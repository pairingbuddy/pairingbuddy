"""Test PostToolUse hook progress bar formatting.

Validates that the solo-status file displays progress in the correct format:
- Known progress: '[N/M] <visual bar> XX%\nAgent: <name>'
- Unknown progress: '[?/?] Agent: <name>'
"""

from tests.conftest import run_hook

FULL_BLOCK = "\u2588"
LIGHT_SHADE = "\u2591"


def _make_plan_markdown(checked: int, unchecked: int) -> str:
    """Generate a plan markdown string with the given number of checked and unchecked tasks."""
    lines = ["# Plan\n"]
    for i in range(checked):
        lines.append(f"- [x] Completed task {i + 1}")
    for i in range(unchecked):
        lines.append(f"- [ ] Incomplete task {i + 1}")
    return "\n".join(lines) + "\n"


def _run_with_plan(tmp_path, checked: int, unchecked: int) -> str:
    """Write a plan, run the hook, and return solo-status content."""
    (tmp_path / ".pairingbuddy").mkdir(exist_ok=True)
    plan_file = tmp_path / "plan.md"
    plan_file.write_text(_make_plan_markdown(checked=checked, unchecked=unchecked))
    env_vars = {
        "PAIRINGBUDDY_SOLO": "true",
        "PAIRINGBUDDY_PLAN_PATH": str(plan_file),
    }
    stdin_payload = {"tool_name": "Task", "tool_input": {"description": "test-agent"}}
    run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))
    return (tmp_path / ".pairingbuddy" / "solo-status").read_text()


# --- Known-progress tests (shared fixture: checked=3, unchecked=4) ---


def test_status_uses_bracket_nm_format(known_progress_status):
    """The first line of solo-status uses '[N/M]' bracket notation instead of 'Progress: N/M'."""
    first_line = known_progress_status.splitlines()[0]
    assert first_line.startswith("[3/7]"), (
        f"Expected first line to start with '[3/7]', got: {first_line!r}"
    )


def test_status_contains_block_characters(known_progress_status):
    """The progress bar contains full block (U+2588) and light shade (U+2591) characters."""
    assert FULL_BLOCK in known_progress_status, (
        f"Expected U+2588 full block character in solo-status, got: {known_progress_status!r}"
    )
    assert LIGHT_SHADE in known_progress_status, (
        f"Expected U+2591 light shade character in solo-status, got: {known_progress_status!r}"
    )


def test_status_contains_percentage(known_progress_status):
    """The first line ends with a percentage value reflecting completion ratio."""
    first_line = known_progress_status.splitlines()[0]
    assert "43%" in first_line, f"Expected '43%' in first line of solo-status, got: {first_line!r}"


def test_agent_name_on_second_line(known_progress_status):
    """The agent name appears on the second line as 'Agent: <name>', after progress bar."""
    lines = known_progress_status.splitlines()
    assert len(lines) >= 2, (
        f"Expected at least 2 lines in solo-status, got: {known_progress_status!r}"
    )
    assert lines[1].startswith("Agent:"), (
        f"Expected second line to start with 'Agent:', got: {lines[1]!r}"
    )


def test_percentage_matches_ratio(known_progress_status):
    """The displayed percentage equals round(completed/total * 100), e.g., 3/7 shows '43%'."""
    expected = f"{round(3 / 7 * 100)}%"
    assert expected in known_progress_status, (
        f"Expected '{expected}' in solo-status for 3/7 progress, got: {known_progress_status!r}"
    )


# --- Proportionality test (unique setup: checked=5, unchecked=5) ---


def test_bar_fills_proportionally(tmp_path):
    """The number of full block characters is proportional to completion percentage."""
    # 5/10 = 50%, so full blocks should equal light shade chars
    status = _run_with_plan(tmp_path, checked=5, unchecked=5)

    full_count = status.count(FULL_BLOCK)
    shade_count = status.count(LIGHT_SHADE)
    assert full_count > 0, f"Expected full block characters in solo-status, got: {status!r}"
    assert shade_count > 0, f"Expected light shade characters in solo-status, got: {status!r}"
    assert full_count == shade_count, (
        f"Expected equal blocks ({full_count}) and shade ({shade_count}) at 50%"
    )


# --- Boundary tests (unique setups: 0% and 100%) ---


def test_bar_at_zero_percent(tmp_path):
    """When completed is 0, bar shows no full blocks, all light shade characters, and '0%'."""
    status = _run_with_plan(tmp_path, checked=0, unchecked=5)

    assert FULL_BLOCK not in status, f"Expected no full block characters at 0%, got: {status!r}"
    assert LIGHT_SHADE in status, f"Expected light shade characters at 0%, got: {status!r}"
    assert "0%" in status, f"Expected '0%' in solo-status at 0%, got: {status!r}"


def test_bar_at_one_hundred_percent(tmp_path):
    """When all tasks completed, bar shows all full blocks, no light shade, and '100%'."""
    status = _run_with_plan(tmp_path, checked=5, unchecked=0)

    assert FULL_BLOCK in status, f"Expected full block characters at 100%, got: {status!r}"
    assert LIGHT_SHADE not in status, f"Expected no light shade characters at 100%, got: {status!r}"
    assert "100%" in status, f"Expected '100%' in solo-status at 100%, got: {status!r}"


# --- Unknown-progress tests (shared fixture: no plan) ---


def test_unknown_shows_question_mark_notation(unknown_progress_status):
    """When plan unavailable, solo-status contains '[?/?]' instead of '[N/M]'."""
    assert "[?/?]" in unknown_progress_status, (
        f"Expected '[?/?]' in solo-status when plan unavailable, got: {unknown_progress_status!r}"
    )


def test_unknown_no_bar_or_percentage(unknown_progress_status):
    """When plan unavailable, solo-status lacks block characters or percentage value."""
    assert FULL_BLOCK not in unknown_progress_status, (
        f"Expected no full block characters when plan unavailable, got: {unknown_progress_status!r}"
    )
    assert LIGHT_SHADE not in unknown_progress_status, (
        "Expected no light shade characters when plan unavailable"
    )
    assert "%" not in unknown_progress_status, (
        f"Expected no percentage value when plan unavailable, got: {unknown_progress_status!r}"
    )


def test_unknown_agent_name_on_same_line(unknown_progress_status):
    """When plan unavailable, agent name on same line as '[?/?]'."""
    non_empty_lines = [line for line in unknown_progress_status.splitlines() if line.strip()]
    assert len(non_empty_lines) == 1, (
        f"Expected exactly 1 non-empty line when plan unavailable, got: {non_empty_lines!r}"
    )
    assert "[?/?]" in non_empty_lines[0], (
        f"Expected '[?/?]' on the single line, got: {non_empty_lines[0]!r}"
    )
    assert "Agent:" in non_empty_lines[0], (
        f"Expected 'Agent:' on the single line, got: {non_empty_lines[0]!r}"
    )
