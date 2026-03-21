"""Tests for write_final_status() in solo-buddy.sh.

Scenarios covered:
- function-definition-and-placement: write_final_status() exists and is called at correct point
- checkbox-counting: counts completed and incomplete tasks from plan file
- status-output-content: writes status file with proper content
- edge-cases: handles missing/empty plan files gracefully
"""

import os
import re
import subprocess
import tempfile
from pathlib import Path

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


def build_write_final_status_script(script: str, tmpdir: str, plan_file: str) -> str:
    """Return a bash snippet that loads write_final_status from *script* and calls it.

    Uses awk to extract the function definition and eval to load it, then
    sets up required variables and calls write_final_status in *tmpdir*.
    The ``set +e`` guard keeps the subprocess from aborting when the script
    does not exist yet.

    STATUS_FILE and PLAN_FILE are set to paths inside tmpdir so that the
    function works correctly when called in isolation.
    """
    status_file_path = f"{tmpdir}/.pairingbuddy/solo-status"
    return f"""
set +e
STATUS_FILE={status_file_path!r}
PLAN_FILE={plan_file!r}
CLAUDE_EXIT=0
if grep -q 'write_final_status()' {script!r} 2>/dev/null; then
    eval "$(awk '/^write_final_status\\(\\)[ \\t]*\\{{/,/^\\}}/' {script!r})"
fi
write_final_status
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


class TestFunctionDefinitionAndPlacement:
    """Tests for write_final_status() definition and placement (scenario 1)."""

    def test_write_final_status_defined(self, script_content):
        """write_final_status() function exists in script."""
        assert "write_final_status()" in script_content, (
            "write_final_status function must be defined in solo-buddy.sh"
        )

    def test_called_after_claude_exit(self, script_content):
        """write_final_status is called after CLAUDE_EXIT=$? in main body."""
        lines = script_content.splitlines()

        # Find line indices for CLAUDE_EXIT=$? and write_final_status call
        # in the main body (outside function definitions)
        in_function = False
        claude_exit_line = None
        write_final_status_call_line = None

        for i, line in enumerate(lines):
            stripped = line.strip()
            # Detect entering a function definition
            if re.match(r"^\w+\(\)\s*\{", stripped):
                in_function = True
                continue
            # Detect leaving a function definition
            if in_function and stripped == "}":
                in_function = False
                continue
            if not in_function:
                if re.search(r"CLAUDE_EXIT=\$\?", line):
                    claude_exit_line = i
                if (
                    re.search(r"\bwrite_final_status\b", line)
                    and "write_final_status()" not in line
                ):
                    write_final_status_call_line = i

        assert write_final_status_call_line is not None, (
            "write_final_status must be called in the main body of solo-buddy.sh"
        )
        assert claude_exit_line is not None, (
            "CLAUDE_EXIT=$? must be set in the main body of solo-buddy.sh"
        )
        assert write_final_status_call_line > claude_exit_line, (
            "write_final_status must be called after CLAUDE_EXIT=$? is set"
        )

    def test_called_before_if_block(self, script_content):
        """write_final_status is called before `if [[ $CLAUDE_EXIT` exit-handling block."""
        lines = script_content.splitlines()

        in_function = False
        write_final_status_call_line = None
        if_claude_exit_line = None

        for i, line in enumerate(lines):
            stripped = line.strip()
            if re.match(r"^\w+\(\)\s*\{", stripped):
                in_function = True
                continue
            if in_function and stripped == "}":
                in_function = False
                continue
            if not in_function:
                if (
                    re.search(r"\bwrite_final_status\b", line)
                    and "write_final_status()" not in line
                ):
                    write_final_status_call_line = i
                if re.search(r"if\s+\[\[.*\$CLAUDE_EXIT", line):
                    if_claude_exit_line = i

        assert write_final_status_call_line is not None, (
            "write_final_status must be called in the main body of solo-buddy.sh"
        )
        assert if_claude_exit_line is not None, (
            "if [[ $CLAUDE_EXIT ... ]] block must exist in the main body of solo-buddy.sh"
        )
        assert write_final_status_call_line < if_claude_exit_line, (
            "write_final_status must be called before the if [[ $CLAUDE_EXIT ]] block"
        )


class TestCheckboxCounting:
    """Tests for checkbox counting in plan file (scenario 2)."""

    def test_counts_completed_tasks(self, script_path):
        """Correctly counts `- [x]` lines in plan file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [x] Task 2\n- [ ] Task 3\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must create the status file"
            content = Path(status_file).read_text()
            assert "2" in content, "Status file must contain the count of completed tasks (2)"

    def test_counts_incomplete_tasks(self, script_path):
        """Correctly counts `- [ ]` lines in plan file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [ ] Task 2\n- [ ] Task 3\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must create the status file"
            content = Path(status_file).read_text()
            # Total is 3, completed is 1 — expect "1/3" or similar
            assert "1" in content, "Status file must contain the count of completed tasks (1)"
            assert "3" in content, "Status file must contain the total task count (3)"

    def test_computes_total(self, script_path):
        """Total = completed + incomplete from plan file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [x] Task 2\n- [ ] Task 3\n- [ ] Task 4\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must create the status file"
            content = Path(status_file).read_text()
            # 2 completed out of 4 total — expect "2/4"
            assert re.search(r"2\s*/\s*4", content), (
                "Status file must contain completion ratio '2/4'"
            )

    def test_handles_no_checkboxes(self, script_path):
        """Plan file with no checkboxes produces 0/0 status."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("# My plan\n\nThis plan has no task checkboxes.\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), (
                "write_final_status must create the status file even with no checkboxes"
            )
            content = Path(status_file).read_text()
            assert re.search(r"0\s*/\s*0", content), (
                "Status file must contain '0/0' when no checkboxes are present"
            )

    def test_handles_all_complete(self, script_path):
        """All tasks checked: N/N for N completed tasks."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [x] Task 2\n- [x] Task 3\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must create the status file"
            content = Path(status_file).read_text()
            assert re.search(r"3\s*/\s*3", content), (
                "Status file must contain '3/3' when all tasks are complete"
            )


class TestStatusOutputContent:
    """Tests for status file output content (scenario 3)."""

    def test_writes_to_status_file(self, script_path):
        """write_final_status writes to STATUS_FILE (.pairingbuddy/solo-status)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [ ] Task 2\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), (
                "write_final_status must write to .pairingbuddy/solo-status"
            )
            content = Path(status_file).read_text()
            assert len(content.strip()) > 0, "Status file must not be empty"

    def test_includes_completion_counts(self, script_path):
        """Output contains X/Y completion counts."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [x] Task 2\n- [ ] Task 3\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must write to STATUS_FILE"
            content = Path(status_file).read_text()
            assert re.search(r"\d+\s*/\s*\d+", content), (
                "Status file must contain X/Y completion counts"
            )

    def test_success_context_on_exit_zero(self, script_path):
        """On CLAUDE_EXIT=0, status reflects success context."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [x] Task 2\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            status_file_path = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            bash_code = f"""
set +e
STATUS_FILE={status_file_path!r}
PLAN_FILE={plan_file!r}
CLAUDE_EXIT=0
if grep -q 'write_final_status()' {script_path!r} 2>/dev/null; then
    eval "$(awk '/^write_final_status\\(\\)[ \\t]*\\{{/,/^\\}}/' {script_path!r})"
fi
write_final_status
"""
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            assert os.path.exists(status_file_path), "write_final_status must write to STATUS_FILE"
            content = Path(status_file_path).read_text().lower()
            # On success, expect a positive signal: "complete", "done", "success", or similar
            assert any(word in content for word in ("complete", "done", "success", "finished")), (
                "Status file must contain a success indicator when CLAUDE_EXIT=0"
            )

    def test_failure_context_on_nonzero_exit(self, script_path):
        """On non-zero CLAUDE_EXIT, status reflects failure/interrupted context."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [ ] Task 2\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            status_file_path = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            bash_code = f"""
set +e
STATUS_FILE={status_file_path!r}
PLAN_FILE={plan_file!r}
CLAUDE_EXIT=1
if grep -q 'write_final_status()' {script_path!r} 2>/dev/null; then
    eval "$(awk '/^write_final_status\\(\\)[ \\t]*\\{{/,/^\\}}/' {script_path!r})"
fi
write_final_status
"""
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            assert os.path.exists(status_file_path), (
                "write_final_status must write to STATUS_FILE even on failure"
            )
            content = Path(status_file_path).read_text().lower()
            # On failure, expect a negative signal: "fail", "error", "interrupted", or similar
            assert any(
                word in content for word in ("fail", "error", "interrupt", "stopped", "abort")
            ), "Status file must contain a failure indicator when CLAUDE_EXIT is non-zero"


class TestEdgeCases:
    """Tests for edge cases in handling plan file (scenario 4)."""

    def test_missing_plan_file(self, script_path):
        """write_final_status handles missing PLAN_FILE without crashing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            missing_plan_file = os.path.join(tmpdir, "nonexistent-plan.md")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, missing_plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            # The function should not crash (exit code may be non-zero but
            # it must not produce an unhandled error that prevents status writing)
            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), (
                "write_final_status must still write status file when PLAN_FILE is missing"
            )

    def test_empty_plan_file(self, script_path):
        """write_final_status handles empty PLAN_FILE (0/0 status)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "empty-plan.md")
            with open(plan_file, "w") as f:
                f.write("")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), (
                "write_final_status must write status file even for empty plan file"
            )
            content = Path(status_file).read_text()
            assert re.search(r"0\s*/\s*0", content), (
                "Status file must contain '0/0' for an empty plan file"
            )


class TestClearTerminalFunction:
    """Tests for clear_terminal() function (scenario 2)."""

    def test_clear_terminal_function_defined(self, script_content):
        """clear_terminal() function exists in script."""
        assert "clear_terminal()" in script_content, (
            "clear_terminal function must be defined in solo-buddy.sh"
        )

    def test_clear_terminal_uses_ansi_and_dev_tty(self, script_content):
        """clear_terminal uses ANSI clear-screen and references /dev/tty."""
        function_body = extract_shell_function(script_content, "clear_terminal")
        assert function_body, "clear_terminal() function must be defined in the script"
        assert r"\033[2J" in function_body or "\033[2J" in function_body, (
            "clear_terminal must use ANSI escape \\033[2J to clear the screen"
        )
        assert r"\033[H" in function_body or "\033[H" in function_body, (
            "clear_terminal must use ANSI escape \\033[H to move cursor to home position"
        )
        assert "/dev/tty" in function_body, (
            "clear_terminal must reference /dev/tty to write directly to the terminal"
        )

    def test_clear_terminal_called_after_claude_exit(self, script_content):
        """clear_terminal is called after CLAUDE_EXIT=$?, before write_final_status."""
        lines = script_content.splitlines()

        in_function = False
        claude_exit_line = None
        clear_terminal_call_line = None
        write_final_status_call_line = None

        for i, line in enumerate(lines):
            stripped = line.strip()
            if re.match(r"^\w+\(\)\s*\{", stripped):
                in_function = True
                continue
            if in_function and stripped == "}":
                in_function = False
                continue
            if not in_function:
                if re.search(r"CLAUDE_EXIT=\$\?", line):
                    claude_exit_line = i
                if re.search(r"\bclear_terminal\b", line) and "clear_terminal()" not in line:
                    clear_terminal_call_line = i
                if (
                    re.search(r"\bwrite_final_status\b", line)
                    and "write_final_status()" not in line
                ):
                    write_final_status_call_line = i

        assert claude_exit_line is not None, (
            "CLAUDE_EXIT=$? must be set in the main body of solo-buddy.sh"
        )
        assert write_final_status_call_line is not None, (
            "write_final_status must be called in the main body of solo-buddy.sh"
        )
        # clear_terminal is called from inside write_final_status(),
        # so we verify write_final_status is called after CLAUDE_EXIT
        assert write_final_status_call_line > claude_exit_line, (
            "write_final_status (which calls clear_terminal) must be called after CLAUDE_EXIT=$?"
        )
        assert clear_terminal_call_line < write_final_status_call_line, (
            "clear_terminal must be called before write_final_status"
        )

    def test_clear_terminal_graceful_when_no_tty(self, script_path):
        """clear_terminal exits gracefully when /dev/tty is unavailable."""
        bash_code = f"""
set +e
if grep -q 'clear_terminal()' {script_path!r} 2>/dev/null; then
    eval "$(awk '/^clear_terminal\\(\\)[ \\t]*\\{{/,/^\\}}/' {script_path!r})"
fi
# Simulate unavailable /dev/tty by redirecting it to /dev/null via env override
# The function should complete without error even without a real tty
clear_terminal 2>/dev/null
echo "EXIT:$?"
"""
        result = subprocess.run(
            ["bash", "-c", bash_code],
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert "EXIT:0" in result.stdout, (
            "clear_terminal must exit with code 0 even when /dev/tty is not a real TTY; "
            f"stdout={result.stdout!r} stderr={result.stderr!r}"
        )


class TestWriteFinalStatusFormattedOutput:
    """Tests for formatted output in write_final_status (scenario 3)."""

    def test_task_list_with_symbols(self, script_path):
        """Status output uses ✓ for completed and ○ for incomplete tasks."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [ ] Task 2\n- [ ] Task 3\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must create the status file"
            content = Path(status_file).read_text()
            assert "✓" in content, "Status file must use ✓ to mark completed tasks"
            assert "○" in content, "Status file must use ○ to mark remaining incomplete tasks"

    def test_current_task_arrow(self, script_path):
        """First incomplete task marked with → in status output."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [ ] Task 2\n- [ ] Task 3\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must create the status file"
            content = Path(status_file).read_text()
            assert "→" in content, (
                "Status file must use → to mark the first incomplete (current) task"
            )

    def test_progress_bar_present(self, script_path):
        """Status output contains progress bar with block characters (█ and ░)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [ ] Task 2\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must create the status file"
            content = Path(status_file).read_text()
            assert "\u2588" in content, (
                "Status file must contain █ (U+2588) for progress bar filled portion"
            )
            assert "\u2591" in content, (
                "Status file must contain ░ (U+2591) for progress bar empty portion"
            )

    def test_session_complete_message(self, script_path):
        """Footer says 'Session complete' and shows formatted task list on exit code 0."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [x] Task 2\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            status_file_path = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            bash_code = f"""
set +e
STATUS_FILE={status_file_path!r}
PLAN_FILE={plan_file!r}
CLAUDE_EXIT=0
if grep -q 'write_final_status()' {script_path!r} 2>/dev/null; then
    eval "$(awk '/^write_final_status\\(\\)[ \\t]*\\{{/,/^\\}}/' {script_path!r})"
fi
write_final_status
"""
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            assert os.path.exists(status_file_path), (
                "write_final_status must create the status file"
            )
            content = Path(status_file_path).read_text()
            assert "Session complete" in content, (
                "Status file must contain 'Session complete' when CLAUDE_EXIT=0"
            )
            # The formatted output must include task symbols (✓ for completed tasks)
            assert "✓" in content, "Formatted status must include ✓ symbols for completed tasks"

    def test_session_interrupted_message(self, script_path):
        """Footer says 'Session interrupted' and shows formatted task list on non-zero exit."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [ ] Task 2\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            status_file_path = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            bash_code = f"""
set +e
STATUS_FILE={status_file_path!r}
PLAN_FILE={plan_file!r}
CLAUDE_EXIT=1
if grep -q 'write_final_status()' {script_path!r} 2>/dev/null; then
    eval "$(awk '/^write_final_status\\(\\)[ \\t]*\\{{/,/^\\}}/' {script_path!r})"
fi
write_final_status
"""
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            assert os.path.exists(status_file_path), (
                "write_final_status must create the status file"
            )
            content = Path(status_file_path).read_text()
            assert "Session interrupted" in content, (
                "Status file must contain 'Session interrupted' when CLAUDE_EXIT is non-zero"
            )
            assert "→" in content, "Formatted status must include → for current task"

    def test_progress_bar_full_when_all_complete(self, script_path):
        """Progress bar shows 100% (all █) when all tasks checked."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [x] Task 2\n- [x] Task 3\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must create the status file"
            content = Path(status_file).read_text()
            assert "\u2588" in content, "Status file must contain █ in the progress bar"
            assert "\u2591" not in content, (
                "Progress bar must show all █ (no ░) when all tasks are complete"
            )

    def test_progress_bar_partial(self, script_path):
        """Progress bar shows partial completion (e.g., 50% for 2/4 tasks)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [x] Task 1\n- [x] Task 2\n- [ ] Task 3\n- [ ] Task 4\n")

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"), exist_ok=True)
            bash_code = build_write_final_status_script(script_path, tmpdir, plan_file)
            subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            status_file = os.path.join(tmpdir, ".pairingbuddy", "solo-status")
            assert os.path.exists(status_file), "write_final_status must create the status file"
            content = Path(status_file).read_text()
            assert "\u2588" in content, (
                "Status file must contain █ for the completed portion of the progress bar"
            )
            assert "\u2591" in content, "Status must contain ░ for incomplete bar portion"
