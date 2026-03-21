"""Tests for solo-progress.mjs formatStatus function and ANSI formatting.

Scenarios covered:
- plan-task-shown-in-status: plan task line appears in status output
- plan-task-with-ansi-color: plan task line includes ANSI formatting when TTY
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
    return {"PAIRINGBUDDY_SOLO": "true"}


@pytest.fixture
def stdin_payload():
    """Return a standard stdin payload for triggering the hook."""
    return {"tool_name": "Agent", "tool_input": {"subagent_type": "test-agent"}}


class TestPlanTaskShownInStatus:
    """Tests for plan task line appearing in status output (scenario 3)."""

    def test_plan_line_shows_first_unchecked_task(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Plan line displays the first unchecked task from the plan."""
        # Setup
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=3))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        # Exercise
        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        # Verify — hook should write a "Plan:" line with the first unchecked task name
        status = _solo_status_content(tmp_path)
        assert "Plan:" in status, f"Expected 'Plan:' line in solo-status, got: {status!r}"
        assert "Incomplete task 1" in status, (
            f"Expected first unchecked task 'Incomplete task 1' in solo-status, got: {status!r}"
        )

    def test_plan_line_absent_when_no_unchecked_tasks(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Plan line is absent when all tasks in plan are completed."""
        # Setup
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=3, unchecked=0))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        # Exercise
        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        # Verify — no unchecked tasks means no "Plan:" line
        status = _solo_status_content(tmp_path)
        assert "Plan:" not in status, (
            f"Expected no 'Plan:' line when all tasks are completed, got: {status!r}"
        )

    def test_plan_line_absent_when_no_plan(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Plan line is absent when no plan file is available."""
        # Exercise — no plan configured
        run_hook(base_env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        # Verify — no "Plan:" line when no plan is available
        status = _solo_status_content(tmp_path)
        assert "Plan:" not in status, (
            f"Expected no 'Plan:' line when no plan is available, got: {status!r}"
        )

    def test_plan_line_on_separate_line_with_known_progress(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Plan line appears on its own line after Agent line when progress is known."""
        # Setup
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        # Exercise
        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        # Verify — "Plan:" should appear on its own line (known-progress multi-line format)
        status = _solo_status_content(tmp_path)
        lines = [line for line in status.splitlines() if line.strip()]
        plan_lines = [line for line in lines if line.startswith("Plan:")]
        assert len(plan_lines) == 1, (
            f"Expected exactly one 'Plan:' line in solo-status, got lines: {lines!r}"
        )
        # Plan line should come after the Agent line
        agent_index = next((i for i, line in enumerate(lines) if line.startswith("Agent:")), None)
        plan_index = next((i for i, line in enumerate(lines) if line.startswith("Plan:")), None)
        assert agent_index is not None, f"Expected 'Agent:' line, got: {lines!r}"
        assert plan_index is not None, f"Expected 'Plan:' line, got: {lines!r}"
        assert plan_index > agent_index, (
            f"Expected 'Plan:' after 'Agent:', got agent={agent_index} plan={plan_index}"
        )

    def test_plan_line_on_same_or_separate_line_unknown_progress(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Plan line placement when progress is unknown (consistent formatting)."""
        # Setup — plan file with unchecked tasks but no progress tracking possible
        # We use a plan path that exists but has no [x] or [ ] checkboxes,
        # so counts will be {completed:0, total:0} not null — actually use no plan at all
        # to get the unknown-progress path, but still provide a plan for task name reading.
        # The hook currently has no concept of reading unchecked task names at all,
        # so any plan file with unchecked items should produce a Plan: line regardless
        # of whether we're in known or unknown progress mode.
        # Use a plan path so that the hook reads tasks from it.
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(
            "# Plan\n\n- [ ] First incomplete task\n- [ ] Second incomplete task\n"
        )
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        # Exercise
        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        # Verify — "Plan:" line appears and shows the first unchecked task
        status = _solo_status_content(tmp_path)
        assert "Plan:" in status, (
            f"Expected 'Plan:' line in solo-status when plan has unchecked tasks, got: {status!r}"
        )
        assert "First incomplete task" in status, (
            f"Expected first unchecked task name in solo-status, got: {status!r}"
        )


class TestAnsiFormattingInStatus:
    """Tests for ANSI color codes in status output (scenario 4 Node parts)."""

    def test_progress_bar_filled_uses_green_ansi(self):
        """Filled portion of progress bar uses green ANSI color code."""
        # This test exercises the hook via subprocess with a plan that has some progress,
        # then checks the status file contains ANSI green escape codes for filled bar chars.
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / ".pairingbuddy").mkdir()
            plan_file = tmp_path / "plan.md"
            plan_file.write_text(_make_plan_markdown(checked=3, unchecked=4))
            env_vars = {
                "PAIRINGBUDDY_SOLO": "true",
                "PAIRINGBUDDY_PLAN_PATH": str(plan_file),
                "FORCE_COLOR": "1",
            }
            stdin_payload = {"tool_name": "Agent", "tool_input": {"subagent_type": "test-agent"}}
            run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

            status = _solo_status_content(tmp_path)

        # ANSI green: ESC[32m or ESC[0;32m or similar green codes
        assert (
            "\x1b[32m" in status
            or "\x1b[0;32m" in status
            or re.search(r"\x1b\[\d*(;\d+)*m", status) is not None
        ), f"Expected ANSI green escape code for filled bar, got: {status!r}"
        # More specifically: the filled block character should be preceded by a green ANSI code
        assert re.search(r"\x1b\[(?:0;)?32m.*\u2588", status, re.DOTALL) is not None, (
            f"Expected green ANSI code before filled block character, got: {status!r}"
        )

    def test_progress_bar_empty_uses_dark_gray_ansi(self):
        """Empty portion of progress bar uses dark gray ANSI color code."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / ".pairingbuddy").mkdir()
            plan_file = tmp_path / "plan.md"
            plan_file.write_text(_make_plan_markdown(checked=3, unchecked=4))
            env_vars = {
                "PAIRINGBUDDY_SOLO": "true",
                "PAIRINGBUDDY_PLAN_PATH": str(plan_file),
                "FORCE_COLOR": "1",
            }
            stdin_payload = {"tool_name": "Agent", "tool_input": {"subagent_type": "test-agent"}}
            run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

            status = _solo_status_content(tmp_path)

        # ANSI dark gray: ESC[90m (bright black / dark gray)
        assert re.search(r"\x1b\[90m.*\u2591", status, re.DOTALL) is not None, (
            f"Expected dark gray ANSI code (ESC[90m) before empty block character, got: {status!r}"
        )

    def test_agent_name_has_cyan_ansi(self):
        """Agent name in status output includes cyan ANSI color code."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / ".pairingbuddy").mkdir()
            plan_file = tmp_path / "plan.md"
            plan_file.write_text(_make_plan_markdown(checked=3, unchecked=4))
            env_vars = {
                "PAIRINGBUDDY_SOLO": "true",
                "PAIRINGBUDDY_PLAN_PATH": str(plan_file),
                "FORCE_COLOR": "1",
            }
            stdin_payload = {
                "tool_name": "Agent",
                "tool_input": {"subagent_type": "color-test-agent"},
            }
            run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

            status = _solo_status_content(tmp_path)

        # ANSI cyan: ESC[36m
        assert re.search(r"\x1b\[(?:0;)?36m.*color-test-agent", status, re.DOTALL) is not None, (
            f"Expected cyan ANSI code (ESC[36m) before agent name, got: {status!r}"
        )

    def test_plan_task_has_bold_white_ansi(self):
        """Plan task line includes bold white ANSI color code."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / ".pairingbuddy").mkdir()
            plan_file = tmp_path / "plan.md"
            plan_file.write_text("# Plan\n\n- [x] Done task\n- [ ] Bold white task\n")
            env_vars = {
                "PAIRINGBUDDY_SOLO": "true",
                "PAIRINGBUDDY_PLAN_PATH": str(plan_file),
                "FORCE_COLOR": "1",
            }
            stdin_payload = {"tool_name": "Agent", "tool_input": {"subagent_type": "test-agent"}}
            run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

            status = _solo_status_content(tmp_path)

        # ANSI bold white: ESC[1;37m or ESC[1m followed by content
        assert re.search(r"\x1b\[1;37m.*Bold white task", status, re.DOTALL) is not None, (
            f"Expected bold white ANSI code (ESC[1;37m) before plan task text, got: {status!r}"
        )

    def test_ansi_codes_absent_when_not_tty(self):
        """ANSI codes are stripped from status output when not a TTY."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / ".pairingbuddy").mkdir()
            plan_file = tmp_path / "plan.md"
            plan_file.write_text(_make_plan_markdown(checked=3, unchecked=4))
            # Do NOT set FORCE_COLOR — subprocess is not a TTY
            env_vars = {
                "PAIRINGBUDDY_SOLO": "true",
                "PAIRINGBUDDY_PLAN_PATH": str(plan_file),
            }
            stdin_payload = {"tool_name": "Agent", "tool_input": {"subagent_type": "test-agent"}}
            run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

            status = _solo_status_content(tmp_path)

        # When not a TTY and no FORCE_COLOR, no ANSI escape sequences should appear
        assert not re.search(r"\x1b\[", status), (
            f"Expected no ANSI escape codes in non-TTY output, got: {status!r}"
        )
