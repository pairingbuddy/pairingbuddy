import json
import os
import subprocess
from pathlib import Path

import pytest

HOOK_PATH = Path(__file__).parent.parent / "hooks" / "solo-progress.mjs"


def run_hook(
    env_vars: dict,
    stdin_payload: dict | None = None,
    cwd: str | None = None,
) -> subprocess.CompletedProcess:
    """Run the solo-progress.mjs hook as a subprocess with the given environment."""
    if stdin_payload is None:
        stdin_payload = {"tool_name": "Write", "tool_input": {"path": "some/file.py"}}

    env = os.environ.copy()
    env.pop("PAIRINGBUDDY_SOLO", None)
    env.update(env_vars)

    return subprocess.run(
        ["node", str(HOOK_PATH)],
        input=json.dumps(stdin_payload),
        capture_output=True,
        text=True,
        env=env,
        cwd=cwd,
    )


@pytest.fixture
def run_hook_fixture():
    """Pytest fixture that exposes run_hook as a callable."""
    return run_hook
