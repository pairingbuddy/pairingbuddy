"""Tests for PostToolUse hook file extraction functionality.

Tests verify the hook extracts the current file path from state files and includes
it in solo-status and solo-progress.log for tracking which file is being worked on.
"""

import json
import re

import pytest

from tests.conftest import run_hook


def _make_plan_markdown(checked: int, unchecked: int) -> str:
    lines = ["# Plan\n"]
    for i in range(checked):
        lines.append(f"- [x] Completed task {i + 1}")
    for i in range(unchecked):
        lines.append(f"- [ ] Incomplete task {i + 1}")
    return "\n".join(lines) + "\n"


def _task_stdin(agent_name: str = "test-agent") -> dict:
    return {"tool_name": "Agent", "tool_input": {"subagent_type": agent_name}}


def _read_log_lines(tmp_path) -> list[str]:
    """Assert solo-progress.log exists and return its non-empty lines."""
    log_file = tmp_path / ".pairingbuddy" / "solo-progress.log"
    assert log_file.exists(), "Expected .pairingbuddy/solo-progress.log to be created"
    return [line for line in log_file.read_text().splitlines() if line.strip()]


def _read_status_lines(tmp_path) -> list[str]:
    """Read solo-status file and return its non-empty lines."""
    status_file = tmp_path / ".pairingbuddy" / "solo-status"
    assert status_file.exists(), "Expected .pairingbuddy/solo-status to be created"
    return [line for line in status_file.read_text().splitlines() if line.strip()]


@pytest.fixture
def solo_tmp_path(tmp_path):
    """Create the .pairingbuddy directory and yield tmp_path."""
    (tmp_path / ".pairingbuddy").mkdir()
    yield tmp_path


@pytest.fixture
def plan_env(solo_tmp_path):
    """Create a plan file and return the env dict with PAIRINGBUDDY_PLAN_PATH set."""
    plan_file = solo_tmp_path / "plan.md"
    plan_file.write_text(_make_plan_markdown(checked=3, unchecked=4))
    return {
        "PAIRINGBUDDY_SOLO": "true",
        "PAIRINGBUDDY_PLAN_PATH": str(plan_file),
    }


def test_current_batch_json_returns_first_test_file(solo_tmp_path, plan_env):
    """Scenario: find-current-file-from-state.

    Test Case: current-batch-json-returns-first-test-file

    Returns batch[0].test_file from .pairingbuddy/current-batch.json when the file
    is present.
    """
    current_batch_file = solo_tmp_path / ".pairingbuddy" / "current-batch.json"
    current_batch_file.write_text(
        json.dumps(
            {
                "batch": [
                    {"test_file": "tests/test_example.py", "test_function": "test_one"},
                    {"test_file": "tests/test_other.py", "test_function": "test_two"},
                ]
            }
        )
    )

    run_hook(
        plan_env,
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    assert any("tests/test_example.py" in line for line in log_lines), (
        f"Expected 'tests/test_example.py' in log, got: {log_lines}"
    )


def test_tests_json_fallback_returns_first_test_file(solo_tmp_path, plan_env):
    """Scenario: find-current-file-from-state.

    Test Case: tests-json-fallback-returns-first-test-file

    Falls back to the first test_file from .pairingbuddy/tests.json when
    current-batch.json is absent.
    """
    tests_file = solo_tmp_path / ".pairingbuddy" / "tests.json"
    tests_file.write_text(
        json.dumps(
            {
                "tests": [
                    {
                        "test_id": "t1",
                        "test_file": "tests/test_fallback.py",
                        "test_function": "test_fallback",
                    },
                    {
                        "test_id": "t2",
                        "test_file": "tests/test_other.py",
                        "test_function": "test_other",
                    },
                ]
            }
        )
    )

    run_hook(
        plan_env,
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    assert any("tests/test_fallback.py" in line for line in log_lines), (
        f"Expected 'tests/test_fallback.py' in log, got: {log_lines}"
    )


def test_current_batch_takes_priority_over_tests_json(solo_tmp_path, plan_env):
    """Scenario: find-current-file-from-state.

    Test Case: current-batch-takes-priority-over-tests-json

    When both current-batch.json and tests.json exist, the file path from
    current-batch.json is used.
    """
    current_batch_file = solo_tmp_path / ".pairingbuddy" / "current-batch.json"
    current_batch_file.write_text(
        json.dumps(
            {
                "batch": [
                    {"test_file": "tests/test_priority.py", "test_function": "test_priority"},
                ]
            }
        )
    )

    tests_file = solo_tmp_path / ".pairingbuddy" / "tests.json"
    tests_file.write_text(
        json.dumps(
            {
                "tests": [
                    {
                        "test_id": "t1",
                        "test_file": "tests/test_secondary.py",
                        "test_function": "test_secondary",
                    },
                ]
            }
        )
    )

    run_hook(
        plan_env,
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    assert any("tests/test_priority.py" in line for line in log_lines), (
        f"Expected 'tests/test_priority.py' from current-batch, got: {log_lines}"
    )
    assert not any("tests/test_secondary.py" in line for line in log_lines), (
        f"Should not use tests.json when current-batch exists, got: {log_lines}"
    )


def test_returns_null_when_no_state_files_present(solo_tmp_path):
    """Scenario: find-current-file-from-state | Test Case: returns-null-when-no-state-files-present

    Returns null when neither current-batch.json nor tests.json exists.
    """
    run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    assert len(log_lines) >= 1, "Expected at least one log line"
    # When no file is found, no log line should contain a "File:" field
    assert not any("File:" in line for line in log_lines), (
        f"Expected no 'File:' in log when state files absent, got: {log_lines}"
    )


def test_returns_null_when_state_files_have_no_file_path(solo_tmp_path):
    """Scenario: find-current-file-from-state.

    Test Case: returns-null-when-state-files-have-no-file-path

    Returns null when state files exist but contain no test_file values.
    """
    current_batch_file = solo_tmp_path / ".pairingbuddy" / "current-batch.json"
    current_batch_file.write_text(json.dumps({"batch": []}))

    run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    assert len(log_lines) >= 1, "Expected at least one log line"
    # When no file is found, no log line should contain a "File:" field
    assert not any("File:" in line for line in log_lines), (
        f"Expected no 'File:' in log when batch is empty, got: {log_lines}"
    )


def test_status_shows_file_line_when_file_path_available(solo_tmp_path, plan_env):
    """Scenario: solo-status-includes-file-line.

    Test Case: status-shows-file-line-when-file-path-available

    A 'File: <path>' line appears in solo-status when a file path is found in
    state files.
    """
    current_batch_file = solo_tmp_path / ".pairingbuddy" / "current-batch.json"
    current_batch_file.write_text(
        json.dumps(
            {
                "batch": [
                    {"test_file": "tests/test_status.py", "test_function": "test_status"},
                ]
            }
        )
    )

    run_hook(
        plan_env,
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    status_lines = _read_status_lines(solo_tmp_path)
    assert any("File:" in line and "tests/test_status.py" in line for line in status_lines), (
        f"Expected 'File: tests/test_status.py' in solo-status, got: {status_lines}"
    )


def test_status_omits_file_line_when_no_file_path(solo_tmp_path, plan_env):
    """Scenario: solo-status-includes-file-line.

    Test Case: status-omits-file-line-when-no-file-path

    No 'File:' line appears in solo-status when no state file provides a file path.
    """
    run_hook(
        plan_env,
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    status_lines = _read_status_lines(solo_tmp_path)
    assert not any("File:" in line for line in status_lines), (
        f"Expected no 'File:' line when no file available, got: {status_lines}"
    )


def test_status_file_line_position_after_agent_line(solo_tmp_path, plan_env):
    """Scenario: solo-status-includes-file-line.

    Test Case: status-file-line-position-after-agent-line

    The 'File:' line appears on the third line, immediately after the 'Agent:' line
    in the known-progress format.
    """
    current_batch_file = solo_tmp_path / ".pairingbuddy" / "current-batch.json"
    current_batch_file.write_text(
        json.dumps(
            {
                "batch": [
                    {"test_file": "tests/test_position.py", "test_function": "test_position"},
                ]
            }
        )
    )

    run_hook(
        plan_env,
        stdin_payload=_task_stdin(agent_name="test-agent"),
        cwd=str(solo_tmp_path),
    )

    status_lines = _read_status_lines(solo_tmp_path)
    assert len(status_lines) >= 3, (
        f"Expected at least 3 lines in solo-status, got {len(status_lines)}: {status_lines}"
    )
    assert "Agent:" in status_lines[1], (
        f"Expected 'Agent:' on line 2 (index 1), got: {status_lines}"
    )
    assert "File:" in status_lines[2], f"Expected 'File:' on line 3 (index 2), got: {status_lines}"


def test_log_line_includes_file_path_when_available(solo_tmp_path, plan_env):
    """Scenario: progress-log-includes-file-path.

    Test Case: log-line-includes-file-path-when-available

    The log line contains the file path from state when one is found.
    """
    current_batch_file = solo_tmp_path / ".pairingbuddy" / "current-batch.json"
    current_batch_file.write_text(
        json.dumps(
            {
                "batch": [
                    {"test_file": "tests/test_log_file.py", "test_function": "test_log"},
                ]
            }
        )
    )

    run_hook(
        plan_env,
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    assert any("tests/test_log_file.py" in line for line in log_lines), (
        f"Expected 'tests/test_log_file.py' in log line, got: {log_lines}"
    )


def test_log_line_omits_file_path_when_unavailable(solo_tmp_path, plan_env):
    """Scenario: progress-log-includes-file-path.

    Test Case: log-line-omits-file-path-when-unavailable

    The log line does not include a file path segment when no state file provides one.
    """
    run_hook(
        plan_env,
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    assert len(log_lines) >= 1, "Expected at least one log line"
    # When no file is found, the log should not contain test file paths
    first_line = log_lines[0]
    assert not re.search(r"(tests/|src/)[^\s]*\.py", first_line), (
        f"Expected no file path in log when unavailable, got: {first_line}"
    )


def test_hook_exits_cleanly_when_pairingbuddy_dir_absent(tmp_path):
    """Scenario: no-errors-when-state-files-absent.

    Test Case: hook-exits-cleanly-when-pairingbuddy-dir-absent

    The hook exits with code 0 and no crash when the .pairingbuddy/ directory does
    not exist at all.
    """
    # Don't create .pairingbuddy directory
    result = run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_task_stdin(),
        cwd=str(tmp_path),
    )

    assert result.returncode == 0, (
        f"Expected clean exit, got returncode={result.returncode}, stderr={result.stderr!r}"
    )


def test_hook_exits_cleanly_when_state_files_absent(solo_tmp_path):
    """Scenario: no-errors-when-state-files-absent.

    Test Case: hook-exits-cleanly-when-state-files-absent

    The hook exits with code 0 when .pairingbuddy/ exists but current-batch.json
    and tests.json are both absent.
    """
    result = run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_task_stdin(),
        cwd=str(solo_tmp_path),
    )

    assert result.returncode == 0, (
        f"Expected clean exit, got returncode={result.returncode}, stderr={result.stderr!r}"
    )
