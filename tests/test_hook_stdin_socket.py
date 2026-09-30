"""
Hook stdin transport tests.

Claude Code spawns hooks from Node, which on Linux hands stdin over as a UNIX socket
rather than a pipe. open("/dev/stdin") on a socket fails with ENXIO, so hooks must read
fd 0 directly. subprocess.run(input=...) uses a pipe and cannot catch this, hence the
socketpair here.
"""

import json
import os
import socket
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
HOOKS_DIR = REPO_ROOT / "hooks"


def _run_with_socket_stdin(script, payload, cwd, env_extra=None):
    parent, child = socket.socketpair()
    env = os.environ.copy()
    env.pop("PAIRINGBUDDY_SOLO", None)
    env.update(env_extra or {})
    try:
        proc = subprocess.Popen(
            ["node", str(HOOKS_DIR / script)],
            stdin=child.fileno(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=cwd,
            env=env,
        )
        child.close()
        parent.sendall(json.dumps(payload).encode())
        parent.shutdown(socket.SHUT_WR)
        stdout, stderr = proc.communicate(timeout=10)
    finally:
        parent.close()
    return proc.returncode, stdout.decode(), stderr.decode()


def test_guardian_reads_payload_from_socket_stdin(tmp_path):
    payload = {
        "session_id": "socket-session",
        "hook_event_name": "PostToolUse",
        "tool_name": "Bash",
    }

    code, stdout, stderr = _run_with_socket_stdin("guardian.mjs", payload, tmp_path)

    assert code == 0, stderr
    assert json.loads(stdout)["hookSpecificOutput"]["hookEventName"] == "PostToolUse"


def test_solo_progress_reads_payload_from_socket_stdin(tmp_path):
    (tmp_path / ".pairingbuddy").mkdir()
    payload = {"tool_name": "Agent", "tool_input": {"subagent_type": "socket-agent"}}

    code, _stdout, stderr = _run_with_socket_stdin(
        "solo-progress.mjs", payload, tmp_path, env_extra={"PAIRINGBUDDY_SOLO": "true"}
    )

    assert code == 0, stderr
    assert not (tmp_path / ".pairingbuddy" / "solo-progress-errors.log").exists()
    assert "socket-agent" in (tmp_path / ".pairingbuddy" / "solo-status").read_text()


def test_guardian_exits_cleanly_on_empty_stdin(tmp_path):
    proc = subprocess.run(
        ["node", str(HOOKS_DIR / "guardian.mjs")],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )

    assert proc.returncode == 0, proc.stderr
