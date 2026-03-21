import tempfile
from pathlib import Path

from tests.conftest import run_hook


def test_exits_for_non_task_tool():
    """Hook exits 0 and writes nothing when tool_name is not 'Task'."""
    with tempfile.TemporaryDirectory() as tmpdir:
        env = {"PAIRINGBUDDY_DIR": tmpdir, "PAIRINGBUDDY_SOLO": "true"}
        stdin_payload = {"tool_name": "Read", "tool_input": {"file_path": "some/file.py"}}

        result = run_hook(env_vars=env, stdin_payload=stdin_payload)

        assert result.returncode == 0
        solo_status_files = list(Path(tmpdir).glob("solo-status*"))
        assert solo_status_files == [], f"Expected no solo-status files, found: {solo_status_files}"
