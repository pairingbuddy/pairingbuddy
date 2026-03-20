import tempfile
from pathlib import Path

import pytest

from tests.conftest import run_hook


@pytest.mark.parametrize(
    "solo_env_value",
    [
        pytest.param(None, id="absent"),
        pytest.param("false", id="false"),
        pytest.param("", id="empty"),
    ],
)
def test_exits_when_solo_env_not_active(solo_env_value):
    """Hook exits 0 and writes nothing when PAIRINGBUDDY_SOLO is absent, 'false', or empty"""
    with tempfile.TemporaryDirectory() as tmpdir:
        env = {"PAIRINGBUDDY_DIR": tmpdir}
        if solo_env_value is not None:
            env["PAIRINGBUDDY_SOLO"] = solo_env_value

        result = run_hook(env_vars=env)

        assert result.returncode == 0
        solo_status_files = list(Path(tmpdir).glob("solo-status*"))
        assert solo_status_files == [], f"Expected no solo-status files, found: {solo_status_files}"
