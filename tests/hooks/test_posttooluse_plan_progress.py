"""Tests for PostToolUse hook plan progress tracking functionality.

Scenarios covered:
- plan-path-discovery: The hook resolves the plan file path using
  PAIRINGBUDDY_PLAN_PATH or falls back to plan-config.json
- checkbox-parsing: The hook counts completed and incomplete checkboxes
  in the plan markdown file
- plan-file-missing: The hook falls back gracefully when the resolved
  plan file path does not exist
- solo-status-output: The hook writes correct progress information to
  the solo-status file
"""

import json
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
    return {"tool_name": "Task", "tool_input": {"description": "test-agent"}}


def test_plan_path_from_env_var(tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
    """When PAIRINGBUDDY_PLAN_PATH is set, use it without reading plan-config.json."""
    # Setup
    plan_file = tmp_path / "my-plan.md"
    plan_file.write_text(_make_plan_markdown(checked=3, unchecked=4))

    env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

    # Exercise
    run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify — path was resolved; hook produced a progress N/M pattern (not a fallback)
    status = _solo_status_content(tmp_path)
    assert re.search(r"\d+/\d+", status), (
        f"Expected N/M progress pattern in solo-status (plan path was resolved), got: {status!r}"
    )


def test_plan_path_from_plan_config(tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
    """When PAIRINGBUDDY_PLAN_PATH is absent, read output_path from plan-config.json."""
    # Setup
    plan_config_dir = pairingbuddy_dir / "plan"
    plan_config_dir.mkdir()

    plan_file = tmp_path / "docs" / "plan.md"
    plan_file.parent.mkdir()
    plan_file.write_text(_make_plan_markdown(checked=2, unchecked=5))

    plan_config = {"output_path": str(plan_file)}
    (plan_config_dir / "plan-config.json").write_text(json.dumps(plan_config))

    # Exercise
    run_hook(base_env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify — path was resolved via plan-config; progress pattern present
    status = _solo_status_content(tmp_path)
    assert re.search(r"\d+/\d+", status), (
        f"Expected N/M progress pattern in solo-status, got: {status!r}"
    )


def test_plan_path_fallback_missing_config(
    tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
):
    """When PAIRINGBUDDY_PLAN_PATH is absent and plan-config.json missing,
    plan path resolves to null."""
    # Exercise
    run_hook(base_env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify — no specific progress counts, hook should show unknown/placeholder
    status = _solo_status_content(tmp_path)
    assert "[?/?]" in status, f"Expected '[?/?]' placeholder in solo-status, got: {status!r}"


def test_plan_path_fallback_missing_output_path(
    tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
):
    """When plan-config.json exists but has no output_path, plan path resolves to null."""
    # Setup
    plan_config_dir = pairingbuddy_dir / "plan"
    plan_config_dir.mkdir()

    # plan-config.json exists but has no output_path
    plan_config = {"title": "My Plan"}
    (plan_config_dir / "plan-config.json").write_text(json.dumps(plan_config))

    # Exercise
    run_hook(base_env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify — no output_path means no plan resolved, should show unknown/placeholder
    status = _solo_status_content(tmp_path)
    assert "[?/?]" in status, f"Expected '[?/?]' placeholder in solo-status, got: {status!r}"


def test_count_incomplete_checkboxes(tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
    """Lines matching '- [ ]' are counted as incomplete tasks."""
    # Setup
    plan_file = tmp_path / "plan.md"
    plan_file.write_text(_make_plan_markdown(checked=2, unchecked=5))

    env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

    # Exercise
    run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify — 2 completed out of 7 total means 5 incomplete
    status = _solo_status_content(tmp_path)
    assert "[2/7]" in status, (
        f"Expected '[2/7]' in solo-status (2 completed, 5 incomplete), got: {status!r}"
    )


def test_total_is_sum_of_completed_and_incomplete(
    tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
):
    """Total count equals completed plus incomplete checkboxes."""
    # Setup
    plan_file = tmp_path / "plan.md"
    plan_file.write_text(_make_plan_markdown(checked=3, unchecked=4))

    env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

    # Exercise
    run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify — total in "N/M" should be 3+4=7
    status = _solo_status_content(tmp_path)
    match = re.search(r"(\d+)/(\d+)", status)
    assert match is not None, f"Expected 'N/M' pattern in solo-status, got: {status!r}"
    total = int(match.group(2))
    assert total == 7, f"Expected total 7, got {total} (status: {status!r})"


def test_plan_file_with_no_checkboxes(tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload):
    """A plan file with no checkbox lines yields completed=0 and total=0."""
    # Setup
    plan_file = tmp_path / "plan.md"
    plan_file.write_text(
        "# Plan\n\nSome introductory text with no tasks yet.\n\n## Notes\n\nMore text here.\n"
    )

    env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

    # Exercise
    run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify — no checkboxes means "0/0" or fallback placeholder
    status = _solo_status_content(tmp_path)
    assert "0/0" in status or "[?/?]" in status, (
        f"Expected '0/0' or '[?/?]' fallback placeholder in solo-status, got: {status!r}"
    )


def test_missing_plan_file_yields_null_progress(
    tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
):
    """When plan file path is set but file missing, progress counts fall back to null."""
    # Setup
    non_existent_plan = tmp_path / "does-not-exist.md"

    env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(non_existent_plan)}

    # Exercise
    run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify
    status = _solo_status_content(tmp_path)
    assert "[?/?]" in status, f"Expected '[?/?]' fallback in solo-status, got: {status!r}"
    assert not re.search(r"\d+/\d+", status), (
        f"Expected no N/M pattern in solo-status when file is missing, got: {status!r}"
    )


def test_status_includes_progress_counts_when_plan_found(
    tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
):
    """When plan is found and parsed, solo-status contains completed and total counts."""
    # Setup
    plan_file = tmp_path / "plan.md"
    plan_file.write_text(_make_plan_markdown(checked=3, unchecked=4))

    env_vars = {**base_env_vars, "PAIRINGBUDDY_PLAN_PATH": str(plan_file)}

    # Exercise
    run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify
    status = _solo_status_content(tmp_path)
    assert "Agent:" in status, f"Expected 'Agent:' line in solo-status, got: {status!r}"
    assert "[3/7]" in status, f"Expected '[3/7]' in solo-status, got: {status!r}"


def test_status_indicates_unknown_progress_when_plan_unavailable(
    tmp_path, pairingbuddy_dir, base_env_vars, stdin_payload
):
    """When plan cannot be resolved or read, solo-status reflects unknown progress."""
    # Setup — no PAIRINGBUDDY_PLAN_PATH and no plan-config.json

    # Exercise
    run_hook(base_env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))

    # Verify
    status = _solo_status_content(tmp_path)
    assert "[?/?]" in status, f"Expected '[?/?]' in solo-status, got: {status!r}"
    assert not re.search(r"\d+/\d+", status), (
        f"Expected no N/M pattern in solo-status when plan is unavailable, got: {status!r}"
    )
