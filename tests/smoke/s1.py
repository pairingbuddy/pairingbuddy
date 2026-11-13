"""Smoke S1: config_change through both built stages on a sample repo, on a cheap model.

Asserts control flow only: stage order config then safety-net, one commit, the gate source, and
`pb stage finish` refused when evidence is removed. Never output quality. The evidence check needs
no model: it drives the real gate hook, tap and CLI on a fresh sample repo, so it costs nothing.

Run it by hand, in a separate shell, from the repo root. It is outside pytest and `pb test --full`,
because it spends money:

    uv run python -m tests.smoke.s1 [--task flag] [--evidence-only] [--record-dir DIR]
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from tests.smoke.runner import REPO_ROOT, Budget, SmokeError, clean_env, run_claude

CLI = REPO_ROOT / "cli" / "pb.mjs"
GATE_HOOK = REPO_ROOT / "hooks" / "gate.mjs"
TAP_HOOK = REPO_ROOT / "hooks" / "tap.mjs"
SAMPLE_REPO = Path(__file__).parent / "sample_repo"
STAGES = ["code-config", "code-safety-net"]
GATE = "G:task-end"
CONFIG_KEY = "code-config.apply-config-change.-.r1.a1"

# One minimal config change per sample task. DEFAULT_TASK is the spike's winner, see the spike doc.
TASKS = {
    "flag": "Set feature.enabled to true in settings.json",
    "value": "Change port from 8080 to 9090 in app.ini",
    "add-key": 'Add a top-level key "retries" with the value 3 to settings.json',
}
DEFAULT_TASK = "value"

TEST_CONFIG = {
    "source_directory": ".",
    "runners": {
        "node": {
            "name": "node",
            "command": "node check.mjs",
            "test_directory": ".",
            "file_pattern": "check.mjs",
            "run_args": [],
        }
    },
    "default_runner": "node",
}
NO_DOCS = {"in_repo_docs": [], "external_docs": [], "last_verified": "2026-01-01T00:00:00Z"}


@dataclass
class S1Result:
    task: str
    passed: bool = False
    cause: str = ""
    cost_usd: float = 0.0
    cost_known: bool = True
    seconds: float = 0.0
    stage_seconds: dict[str, float] = field(default_factory=dict)


def git(repo: Path, *args: str) -> str:
    command = ["git", "-C", str(repo), *args]
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def make_repo(parent: Path) -> Path:
    """A fresh copy of the sample repo. Signing is off, so a signer cannot flake the run."""
    repo = parent / "repo"
    shutil.copytree(SAMPLE_REPO, repo)
    git(repo, "init", "-q", "-b", "feature")
    git(repo, "config", "user.email", "smoke@example.invalid")
    git(repo, "config", "user.name", "smoke")
    git(repo, "config", "commit.gpgsign", "false")
    state = repo / ".pairingbuddy"
    state.mkdir()
    (state / "test-config.json").write_text(json.dumps(TEST_CONFIG))
    (state / "doc-config.json").write_text(json.dumps(NO_DOCS))
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "init")
    return repo


def pb_raw(repo: Path, *args: str) -> subprocess.CompletedProcess:
    command = ["node", str(CLI), *args]
    return subprocess.run(command, cwd=repo, env=clean_env(), capture_output=True, text=True)


def pb(repo: Path, *args: str) -> dict:
    run = pb_raw(repo, *args)
    if run.returncode != 0:
        raise SmokeError(f"pb {' '.join(args)} refused: {run.stderr.strip()}")
    return json.loads(run.stdout)


def task_dir(repo: Path) -> Path:
    return repo / ".pairingbuddy" / "run" / "task"


def read_ledger(repo: Path) -> dict:
    return json.loads((task_dir(repo) / "ledger.json").read_text())


def commit_subjects(repo: Path) -> list[str]:
    return git(repo, "log", "--format=%s").splitlines()


def stage_prompt(stage: str, description: str) -> str:
    args = {"attempt": 1, "pluginRoot": str(REPO_ROOT), "task": {"description": description}}
    return f"/pairingbuddy:{stage} {json.dumps(args)}"


def require_stage_done(repo: Path, stage: str) -> None:
    ledger = read_ledger(repo)
    if ledger["stop"] is not None:
        raise SmokeError(f"{stage}: the run stopped: {ledger['stop']['reason']}")
    if not any(s["name"] == stage and s["status"] == "done" for s in ledger["stages"]):
        current = ledger["stage"]
        raise SmokeError(
            f"{stage}: not done, stage {current['name']!r} is {current['status']!r} "
            f"with runId {current['runId']!r}"
        )


def assert_control_flow(ledger: dict, commits: list[str]) -> None:
    """`commits` is the log, newest first, with the sample repo's own commit last."""
    finished = [stage["name"] for stage in ledger["stages"] if stage["status"] == "done"]
    if finished != STAGES:
        raise SmokeError(f"stage order is {finished}, expected {STAGES}")
    if len(commits) != 2:
        raise SmokeError(f"expected one commit, the log has {commits}")
    source = ledger["gates"].get(GATE, {}).get("source")
    if source != "auto":
        raise SmokeError(f"gate source of {GATE} is {source!r}, expected 'auto'")
    if ledger["policy"] != {"mode": "auto", "source": "permission_mode"}:
        raise SmokeError(f"the gate policy is {ledger['policy']}, so the env was not clean")


def hook(script: Path, repo: Path, tool: str, tool_input: dict, **extra) -> None:
    payload = {
        "session_id": "smoke-evidence",
        "cwd": str(repo),
        "permission_mode": "auto",
        "tool_name": tool,
        "tool_input": tool_input,
    }
    subprocess.run(
        ["node", str(script)],
        cwd=repo,
        env=clean_env(),
        input=json.dumps(payload | extra),
        check=True,
        capture_output=True,
        text=True,
    )


def prepare_finishable_stage(parent: Path) -> Path:
    """code-config with all its evidence, reached by the real hooks and CLI and no model."""
    parent.mkdir(parents=True)
    repo = make_repo(parent)
    pb(repo, "run", "open", "--kind", "code")
    start = {
        "name": "pairingbuddy:code-config",
        "args": {"attempt": 1, "pluginRoot": str(REPO_ROOT), "task": {"description": "evidence"}},
    }
    hook(GATE_HOOK, repo, "Workflow", start)
    hook(TAP_HOOK, repo, "Workflow", start, tool_response={"runId": "wf_smoke"})
    (repo / "settings.json").write_text('{"feature": {"enabled": true}}\n')
    artifact = {
        "pb_key": CONFIG_KEY,
        "ambiguity": "",
        "commit_subject": "enable the feature",
        "files_changed": ["settings.json"],
    }
    agent = {"agent_id": "smoke", "agent_type": "pairingbuddy:apply-config-change"}
    hook(TAP_HOOK, repo, "StructuredOutput", artifact, **agent)
    pb(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY)
    return repo


def check_finish_refused_without_evidence(parent: Path) -> None:
    control = prepare_finishable_stage(parent / "control")
    pb(control, "stage", "finish")

    repo = prepare_finishable_stage(parent / "removed")
    (task_dir(repo) / "artifacts" / f"{CONFIG_KEY}.json").unlink()
    refused = pb_raw(repo, "stage", "finish")
    ledger = read_ledger(repo)
    if refused.returncode != 1 or "cannot finish" not in refused.stderr:
        raise SmokeError(f"stage finish was not refused: {refused.returncode} {refused.stderr}")
    if ledger["stage"]["status"] != "active" or ledger["stop"] is None:
        raise SmokeError(f"the refusal left the stage closed or unstopped: {ledger['stage']}")


def run_stages(
    repo: Path, description: str, budget: Budget, record: Path, result: S1Result
) -> None:
    for stage in STAGES:
        run = run_claude(repo, stage_prompt(stage, description), budget, record / f"{stage}.stream")
        result.stage_seconds[stage] = round(run.seconds, 1)
        require_stage_done(repo, stage)


def control_flow_run(task: str, budget: Budget, record: Path, result: S1Result) -> None:
    repo = make_repo(record)
    pb(repo, "run", "open", "--kind", "code")
    run_stages(repo, TASKS[task], budget, record, result)
    gate = pb(repo, "gate", "eval")
    if gate["result"] != "auto-pass":
        raise SmokeError(f"the gate did not auto-pass: {gate}")
    ledger = read_ledger(repo)
    pb(repo, "task", "end")
    if task_dir(repo).exists():
        raise SmokeError("pb task end left run/task")
    assert_control_flow(ledger, commit_subjects(repo))


def run_s1(task: str, record: Path, budget: Budget | None = None) -> S1Result:
    """One smoke run. A failure lands in the result, with its cause, and never raises."""
    budget = budget or Budget()
    result = S1Result(task)
    record.mkdir(parents=True, exist_ok=True)
    try:
        control_flow_run(task, budget, record, result)
        check_finish_refused_without_evidence(record / "evidence")
        result.passed = True
    except SmokeError as e:
        result.cause = f"{type(e).__name__}: {e}"
    result.cost_usd = round(budget.spent, 6)
    result.cost_known = budget.cost_known
    result.seconds = round(sum(result.stage_seconds.values()), 1)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", choices=sorted(TASKS), default=DEFAULT_TASK)
    parser.add_argument("--evidence-only", action="store_true", help="the free check alone")
    parser.add_argument("--record-dir", type=Path)
    options = parser.parse_args()
    record = options.record_dir or Path(tempfile.mkdtemp(prefix="pb-smoke-"))
    if options.evidence_only:
        check_finish_refused_without_evidence(record / "evidence")
        print(f"PASS evidence check, recorded in {record}")
        return 0
    result = run_s1(options.task, record)
    print(json.dumps(result.__dict__))
    print(f"{'PASS' if result.passed else 'FAIL'} S1, recorded in {record}")
    return 0 if result.passed else 1


if __name__ == "__main__":
    sys.exit(main())
