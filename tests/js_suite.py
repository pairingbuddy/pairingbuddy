"""Runs the explicitly listed JS test files with `node --test`."""

import os
import re
import signal
import subprocess
from pathlib import Path

JS_TEST_FILES = [
    "tests/js/alert-config.test.mjs",
    "tests/js/band-width.test.mjs",
    "tests/js/code-command.test.mjs",
    "tests/js/code-config.test.mjs",
    "tests/js/code-router.test.mjs",
    "tests/js/code-safety-net.test.mjs",
    "tests/js/code-scenarios.test.mjs",
    "tests/js/code-tdd.test.mjs",
    "tests/js/code-tdd-coverage.test.mjs",
    "tests/js/code-tdd-refactor.test.mjs",
    "tests/js/committing-changes-skill.test.mjs",
    "tests/js/config-hash-in-ledger.test.mjs",
    "tests/js/configured-branch-rules.test.mjs",
    "tests/js/curate-guidance-drops-suggestions.test.mjs",
    "tests/js/current-test.test.mjs",
    "tests/js/d17-guard.test.mjs",
    "tests/js/d17-rules.test.mjs",
    "tests/js/duration-safeguards.test.mjs",
    "tests/js/gate-eval.test.mjs",
    "tests/js/gate.test.mjs",
    "tests/js/gate-rules-safeguards.test.mjs",
    "tests/js/gates-safeguards.test.mjs",
    "tests/js/git-config-bootstrap.test.mjs",
    "tests/js/git-config-schema.test.mjs",
    "tests/js/glob-match.test.mjs",
    "tests/js/git-doctor-cli.test.mjs",
    "tests/js/git-doctor.test.mjs",
    "tests/js/config-globs.test.mjs",
    "tests/js/glance-sentences.test.mjs",
    "tests/js/glance-stop-names.test.mjs",
    "tests/js/glance-safeguards.test.mjs",
    "tests/js/harness.test.mjs",
    "tests/js/hooks-json.test.mjs",
    "tests/js/keys-labels.test.mjs",
    "tests/js/label-contract.test.mjs",
    "tests/js/human-abandon.test.mjs",
    "tests/js/ledger.test.mjs",
    "tests/js/ledger-safeguards.test.mjs",
    "tests/js/looping-and-counts.test.mjs",
    "tests/js/paths-mode-no-ask.test.mjs",
    "tests/js/pb-checkpoint.test.mjs",
    "tests/js/pb-cli-safeguards.test.mjs",
    "tests/js/pb-human.test.mjs",
    "tests/js/pb-red-green.test.mjs",
    "tests/js/pb-refactor.test.mjs",
    "tests/js/pb-run-open.test.mjs",
    "tests/js/pb-stage.test.mjs",
    "tests/js/pb-task-end.test.mjs",
    "tests/js/pb-test.test.mjs",
    "tests/js/plain-names.test.mjs",
    "tests/js/plan-boxes-safeguards.test.mjs",
    "tests/js/pr-body-tap.test.mjs",
    "tests/js/pr-draft-contracts.test.mjs",
    "tests/js/pr-draft.test.mjs",
    "tests/js/pr-lint.test.mjs",
    "tests/js/pr-lint-safeguards.test.mjs",
    "tests/js/pr-lint-cli.test.mjs",
    "tests/js/pr-lint-run-safeguards.test.mjs",
    "tests/js/publish.test.mjs",
    "tests/js/publish-steps.test.mjs",
    "tests/js/publish-gate-answers.test.mjs",
    "tests/js/publish-gate-eval.test.mjs",
    "tests/js/publish-run.test.mjs",
    "tests/js/publish-comment.test.mjs",
    "tests/js/progress-row.test.mjs",
    "tests/js/now-building-safeguards.test.mjs",
    "tests/js/report-content.test.mjs",
    "tests/js/report-safeguards.test.mjs",
    "tests/js/reports-kept.test.mjs",
    "tests/js/run-hooks.test.mjs",
    "tests/js/run-recorder.test.mjs",
    "tests/js/session-binding.test.mjs",
    "tests/js/shell-hooks-isolation.test.mjs",
    "tests/js/smoke-s2.test.mjs",
    "tests/js/stage-names.test.mjs",
    "tests/js/stages-safeguards.test.mjs",
    "tests/js/stage-graph-safeguards.test.mjs",
    "tests/js/stage-report-coverage.test.mjs",
    "tests/js/stage-run-safeguards.test.mjs",
    "tests/js/stop-code-cli.test.mjs",
    "tests/js/stop-code-ledger.test.mjs",
    "tests/js/stop-code-plain-names.test.mjs",
    "tests/js/suggestion-reaches-spawn.test.mjs",
    "tests/js/suggestion-schema.test.mjs",
    "tests/js/t4a-broken-copy-helper.test.mjs",
    "tests/js/t4a-lab-setup.test.mjs",
    "tests/js/t4a-lab-show.test.mjs",
    "tests/js/t4a-plugin-dir-option.test.mjs",
    "tests/js/t4a-runbook.test.mjs",
    "tests/js/tap.test.mjs",
    "tests/js/tdd-agent-contracts.test.mjs",
    "tests/js/unit-open.test.mjs",
    "tests/js/unit-files-safeguards.test.mjs",
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
