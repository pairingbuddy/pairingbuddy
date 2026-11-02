"""Runs the JS harness suite through pytest and proves the wrapper fails correctly.

Covers the literal JS_TEST_FILES wrapper that runs `node --test` on explicit files.
"""

import contextlib
import os
import time
from pathlib import Path

import pytest

from tests.js_suite import JS_TEST_FILES, run_node_tests

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = "tests/fixtures/js_harness"


def _output(result):
    return f"{result.stdout}\n{result.stderr}"


def _is_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def _wait_until_gone(pid, seconds=3.0):
    deadline = time.monotonic() + seconds
    while _is_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    return not _is_alive(pid)


def test_listed_js_files_pass():
    missing = [f for f in JS_TEST_FILES if not (REPO_ROOT / f).is_file()]

    result = run_node_tests(JS_TEST_FILES, cwd=REPO_ROOT)

    assert JS_TEST_FILES, "JS_TEST_FILES must not be empty"
    assert "tests/js/harness.test.mjs" in JS_TEST_FILES, "harness test must be listed"
    assert missing == [], f"listed JS test files do not exist: {missing}"
    assert result.returncode == 0, f"node --test failed:\n{_output(result)}"


def test_passing_fixture_passes():
    result = run_node_tests([f"{FIXTURES}/passes.test.mjs"], cwd=REPO_ROOT)

    assert result.returncode == 0, f"a plain passing file must succeed:\n{_output(result)}"


def test_missing_listed_file_fails():
    real_file = "tests/js/harness.test.mjs"
    missing_file = "tests/js/does_not_exist.test.mjs"

    result = run_node_tests([real_file, missing_file], cwd=REPO_ROOT)

    output = _output(result)
    assert result.returncode != 0, f"a missing listed file must not report success:\n{output}"
    assert missing_file in output, f"output must name the missing file:\n{output}"


def test_failing_node_test_fails():
    failing_file = f"{FIXTURES}/always_fails.test.mjs"
    failing_test_name = "fixture always fails deliberately"

    result = run_node_tests([failing_file], cwd=REPO_ROOT)

    output = _output(result)
    assert failing_file not in JS_TEST_FILES, "fixture must stay outside the literal list"
    assert result.returncode != 0, f"a failing node test must not report success:\n{output}"
    assert failing_test_name in output, f"output must name the failing test:\n{output}"


def test_empty_file_list_fails_without_discovering_tests():
    result = run_node_tests([], cwd=REPO_ROOT)

    output = _output(result)
    assert result.returncode != 0, f"an empty list must not report success:\n{output}"
    assert "always fails deliberately" not in output, (
        f"an empty list must not fall back to node's discovery:\n{output}"
    )


@pytest.mark.parametrize(
    "fixture_name",
    [
        "zero_tests.test.mjs",
        "all_skipped.test.mjs",
        "partly_skipped.test.mjs",
        "partly_todo.test.mjs",
    ],
)
def test_listed_file_that_proves_nothing_fails(fixture_name):
    listed_file = f"{FIXTURES}/{fixture_name}"

    result = run_node_tests([listed_file], cwd=REPO_ROOT)

    output = _output(result)
    assert listed_file not in JS_TEST_FILES, "fixture must stay outside the literal list"
    assert result.returncode != 0, (
        f"{fixture_name} ran no real passing test and must not succeed:\n{output}"
    )


def test_hanging_file_times_out_with_output_and_leaves_no_process(tmp_path, monkeypatch):
    pid_file = tmp_path / "pids.txt"
    monkeypatch.setenv("HANG_PID_FILE", str(pid_file))
    hanging_file = f"{FIXTURES}/hangs.test.mjs"
    pids = []

    try:
        result = run_node_tests([hanging_file], cwd=REPO_ROOT, timeout=3)
        pids = [int(p) for p in pid_file.read_text().split()]
    finally:
        for pid in pid_file.read_text().split() if pid_file.exists() else []:
            with contextlib.suppress(ProcessLookupError):
                os.kill(int(pid), 9)

    output = _output(result)
    assert hanging_file not in JS_TEST_FILES, "fixture must stay outside the literal list"
    assert result.returncode != 0, f"a timed-out run must not report success:\n{output}"
    assert "timed out" in output.lower(), f"output must say the run timed out:\n{output}"
    assert "hang fixture started" in output, (
        f"output captured before the kill must be returned:\n{output}"
    )
    assert len(pids) == 2, f"fixture must record its own and its child's pid, got {pids}"
    assert [_wait_until_gone(pid) for pid in pids] == [True, True], (
        f"processes {pids} survived the timeout"
    )
