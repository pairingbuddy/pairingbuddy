"""Tests for print_exit_summary() in solo-buddy.sh.

Scenarios covered:
- print-exit-summary-definition: print_exit_summary() exists and has required content
- exit-summary-call-ordering: function is called at correct point in exit sequence
- exit-summary-success-output: output shows success indicators with PR URL and report path
- exit-summary-pr-failure-output: PR failure warning shown but success message still present
- exit-summary-interrupted-output: output shows failure indicators with exit code and report path
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


def build_print_exit_summary_script(
    script: str,
    tmpdir: str,
    claude_exit: int,
    pr_url: str = "",
    pr_error: str = "",
    report_file: str = "",
) -> str:
    """Return a bash snippet that loads print_exit_summary from *script* and calls it.

    Uses awk to extract the function definition and eval to load it, then
    sets up required environment variables and calls print_exit_summary.

    The script simulates exit conditions and variables that would be set by
    the main solo-buddy.sh flow.
    """
    return f"""
set +e
CLAUDE_EXIT={claude_exit}
PR_URL={pr_url!r}
PR_ERROR={pr_error!r}
REPORT_FILE={report_file!r}
if grep -q 'print_exit_summary()' {script!r} 2>/dev/null; then
    eval "$(awk '/^print_exit_summary\\(\\)[ \\t]*\\{{/,/^\\}}/' {script!r})"
fi
print_exit_summary 2>&1
echo "EXIT:$?"
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


class TestPrintExitSummaryDefinition:
    """Tests for print_exit_summary() definition (scenario 1: print-exit-summary-definition)."""

    def test_function_defined(self, script_content):
        """print_exit_summary() function is defined in script."""
        assert "print_exit_summary()" in script_content, (
            "print_exit_summary function must be defined in solo-buddy.sh"
        )

    def test_references_dev_tty(self, script_content):
        """print_exit_summary function body references /dev/tty."""
        function_body = extract_shell_function(script_content, "print_exit_summary")
        assert function_body, "print_exit_summary() function must be defined in the script"
        assert "/dev/tty" in function_body, (
            "print_exit_summary must reference /dev/tty to write directly to the terminal"
        )

    def test_graceful_without_tty(self, script_path):
        """print_exit_summary exits 0 when /dev/tty unavailable (behavioral)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bash_code = build_print_exit_summary_script(script_path, tmpdir, claude_exit=0)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            assert "EXIT:0" in result.stdout, (
                "print_exit_summary must exit with code 0 even when /dev/tty is not available; "
                f"stdout={result.stdout!r} stderr={result.stderr!r}"
            )


class TestExitSummaryCallOrdering:
    """Tests for call ordering (scenario 2: exit-summary-call-ordering)."""

    def test_called_after_write_final_status(self, script_content):
        """print_exit_summary appears after write_final_status in main body."""
        lines = script_content.splitlines()

        in_function = False
        write_final_status_line = None
        print_exit_summary_line = None

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
                    write_final_status_line = i
                if (
                    re.search(r"\bprint_exit_summary\b", line)
                    and "print_exit_summary()" not in line
                ):
                    print_exit_summary_line = i

        assert write_final_status_line is not None, (
            "write_final_status must be called in the main body of solo-buddy.sh"
        )
        assert print_exit_summary_line is not None, (
            "print_exit_summary must be called in the main body of solo-buddy.sh"
        )
        assert print_exit_summary_line > write_final_status_line, (
            "print_exit_summary must be called after write_final_status"
        )

    def test_called_before_exit(self, script_content):
        """print_exit_summary appears before `exit $CLAUDE_EXIT` in main body."""
        lines = script_content.splitlines()

        in_function = False
        print_exit_summary_line = None
        exit_claude_exit_line = None

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
                    re.search(r"\bprint_exit_summary\b", line)
                    and "print_exit_summary()" not in line
                ):
                    print_exit_summary_line = i
                if re.search(r"exit\s+\$CLAUDE_EXIT", line):
                    exit_claude_exit_line = i

        assert print_exit_summary_line is not None, (
            "print_exit_summary must be called in the main body of solo-buddy.sh"
        )
        assert exit_claude_exit_line is not None, (
            "exit $CLAUDE_EXIT must be present in the main body of solo-buddy.sh"
        )
        assert print_exit_summary_line < exit_claude_exit_line, (
            "print_exit_summary must be called before exit $CLAUDE_EXIT"
        )


class TestExitSummarySuccessOutput:
    """Tests for success output (scenario 3: exit-summary-success-output)."""

    def test_success_indicator(self, script_path):
        """Output contains '✓' and 'complete' when CLAUDE_EXIT=0 (behavioral)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bash_code = build_print_exit_summary_script(script_path, tmpdir, claude_exit=0)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            output = result.stdout + result.stderr
            assert "✓" in output, "Output must contain '✓' success indicator when CLAUDE_EXIT=0"
            assert "complete" in output.lower(), "Output must contain 'complete' when CLAUDE_EXIT=0"

    def test_shows_pr_url(self, script_path):
        """Output contains PR URL when PR_URL variable is set (behavioral)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            pr_url = "https://github.com/test/test/pull/42"
            bash_code = build_print_exit_summary_script(
                script_path, tmpdir, claude_exit=0, pr_url=pr_url
            )
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            output = result.stdout + result.stderr
            assert pr_url in output, f"Output must contain PR URL '{pr_url}' when PR_URL is set"

    def test_shows_report_path(self, script_path):
        """Output contains report file path when report exists (behavioral)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            report_file = os.path.join(tmpdir, ".pairingbuddy", "SOLO_BUDDY_REPORT.md")
            os.makedirs(os.path.dirname(report_file), exist_ok=True)
            with open(report_file, "w") as f:
                f.write("# Report\n")

            bash_code = build_print_exit_summary_script(
                script_path, tmpdir, claude_exit=0, report_file=report_file
            )
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            output = result.stdout + result.stderr
            assert report_file in output or "SOLO_BUDDY_REPORT" in output, (
                "Output must contain report path when report exists"
            )


class TestExitSummaryPRFailureOutput:
    """Tests for PR failure output (scenario 4: exit-summary-pr-failure-output)."""

    def test_pr_failure_warning(self, script_path):
        """Output contains '⚠' or 'warning' and 'PR' when PR_ERROR is set (behavioral)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bash_code = build_print_exit_summary_script(
                script_path, tmpdir, claude_exit=0, pr_error="gh pr create failed"
            )
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            output = result.stdout + result.stderr
            has_warning_indicator = "⚠" in output or "warning" in output.lower()
            has_pr_mention = "pr" in output.lower()
            assert has_warning_indicator and has_pr_mention, (
                "Output must contain warning indicator and 'PR' when PR_ERROR is set"
            )

    def test_still_shows_success(self, script_path):
        """Output still contains '✓' and 'complete' even when PR failed (behavioral)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bash_code = build_print_exit_summary_script(
                script_path, tmpdir, claude_exit=0, pr_error="gh pr create failed"
            )
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            output = result.stdout + result.stderr
            assert "✓" in output, "Output must contain '✓' success indicator even when PR failed"
            assert "complete" in output.lower(), (
                "Output must contain 'complete' even when PR failed"
            )


class TestExitSummaryInterruptedOutput:
    """Tests for interrupted/failure output (scenario 5: exit-summary-interrupted-output)."""

    def test_failure_indicator(self, script_path):
        """Output contains '✗' and 'interrupted' when CLAUDE_EXIT=1 (behavioral)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bash_code = build_print_exit_summary_script(script_path, tmpdir, claude_exit=1)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            output = result.stdout + result.stderr
            assert "✗" in output, "Output must contain '✗' failure indicator when CLAUDE_EXIT=1"
            assert "interrupt" in output.lower(), (
                "Output must contain 'interrupt' or similar when CLAUDE_EXIT=1"
            )

    def test_shows_exit_code(self, script_path):
        """Output contains the exit code number when CLAUDE_EXIT is non-zero (behavioral)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bash_code = build_print_exit_summary_script(script_path, tmpdir, claude_exit=42)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            output = result.stdout + result.stderr
            assert "42" in output, (
                "Output must contain the exit code number (42) when CLAUDE_EXIT=42"
            )

    def test_shows_report_on_failure(self, script_path):
        """Output contains report path even on failure (behavioral)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            report_file = os.path.join(tmpdir, ".pairingbuddy", "SOLO_BUDDY_REPORT.md")
            os.makedirs(os.path.dirname(report_file), exist_ok=True)
            with open(report_file, "w") as f:
                f.write("# Report\n")

            bash_code = build_print_exit_summary_script(
                script_path, tmpdir, claude_exit=1, report_file=report_file
            )
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            output = result.stdout + result.stderr
            assert report_file in output or "SOLO_BUDDY_REPORT" in output, (
                "Output must contain report path even on failure"
            )
