"""Tests for solo-progress.mjs formatStatus function and ANSI formatting.

Scenarios covered:
- task-list-at-top: completed/current/pending tasks with symbols at top
- markdown-stripping: **bold**, *italic*, `backtick` markdown removed
- blank-line-between-task-list-and-bar: empty line separates task list from [N/M] bar
- description-indented-no-label: description indented under agent, no "Task:" label
- plan-line-removed: "Plan:" label removed, plan integrated into task list
- unknown-progress-format: [?/?] format with task symbols when no plan
- progress-bar-line-position: [N/M] line placement and structure
- ansi-formatting: ANSI color codes for progress bar, agent name, absent when not TTY
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


# ============================================================================
# Scenario 1: task-list-at-top (5 tests)
# ============================================================================


class TestTaskListAtTop:
    """Tests for task list symbols at top of status output."""

    def test_completed_tasks_show_checkmark(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Completed tasks show ✓ symbol."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "✓ Completed task 1" in status, (
            f"Expected checkmark for completed task, got: {status!r}"
        )
        assert "✓ Completed task 2" in status, (
            f"Expected checkmark for completed task 2, got: {status!r}"
        )

    def test_current_task_shows_arrow(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """First unchecked task shows → symbol."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=3))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "→ Incomplete task 1" in status, (
            f"Expected arrow for first unchecked task, got: {status!r}"
        )

    def test_pending_tasks_show_circle(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Remaining unchecked tasks show ○ symbol."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=3))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "○ Incomplete task 2" in status, (
            f"Expected circle for pending task 2, got: {status!r}"
        )
        assert "○ Incomplete task 3" in status, (
            f"Expected circle for pending task 3, got: {status!r}"
        )

    def test_task_list_order_matches_plan(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Task list order matches plan file order."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        lines = status.splitlines()
        # Find positions of task symbols
        checkmark_1 = next(i for i, ln in enumerate(lines) if "✓ Completed task 1" in ln)
        checkmark_2 = next(i for i, ln in enumerate(lines) if "✓ Completed task 2" in ln)
        arrow = next(i for i, ln in enumerate(lines) if "→ Incomplete task 1" in ln)
        circle = next(i for i, ln in enumerate(lines) if "○ Incomplete task 2" in ln)
        assert checkmark_1 < checkmark_2 < arrow < circle, (
            f"Expected tasks in plan order, got lines: {lines!r}"
        )

    def test_task_list_absent_when_no_plan(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """No task symbols when no plan available."""
        # No plan file, no PAIRINGBUDDY_PLAN_PATH
        run_hook(base_env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "✓" not in status, f"Expected no checkmark when no plan, got: {status!r}"
        assert "→" not in status, f"Expected no arrow when no plan, got: {status!r}"
        assert "○" not in status, f"Expected no circle when no plan, got: {status!r}"


# ============================================================================
# Scenario 2: markdown-stripping (4 tests)
# ============================================================================


class TestMarkdownStripping:
    """Tests for markdown formatting being stripped from task names."""

    def test_bold_markdown_stripped(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """**text** becomes text (no stars)."""
        plan_content = "# Plan\n\n- [x] **Bold task** description\n- [ ] Next task\n"
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(plan_content)
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "**" not in status, f"Expected bold markdown stripped, got: {status!r}"
        assert "Bold task" in status, f"Expected task text to appear without stars, got: {status!r}"

    def test_italic_markdown_stripped(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """*text* becomes text."""
        plan_content = "# Plan\n\n- [x] *Italic task* description\n- [ ] Next task\n"
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(plan_content)
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        # Verify no italic stars remain (single stars around a word)
        assert not re.search(r"\*[^*\n]+\*", status), (
            f"Expected italic markdown stripped, got: {status!r}"
        )
        assert "Italic task" in status, (
            f"Expected task text to appear without stars, got: {status!r}"
        )

    def test_backtick_markdown_stripped(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """`text` becomes text."""
        plan_content = "# Plan\n\n- [x] Use `code_function` here\n- [ ] Next task\n"
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(plan_content)
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "`" not in status, f"Expected backtick markdown stripped, got: {status!r}"
        assert "code_function" in status, (
            f"Expected task text to appear without backticks, got: {status!r}"
        )

    def test_plain_text_unchanged(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """text without markdown passes through unchanged."""
        plan_content = "# Plan\n\n- [x] Plain text task\n- [ ] Another plain task\n"
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(plan_content)
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "Plain text task" in status, f"Expected plain text to pass through, got: {status!r}"
        assert "Another plain task" in status, (
            f"Expected plain text task 2 to pass through, got: {status!r}"
        )


# ============================================================================
# Scenario 3: blank-line-between-task-list-and-bar (1 test)
# ============================================================================


class TestBlankLineBetweenTaskListAndBar:
    """Tests for blank line separating task list from progress bar line."""

    def test_blank_line_separates_tasks_from_bar(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Empty line between last task and [N/M] line."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        lines = status.splitlines()

        # Find the line with [N/M]
        bar_line_idx = next(i for i, ln in enumerate(lines) if re.match(r"\[[\d?]+/[\d?]+\]", ln))
        # The line immediately before the bar line must be blank
        assert bar_line_idx > 0, "Bar line should not be the first line"
        assert lines[bar_line_idx - 1] == "", (
            f"Expected blank line before bar, got {lines[bar_line_idx - 1]!r} in: {lines!r}"
        )


# ============================================================================
# Scenario 4: description-indented-no-label (4 tests)
# ============================================================================


class TestDescriptionIndentedNoLabel:
    """Tests for task description indentation and label removal."""

    def test_description_indented_under_agent(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Description appears indented (with leading spaces), no "Task:" label."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=2))
        payload = {
            "tool_name": "Agent",
            "tool_input": {"subagent_type": "test-agent", "description": "Do the thing"},
        }
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        # Description should appear indented (leading spaces)
        assert re.search(r"^ {2,}Do the thing", status, re.MULTILINE), (
            f"Expected indented description, got: {status!r}"
        )

    def test_no_task_label_in_status(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """The literal "Task:" label does NOT appear in known-progress status."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=2))
        payload = {
            "tool_name": "Agent",
            "tool_input": {"subagent_type": "test-agent", "description": "Do the thing"},
        }
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "Task:" not in status, f"Expected no 'Task:' label in status, got: {status!r}"

    def test_description_absent_when_missing(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """No indented line when description is null."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=1, unchecked=2))
        # stdin_payload has no description field
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        lines = status.splitlines()
        # No line should be indented with spaces (task symbols use different chars, not spaces)
        indented_lines = [ln for ln in lines if ln.startswith("  ")]
        assert not indented_lines, (
            f"Expected no indented description lines when no description, got: {indented_lines!r}"
        )

    def test_description_indented_in_unknown_format(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Description indented in [?/?] format too."""
        # No plan file — triggers unknown progress
        payload = {
            "tool_name": "Agent",
            "tool_input": {"subagent_type": "test-agent", "description": "Unknown task"},
        }

        run_hook(base_env_vars, stdin_payload=payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert re.search(r"^ {2,}Unknown task", status, re.MULTILINE), (
            f"Expected indented description in unknown format, got: {status!r}"
        )


# ============================================================================
# Scenario 5: plan-line-removed (2 tests)
# ============================================================================


class TestPlanLineRemoved:
    """Tests for removal of "Plan:" label from status output."""

    def test_no_plan_label_in_known_progress(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """ "Plan:" does NOT appear in known-progress status."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "Plan:" not in status, f"Expected no 'Plan:' label in status, got: {status!r}"

    def test_no_plan_label_in_unknown_progress(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """ "Plan:" does NOT appear in unknown-progress status."""
        # No plan file — triggers unknown progress
        run_hook(base_env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "Plan:" not in status, (
            f"Expected no 'Plan:' label in unknown-progress status, got: {status!r}"
        )


# ============================================================================
# Scenario 6: unknown-progress-format (3 tests)
# ============================================================================


class TestUnknownProgressFormat:
    """Tests for status output when progress cannot be determined."""

    def test_unknown_progress_first_line(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """First line is "[?/?] Agent: <name>"."""
        # No plan file — triggers unknown progress
        run_hook(base_env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        first_line = status.splitlines()[0]
        assert re.match(r"^\[\?/\?\] Agent: test-agent", first_line), (
            f"Expected '[?/?] Agent: test-agent' as first line, got: {first_line!r}"
        )

    def test_unknown_progress_no_task_symbols(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """No ✓/→/○ symbols when no plan."""
        # No plan file — triggers unknown progress
        run_hook(base_env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        assert "✓" not in status, f"Expected no checkmark in unknown progress, got: {status!r}"
        assert "→" not in status, f"Expected no arrow in unknown progress, got: {status!r}"
        assert "○" not in status, f"Expected no circle in unknown progress, got: {status!r}"

    def test_unknown_progress_description_on_second_line(
        self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
    ):
        """Description indented on second line."""
        payload = {
            "tool_name": "Agent",
            "tool_input": {"subagent_type": "test-agent", "description": "My task desc"},
        }

        run_hook(base_env_vars, stdin_payload=payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        lines = status.splitlines()
        assert len(lines) >= 2, f"Expected at least 2 lines, got: {lines!r}"
        assert re.match(r"^ {2,}My task desc", lines[1]), (
            f"Expected indented description on second line, got: {lines[1]!r}"
        )


# ============================================================================
# Scenario 7: progress-bar-line-position (2 tests)
# ============================================================================


class TestProgressBarLinePosition:
    """Tests for positioning of the progress bar line."""

    def test_bar_after_task_list(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """[N/M] line comes after the task list (not first line)."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        lines = status.splitlines()

        bar_line_idx = next((i for i, ln in enumerate(lines) if re.match(r"\[\d+/\d+\]", ln)), None)
        assert bar_line_idx is not None, f"Expected [N/M] line in status, got: {status!r}"
        assert bar_line_idx > 0, f"Expected [N/M] bar after task list, got index {bar_line_idx}"

    def test_agent_after_bar(self, tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
        """Agent: line immediately follows [N/M] line."""
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(_make_plan_markdown(checked=2, unchecked=2))
        env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

        run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

        status = _solo_status_content(tmp_path)
        lines = status.splitlines()

        bar_line_idx = next((i for i, ln in enumerate(lines) if re.match(r"\[\d+/\d+\]", ln)), None)
        assert bar_line_idx is not None, f"Expected [N/M] line in status, got: {status!r}"
        assert bar_line_idx + 1 < len(lines), "Expected Agent: line after bar line"
        assert lines[bar_line_idx + 1].startswith("Agent:"), (
            f"Expected 'Agent:' immediately after bar line, got: {lines[bar_line_idx + 1]!r}"
        )


# ============================================================================
# Existing ANSI Tests (kept from original, updated for new format)
# ============================================================================


class TestAnsiFormattingInStatus:
    """Tests for ANSI color codes in status output."""

    def test_progress_bar_filled_uses_green_ansi(self):
        """Filled portion of progress bar uses green ANSI color code."""
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
