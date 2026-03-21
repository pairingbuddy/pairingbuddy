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

    def test_completed_task_green_symbol_only(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Green applies to ✓ symbol only, task text is normal white.

        Format: GREEN ✓ RESET text
        """
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=1))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Green wraps only ✓, then RESET appears before task text
        completed_lines = [ln for ln in status.splitlines() if "Completed task" in ln]
        assert len(completed_lines) >= 2, f"Expected 2 completed task lines, got: {status!r}"
        for ln in completed_lines:
            # Pattern: GREEN ✓ RESET <text>
            assert re.search(r"\x1b\[32m[^C]*✓[^C]*\x1b\[0m", ln), (
                f"Expected green ✓ then reset before text, got: {ln!r}"
            )

    def test_active_task_cyan_symbol_bold_white_text(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Cyan applies to → only, task text is bold white.

        Format: CYAN → RESET BOLD_WHITE text RESET
        """
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Find the active task line
        active_line = next(
            (ln for ln in status.splitlines() if "Incomplete task 1" in ln),
            None,
        )
        assert active_line is not None, (
            f"Expected active task line with 'Incomplete task 1', got: {status!r}"
        )
        # Cyan wraps only → then reset, then bold white wraps text
        assert re.search(r"\x1b\[36m[^\x1b]*→[^\x1b]*\x1b\[0m", active_line), (
            f"Expected cyan → then reset, got: {active_line!r}"
        )
        assert re.search(r"\x1b\[1;37m[^\x1b]*Incomplete task 1", active_line), (
            f"Expected bold white before task text, got: {active_line!r}"
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

    def test_task_list_indented(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """Each task line is indented with leading spaces before the symbol."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        # Find task lines (contain ✓, →, or ○)
        task_lines = [ln for ln in status.splitlines() if any(s in ln for s in ("✓", "→", "○"))]
        assert len(task_lines) >= 3, f"Expected at least 3 task lines, got: {status!r}"
        for ln in task_lines:
            # Strip ANSI codes to check raw indentation
            raw = re.sub(r"\x1b\[[0-9;]*m", "", ln)
            assert raw.startswith("  "), f"Expected task line to start with 2 spaces, got: {raw!r}"


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

    def test_agent_name_dim_label_normal(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """'Agent:' label is normal white, agent name is dim.

        Format: Agent: DIM name RESET
        """
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)

        lines = status.splitlines()
        agent_line = next((ln for ln in lines if "Agent:" in ln), None)
        assert agent_line is not None, f"Expected 'Agent:' line in: {status!r}"

        # Dim should appear AFTER "Agent:" (wrapping the name, not the label)
        assert re.search(r"Agent:.*\x1b\[2m", agent_line), (
            f"Expected dim after 'Agent:' label, got: {agent_line!r}"
        )
        # "Agent:" itself should NOT be preceded by dim
        assert not re.search(r"\x1b\[2m[^\x1b]*Agent:", agent_line), (
            f"'Agent:' label should not be dim, got: {agent_line!r}"
        )
