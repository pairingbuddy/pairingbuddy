"""Tests for scripts/solo-buddy.sh PR creation feature

This test module validates the behavior of the solo-buddy shell script's PR
creation functionality, including calling gh pr create after claude exits,
handling report files, graceful gh failure handling, exit code propagation,
and branch name extraction for PR title.
"""

import os
import stat
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SCRIPT_PATH = REPO_ROOT / "scripts" / "solo-buddy.sh"


@pytest.fixture
def fake_claude(tmp_path):
    """Creates a fake 'claude' binary with configurable exit code.

    The fake claude writes its arguments to args.txt and its environment
    to env.txt in tmp_path, then exits with the specified exit code.
    """
    claude_bin = tmp_path / "claude"
    args_file = tmp_path / "args.txt"
    env_file = tmp_path / "env.txt"
    exit_code_file = tmp_path / "exit_code.txt"

    # Default exit code is 0
    exit_code_file.write_text("0")

    claude_bin.write_text(
        f"""#!/usr/bin/env bash
printf '%s\\n' "$@" > {args_file}
env > {env_file}
exit $(cat {exit_code_file})
"""
    )
    claude_bin.chmod(claude_bin.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    return {
        "bin_dir": str(tmp_path),
        "args_file": args_file,
        "env_file": env_file,
        "exit_code_file": exit_code_file,
    }


@pytest.fixture
def fake_gh(tmp_path):
    """Creates a fake 'gh' binary that records invocations.

    The fake gh writes its arguments to a log file and exits with a
    configurable exit code.
    """
    gh_bin = tmp_path / "gh"
    gh_log = tmp_path / "gh_invocations.txt"
    gh_exit_code_file = tmp_path / "gh_exit_code.txt"

    # Default gh exit code is 0
    gh_exit_code_file.write_text("0")

    gh_bin.write_text(
        f"""#!/usr/bin/env bash
echo "$@" >> {gh_log}
exit $(cat {gh_exit_code_file})
"""
    )
    gh_bin.chmod(gh_bin.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    return {
        "bin_dir": str(tmp_path),
        "log_file": gh_log,
        "exit_code_file": gh_exit_code_file,
    }


@pytest.fixture
def git_repo(tmp_path):
    """Creates a fake git repository with a known branch name."""
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()

    # Initialize repo and set branch name
    subprocess.run(
        ["git", "init", "-b", "feature/test-branch"],
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

    return {
        "dir": repo_dir,
        "branch": "feature/test-branch",
    }


@pytest.fixture
def plan_file(tmp_path):
    """Creates a minimal plan file for tests that need a valid plan."""
    path = tmp_path / "plan.md"
    path.write_text("# My plan")
    return path


@pytest.fixture
def report_in_repo(git_repo):
    """Creates the .pairingbuddy directory and a minimal report file in the repo."""
    pairingbuddy_dir = git_repo["dir"] / ".pairingbuddy"
    pairingbuddy_dir.mkdir(parents=True, exist_ok=True)
    report_file = pairingbuddy_dir / "SOLO_BUDDY_REPORT.md"
    report_file.write_text("# Report")
    return report_file


def _run_script(args, fake_claude=None, fake_gh=None, cwd=None, env=None):
    """Run solo-buddy.sh with optional fake claude and gh on PATH."""
    script_env = os.environ.copy()
    extra_dirs = []
    if fake_claude:
        extra_dirs.append(fake_claude["bin_dir"])
    if fake_gh and fake_gh["bin_dir"] not in extra_dirs:
        extra_dirs.append(fake_gh["bin_dir"])
    if extra_dirs:
        script_env["PATH"] = ":".join(extra_dirs) + ":" + script_env.get("PATH", "")
    if env:
        script_env.update(env)

    return subprocess.run(
        [str(SCRIPT_PATH)] + args,
        capture_output=True,
        text=True,
        env=script_env,
        cwd=cwd,
    )


# Scenario: exec-replaced-with-regular-call
# The script does not use `exec claude` - it uses a regular subprocess call


def test_claude_invoked_without_exec(plan_file, fake_claude, fake_gh, git_repo, report_in_repo):
    """claude is invoked as a regular subprocess call, not with exec

    When solo-buddy.sh runs, it should call claude as a subprocess (allowing
    the script to continue after claude exits) rather than using 'exec'
    (which replaces the script process entirely).

    We verify this indirectly: if `exec` is used, the script process is
    replaced by claude and no code after it can run. We detect this by
    checking that gh is invoked (which would only happen if execution
    continues after claude returns).
    """
    _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        fake_gh=fake_gh,
        cwd=git_repo["dir"],
    )

    assert fake_gh["log_file"].exists(), (
        "gh was never invoked, which means exec replaced the script process "
        "and no code after claude ran - script must use a regular call, not exec"
    )


# Scenario: pr-creation-after-claude-exits
# gh pr create called on claude success (exit 0) with report, NOT called on claude failure


def test_gh_pr_create_on_success(plan_file, fake_claude, fake_gh, git_repo, report_in_repo):
    """when claude exits with 0, script calls gh pr create

    After claude completes successfully (exit 0), the script should invoke
    gh pr create to create a pull request.
    """
    fake_claude["exit_code_file"].write_text("0")

    _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        fake_gh=fake_gh,
        cwd=git_repo["dir"],
    )

    assert fake_gh["log_file"].exists(), "gh pr create was not called after claude succeeded"
    invocation = fake_gh["log_file"].read_text()
    assert "pr create" in invocation, f"Expected 'gh pr create' to be called, got: {invocation!r}"


def test_gh_pr_create_skipped_on_failure(plan_file, fake_claude, fake_gh, git_repo, report_in_repo):
    """when claude exits with non-zero, script does not call gh pr create

    When claude fails (exits with non-zero status), the script should not
    attempt to create a pull request.
    """
    fake_claude["exit_code_file"].write_text("1")

    _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        fake_gh=fake_gh,
        cwd=git_repo["dir"],
    )

    assert not fake_gh["log_file"].exists(), (
        "gh pr create was called even though claude failed - "
        "script should skip PR creation on claude failure"
    )


# Scenario: report-file-handling
# Report file used as body when exists, fallback when missing


def test_report_file_used_as_body(plan_file, fake_claude, fake_gh, git_repo):
    """when report file exists, its content is passed as --body to gh pr create

    The script should look for a report file generated by claude and use its
    content as the body of the pull request (via --body or --body-file argument
    to gh pr create).
    """
    pairingbuddy_dir = git_repo["dir"] / ".pairingbuddy"
    pairingbuddy_dir.mkdir(parents=True, exist_ok=True)
    report_file = pairingbuddy_dir / "SOLO_BUDDY_REPORT.md"
    report_file.write_text("# Solo Buddy Report\nAll tests passed.")

    fake_claude["exit_code_file"].write_text("0")

    _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        fake_gh=fake_gh,
        cwd=git_repo["dir"],
    )

    assert fake_gh["log_file"].exists(), "gh was not invoked"
    invocation = fake_gh["log_file"].read_text()
    assert "--body-file" in invocation, (
        f"Expected '--body-file' in gh invocation when report exists, got: {invocation!r}"
    )
    assert ".pairingbuddy/SOLO_BUDDY_REPORT.md" in invocation, (
        f"Expected report file path in gh invocation, got: {invocation!r}"
    )


def test_fallback_body_when_report_missing(plan_file, fake_claude, fake_gh, git_repo):
    """when report file doesn't exist, PR is still created without --body-file

    If the expected report file is not found, the script should still create
    a PR but without the --body-file argument (no report to attach).
    """
    # Ensure report file does NOT exist
    report_file = git_repo["dir"] / ".pairingbuddy" / "SOLO_BUDDY_REPORT.md"
    assert not report_file.exists(), "test setup: report file should not exist"

    fake_claude["exit_code_file"].write_text("0")

    _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        fake_gh=fake_gh,
        cwd=git_repo["dir"],
    )

    assert fake_gh["log_file"].exists(), (
        "gh pr create was not called even though claude succeeded - "
        "script should still attempt PR creation when report is missing"
    )
    invocation = fake_gh["log_file"].read_text()
    assert "--body-file" not in invocation, (
        f"Expected no '--body-file' when report is missing, got: {invocation!r}"
    )


# Scenario: gh-failure-graceful-handling
# gh failure doesn't crash script, warns to stderr


def test_gh_failure_warning_message(plan_file, fake_claude, fake_gh, git_repo, report_in_repo):
    """when gh pr create fails, script warns to stderr and continues

    If the gh pr create command fails (exits non-zero), the script should emit
    a warning message to stderr but not crash - the overall script should exit
    with the original claude exit code, not the gh exit code.
    """
    fake_claude["exit_code_file"].write_text("0")
    fake_gh["exit_code_file"].write_text("1")

    result = _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        fake_gh=fake_gh,
        cwd=git_repo["dir"],
    )

    assert result.returncode == 0, (
        f"Script should exit with claude's code (0), not gh's failure code. "
        f"Got exit code: {result.returncode}"
    )
    assert result.stderr, "Script should emit a warning to stderr when gh pr create fails"


# Scenario: claude-exit-code-propagated
# Script exits with claude's exit code


def test_exit_code_matches_claude(plan_file, fake_claude, fake_gh, git_repo, report_in_repo):
    """when claude exits with code N, script also exits with code N

    The script should propagate claude's exit code. If claude exits 0, the
    script should exit 0. If claude exits non-zero, the script should exit
    with the same non-zero code.
    """
    fake_claude["exit_code_file"].write_text("42")

    result = _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        fake_gh=fake_gh,
        cwd=git_repo["dir"],
    )

    assert result.returncode == 42, (
        f"Script should exit with claude's exit code 42, got: {result.returncode}"
    )


# Scenario: branch-name-as-pr-title
# Git branch name used as --title


def test_branch_name_extracted_for_title(plan_file, fake_claude, fake_gh, git_repo, report_in_repo):
    """current git branch name is used as the --title for gh pr create

    When creating the pull request, the script should extract the current
    git branch name and pass it as the --title argument to gh pr create.
    """
    fake_claude["exit_code_file"].write_text("0")

    _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        fake_gh=fake_gh,
        cwd=git_repo["dir"],
    )

    assert fake_gh["log_file"].exists(), "gh was not invoked"
    invocation = fake_gh["log_file"].read_text()
    assert "--title" in invocation, f"Expected '--title' in gh invocation, got: {invocation!r}"
    # Branch 'feature/test-branch' is sanitized: strip 'feature/' prefix,
    # replace hyphens with spaces, capitalize -> 'Test branch'
    assert "Test branch" in invocation, (
        f"Expected sanitized branch name 'Test branch' used as PR title, got: {invocation!r}"
    )
