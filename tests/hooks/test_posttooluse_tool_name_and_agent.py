"""Tests for PostToolUse hook tool_name filtering and agent name extraction.

Tests verify the hook correctly:
1. Filters on tool_name "Agent" (not "Task")
2. Extracts agent name from tool_input.subagent_type (not tool_input.description)
"""

import pytest

from tests.conftest import run_hook


def _make_plan_markdown(checked: int, unchecked: int) -> str:
    lines = ["# Plan\n"]
    for i in range(checked):
        lines.append(f"- [x] Completed task {i + 1}")
    for i in range(unchecked):
        lines.append(f"- [ ] Incomplete task {i + 1}")
    return "\n".join(lines) + "\n"


def _agent_stdin(agent_name: str = "test-agent") -> dict:
    """Create a stdin payload with tool_name='Agent' and subagent_type."""
    return {
        "tool_name": "Agent",
        "tool_input": {
            "subagent_type": agent_name,
            "description": "some description",
        },
    }


def _non_agent_stdin(tool_name: str = "Read") -> dict:
    """Create a stdin payload with a non-Agent tool_name."""
    return {
        "tool_name": tool_name,
        "tool_input": {"path": "some/file.py"},
    }


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


def test_processes_agent_tool_events(solo_tmp_path, plan_env):
    """Scenario: tool-name-filter | Test Case: processes-agent-tool-events

    When tool_name is "Agent", the hook runs and writes output files.
    """
    run_hook(
        plan_env,
        stdin_payload=_agent_stdin(agent_name="test-agent"),
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    assert len(log_lines) >= 1, "Expected hook to write log when tool_name is Agent"


def test_skips_non_agent_tool_events_read(solo_tmp_path):
    """Scenario: tool-name-filter | Test Case: skips-non-agent-tool-events

    When tool_name is not "Agent" (e.g. "Read"), the hook exits early and writes nothing.
    """
    run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_non_agent_stdin("Read"),
        cwd=str(solo_tmp_path),
    )

    log_file = solo_tmp_path / ".pairingbuddy" / "solo-progress.log"
    assert not log_file.exists(), "Expected hook to skip non-Agent tool_name"


def test_skips_non_agent_tool_events_write(solo_tmp_path):
    """Scenario: tool-name-filter | Test Case: skips-non-agent-tool-events

    When tool_name is not "Agent" (e.g. "Write"), the hook exits early and writes nothing.
    """
    run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_non_agent_stdin("Write"),
        cwd=str(solo_tmp_path),
    )

    log_file = solo_tmp_path / ".pairingbuddy" / "solo-progress.log"
    assert not log_file.exists(), "Expected hook to skip non-Agent tool_name"


def test_skips_non_agent_tool_events_task(solo_tmp_path):
    """Scenario: tool-name-filter | Test Case: skips-non-agent-tool-events

    When tool_name is not "Agent" (e.g. "Task"), the hook exits early and writes nothing.
    """
    run_hook(
        {"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=_non_agent_stdin("Task"),
        cwd=str(solo_tmp_path),
    )

    log_file = solo_tmp_path / ".pairingbuddy" / "solo-progress.log"
    assert not log_file.exists(), "Expected hook to skip non-Agent tool_name"


def test_agent_name_from_subagent_type(solo_tmp_path, plan_env):
    """Scenario: agent-name-extraction | Test Case: agent-name-from-subagent-type

    The agent name written to the log comes from tool_input.subagent_type.
    The task description written to the log comes from tool_input.description.
    Both appear in the log line.
    """
    agent_name = "my-special-agent"
    description = "this should appear in log"

    run_hook(
        plan_env,
        stdin_payload={
            "tool_name": "Agent",
            "tool_input": {
                "subagent_type": agent_name,
                "description": description,
            },
        },
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    log_content = "\n".join(log_lines)
    assert agent_name in log_content, (
        f"Expected agent name '{agent_name}' (from subagent_type) in log"
    )
    assert description in log_content, (
        f"Expected description '{description}' from tool_input in log"
    )


def test_agent_name_unknown_when_subagent_type_absent(solo_tmp_path, plan_env):
    """Scenario: agent-name-extraction | Test Case: agent-name-unknown-when-subagent-type-absent

    Falls back to "unknown" when subagent_type is missing.
    """
    run_hook(
        plan_env,
        stdin_payload={
            "tool_name": "Agent",
            "tool_input": {
                "description": "some description without subagent_type",
            },
        },
        cwd=str(solo_tmp_path),
    )

    log_lines = _read_log_lines(solo_tmp_path)
    log_content = "\n".join(log_lines)
    assert "unknown" in log_content, (
        f"Expected fallback to 'unknown' when subagent_type missing, got: {log_content}"
    )
