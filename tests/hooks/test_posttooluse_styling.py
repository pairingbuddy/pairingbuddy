"""Tests for solo-progress.mjs color and styling implementation.

Tests verify the styling spec:
1. Completed tasks: green (\x1b[32m) ✓ symbol AND text
2. Active task: cyan (\x1b[36m) → symbol AND text
3. Pending tasks: dim gray (\x1b[2m or \x1b[90m) ○ symbol AND text
4. Agent line: dim (\x1b[2m) — the whole "Agent: name" line
5. Progress bar fill: cyan (\x1b[36m) █ blocks (was green)
6. Progress bar empty: dark gray (\x1b[90m) ░ blocks
7. Percentage: bold (\x1b[1m) when > 0%
"""

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from conftest import run_hook


def _make_plan_markdown(checked: int, unchecked: int) -> str:
    """Generate a plan markdown string with the given number of checked and unchecked tasks."""
    lines = ["# Plan\n"]
    for i in range(checked):
        lines.append(f"- [x] Completed task {i + 1}")
    for i in range(unchecked):
        lines.append(f"- [ ] Incomplete task {i + 1}")
    return "\n".join(lines) + "\n"


def _solo_status_content(tmp_path: Path) -> str:
    """Read the solo-status file written by the hook."""
    return (tmp_path / ".pairingbuddy" / "solo-status").read_text()


@pytest.fixture
def pairingbuddy_dir(tmp_path):
    """Create the .pairingbuddy directory in tmp_path."""
    d = tmp_path / ".pairingbuddy"
    d.mkdir()
    return d


@pytest.fixture
def base_env_vars():
    """Return the base environment variables required for solo mode."""
    return {
        "PAIRINGBUDDY_SOLO": "true",
        "FORCE_COLOR": "1",
    }


@pytest.fixture
def stdin_payload():
    """Return a standard stdin payload for triggering the hook."""
    return {"tool_name": "Agent", "tool_input": {"subagent_type": "test-agent"}}


# ============================================================================
# TestTaskListColors (4 tests)
# ============================================================================


class TestTaskListColors:
    """Tests for task list color styling per spec."""

    def test_completed_task_green(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """Completed tasks show green (\x1b[32m) before ✓ symbol AND text.

        The entire completed task line (symbol + text) should be wrapped in green.
        """
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=1))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Verify green ANSI code (\x1b[32m) appears before the checkmark
        assert re.search(r"\x1b\[32m.*✓", status), (
            f"Expected green ANSI code (\\x1b[32m) before completed task ✓, got: {status!r}"
        )
        # Verify the task text "Completed task 1" appears in the status
        assert "Completed task 1" in status, (
            f"Expected 'Completed task 1' text in status, got: {status!r}"
        )
        # Verify both completed tasks are green (per-line match, no DOTALL)
        green_count = len(re.findall(r"\x1b\[32m[^\n]*✓[^\n]*Completed task", status))
        assert green_count >= 2, (
            f"Expected at least 2 green completed tasks, found: {green_count} in {status!r}"
        )

    def test_active_task_cyan(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """Active (first incomplete) task is wrapped in cyan (\x1b[36m).

        The entire active task line (spinner + text) should be wrapped in cyan.
        """
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Verify cyan ANSI code (\x1b[36m) appears on the active task line
        # The active task is "Incomplete task 1" (first unchecked)
        assert re.search(r"\x1b\[36m.*Incomplete task 1", status, re.DOTALL), (
            f"Expected cyan ANSI code (\\x1b[36m) before active task, got: {status!r}"
        )

    def test_pending_task_dim(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """Pending (subsequent incomplete) tasks are dim gray (\x1b[2m or \x1b[90m).

        Each pending task line should be wrapped in dim color.
        """
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=3))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Verify dim formatting on pending tasks (both \x1b[2m and \x1b[90m are acceptable)
        # Look for dim code before the second and third tasks
        assert re.search(r"(\x1b\[2m|\x1b\[90m).*Incomplete task 2", status, re.DOTALL), (
            f"Expected dim ANSI code (\\x1b[2m or \\x1b[90m) before pending task 2, got: {status!r}"
        )
        assert re.search(r"(\x1b\[2m|\x1b\[90m).*Incomplete task 3", status, re.DOTALL), (
            f"Expected dim ANSI code before pending task 3, got: {status!r}"
        )

    def test_active_task_arrow_cyan(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """Active task → arrow is also cyan colored (part of the cyan line).

        The → and task text should both be inside the cyan escape code.
        """
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # The → should be present and wrapped in cyan
        assert "→" in status, f"Expected → on active task, got: {status!r}"
        assert re.search(r"\x1b\[36m[^\x1b]*→", status), (
            f"Expected → inside cyan escape, got: {status!r}"
        )


# ============================================================================
# TestProgressBarColors (3 tests)
# ============================================================================


class TestProgressBarColors:
    """Tests for progress bar color styling per spec."""

    def test_filled_bar_cyan(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """Filled portion of progress bar (█) is cyan (\x1b[36m), not green.

        The filled blocks of the progress bar should be wrapped in cyan ANSI code.
        """
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=3, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Find the progress bar line (contains [N/M])
        bar_line = next(
            (ln for ln in status.splitlines() if re.match(r"\[[\d]+/[\d]+\]", ln)),
            None,
        )
        assert bar_line is not None, f"Expected [N/M] bar line, got: {status!r}"

        # Verify cyan code before filled block on the bar line
        assert re.search(r"\x1b\[36m[^\n]*\u2588", bar_line), (
            f"Expected cyan before filled bar (█) on bar line, got: {bar_line!r}"
        )

        # Verify no green code on the bar line (was the old color)
        assert not re.search(r"\x1b\[32m[^\n]*\u2588", bar_line), (
            f"Expected no green before filled bar on bar line, got: {bar_line!r}"
        )

    def test_percentage_bold_when_nonzero(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Percentage is bold (\x1b[1m) when > 0%.

        The percentage number should be wrapped in bold ANSI code.
        """
        plan_file = tmp_path / "plan.md"
        # 3 out of 5 tasks = 60% (non-zero)
        plan_file.write_text(_make_plan_markdown(checked=3, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Verify bold code (\x1b[1m) appears before a non-zero percentage
        assert re.search(r"\x1b\[1m[^0][\d]*%", status), (
            f"Expected bold ANSI code (\\x1b[1m) before non-zero percentage, got: {status!r}"
        )

    def test_percentage_not_bold_at_zero(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Percentage is NOT bold when 0%.

        When no tasks are completed (0%), the percentage should not have bold formatting.
        """
        plan_file = tmp_path / "plan.md"
        # 0 out of 3 tasks = 0%
        plan_file.write_text(_make_plan_markdown(checked=0, unchecked=3))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Verify 0% is NOT preceded by bold code
        # Extract the percentage line and check it
        lines = status.splitlines()
        percentage_line = next((ln for ln in lines if re.search(r"\[[\d?]+/[\d?]+\]", ln)), None)
        assert percentage_line is not None, f"Expected progress line in: {status!r}"

        # The 0% should NOT have bold code before it
        assert not re.search(r"\x1b\[1m.*0%", percentage_line), (
            f"Expected NO bold code before 0%, got: {percentage_line!r}"
        )


# ============================================================================
# TestAgentLineDim (1 test)
# ============================================================================


class TestAgentLineDim:
    """Tests for agent line dim formatting per spec."""

    def test_agent_line_dim(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """Agent: line is wrapped in dim (\x1b[2m).

        The entire "Agent: name" line should be wrapped in dim ANSI code.
        """
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Verify dim code (\x1b[2m) appears and wraps the Agent: line
        # The Agent line should start with or contain the dim code
        lines = status.splitlines()
        agent_line = next((ln for ln in lines if "Agent:" in ln), None)
        assert agent_line is not None, f"Expected 'Agent:' line in: {status!r}"

        # The agent line should be wrapped in dim formatting
        assert re.search(r"\x1b\[2m.*Agent:", agent_line), (
            f"Expected dim ANSI code (\\x1b[2m) before 'Agent:' line, got: {agent_line!r}"
        )
