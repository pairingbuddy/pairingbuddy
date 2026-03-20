import tempfile
from pathlib import Path

from tests.conftest import run_hook


def test_no_stdout_when_solo_disabled():
    """stdout is empty when hook exits early because PAIRINGBUDDY_SOLO is not set"""
    stdin_payload = {"tool_name": "Write", "tool_input": {"path": "some/file.py"}}

    result = run_hook(env_vars={}, stdin_payload=stdin_payload)

    assert result.stdout == ""


def test_no_stdout_when_non_task_tool():
    """stdout is empty when hook exits early because tool_name is not 'Task'"""
    stdin_payload = {"tool_name": "Read", "tool_input": {"path": "some/file.py"}}

    result = run_hook(
        env_vars={"PAIRINGBUDDY_SOLO": "true"},
        stdin_payload=stdin_payload,
    )

    assert result.stdout == ""


def test_no_stdout_when_writing_status():
    """stdout is empty even when the hook successfully writes the status file"""
    with tempfile.TemporaryDirectory() as tmpdir:
        pairingbuddy_dir = Path(tmpdir) / ".pairingbuddy"
        pairingbuddy_dir.mkdir()

        stdin_payload = {
            "tool_name": "Task",
            "tool_input": {"description": "write-tests"},
        }

        result = run_hook(
            env_vars={"PAIRINGBUDDY_SOLO": "true"},
            stdin_payload=stdin_payload,
            cwd=tmpdir,
        )

        assert result.stdout == ""
