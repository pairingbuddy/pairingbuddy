"""Tests for solo-buddy renderer functionality."""

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


def build_render_status_script(script: str, tmpdir: str) -> str:
    """Return a bash snippet that loads render_status from *script* and calls it in *tmpdir*.

    Uses awk to extract the function definition and eval to load it, then
    changes into tmpdir before invoking render_status.  The ``set +e`` guard
    keeps the subprocess from aborting when the script does not exist yet.

    STATUS_FILE is set to the expected path inside tmpdir so that the function
    works correctly when called in isolation (outside of the full script context
    where STATUS_FILE is assigned at the top level).
    """
    status_file_path = f"{tmpdir}/.pairingbuddy/solo-status"
    return f"""
set +e
STATUS_FILE={status_file_path!r}
if grep -q 'render_status()' {script!r} 2>/dev/null; then
    eval "$(awk '/^render_status\\(\\)[ \\t]*\\{{/,/^\\}}/' {script!r})"
fi
cd {tmpdir!r}
render_status
"""


@pytest.fixture
def script_path() -> str:
    """Return the absolute path to solo-buddy.sh."""
    return os.path.abspath(SCRIPT_PATH)


@pytest.fixture
def script_content(script_path: str) -> str:
    """Return the full text of solo-buddy.sh."""
    with open(script_path) as f:
        return f.read()


class TestRenderStatusFunction:
    """Tests for the render_status function."""

    def test_render_status_displays_file_contents(self, script_path):
        """render_status outputs the contents of .pairingbuddy/solo-status when the file exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            status_dir = os.path.join(tmpdir, ".pairingbuddy")
            os.makedirs(status_dir)
            status_file = os.path.join(status_dir, "solo-status")
            expected_content = "Agent 2/5: implement-tests\nStatus: Running"
            with open(status_file, "w") as f:
                f.write(expected_content)

            bash_code = build_render_status_script(script_path, tmpdir)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            assert expected_content in result.stdout

    def test_render_status_waiting_message_when_no_file(self, script_path):
        """render_status outputs a waiting message when .pairingbuddy/solo-status does not exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bash_code = build_render_status_script(script_path, tmpdir)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            assert "waiting" in result.stdout.lower()


class TestStartRendererFunction:
    """Tests for the start_renderer function."""

    def test_start_renderer_runs_in_background(self, script_content):
        """start_renderer starts the renderer as a background process."""
        assert "start_renderer" in script_content, (
            "start_renderer function must exist in the script"
        )

        function_body = extract_shell_function(script_content, "start_renderer")

        assert re.search(r"&\s*$", function_body, re.MULTILINE), (
            "start_renderer must launch renderer as background process using '&' at end of line"
        )

    def test_start_renderer_captures_pid(self, script_content):
        """start_renderer stores the renderer PID in a variable for later cleanup."""
        assert "start_renderer" in script_content, (
            "start_renderer function must exist in the script"
        )

        function_body = extract_shell_function(script_content, "start_renderer")

        assert re.search(r"\$!", function_body), (
            "start_renderer must capture PID using $! after background launch"
        )


class TestRendererIntegration:
    """Tests for renderer integration in the solo-buddy.sh flow."""

    def test_renderer_started_after_claude_launch(self, script_content):
        """start_renderer is called during the solo-buddy.sh main flow."""
        lines = script_content.splitlines()
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

        body = "\n".join(body_lines)
        assert "start_renderer" in body, (
            "solo-buddy.sh main flow must call start_renderer (not just define it)"
        )

    def test_renderer_loops_with_sleep_interval(self, script_content):
        """The renderer loop includes a sleep call to update at a regular interval."""
        assert "start_renderer" in script_content, (
            "start_renderer function must exist in the script"
        )

        function_body = extract_shell_function(script_content, "start_renderer")

        assert re.search(r"\bsleep\b", function_body), (
            "start_renderer must include a sleep call for the render loop interval"
        )


class TestRenderStatusAnsiUpdate:
    """Tests for ANSI escape code updates in render_status."""

    def test_render_status_uses_ansi_cursor_up(self, script_content):
        """render_status function body contains ANSI cursor-up escape sequence."""
        function_body = extract_shell_function(script_content, "render_status")
        assert function_body, "render_status function must exist in the script"
        # ANSI cursor-up: ESC[<n>A — matches \\033[...A or \\e[...A or literal ESC
        assert re.search(r"(\\033|\\e|\x1b)\[[\d;]*A", function_body), (
            "render_status must use ANSI cursor-up escape sequence (e.g. \\033[<n>A)"
        )

    def test_render_status_uses_ansi_clear_line(self, script_content):
        """render_status function body contains ANSI clear-line escape sequence."""
        function_body = extract_shell_function(script_content, "render_status")
        assert function_body, "render_status function must exist in the script"
        # ANSI erase line: ESC[2K or ESC[K
        assert re.search(r"(\\033|\\e|\x1b)\[[\d;]*K", function_body), (
            "render_status must use ANSI clear-line escape sequence (e.g. \\033[2K)"
        )

    def test_render_status_no_separator_line(self, script_content):
        """render_status does NOT print the old separator '---...' line."""
        function_body = extract_shell_function(script_content, "render_status")
        assert function_body, "render_status function must exist in the script"
        assert not re.search(r"echo\s+['\"][-]{3,}", function_body), (
            "render_status must not print separator lines like '---...'"
        )

    def test_render_status_still_displays_file_contents(self, script_path):
        """Still outputs status file contents when file exists (behavioral test)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            status_dir = os.path.join(tmpdir, ".pairingbuddy")
            os.makedirs(status_dir)
            status_file = os.path.join(status_dir, "solo-status")
            expected_content = "Agent 3/5: implement-tests\nStatus: Running"
            with open(status_file, "w") as f:
                f.write(expected_content)

            bash_code = build_render_status_script(script_path, tmpdir)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            assert expected_content in result.stdout

    def test_render_status_still_shows_waiting_when_no_file(self, script_path):
        """Still outputs waiting message when no file (behavioral test)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bash_code = build_render_status_script(script_path, tmpdir)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            assert "waiting" in result.stdout.lower()
