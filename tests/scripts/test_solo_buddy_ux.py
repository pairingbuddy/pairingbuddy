"""Tests for solo-buddy.sh UX improvements.

Scenarios covered:
- final-status-on-completion: cleanup() calls render_status before kill to display final status
- json-output-redirected-to-file: claude stdout is redirected to .pairingbuddy/solo-session.json
- plan-task-shown-in-status (shell parts): render_status spinner and character handling
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
LAST_RENDER_LINES=0
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


class TestFinalStatusOnCompletion:
    """Tests for cleanup() calling render_status before kill (scenario 1)."""

    def test_cleanup_calls_render_status_before_kill(self, script_content):
        """cleanup() calls render_status before kill (structural test)."""
        function_body = extract_shell_function(script_content, "cleanup")

        assert function_body, "cleanup() function must be defined in the script"
        assert "render_status" in function_body, (
            "cleanup() must call render_status to display final status before kill"
        )

    def test_cleanup_render_before_kill_ordering(self, script_content):
        """render_status appears earlier than kill in cleanup() function body (structural test)."""
        function_body = extract_shell_function(script_content, "cleanup")

        assert function_body, "cleanup() function must be defined in the script"

        render_pos = function_body.find("render_status")
        kill_match = re.search(r"\bkill\b", function_body)

        assert render_pos != -1, "cleanup() must call render_status"
        assert kill_match is not None, "cleanup() must call kill"
        assert render_pos < kill_match.start(), "render_status must appear before kill in cleanup()"

    def test_final_render_outputs_status_content(self, script_path):
        """cleanup with valid status file outputs final status content (behavioral test)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            status_dir = os.path.join(tmpdir, ".pairingbuddy")
            os.makedirs(status_dir)
            status_file = os.path.join(status_dir, "solo-status")
            expected_content = "Task 3/5: complete\nStatus: Done"
            with open(status_file, "w") as f:
                f.write(expected_content)

            # Extract cleanup() and render_status() from the script, then call
            # cleanup() in the context of a fake RENDERER_PID (a background sleep)
            # with STATUS_FILE pointing at our test file. We capture stdout to
            # verify render_status was called and output the status.
            cleanup_body = extract_shell_function(script_content_from_path(script_path), "cleanup")
            render_body = extract_shell_function(
                script_content_from_path(script_path), "render_status"
            )

            status_file_path = os.path.join(status_dir, "solo-status")
            wrapper = os.path.join(tmpdir, "wrapper.sh")
            with open(wrapper, "w") as f:
                f.write(f"""#!/bin/bash
set +e

STATUS_FILE={status_file_path!r}
LAST_RENDER_LINES=0

{render_body}

{cleanup_body}

# Start a disposable background process for RENDERER_PID
sleep 60 </dev/null >/dev/null 2>&1 &
RENDERER_PID=$!
disown $RENDERER_PID

cleanup
""")
            os.chmod(wrapper, 0o755)

            result = subprocess.run(
                ["bash", wrapper],
                capture_output=True,
                text=True,
                timeout=10,
            )

            assert expected_content in result.stdout, (
                "cleanup() must call render_status so final status content is output; "
                f"got stdout={result.stdout!r} stderr={result.stderr!r}"
            )


def script_content_from_path(path: str) -> str:
    """Read and return the content of the script at *path*."""
    with open(path) as f:
        return f.read()


class TestJsonOutputRedirectedToFile:
    """Tests for claude stdout redirection to .pairingbuddy/solo-session.json (scenario 2)."""

    def test_claude_stdout_redirected_to_file(self, script_content):
        """claude invocation redirects stdout to .pairingbuddy/solo-session.json (structural)."""
        # Find the line(s) that invoke the claude command (not inside a function)
        lines = script_content.splitlines()
        in_function = False
        claude_lines = []
        for line in lines:
            stripped = line.strip()
            if re.match(r"^\w.*\(\)\s*\{", stripped):
                in_function = True
                continue
            if in_function and stripped == "}":
                in_function = False
                continue
            if not in_function and re.search(r"\bclaude\b", line):
                claude_lines.append(line)

        assert claude_lines, "solo-buddy.sh must invoke claude in the main script body"

        # At least one claude invocation line must redirect stdout to solo-session.json
        redirected = any(
            re.search(r">\s*.pairingbuddy/solo-session\.json", line) for line in claude_lines
        )
        assert redirected, (
            "claude invocation must redirect stdout to .pairingbuddy/solo-session.json; "
            f"found claude lines: {claude_lines!r}"
        )

    def test_exit_code_captured_after_redirect(self, script_content):
        """CLAUDE_EXIT=$? still works after stdout redirect (structural)."""
        # Find the region around the claude invocation (main body, not in functions)
        lines = script_content.splitlines()
        in_function = False
        main_lines = []
        for line in lines:
            stripped = line.strip()
            if re.match(r"^\w.*\(\)\s*\{", stripped):
                in_function = True
                continue
            if in_function and stripped == "}":
                in_function = False
                continue
            if not in_function:
                main_lines.append(line)

        main_body = "\n".join(main_lines)

        # CLAUDE_EXIT=$? must be present after a redirected claude invocation
        assert re.search(r"CLAUDE_EXIT=\$\?", main_body), (
            "script must capture CLAUDE_EXIT=$? after the claude invocation"
        )

        # Verify the claude invocation with redirect comes before CLAUDE_EXIT capture
        claude_redirect_pos = -1
        exit_capture_pos = -1
        for i, line in enumerate(main_lines):
            if re.search(r"\bclaude\b", line) and re.search(
                r">\s*.pairingbuddy/solo-session\.json", line
            ):
                claude_redirect_pos = i
            if re.search(r"CLAUDE_EXIT=\$\?", line):
                exit_capture_pos = i

        assert claude_redirect_pos != -1, "claude invocation with stdout redirect must be present"
        assert exit_capture_pos != -1, "CLAUDE_EXIT=$? capture must be present"
        assert claude_redirect_pos < exit_capture_pos, (
            "CLAUDE_EXIT=$? must follow the redirected claude invocation"
        )

    def test_json_file_path_uses_pairingbuddy_dir(self, script_content):
        """redirect target is .pairingbuddy/solo-session.json not other paths (structural)."""
        # Extract main body (outside functions)
        lines = script_content.splitlines()
        in_function = False
        main_lines = []
        for line in lines:
            stripped = line.strip()
            if re.match(r"^\w.*\(\)\s*\{", stripped):
                in_function = True
                continue
            if in_function and stripped == "}":
                in_function = False
                continue
            if not in_function:
                main_lines.append(line)

        main_body = "\n".join(main_lines)

        # The redirect must use exactly .pairingbuddy/solo-session.json
        assert re.search(r">\s*\.pairingbuddy/solo-session\.json", main_body), (
            "stdout redirect must target .pairingbuddy/solo-session.json specifically"
        )

        # Must NOT redirect to a temp file or other path
        assert not re.search(r">\s*/tmp/", main_body), (
            "stdout redirect must not use /tmp; use .pairingbuddy/solo-session.json"
        )


class TestRenderStatusSpinner:
    """Tests for render_status spinner behavior (scenario 4 shell parts)."""

    def test_render_status_spinner_advances_each_call(self, script_path):
        """Spinner advances on each invocation of render_status."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Call render_status twice and capture the output of each call
            # The spinner character should differ between calls
            status_file_path = f"{tmpdir}/.pairingbuddy/solo-status"
            bash_code = f"""
set +e
STATUS_FILE={status_file_path!r}
LAST_RENDER_LINES=0
SPINNER_INDEX=0
if grep -q 'render_status()' {os.path.abspath(script_path)!r} 2>/dev/null; then
    eval "$(awk '/^render_status\\(\\)[ \\t]*\\{{/,/^\\}}/' {os.path.abspath(script_path)!r})"
fi
cd {tmpdir!r}
# First call
output1=$(render_status 2>/dev/null)
# Second call
output2=$(render_status 2>/dev/null)
echo "CALL1:$output1"
echo "CALL2:$output2"
# The spinner chars on each call must differ
if [[ "$output1" != "$output2" ]]; then
    echo "SPINNER_ADVANCED"
else
    echo "SPINNER_SAME"
fi
"""
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            assert "SPINNER_ADVANCED" in result.stdout, (
                "render_status spinner must advance on each call (outputs differed check failed); "
                f"stdout={result.stdout!r} stderr={result.stderr!r}"
            )

    def test_render_status_spinner_uses_braille_characters(self, script_content):
        """Braille spinner character set defined in render_status function."""
        function_body = extract_shell_function(script_content, "render_status")

        assert function_body, "render_status function must exist in the script"

        # Braille spinner characters: ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ (U+280B, U+2819, etc.)
        # Check for the presence of braille unicode characters (range U+2800–U+28FF)
        braille_pattern = re.compile(r"[\u2800-\u28ff]")
        assert braille_pattern.search(function_body), (
            "render_status must define a braille spinner character set "
            "(e.g. ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) in the function body"
        )

    def test_render_status_no_ansi_when_not_tty(self, script_path):
        """No ANSI color codes when output is not a TTY."""
        with tempfile.TemporaryDirectory() as tmpdir:
            status_dir = os.path.join(tmpdir, ".pairingbuddy")
            os.makedirs(status_dir)
            status_file = os.path.join(status_dir, "solo-status")
            with open(status_file, "w") as f:
                f.write("Task 1/3: running")

            status_file_path = os.path.join(status_dir, "solo-status")
            script = os.path.abspath(script_path)
            # Call render_status twice: the second call will trigger cursor-up ANSI
            # sequences if LAST_RENDER_LINES > 0 after the first call.
            # When not a TTY, both calls must produce plain text with no ANSI codes.
            bash_code = f"""
set +e
STATUS_FILE={status_file_path!r}
LAST_RENDER_LINES=0
if grep -q 'render_status()' {script!r} 2>/dev/null; then
    eval "$(awk '/^render_status\\(\\)[ \\t]*\\{{/,/^\\}}/' {script!r})"
fi
cd {tmpdir!r}
# First call sets LAST_RENDER_LINES > 0
render_status
# Second call: if render_status does not detect TTY, must not emit ANSI
render_status
"""
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            # When stdout is captured (not a TTY), ANSI escape codes should not appear
            # Check for ESC sequences (\x1b[ ...) in the captured stdout
            assert "\x1b[" not in result.stdout, (
                "render_status must not emit ANSI escape codes when output is not a TTY; "
                f"got stdout={result.stdout!r}"
            )
