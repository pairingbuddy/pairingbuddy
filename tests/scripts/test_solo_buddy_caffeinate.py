"""Tests for solo-buddy caffeinate sleep prevention functionality.

Note: These are structural tests that inspect the shell script source text
using string/regex matching to verify function definitions, system checks, and
process handling. This approach is intentionally fragile: if the script
formatting changes, the tests may break even without a behavioral change.
The trade-off is accepted because the target is a small, stable shell script
and source-level checks are the most practical way to assert structural
properties without a macOS development environment for testing caffeinate
behavior.
"""

import os
import re

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


class TestStartCaffeinateFunction:
    """Tests for the start_caffeinate() function."""

    def test_start_caffeinate_defined(self, script_content):
        """A function named start_caffeinate() is defined in the script."""
        assert "start_caffeinate()" in script_content, (
            "start_caffeinate() function must be defined in the script"
        )

    def test_start_caffeinate_checks_darwin(self, script_content):
        """The start_caffeinate function checks for Darwin (macOS) system."""
        function_body = extract_shell_function(script_content, "start_caffeinate")
        assert function_body, "start_caffeinate() function must exist in the script"

        assert re.search(r"\b(Darwin|uname)\b", function_body), (
            "start_caffeinate must check for Darwin or use uname to detect macOS"
        )

    def test_start_caffeinate_runs_caffeinate(self, script_content):
        """The start_caffeinate function invokes the caffeinate command."""
        function_body = extract_shell_function(script_content, "start_caffeinate")
        assert function_body, "start_caffeinate() function must exist in the script"

        assert re.search(r"\bcaffeinate\b", function_body), (
            "start_caffeinate must invoke the caffeinate command"
        )

    def test_start_caffeinate_runs_in_background(self, script_content):
        """The start_caffeinate function launches caffeinate as a background process."""
        function_body = extract_shell_function(script_content, "start_caffeinate")
        assert function_body, "start_caffeinate() function must exist in the script"

        assert re.search(r"&\s*$", function_body, re.MULTILINE), (
            "start_caffeinate must launch caffeinate as background process using '&' at end of line"
        )

    def test_start_caffeinate_captures_pid(self, script_content):
        """The start_caffeinate function stores the caffeinate PID for later cleanup."""
        function_body = extract_shell_function(script_content, "start_caffeinate")
        assert function_body, "start_caffeinate() function must exist in the script"

        assert "CAFFEINATE_PID" in function_body, (
            "start_caffeinate must store caffeinate PID in CAFFEINATE_PID variable"
        )

        assert re.search(r"\$!", function_body), (
            "start_caffeinate must capture PID using $! after background launch"
        )


class TestStopCaffeinateFunction:
    """Tests for the stop_caffeinate() function."""

    def test_stop_caffeinate_defined(self, script_content):
        """A function named stop_caffeinate() is defined in the script."""
        assert "stop_caffeinate()" in script_content, (
            "stop_caffeinate() function must be defined in the script"
        )

    def test_stop_caffeinate_kills_caffeinate_pid(self, script_content):
        """The stop_caffeinate function references CAFFEINATE_PID."""
        function_body = extract_shell_function(script_content, "stop_caffeinate")
        assert function_body, "stop_caffeinate() function must exist in the script"

        assert "CAFFEINATE_PID" in function_body, (
            "stop_caffeinate must reference CAFFEINATE_PID variable"
        )

    def test_stop_caffeinate_uses_kill_command(self, script_content):
        """The stop_caffeinate function sends a kill signal."""
        function_body = extract_shell_function(script_content, "stop_caffeinate")
        assert function_body, "stop_caffeinate() function must exist in the script"

        assert re.search(r"\bkill\b", function_body), (
            "stop_caffeinate must use kill command to terminate the process"
        )

    def test_stop_caffeinate_handles_already_exited_process(self, script_content):
        """Kill in stop_caffeinate suppresses errors for already-exited processes."""
        function_body = extract_shell_function(script_content, "stop_caffeinate")
        assert function_body, "stop_caffeinate() function must exist in the script"

        assert re.search(r"2>/dev/null|\|\|?\s*true", function_body), (
            "stop_caffeinate must handle kill errors with 2>/dev/null or || true guard"
        )


class TestCleanupAndCaffeinateIntegration:
    """Tests for caffeinate integration in cleanup()."""

    def test_cleanup_calls_stop_caffeinate(self, script_content):
        """The cleanup() function calls stop_caffeinate()."""
        cleanup_body = extract_shell_function(script_content, "cleanup")
        assert cleanup_body, "cleanup() function must exist in the script"

        assert "stop_caffeinate" in cleanup_body, (
            "cleanup() must call stop_caffeinate() to clean up the caffeinate process"
        )


class TestCaffeinateIntegrationInMainBody:
    """Tests for caffeinate integration in the solo-buddy.sh main flow."""

    def test_start_caffeinate_before_claude(self, script_content):
        """start_caffeinate is called before the claude invocation in main body."""
        body = extract_main_body(script_content)

        start_caffeinate_pos = body.find("start_caffeinate")
        claude_pos = body.find("claude")

        assert start_caffeinate_pos != -1, "solo-buddy.sh main flow must call start_caffeinate"
        assert claude_pos != -1, "solo-buddy.sh main flow must invoke claude"
        assert start_caffeinate_pos < claude_pos, (
            "start_caffeinate must be called before claude invocation"
        )
