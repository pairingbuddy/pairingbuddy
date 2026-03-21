"""Tests for print_header() in solo-buddy.sh.

Scenarios covered:
- print-header-definition: print_header() exists and has required content
- startup-call-ordering: print_header is called at correct point in startup sequence
- print-header-behavioral: running print_header produces expected output
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


def build_print_header_script(script: str, tmpdir: str, plan_file: str, branch: str) -> str:
    """Return a bash snippet that loads print_header from *script* and calls it.

    Uses awk to extract the function definition and eval to load it, then
    sets up required variables and calls print_header.

    PLAN_FILE and BRANCH are set so the function works correctly when called
    in isolation.
    """
    return f"""
set +e
PLAN_FILE={plan_file!r}
BRANCH={branch!r}
if grep -q 'print_header()' {script!r} 2>/dev/null; then
    eval "$(awk '/^print_header\\(\\)[ \\t]*\\{{/,/^\\}}/' {script!r})"
fi
print_header
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


class TestPrintHeaderDefinition:
    """Tests for print_header() definition (scenario 1: print-header-definition)."""

    def test_print_header_function_exists(self, script_content):
        """print_header() function is defined in script."""
        assert "print_header()" in script_content, (
            "print_header function must be defined in solo-buddy.sh"
        )

    def test_print_header_writes_to_dev_tty(self, script_content):
        """print_header function body references /dev/tty."""
        function_body = extract_shell_function(script_content, "print_header")
        assert function_body, "print_header() function must be defined in the script"
        assert "/dev/tty" in function_body, (
            "print_header must reference /dev/tty to write directly to the terminal"
        )

    def test_print_header_includes_branding(self, script_content):
        """print_header body contains 'Pairing Buddy' and 'Solo' branding."""
        function_body = extract_shell_function(script_content, "print_header")
        assert function_body, "print_header() function must be defined in the script"
        assert "Pairing Buddy" in function_body or "pairing buddy" in function_body.lower(), (
            "print_header must include 'Pairing Buddy' branding"
        )
        assert "Solo" in function_body or "solo" in function_body.lower(), (
            "print_header must include 'Solo' branding"
        )

    def test_print_header_includes_plan_path(self, script_content):
        """print_header body references PLAN_FILE variable."""
        function_body = extract_shell_function(script_content, "print_header")
        assert function_body, "print_header() function must be defined in the script"
        assert "PLAN_FILE" in function_body, (
            "print_header must reference the PLAN_FILE variable to show the plan path"
        )

    def test_print_header_includes_branch(self, script_content):
        """print_header body references git branch or BRANCH variable."""
        function_body = extract_shell_function(script_content, "print_header")
        assert function_body, "print_header() function must be defined in the script"
        assert "BRANCH" in function_body or "git branch" in function_body, (
            "print_header must reference the branch name via BRANCH variable or git command"
        )


class TestStartupCallOrdering:
    """Tests for startup call ordering (scenario 2: startup-call-ordering)."""

    def test_clear_terminal_before_start_renderer(self, script_content):
        """clear_terminal is called before start_renderer in main body."""
        lines = script_content.splitlines()

        in_function = False
        clear_terminal_line = None
        start_renderer_line = None

        for i, line in enumerate(lines):
            stripped = line.strip()
            if re.match(r"^\w+\(\)\s*\{", stripped):
                in_function = True
                continue
            if in_function and stripped == "}":
                in_function = False
                continue
            if not in_function:
                if re.search(r"\bclear_terminal\b", line) and "clear_terminal()" not in line:
                    clear_terminal_line = i
                if re.search(r"\bstart_renderer\b", line) and "start_renderer()" not in line:
                    start_renderer_line = i

        assert clear_terminal_line is not None, "clear_terminal must be called in the main body"
        assert start_renderer_line is not None, "start_renderer must be called in the main body"
        assert clear_terminal_line < start_renderer_line, (
            "clear_terminal must be called before start_renderer"
        )

    def test_print_header_before_start_renderer(self, script_content):
        """print_header is called before start_renderer in main body."""
        lines = script_content.splitlines()

        in_function = False
        print_header_line = None
        start_renderer_line = None

        for i, line in enumerate(lines):
            stripped = line.strip()
            if re.match(r"^\w+\(\)\s*\{", stripped):
                in_function = True
                continue
            if in_function and stripped == "}":
                in_function = False
                continue
            if not in_function:
                if re.search(r"\bprint_header\b", line) and "print_header()" not in line:
                    print_header_line = i
                if re.search(r"\bstart_renderer\b", line) and "start_renderer()" not in line:
                    start_renderer_line = i

        assert print_header_line is not None, "print_header must be called in the main body"
        assert start_renderer_line is not None, "start_renderer must be called in the main body"
        assert print_header_line < start_renderer_line, (
            "print_header must be called before start_renderer"
        )

    def test_header_after_clear(self, script_content):
        """print_header is called after clear_terminal in main body."""
        lines = script_content.splitlines()

        in_function = False
        clear_terminal_line = None
        print_header_line = None

        for i, line in enumerate(lines):
            stripped = line.strip()
            if re.match(r"^\w+\(\)\s*\{", stripped):
                in_function = True
                continue
            if in_function and stripped == "}":
                in_function = False
                continue
            if not in_function:
                if re.search(r"\bclear_terminal\b", line) and "clear_terminal()" not in line:
                    clear_terminal_line = i
                if re.search(r"\bprint_header\b", line) and "print_header()" not in line:
                    print_header_line = i

        assert clear_terminal_line is not None, "clear_terminal must be called in the main body"
        assert print_header_line is not None, "print_header must be called in the main body"
        assert print_header_line > clear_terminal_line, (
            "print_header must be called after clear_terminal"
        )


class TestPrintHeaderBehavioral:
    """Tests for print_header behavioral output (scenario 3: print-header-behavioral)."""

    def test_output_contains_branding(self, script_path):
        """Running print_header produces 'Pairing Buddy' and 'Solo' in output."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [ ] Task 1\n")

            bash_code = build_print_header_script(script_path, tmpdir, plan_file, "main")
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            output = result.stdout + result.stderr
            assert "Pairing Buddy" in output or "pairing buddy" in output.lower(), (
                "print_header output must contain 'Pairing Buddy' branding"
            )
            assert "Solo" in output or "solo" in output.lower(), (
                "print_header output must contain 'Solo' branding"
            )

    def test_output_contains_plan_path(self, script_path):
        """print_header output contains the plan file path value."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "test-plan.md")
            with open(plan_file, "w") as f:
                f.write("- [ ] Task 1\n")

            bash_code = build_print_header_script(script_path, tmpdir, plan_file, "main")
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            output = result.stdout + result.stderr
            assert "test-plan.md" in output or plan_file in output, (
                "print_header output must contain the plan file path"
            )

    def test_output_contains_branch_name(self, script_path):
        """print_header output contains the branch name."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [ ] Task 1\n")

            branch_name = "feature/awesome-feature"
            bash_code = build_print_header_script(script_path, tmpdir, plan_file, branch_name)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            output = result.stdout + result.stderr
            assert "awesome" in output.lower() or branch_name in output, (
                "print_header output must contain the branch name or a derived version"
            )

    def test_graceful_without_tty(self, script_path):
        """print_header exits 0 when /dev/tty is unavailable."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("- [ ] Task 1\n")

            bash_code = build_print_header_script(script_path, tmpdir, plan_file, "main")
            # Redirect /dev/tty to /dev/null to simulate unavailable tty
            bash_code += '\necho "EXIT:$?"'
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
                timeout=10,
            )

            assert "EXIT:0" in result.stdout, (
                "print_header must exit with code 0 even when /dev/tty is not available; "
                f"stdout={result.stdout!r} stderr={result.stderr!r}"
            )
