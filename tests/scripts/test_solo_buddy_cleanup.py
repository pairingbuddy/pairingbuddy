"""Tests for solo-buddy cleanup functionality.

Note: Most tests here are structural — they inspect the shell script source text
using string/regex matching to verify function definitions, kill commands, and trap
registrations.  This approach is intentionally fragile: if the script formatting
changes (e.g., spacing, function-definition style) the tests may break even without
a behavioral change.  The trade-off is accepted because the target is a small,
stable shell script and source-level checks are the most practical way to assert
structural properties without executing the script.  The integration test
(test_renderer_process_killed_on_exit) provides the authoritative behavioral check.
"""

import os
import re
import subprocess
import tempfile

import pytest

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "solo-buddy.sh")


def extract_shell_function(content: str, function_name: str) -> str:
    """Return the body of a named shell function from script content.

    Finds the first occurrence of ``function_name()`` and collects lines
    until the closing ``}`` on its own line.  Returns the joined lines as a
    string, or an empty string when the function is not found.
    """
    lines = content.splitlines()
    in_function = False
    function_lines = []
    for line in lines:
        if f"{function_name}()" in line:
            in_function = True
        if in_function:
            function_lines.append(line)
            if line.strip() == "}" and len(function_lines) > 1:
                break
    return "\n".join(function_lines)


def extract_main_body(content: str) -> str:
    """Return the main script body, excluding all named function definitions.

    Lines between a ``name() {`` header and its closing ``}`` are dropped so
    that only top-level (non-function) lines remain.
    """
    lines = content.splitlines()
    in_function = False
    body_lines = []
    for line in lines:
        stripped = line.strip()
        if re.match(r"^\w.*\(\)\s*\{", stripped):
            in_function = True
            continue
        if in_function and stripped == "}":
            in_function = False
            continue
        if not in_function:
            body_lines.append(line)
    return "\n".join(body_lines)


@pytest.fixture
def script_path() -> str:
    """Return the absolute path to solo-buddy.sh."""
    return os.path.abspath(SCRIPT_PATH)


@pytest.fixture
def script_content(script_path: str) -> str:
    """Return the full text of solo-buddy.sh."""
    with open(script_path) as f:
        return f.read()


class TestCleanupFunctionDefinition:
    """Tests for the cleanup() function definition."""

    def test_cleanup_function_exists(self, script_content):
        """A function named cleanup() is defined in the script."""
        assert "cleanup()" in script_content, "cleanup() function must be defined in the script"

    def test_cleanup_kills_renderer_pid(self, script_content):
        """The cleanup function references RENDERER_PID in the body."""
        function_body = extract_shell_function(script_content, "cleanup")

        assert "RENDERER_PID" in function_body, (
            "cleanup function must reference RENDERER_PID variable"
        )

    def test_cleanup_uses_kill_command(self, script_content):
        """The cleanup function sends a kill signal."""
        function_body = extract_shell_function(script_content, "cleanup")

        assert re.search(r"\bkill\b", function_body), (
            "cleanup function must use kill command to terminate the process"
        )

    def test_cleanup_handles_already_exited_process(self, script_content):
        """Kill in cleanup suppresses errors for already-exited processes."""
        function_body = extract_shell_function(script_content, "cleanup")

        assert re.search(r"2>/dev/null|\|\|?\s*true", function_body), (
            "cleanup function must handle kill errors with 2>/dev/null or || true guard"
        )


class TestTrapRegistration:
    """Tests for trap registration in the script."""

    def test_trap_registered_for_exit(self, script_content):
        """The script registers a trap for the EXIT pseudo-signal so cleanup runs on normal exit."""
        assert re.search(r"trap\s+.*cleanup.*EXIT", script_content), (
            "script must register trap for EXIT signal that invokes cleanup"
        )

    def test_trap_registered_for_sigterm(self, script_content):
        """Script registers a trap for SIGTERM to run cleanup on termination."""
        assert re.search(r"trap\s+.*cleanup.*(SIGTERM|TERM)", script_content), (
            "script must register trap for SIGTERM signal that invokes cleanup"
        )

    def test_trap_registered_for_sigint(self, script_content):
        """The script registers a trap for SIGINT so cleanup runs on Ctrl-C."""
        assert re.search(r"trap\s+.*cleanup.*(SIGINT|INT)", script_content), (
            "script must register trap for SIGINT signal that invokes cleanup"
        )


class TestTrapAndCleanupIntegration:
    """Tests for trap and cleanup integration in the solo-buddy.sh flow."""

    def test_trap_set_after_start_renderer(self, script_content):
        """The trap invocation appears in the main script body after the call to start_renderer."""
        body = extract_main_body(script_content)

        start_renderer_pos = body.find("start_renderer")
        trap_pos = body.find("trap")

        assert start_renderer_pos != -1, "solo-buddy.sh main flow must call start_renderer"
        assert trap_pos != -1, "solo-buddy.sh main flow must set up trap"
        assert start_renderer_pos < trap_pos, (
            "trap must be registered after start_renderer is called so RENDERER_PID is populated"
        )

    @pytest.mark.integration
    def test_renderer_process_killed_on_exit(self, script_path, script_content):
        """cleanup() kills the renderer process that would otherwise outlive the script."""
        cleanup_body = extract_shell_function(script_content, "cleanup")

        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = os.path.join(tmpdir, "renderer.pid")

            # Create a wrapper that loads the real cleanup() function extracted
            # by the Python helper, starts a long-lived background process,
            # disowns it so it survives shell exit without cleanup, records the
            # PID, then calls cleanup() explicitly and checks the process is gone.
            #
            # Redirect the background sleep away from inherited pipe fds so the
            # subprocess does not block waiting for them to close.
            wrapper = os.path.join(tmpdir, "wrapper.sh")
            with open(wrapper, "w") as f:
                f.write(f"""#!/bin/bash
set +e

# Load cleanup() extracted from the real script by the Python test helper
{cleanup_body}

# Start a long-lived background process with all fds closed so it does not
# hold the test's pipe open.  disown ensures the shell does not send SIGHUP.
sleep 60 </dev/null >/dev/null 2>&1 &
RENDERER_PID=$!
disown $RENDERER_PID
echo "$RENDERER_PID" > {pid_file!r}

# Call cleanup - it must kill RENDERER_PID
cleanup

# Check whether the process is still running
if kill -0 "$RENDERER_PID" 2>/dev/null; then
    echo "PROCESS_ALIVE"
else
    echo "PROCESS_DEAD"
fi
exit 0
""")
            os.chmod(wrapper, 0o755)

            # Exercise
            result = subprocess.run(
                ["bash", wrapper],
                capture_output=True,
                text=True,
                timeout=10,
            )

            # Verify - cleanup() must have killed the renderer process
            assert "PROCESS_DEAD" in result.stdout, (
                "cleanup() function must kill RENDERER_PID; "
                f"got stdout={result.stdout!r} stderr={result.stderr!r}"
            )
