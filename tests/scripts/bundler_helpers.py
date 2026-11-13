"""Shared helpers for the workflow bundler tests."""

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build-workflows.mjs"
FIXTURE_ROOT = REPO_ROOT / "tests" / "fixtures" / "workflow_bundler"
NODE_TIMEOUT_SECONDS = 10


def run_node(arguments):
    """Run node with the given arguments and return the completed process."""
    return subprocess.run(
        ["node", *map(str, arguments)],
        capture_output=True,
        text=True,
        timeout=NODE_TIMEOUT_SECONDS,
    )


def run_build(src, out, root, check=False):
    """Run the bundler via node (with --check when asked) and return the completed process."""
    arguments = [BUILD_SCRIPT]
    if check:
        arguments.append("--check")
    arguments += ["--src", src, "--out", out, "--root", root]
    return run_node(arguments)


def build_ok(fixture_tree, out):
    """Build the fixture tree into out, assert the build succeeded, and return the result."""
    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)
    assert result.returncode == 0, result.stderr
    return result


def assert_clean_failure(result, named):
    """Assert a failed build that names `named` in a clean message with no stack trace."""
    assert result.returncode != 0, result.stdout + result.stderr
    assert named in result.stderr, f"the message must name {named}: {result.stderr}"
    assert "\n    at " not in result.stderr, "the failure must be a clean message, no stack trace"


def assert_nothing_written(out):
    """Assert the output directory is absent or empty."""
    assert not out.exists() or list(out.iterdir()) == [], "no output may be written on failure"


# Claude Code's workflow approval dialog refuses a script with a line it must cut (~4064)
MAX_BUNDLE_LINE = 2000
