import json
import os
import subprocess
import tempfile
from pathlib import Path

import pytest

from tests.conftest import HOOK_PATH


def run_hook_with_task(tmpdir: str, agent_description: str) -> subprocess.CompletedProcess:
    """Run the solo-progress.mjs hook as a subprocess simulating an Agent tool call in solo mode."""
    pairingbuddy_dir = Path(tmpdir) / ".pairingbuddy"
    pairingbuddy_dir.mkdir(exist_ok=True)

    stdin_payload = {
        "tool_name": "Agent",
        "tool_input": {
            "subagent_type": agent_description,
            "description": "implementing the test suite",
        },
    }

    env = os.environ.copy()
    env.pop("PAIRINGBUDDY_SOLO", None)
    env["PAIRINGBUDDY_SOLO"] = "true"

    return subprocess.run(
        ["node", str(HOOK_PATH)],
        input=json.dumps(stdin_payload),
        capture_output=True,
        text=True,
        env=env,
        cwd=tmpdir,
    )


@pytest.fixture
def solo_status_file():
    """Run the hook with an Agent tool call and return the path to the written status file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        agent_description = "implement-tests"
        run_hook_with_task(tmpdir, agent_description)
        yield Path(tmpdir) / ".pairingbuddy" / "solo-status"


def test_status_file_created_in_pairingbuddy_dir(solo_status_file):
    """Status file is written to .pairingbuddy/solo-status relative to cwd."""
    assert solo_status_file.exists(), "Expected .pairingbuddy/solo-status file to exist"


def test_status_file_contains_agent_name(solo_status_file):
    """Written status file contains agent name and indented description."""
    content = solo_status_file.read_text()
    assert "Agent: implement-tests" in content
    assert "  implementing the test suite" in content


def test_status_file_contains_progress_line(solo_status_file):
    """Written status file contains the placeholder '[?/?]' when no plan is available."""
    content = solo_status_file.read_text()
    assert "[?/?]" in content
