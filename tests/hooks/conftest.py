"""Shared fixtures for PostToolUse hook tests."""

import pytest

from tests.conftest import run_hook


def _make_plan_markdown(checked: int, unchecked: int) -> str:
    """Generate a plan markdown string with the given number of checked and unchecked tasks."""
    lines = ["# Plan\n"]
    for i in range(checked):
        lines.append(f"- [x] Completed task {i + 1}")
    for i in range(unchecked):
        lines.append(f"- [ ] Incomplete task {i + 1}")
    return "\n".join(lines) + "\n"


@pytest.fixture(scope="module")
def known_progress_status(tmp_path_factory):
    """Run the hook once with checked=3, unchecked=4 and return solo-status content.

    Shared across all known-progress tests to avoid spawning a subprocess per test.
    """
    tmp_path = tmp_path_factory.mktemp("known_progress")
    (tmp_path / ".pairingbuddy").mkdir(exist_ok=True)
    plan_file = tmp_path / "plan.md"
    plan_file.write_text(_make_plan_markdown(checked=3, unchecked=4))
    env_vars = {
        "PAIRINGBUDDY_SOLO": "true",
        "PAIRINGBUDDY_PLAN_PATH": str(plan_file),
    }
    stdin_payload = {"tool_name": "Task", "tool_input": {"description": "test-agent"}}
    run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))
    return (tmp_path / ".pairingbuddy" / "solo-status").read_text()


@pytest.fixture(scope="module")
def unknown_progress_status(tmp_path_factory):
    """Run the hook once with no plan available and return solo-status content.

    Shared across all unknown-progress tests to avoid spawning a subprocess per test.
    """
    tmp_path = tmp_path_factory.mktemp("unknown_progress")
    (tmp_path / ".pairingbuddy").mkdir(exist_ok=True)
    env_vars = {"PAIRINGBUDDY_SOLO": "true"}
    stdin_payload = {"tool_name": "Task", "tool_input": {"description": "test-agent"}}
    run_hook(env_vars, stdin_payload=stdin_payload, cwd=str(tmp_path))
    return (tmp_path / ".pairingbuddy" / "solo-status").read_text()
