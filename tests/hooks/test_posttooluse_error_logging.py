"""Tests for PostToolUse hook error logging functionality.

Tests verify the hook gracefully handles invalid input and logs errors to
solo-progress-errors.log with proper formatting.
"""

import os
import re
import subprocess
from pathlib import Path

import pytest

from tests.conftest import run_hook

HOOK_PATH = Path(__file__).parent.parent.parent / "hooks" / "solo-progress.mjs"


def _agent_stdin(agent_name: str = "test-agent") -> dict:
    """Create a valid stdin payload with tool_name='Agent'."""
    return {
        "tool_name": "Agent",
        "tool_input": {
            "subagent_type": agent_name,
        },
    }


def _run_hook_with_raw_stdin(
    env_vars: dict,
    raw_stdin: str,
    cwd: str | None = None,
) -> subprocess.CompletedProcess:
    """Run the solo-progress.mjs hook with raw stdin (not JSON-encoded)."""
    env = os.environ.copy()
    env.pop("PAIRINGBUDDY_SOLO", None)
    env.update(env_vars)

    return subprocess.run(
        ["node", str(HOOK_PATH)],
        input=raw_stdin,
        capture_output=True,
        text=True,
        env=env,
        cwd=cwd,
    )


def _read_error_log_lines(tmp_path) -> list[str]:
    """Read solo-progress-errors.log and return its non-empty lines."""
    error_file = tmp_path / ".pairingbuddy" / "solo-progress-errors.log"
    if not error_file.exists():
        return []
    return [line for line in error_file.read_text().splitlines() if line.strip()]


@pytest.fixture
def solo_tmp_path(tmp_path):
    """Create the .pairingbuddy directory and yield tmp_path."""
    (tmp_path / ".pairingbuddy").mkdir()
    yield tmp_path


def test_error_written_to_error_log(solo_tmp_path):
    """Scenario: error-log-on-stdin-failure | Test Case: error-written-to-error-log

    When invalid JSON is provided on stdin, an error entry is written to
    solo-progress-errors.log.
    """
    _run_hook_with_raw_stdin(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        raw_stdin="this is not valid json{{{",
        cwd=str(solo_tmp_path),
    )

    lines = _read_error_log_lines(solo_tmp_path)

    assert len(lines) >= 1, "Expected at least one entry in solo-progress-errors.log"


def test_error_log_entry_has_timestamp(solo_tmp_path):
    """Scenario: error-log-on-stdin-failure | Test Case: error-log-entry-has-timestamp

    Error log entries start with an ISO-8601 timestamp (e.g. '2025-01-01T00:00:00.000Z').
    """
    _run_hook_with_raw_stdin(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        raw_stdin="not json at all",
        cwd=str(solo_tmp_path),
    )

    lines = _read_error_log_lines(solo_tmp_path)

    assert len(lines) >= 1, "Expected at least one entry in solo-progress-errors.log"
    iso_8601_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z")
    assert iso_8601_pattern.match(lines[0]), (
        f"Expected line to start with ISO-8601 timestamp, got: {lines[0]!r}"
    )


def test_error_log_entry_has_error_message(solo_tmp_path):
    """Scenario: error-log-on-stdin-failure | Test Case: error-log-entry-has-error-message

    Error log entries contain error information describing what went wrong.
    """
    _run_hook_with_raw_stdin(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        raw_stdin="totally invalid {json",
        cwd=str(solo_tmp_path),
    )

    lines = _read_error_log_lines(solo_tmp_path)

    assert len(lines) >= 1, "Expected at least one entry in solo-progress-errors.log"
    # The entry should contain something describing the error, not just a timestamp
    full_line = lines[0]
    # Strip leading timestamp (up to and including 'Z ') to check remaining content
    after_timestamp = re.sub(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*", "", full_line)
    assert len(after_timestamp) > 0, "Expected error message content after timestamp"


def test_exits_zero_on_invalid_json(solo_tmp_path):
    """Scenario: exit-code-zero-on-failure | Test Case: exits-zero-on-invalid-json

    The hook exits with code 0 even when receiving invalid JSON on stdin,
    allowing graceful degradation in Solo mode.
    """
    result = _run_hook_with_raw_stdin(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        raw_stdin="not valid json at all }{",
        cwd=str(solo_tmp_path),
    )

    assert result.returncode == 0, (
        f"Expected exit code 0, got {result.returncode}. stderr: {result.stderr!r}"
    )


def test_multiple_errors_append_multiple_entries(solo_tmp_path):
    """Scenario: append-only-error-log | Test Case: multiple-errors-append-multiple-entries

    Running the hook twice with invalid input produces a log file with exactly
    two error entries, preserving the first entry.
    """
    _run_hook_with_raw_stdin(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        raw_stdin="bad json first run",
        cwd=str(solo_tmp_path),
    )
    _run_hook_with_raw_stdin(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        raw_stdin="bad json second run",
        cwd=str(solo_tmp_path),
    )

    lines = _read_error_log_lines(solo_tmp_path)

    assert len(lines) == 2, (
        f"Expected exactly 2 error entries (append mode), got {len(lines)}: {lines}"
    )


def test_exits_zero_when_pairingbuddy_dir_absent(tmp_path):
    """Scenario: missing-pairingbuddy-dir | Test Case: exits-zero-when-pairingbuddy-dir-absent

    When .pairingbuddy/ directory does not exist, the hook exits with code 0
    (no error crash).
    """
    result = _run_hook_with_raw_stdin(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        raw_stdin="invalid json here",
        cwd=str(tmp_path),
    )

    assert result.returncode == 0, (
        f"Expected exit code 0 when .pairingbuddy/ is absent, got {result.returncode}. "
        f"stderr: {result.stderr!r}"
    )


def test_no_error_log_outside_pairingbuddy_dir(tmp_path):
    """Scenario: missing-pairingbuddy-dir | Test Case: no-error-log-outside-pairingbuddy-dir

    When .pairingbuddy/ directory is missing, no error log file is created
    outside of .pairingbuddy/.
    """
    _run_hook_with_raw_stdin(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        raw_stdin="invalid json here",
        cwd=str(tmp_path),
    )

    # No file named solo-progress-errors.log should exist anywhere in tmp_path
    error_logs = list(tmp_path.rglob("solo-progress-errors.log"))
    assert error_logs == [], (
        f"Expected no error log files outside .pairingbuddy/, found: {error_logs}"
    )


def test_successful_invocation_still_writes_progress_log(solo_tmp_path):
    """Test that valid invocations write to progress log without interference.

    Scenario: normal-operation-unaffected
    Test Case: successful-invocation-still-writes-progress-log

    Valid invocations still write to solo-progress.log as expected; error logging
    does not interfere with normal operation.
    """
    run_hook(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_agent_stdin("write-tests"),
        cwd=str(solo_tmp_path),
    )

    progress_log = solo_tmp_path / ".pairingbuddy" / "solo-progress.log"
    assert progress_log.exists(), "Expected solo-progress.log to exist after valid invocation"
    content = progress_log.read_text()
    assert "write-tests" in content, (
        f"Expected agent name 'write-tests' in progress log, got: {content!r}"
    )
