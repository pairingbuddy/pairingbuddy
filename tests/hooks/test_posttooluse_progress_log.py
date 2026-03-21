"""Tests for PostToolUse hook progress log functionality.

Tests verify the hook creates and maintains solo-progress.log with proper formatting
for tracking task execution progress in Solo mode.
"""

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


def test_log_file_created_when_absent(solo_tmp_path):
    """Scenario: log-file-creation | Test Case: log-file-created-when-absent

    When solo-progress.log does not exist, the hook creates it and writes a single line.
    """
    run_hook({"PAIRINGBUDDY_SOLO": "true"}, stdin_payload=_task_stdin(), cwd=str(solo_tmp_path))

    _read_log_lines(solo_tmp_path)


def test_log_line_has_iso8601_timestamp(solo_tmp_path, plan_env):
    """Scenario: log-line-format-with-progress | Test Case: log-line-has-iso8601-timestamp

    The log line starts with an ISO-8601 timestamp (e.g. '2025-01-01T00:00:00.000Z').
    """
    run_hook(plan_env, stdin_payload=_task_stdin(), cwd=str(solo_tmp_path))

    first_line = _read_log_lines(solo_tmp_path)[0]
    iso8601_pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"
    assert re.match(iso8601_pattern, first_line), (
        f"Expected log line to start with ISO 8601 timestamp, got: {first_line!r}"
    )


def test_log_line_has_nm_bracket_notation(solo_tmp_path, plan_env):
    """Scenario: log-line-format-with-progress | Test Case: log-line-has-nm-bracket-notation

    When progress is known, the log line contains '[N/M]' with correct
    completed and total counts.
    """
    run_hook(plan_env, stdin_payload=_task_stdin(), cwd=str(solo_tmp_path))

    log_content = "\n".join(_read_log_lines(solo_tmp_path))
    assert "[3/7]" in log_content, (
        f"Expected '[3/7]' in solo-progress.log for 3 completed out of 7, got: {log_content!r}"
    )


def test_log_line_has_agent_name(solo_tmp_path):
    """Scenario: log-line-format-with-progress | Test Case: log-line-has-agent-name

    The log line contains the agent name from tool_input.subagent_type.
    """
    agent_name = "my-special-agent"

    run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_task_stdin(agent_name=agent_name),
        cwd=str(solo_tmp_path),
    )

    log_content = "\n".join(_read_log_lines(solo_tmp_path))
    assert agent_name in log_content, (
        f"Expected agent name '{agent_name}' in solo-progress.log, got: {log_content!r}"
    )


def test_log_line_unknown_uses_question_mark_notation(solo_tmp_path):
    """Scenario: log-line-format-unknown-progress | Test: unknown-question-mark

    When no plan is available, the log line contains '[?/?]' instead of
    '[N/M]'.
    """
    run_hook({"PAIRINGBUDDY_SOLO": "true"}, stdin_payload=_task_stdin(), cwd=str(solo_tmp_path))

    log_content = "\n".join(_read_log_lines(solo_tmp_path))
    assert "[?/?]" in log_content, (
        f"Expected '[?/?]' in solo-progress.log when no plan available, got: {log_content!r}"
    )


def test_log_line_unknown_still_has_timestamp_and_agent(solo_tmp_path):
    """Scenario: log-line-format-unknown-progress | Test: unknown-timestamp-agent

    When no plan is available, the log line still contains an ISO-8601
    timestamp and the agent name.
    """
    agent_name = "some-agent"

    run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_task_stdin(agent_name=agent_name),
        cwd=str(solo_tmp_path),
    )

    first_line = _read_log_lines(solo_tmp_path)[0]
    iso8601_pattern = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"
    assert re.search(iso8601_pattern, first_line), (
        f"Expected ISO 8601 timestamp in log line, got: {first_line!r}"
    )
    assert agent_name in first_line, (
        f"Expected agent name '{agent_name}' in log line, got: {first_line!r}"
    )


def test_second_invocation_appends_new_line(solo_tmp_path):
    """Scenario: append-only-behavior | Test Case: second-invocation-appends-new-line

    Running the hook twice produces a log file with exactly two lines, preserving the first entry.
    """
    run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_task_stdin("agent-one"),
        cwd=str(solo_tmp_path),
    )
    run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_task_stdin("agent-two"),
        cwd=str(solo_tmp_path),
    )

    lines = _read_log_lines(solo_tmp_path)
    assert len(lines) == 2, (
        f"Expected exactly 2 lines after two invocations, got {len(lines)}: {lines!r}"
    )
    assert "agent-one" in lines[0], (
        f"Expected first entry to contain 'agent-one', got: {lines[0]!r}"
    )
    assert "agent-two" in lines[1], (
        f"Expected second entry to contain 'agent-two', got: {lines[1]!r}"
    )


def test_no_log_when_not_solo_mode(solo_tmp_path):
    """Scenario: solo-mode-guard | Test Case: no-log-when-not-solo-mode

    When PAIRINGBUDDY_SOLO is unset or false, solo-progress.log is not created.
    """
    # run_hook removes PAIRINGBUDDY_SOLO by default; pass empty dict to leave it unset
    run_hook({}, stdin_payload=_task_stdin(), cwd=str(solo_tmp_path))

    log_file = solo_tmp_path / ".pairingbuddy" / "solo-progress.log"
    assert not log_file.exists(), (
        "Expected solo-progress.log NOT to be created when PAIRINGBUDDY_SOLO is unset"
    )


def test_no_log_for_non_task_tool(solo_tmp_path):
    """Scenario: solo-mode-guard | Test Case: no-log-for-non-task-tool

    When the tool_name is not 'Agent' (e.g. 'Write'), solo-progress.log is not written to.
    """
    stdin_payload = {"tool_name": "Read", "tool_input": {"path": "some/file.py"}}

    run_hook({"PAIRINGBUDDY_SOLO": "true"}, stdin_payload=stdin_payload, cwd=str(solo_tmp_path))

    log_file = solo_tmp_path / ".pairingbuddy" / "solo-progress.log"
    assert not log_file.exists(), (
        "Expected solo-progress.log NOT to be created for non-Task tool (Read)"
    )
