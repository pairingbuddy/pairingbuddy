"""Runs the explicitly listed JS test files with `node --test`."""

import os
import re
import signal
import subprocess
from pathlib import Path

JS_TEST_FILES = [
    "tests/js/code-command.test.mjs",
    "tests/js/code-config.test.mjs",
    "tests/js/code-router.test.mjs",
    "tests/js/code-safety-net.test.mjs",
    "tests/js/gate-eval.test.mjs",
    "tests/js/gate.test.mjs",
    "tests/js/harness.test.mjs",
    "tests/js/keys-labels.test.mjs",
    "tests/js/label-contract.test.mjs",
    "tests/js/ledger.test.mjs",
    "tests/js/pb-checkpoint.test.mjs",
    "tests/js/pb-human.test.mjs",
    "tests/js/pb-run-open.test.mjs",
    "tests/js/pb-stage.test.mjs",
    "tests/js/pb-task-end.test.mjs",
    "tests/js/pb-test.test.mjs",
    "tests/js/run-hooks.test.mjs",
    "tests/js/session-binding.test.mjs",
    "tests/js/tap.test.mjs",
    "tests/js/verbs.test.mjs",
]


def _failed(command, stderr, stdout=""):
    return subprocess.CompletedProcess(args=command, returncode=1, stdout=stdout, stderr=stderr)


def _problem_with_run(files, stdout):
    summary = re.findall(r"^# (pass|skipped|todo) (\d+)$", stdout, re.M)
    counts = {name: int(n) for name, n in summary}
    if counts.get("pass", 0) == 0:
        return "no test passed"
    if counts.get("skipped", 0) or counts.get("todo", 0):
        return "tests were skipped or marked todo"
    # node reports a file that defines no tests as one passing test named after the file
    empty = [f for f in files if re.search(rf"^(not )?ok \d+ - {re.escape(f)}$", stdout, re.M)]
    if empty:
        return "these files ran no tests: " + ", ".join(empty)
    return None


def run_node_tests(files, cwd, timeout=120):
    command = ["node", "--test", "--test-reporter=tap", *files]
    if not files:
        return _failed(command, "No JS test files listed")
    missing = [f for f in files if not (Path(cwd) / f).exists()]
    if missing:
        return _failed(command, "Missing JS test files: " + ", ".join(missing))

    proc = subprocess.Popen(
        command,
        cwd=cwd,
        env={k: v for k, v in os.environ.items() if k != "PAIRINGBUDDY_SOLO"},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        stdout, stderr = proc.communicate()
        return _failed(command, f"{stderr}\nnode --test timed out after {timeout}s", stdout)

    if proc.returncode == 0 and (problem := _problem_with_run(files, stdout)):
        return _failed(command, f"{stderr}\nnode --test proved nothing: {problem}", stdout)
    return subprocess.CompletedProcess(command, proc.returncode, stdout, stderr)
