"""
Guardian hook agent info field tests.

Tests for hooks/guardian.mjs - Agent info tracking (lastTool, lastAgent, lastDescription).
These fields are written to the session state file for observability.
"""

import datetime
import json
import os
import subprocess
import time
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
GUARDIAN_PATH = REPO_ROOT / "hooks" / "guardian.mjs"


def _run_guardian_with_tool_info(
    tmp_path,
    session_id="test-session",
    tool_name=None,
    tool_input=None,
    env_extra=None,
    elapsed_ms=None,
    hook_event_name="PostToolUse",
):
    """Invoke guardian.mjs via subprocess with tool info in stdin.

    Returns parsed JSON output from stdout and the session state file path.
    """
    state_dir = tmp_path / ".pairingbuddy" / "hooks"
    state_dir.mkdir(parents=True, exist_ok=True)

    if elapsed_ms is not None:
        # Write a state file with lastInjection set to elapsed_ms ago
        last_injection_ts = time.time() - elapsed_ms / 1000
        last_injection_iso = (
            datetime.datetime.fromtimestamp(last_injection_ts, tz=datetime.UTC).strftime(
                "%Y-%m-%dT%H:%M:%S.%f"
            )[:-3]
            + "Z"
        )
        state_file = state_dir / f"{session_id}.json"
        state_file.write_text(json.dumps({"lastInjection": last_injection_iso, "trigger": "timer"}))

    stdin_data = {
        "session_id": session_id,
        "hook_event_name": hook_event_name,
    }
    if tool_name is not None:
        stdin_data["tool_name"] = tool_name
    if tool_input is not None:
        stdin_data["tool_input"] = tool_input

    env = os.environ.copy()
    env.pop("PAIRINGBUDDY_SOLO", None)
    if env_extra:
        env.update(env_extra)

    cmd = ["node", str(GUARDIAN_PATH)]

    result = subprocess.run(
        cmd,
        input=json.dumps(stdin_data),
        capture_output=True,
        text=True,
        cwd=str(tmp_path),
        env=env,
    )

    session_file = state_dir / f"{session_id}.json"
    return json.loads(result.stdout), session_file


class TestGuardianAgentInfo:
    """Test that guardian writes agent info fields to session state."""

    def test_guardian_writes_lasttool_on_every_call(self, tmp_path):
        """guardian.mjs writes lastTool field when tool_name is provided in stdin.

        With tool_name: "Bash" and no injection trigger (elapsed_ms=1000 is before any interval),
        the session file should contain lastTool: "Bash".
        """
        output, session_file = _run_guardian_with_tool_info(
            tmp_path,
            session_id="test-lasttool",
            tool_name="Bash",
            elapsed_ms=1000,
        )

        assert session_file.exists(), f"Expected session file at {session_file}"
        state = json.loads(session_file.read_text())
        assert state.get("lastTool") == "Bash", (
            f"Expected lastTool='Bash', got {state.get('lastTool')}"
        )

    def test_guardian_writes_lastagent_for_agent_tool(self, tmp_path):
        """guardian.mjs extracts lastAgent from tool_input.subagent_type for Agent tools."""
        output, session_file = _run_guardian_with_tool_info(
            tmp_path,
            session_id="test-lastagent",
            tool_name="Agent",
            tool_input={"subagent_type": "pairingbuddy:implement-tests"},
            elapsed_ms=1000,
        )

        assert session_file.exists(), f"Expected session file at {session_file}"
        state = json.loads(session_file.read_text())
        assert state.get("lastAgent") == "pairingbuddy:implement-tests", (
            f"Expected lastAgent='pairingbuddy:implement-tests', got {state.get('lastAgent')}"
        )

    def test_guardian_writes_lastdescription_for_agent_tool(self, tmp_path):
        """guardian.mjs extracts lastDescription from tool_input.description for Agent tools."""
        output, session_file = _run_guardian_with_tool_info(
            tmp_path,
            session_id="test-lastdescription",
            tool_name="Agent",
            tool_input={"description": "Implement tests for reverse_string"},
            elapsed_ms=1000,
        )

        assert session_file.exists(), f"Expected session file at {session_file}"
        state = json.loads(session_file.read_text())
        assert state.get("lastDescription") == "Implement tests for reverse_string", (
            f"Expected lastDescription='Implement tests for reverse_string', "
            f"got {state.get('lastDescription')}"
        )

    def test_guardian_preserves_lastagent_for_non_agent_tool(self, tmp_path):
        """guardian.mjs preserves previous lastAgent when tool is not Agent.

        First call with Agent sets lastAgent, second call with Bash preserves it.
        """
        # First call: set agent info
        _run_guardian_with_tool_info(
            tmp_path,
            session_id="test-preserve-agent",
            tool_name="Agent",
            tool_input={
                "subagent_type": "pairingbuddy:implement-tests",
                "description": "Implement tests",
            },
            elapsed_ms=300_000,
        )
        # Second call: non-Agent tool, no elapsed_ms so it reads existing state
        output, session_file = _run_guardian_with_tool_info(
            tmp_path,
            session_id="test-preserve-agent",
            tool_name="Bash",
        )

        state = json.loads(session_file.read_text())
        assert state.get("lastAgent") == "pairingbuddy:implement-tests", (
            f"Expected lastAgent preserved, got {state.get('lastAgent')}"
        )

    def test_guardian_preserves_lastdescription_for_non_agent_tool(self, tmp_path):
        """guardian.mjs preserves previous lastDescription when tool is not Agent.

        First call with Agent sets lastDescription, second call with Write preserves it.
        """
        # First call: set agent info
        _run_guardian_with_tool_info(
            tmp_path,
            session_id="test-preserve-desc",
            tool_name="Agent",
            tool_input={
                "subagent_type": "pairingbuddy:implement-tests",
                "description": "Implement tests",
            },
            elapsed_ms=300_000,
        )
        # Second call: non-Agent tool, no elapsed_ms so it reads existing state
        output, session_file = _run_guardian_with_tool_info(
            tmp_path,
            session_id="test-preserve-desc",
            tool_name="Write",
        )

        state = json.loads(session_file.read_text())
        assert state.get("lastDescription") == "Implement tests", (
            f"Expected lastDescription preserved, got {state.get('lastDescription')}"
        )

    def test_guardian_agent_info_written_when_no_injection(self, tmp_path):
        """guardian.mjs writes agent info fields even when shouldInject is false.

        With elapsed_ms=1000 (no injection trigger), agent info fields should still be
        present in the session file.
        """
        output, session_file = _run_guardian_with_tool_info(
            tmp_path,
            session_id="test-no-injection",
            tool_name="Agent",
            tool_input={
                "subagent_type": "pairingbuddy:create-tests",
                "description": "Create placeholder tests",
            },
            elapsed_ms=1000,
        )

        assert session_file.exists(), f"Expected session file at {session_file}"
        state = json.loads(session_file.read_text())

        # Fields should be present even though no injection occurred
        assert state.get("lastTool") == "Agent", "Expected lastTool to be written"
        assert state.get("lastAgent") == "pairingbuddy:create-tests", (
            "Expected lastAgent to be written even without injection"
        )
        assert state.get("lastDescription") == "Create placeholder tests", (
            "Expected lastDescription to be written even without injection"
        )
