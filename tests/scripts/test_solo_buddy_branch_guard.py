"""Tests for scripts/solo-buddy.sh branch guard feature

This test module validates that the solo-buddy script exits early with
an error when invoked on protected branches (main/master) before any
code execution begins.
"""

import os
import re
import stat
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
SCRIPT_PATH = REPO_ROOT / "scripts" / "solo-buddy.sh"


@pytest.fixture
def fake_claude(tmp_path):
    """Creates a fake 'claude' binary that records invocations.

    The fake claude writes its arguments to args.txt and exits with code 0.
    If this fixture is used in a test, it means the script reached the point
    where it would call claude - meaning the branch guard did NOT prevent it.
    """
    claude_bin = tmp_path / "claude"
    args_file = tmp_path / "args.txt"

    claude_bin.write_text(
        f"""#!/usr/bin/env bash
printf '%s\\n' "$@" > {args_file}
exit 0
"""
    )
    claude_bin.chmod(claude_bin.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    return {
        "bin_dir": str(tmp_path),
        "args_file": args_file,
    }


@pytest.fixture
def plan_file(tmp_path):
    """Creates a minimal plan file for tests that need a valid plan."""
    path = tmp_path / "plan.md"
    path.write_text("# My plan")
    return path


@pytest.fixture
def git_repo_on_branch(tmp_path):
    """Creates a git repository on a configurable branch.

    Returns a fixture that accepts a branch name and creates/checks out
    a repo on that branch.
    """

    def _create_repo(branch_name):
        repo_dir = tmp_path / "repo"
        repo_dir.mkdir(exist_ok=True)

        # Initialize repo on the desired branch
        subprocess.run(
            ["git", "init", "-b", branch_name],
            cwd=repo_dir,
            capture_output=True,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=repo_dir,
            capture_output=True,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=repo_dir,
            capture_output=True,
            check=True,
        )

        return repo_dir

    return _create_repo


def _run_script(args, fake_claude=None, cwd=None, env=None):
    """Run solo-buddy.sh with optional fake claude on PATH."""
    script_env = os.environ.copy()
    if fake_claude:
        script_env["PATH"] = fake_claude["bin_dir"] + ":" + script_env.get("PATH", "")
    if env:
        script_env.update(env)

    return subprocess.run(
        [str(SCRIPT_PATH)] + args,
        capture_output=True,
        text=True,
        env=script_env,
        cwd=cwd,
    )


# Scenario: branch-guard-protection
# The script refuses to run on main/master branches to prevent accidental pushes


def test_exits_nonzero_on_main(plan_file, git_repo_on_branch, fake_claude):
    """when on 'main' branch, script exits with non-zero status

    The branch guard should prevent the script from running on the main
    branch to avoid accidental pushes. The script should exit immediately
    with a non-zero status.
    """
    repo_dir = git_repo_on_branch("main")

    result = _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        cwd=repo_dir,
    )

    assert result.returncode != 0, (
        f"Script should exit with non-zero on main branch, but exited with {result.returncode}"
    )


def test_exits_nonzero_on_master(plan_file, git_repo_on_branch, fake_claude):
    """when on 'master' branch, script exits with non-zero status

    The branch guard should also protect against the older 'master' branch
    naming convention. The script should exit immediately with a non-zero status.
    """
    repo_dir = git_repo_on_branch("master")

    result = _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        cwd=repo_dir,
    )

    assert result.returncode != 0, (
        f"Script should exit with non-zero on master branch, but exited with {result.returncode}"
    )


def test_error_message_mentions_branch(plan_file, git_repo_on_branch):
    """when guard blocks execution, error message mentions the branch name

    The error message should clearly indicate which branch the user is on
    and why the script refused to run. This helps the user understand what
    went wrong.
    """
    repo_dir = git_repo_on_branch("main")

    result = _run_script(
        [str(plan_file)],
        cwd=repo_dir,
    )

    assert result.returncode != 0, "Script should exit with non-zero on main"
    error_output = result.stderr + result.stdout
    assert "main" in error_output.lower(), (
        "Error message should mention 'main' branch name, "
        f"but got stderr: {result.stderr!r}, stdout: {result.stdout!r}"
    )


def test_continues_on_feature_branch(plan_file, git_repo_on_branch, fake_claude):
    """when on a feature branch, script proceeds normally (returncode 0)

    The branch guard should only block main/master. Any other branch name
    (like feature/*, bugfix/*, etc.) should be allowed to proceed. We verify
    this by checking that the script exits with 0 (success) when the fake
    claude succeeds.
    """
    repo_dir = git_repo_on_branch("feature/test")

    result = _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        cwd=repo_dir,
    )

    assert result.returncode == 0, (
        "Script should proceed normally on feature branch, "
        f"but exited with {result.returncode}. "
        f"stderr: {result.stderr!r}"
    )


def test_guard_before_start_renderer(plan_file, git_repo_on_branch):
    """structural: branch guard is checked before start_renderer is called

    The guard check must happen before start_renderer to avoid spawning
    background processes that need cleanup. We verify this by reading the
    script source and checking that the guard appears before start_renderer
    in the main execution flow.
    """
    script_content = SCRIPT_PATH.read_text()

    # Find positions of key elements in the script
    # The branch guard should be an if-statement checking for main/master
    guard_pattern = r"if\s+\[\[.*\$BRANCH.*==.*(?:main|master)"
    guard_match = re.search(guard_pattern, script_content)

    # start_renderer is called explicitly in the script
    renderer_pattern = r"start_renderer\s*\("
    renderer_match = re.search(renderer_pattern, script_content)

    assert guard_match is not None, (
        "Script should have a branch guard checking BRANCH against main/master. "
        "Could not find pattern like: if [[ $BRANCH == main || $BRANCH == master ]]"
    )

    assert renderer_match is not None, "Script should call start_renderer"

    # Verify guard appears before renderer
    assert guard_match.start() < renderer_match.start(), (
        f"Branch guard (at position {guard_match.start()}) should appear "
        f"BEFORE start_renderer (at position {renderer_match.start()}) "
        f"to avoid spawning background processes on protected branches"
    )
