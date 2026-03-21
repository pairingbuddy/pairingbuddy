"""Tests for scripts/solo-buddy.sh

This test module validates the behavior of the solo-buddy shell script,
including file structure, argument validation, CLI invocation flags, and
environment variable handling.
"""

import os
import stat
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SCRIPT_PATH = REPO_ROOT / "scripts" / "solo-buddy.sh"


# Scenario: script-file-structure
# The script file exists and is executable


def test_script_file_exists():
    """scripts/solo-buddy.sh exists in the repository"""
    assert SCRIPT_PATH.exists(), f"Expected {SCRIPT_PATH} to exist"


def test_script_is_executable():
    """the file has executable permissions"""
    file_stat = SCRIPT_PATH.stat()
    is_executable = bool(file_stat.st_mode & stat.S_IXUSR)
    assert is_executable, f"Expected {SCRIPT_PATH} to have user execute permission (chmod +x)"


@pytest.fixture
def fake_claude(tmp_path):
    """Creates a fake 'claude' binary that captures its invocation details.

    The fake claude writes its arguments to args.txt and its environment
    to env.txt in tmp_path, then exits 0.
    """
    claude_bin = tmp_path / "claude"
    args_file = tmp_path / "args.txt"
    env_file = tmp_path / "env.txt"

    claude_bin.write_text(
        f"""#!/usr/bin/env bash
printf '%s\\n' "$@" > {args_file}
env > {env_file}
exit 0
"""
    )
    claude_bin.chmod(claude_bin.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    return {
        "bin_dir": str(tmp_path),
        "args_file": args_file,
        "env_file": env_file,
    }


@pytest.fixture
def plan_file(tmp_path):
    """Creates a minimal plan file for tests that need a valid plan."""
    path = tmp_path / "plan.md"
    path.write_text("# My plan")
    return path


def _run_script(args, fake_claude=None, env=None):
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
    )


# Scenario: plan-file-validation
# The script validates the plan file argument before invoking claude


def test_missing_plan_argument_exits_nonzero():
    """calling script with no arguments exits with non-zero status and prints usage/error"""
    result = _run_script([])

    assert result.returncode != 0
    assert "plan_file" in result.stderr


def test_nonexistent_plan_file_exits_nonzero(tmp_path):
    """calling script with a path that doesn't exist exits with error"""
    nonexistent = str(tmp_path / "does_not_exist.md")

    result = _run_script([nonexistent])

    assert result.returncode != 0
    assert "not found" in result.stderr


def test_valid_plan_file_accepted(plan_file, fake_claude):
    """calling script with an existing file does not exit early with a validation error"""
    result = _run_script([str(plan_file)], fake_claude=fake_claude)

    assert result.returncode == 0


# Scenario: claude-invocation-flags
# The script constructs the correct claude CLI invocation


def test_invokes_with_print_flag(plan_file, fake_claude):
    """the script invokes claude with -p or --print"""
    _run_script([str(plan_file)], fake_claude=fake_claude)

    args = fake_claude["args_file"].read_text().splitlines()
    assert "-p" in args or "--print" in args


def test_invokes_with_dangerously_skip_permissions(plan_file, fake_claude):
    """the script passes --dangerously-skip-permissions"""
    _run_script([str(plan_file)], fake_claude=fake_claude)

    args = fake_claude["args_file"].read_text().splitlines()
    assert "--dangerously-skip-permissions" in args


def test_invokes_with_json_output_format(plan_file, fake_claude):
    """the script passes --output-format json"""
    _run_script([str(plan_file)], fake_claude=fake_claude)

    args = fake_claude["args_file"].read_text().splitlines()
    assert "--output-format" in args
    output_format_index = args.index("--output-format")
    assert args[output_format_index + 1] == "json"


def test_prompt_includes_plan_path(plan_file, fake_claude):
    """the prompt passed to claude contains 'Execute the plan at:' and the plan file path"""
    _run_script([str(plan_file)], fake_claude=fake_claude)

    args_text = fake_claude["args_file"].read_text()
    assert "/pairingbuddy:code" in args_text
    assert "execute the plan at:" in args_text.lower()
    assert str(plan_file) in args_text


# Scenario: solo-env-var
# The script sets the PAIRINGBUDDY_SOLO environment variable


def test_sets_pairingbuddy_solo_true(plan_file, fake_claude):
    """PAIRINGBUDDY_SOLO=true is set in the claude subprocess environment"""
    _run_script([str(plan_file)], fake_claude=fake_claude)

    env_text = fake_claude["env_file"].read_text()
    assert "PAIRINGBUDDY_SOLO=true" in env_text


# Scenario: max-retries-flag
# The -n flag controls max retries with a default of 5


def test_default_retries_is_five(plan_file, fake_claude):
    """when -n is not specified, script runs successfully with default retries"""
    result = _run_script([str(plan_file)], fake_claude=fake_claude)

    assert result.returncode == 0


def test_custom_retries_accepted(plan_file, fake_claude):
    """when -n 3 is specified, the flag is accepted without error"""
    result = _run_script(["-n", "3", str(plan_file)], fake_claude=fake_claude)

    assert result.returncode == 0


# Scenario: api-key-safety
# The script unsets ANTHROPIC_API_KEY by default to prevent unexpected API billing


def test_api_key_unset_by_default(plan_file, fake_claude):
    """ANTHROPIC_API_KEY is NOT present in the claude subprocess environment by default"""
    _run_script(
        [str(plan_file)],
        fake_claude=fake_claude,
        env={"ANTHROPIC_API_KEY": "sk-test-key-should-be-removed"},
    )

    env_text = fake_claude["env_file"].read_text()
    assert "sk-test-key-should-be-removed" not in env_text
    assert "ANTHROPIC_API_KEY" not in env_text


def test_api_key_preserved_with_use_api_key_flag(plan_file, fake_claude):
    """ANTHROPIC_API_KEY IS present when --use-api-key is passed"""
    _run_script(
        ["--use-api-key", str(plan_file)],
        fake_claude=fake_claude,
        env={"ANTHROPIC_API_KEY": "sk-test-key-should-be-kept"},
    )

    env_text = fake_claude["env_file"].read_text()
    assert "sk-test-key-should-be-kept" in env_text


# Scenario: help-flag
# The script includes usage help


def test_help_flag_prints_usage():
    """-h or --help prints usage information and exits 0"""
    result = _run_script(["-h"])

    assert result.returncode == 0
    assert "Usage" in result.stdout
    assert "plan_file" in result.stdout
