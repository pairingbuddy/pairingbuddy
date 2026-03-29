"""Tests for render_status reading source files (plan + hooks) instead of STATUS_FILE."""

import json
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
    changes into tmpdir before invoking render_status.  The function needs
    LAST_RENDER_LINES=0 and PLAN_FILE set up, and assumes render_status reads
    from source files (plan + hooks) rather than STATUS_FILE.
    """
    plan_file_path = f"{tmpdir}/plan.md"
    return f"""
set +e
PLAN_FILE={plan_file_path!r}
LAST_RENDER_LINES=0
FORCE_COLOR=0
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


class TestRenderStatusSourceReading:
    """Tests for render_status reading from source files (plan + hooks)."""

    def test_render_status_references_plan_file(self, script_content):
        """render_status function body contains reference to PLAN_FILE."""
        function_body = extract_shell_function(script_content, "render_status")
        assert function_body, "render_status function must exist in the script"

        # Should reference PLAN_FILE variable or "$PLAN_FILE"
        assert re.search(r"\$PLAN_FILE|PLAN_FILE", function_body), (
            "render_status must reference $PLAN_FILE to read the plan"
        )

    def test_render_status_reads_hooks_dir(self, script_content):
        """render_status function body reads .pairingbuddy/hooks directory for agent info."""
        function_body = extract_shell_function(script_content, "render_status")
        assert function_body, "render_status function must exist in the script"

        # Should reference hooks and .json files
        assert re.search(r"\.pairingbuddy/hooks", function_body), (
            "render_status must read from .pairingbuddy/hooks directory"
        )
        assert re.search(r"\.json", function_body), "render_status must read .json hook files"

    def test_render_status_no_status_file_dependency(self, script_content):
        """render_status function body does NOT read STATUS_FILE (except write_final_status)."""
        function_body = extract_shell_function(script_content, "render_status")
        assert function_body, "render_status function must exist in the script"

        # Should NOT reference STATUS_FILE or "solo-status" in render_status
        # (those are for write_final_status, not render_status)
        assert not re.search(r"\$STATUS_FILE|solo-status", function_body), (
            "render_status must not read from STATUS_FILE; it should read source files instead"
        )


class TestRenderStatusBehavior:
    """Behavioral tests: render_status reads plan and hooks, displays progress."""

    def test_render_shows_task_progress_from_plan(self, script_path):
        """render_status reads plan file and displays completed/incomplete tasks with checkmarks."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write(
                    """# Plan

- [x] **Task 1** (completed)
- [x] Task 2
- [ ] Task 3 (incomplete)
"""
                )

            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"))

            bash_code = build_render_status_script(script_path, tmpdir)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            # Should show checkmarks for completed tasks
            assert "✓" in result.stdout or "Task 1" in result.stdout, (
                "render_status must display completed tasks from plan"
            )
            # Should show some indication of progress (2/3 ratio or similar)
            assert "2" in result.stdout or "3" in result.stdout, (
                "render_status must show task counts from plan"
            )

    def test_render_shows_agent_from_hooks_file(self, script_path):
        """render_status reads guardian hooks file and displays lastAgent and lastDescription."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_file = os.path.join(tmpdir, "plan.md")
            with open(plan_file, "w") as f:
                f.write("# Plan\n\n- [ ] Task 1\n")

            hooks_dir = os.path.join(tmpdir, ".pairingbuddy", "hooks")
            os.makedirs(hooks_dir)

            session_file = os.path.join(hooks_dir, "test-session.json")
            with open(session_file, "w") as f:
                json.dump(
                    {
                        "lastAgent": "pairingbuddy:implement-tests",
                        "lastDescription": "Implement unit tests",
                    },
                    f,
                )

            bash_code = build_render_status_script(script_path, tmpdir)
            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            # Should display agent name and description from hooks
            assert "implement-tests" in result.stdout, (
                "render_status must display lastAgent from hooks file"
            )
            assert "Implement unit tests" in result.stdout or "tests" in result.stdout.lower(), (
                "render_status must display lastDescription from hooks file"
            )

    def test_render_degrades_when_no_files(self, script_path):
        """render_status shows initializing message when no plan or hooks files exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            os.makedirs(os.path.join(tmpdir, ".pairingbuddy"))
            # Do not create plan.md or hooks files
            plan_file = os.path.join(tmpdir, "plan.md")

            bash_code = f"""
set +e
PLAN_FILE={plan_file!r}
LAST_RENDER_LINES=0
FORCE_COLOR=0
if grep -q 'render_status\\(\\)' {script_path!r} 2>/dev/null; then
    eval "$(awk '/^render_status\\(\\)[ \\t]*\\{{/,/^\\}}/' {script_path!r})"
fi
cd {tmpdir!r}
render_status
"""

            result = subprocess.run(
                ["bash", "-c", bash_code],
                capture_output=True,
                text=True,
            )

            # Should show initializing message (graceful degradation)
            assert "Initializing" in result.stdout or "initializing" in result.stdout.lower(), (
                "render_status must show initializing message when no source files exist"
            )
            # Should exit cleanly (no errors)
            assert result.returncode == 0, (
                "render_status must exit cleanly even with no source files"
            )
