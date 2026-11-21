"""Smoke S1: `/pairingbuddy:code <task>` end to end on a sample repo, on a cheap model.

One `claude -p` session on main, with a local bare origin whose HEAD is main and the gh shim first
on PATH, so `pb unit open` finds its base and nothing reaches GitHub. The plugin loads from outside
its cwd and the Stop hook drives the chain from stage to stage. Asserts control flow only, never
output quality: stage order intake, config, safety-net, one commit on the unit branch, the gate
source, and the code run ended. The ledger leaves with the run, and the publish run after it opens
run/task again, so a watcher keeps the code run's last copy. The publish run is not checked.

Two checks need no model and cost nothing, because a model cannot be made to misbehave on cue. They
drive the real gate hook, tap and CLI on a fresh sample repo: out-of-order calls are denied, and
`pb stage finish` is refused when evidence is removed.

Run it by hand, in a separate shell, from the repo root. It is outside pytest and `pb test --full`,
because it spends money:

    uv run python -m tests.smoke.s1 [--task flag] [--free-only] [--record-dir DIR] [--budget-usd N]
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from tests.smoke.runner import (
    BUDGET_USD,
    REPO_ROOT,
    Budget,
    SmokeError,
    clean_env,
    parse_stream,
    run_claude,
)

CLI = REPO_ROOT / "cli" / "pb.mjs"
GATE_HOOK = REPO_ROOT / "hooks" / "gate-boot.mjs"
GH_SHIM = REPO_ROOT / "tests" / "js" / "gh-shim.mjs"
TAP_HOOK = REPO_ROOT / "hooks" / "tap.mjs"
SAMPLE_REPO = Path(__file__).parent / "sample_repo"
STAGES = ["intake", "code-config", "code-safety-net"]
GATE = "G:task-end"
CONFIG_KEY = "code-config.apply-config-change.-.r1.a1"
CLASSIFY_KEY = "intake.classify-task.-.r1.a1"
BRANCH = "port-change"
WATCH_INTERVAL_S = 0.02
DENIED = "PreToolUse:"
TRANSCRIPT_DIR = re.compile(r"Transcript dir: (/[^\n\"'\\]+)")
RELAY_MARKS = ("/pairingbuddy:code", "[Workflow harness — user request]")
AGENT_RECORDS = ("api-request-blob", "user")
OFF_TASK_TOOLS = {"Skill", "Agent", "Workflow"}

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
# The sample's config files, so `pb task end` checks a config_change against them and asks no human.
GIT_CONFIG = {"config_globs": ["app.ini", "settings.json"]}


@dataclass
class S1Result:
    task: str
    passed: bool = False
    cause: str = ""
    cost_usd: float = 0.0
    cost_known: bool = True
    seconds: float = 0.0
    stage_seconds: dict[str, float] = field(default_factory=dict)
    workflows: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    agents: list[str] = field(default_factory=list)
    workflow_agents: int = 0
    relayed_to: list[str] = field(default_factory=list)
    off_task: list[str] = field(default_factory=list)
    denials: list[str] = field(default_factory=list)
    tool_errors: int = 0
    stop_blocks: int = 0


def git(repo: Path, *args: str) -> str:
    command = ["git", "-C", str(repo), *args]
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def make_repo(parent: Path, on_main: bool = False) -> tuple[Path, Path]:
    """A fresh copy of the sample repo and its local bare origin, which has main as its HEAD.

    The repo is on a branch a human made from main, or left on main with on_main. Signing is off,
    so a signer cannot flake the run. `.pairingbuddy/` is ignored, as the coding skill requires,
    because its state files would otherwise leave the tree dirty at `pb task end`.
    """
    repo = parent / "repo"
    shutil.copytree(SAMPLE_REPO, repo)
    (repo / ".gitignore").write_text(".pairingbuddy/\n")
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "smoke@example.invalid")
    git(repo, "config", "user.name", "smoke")
    git(repo, "config", "commit.gpgsign", "false")
    state = repo / ".pairingbuddy"
    state.mkdir()
    (state / "test-config.json").write_text(json.dumps(TEST_CONFIG))
    (state / "doc-config.json").write_text(json.dumps(NO_DOCS))
    (state / "git-config.json").write_text(json.dumps(GIT_CONFIG))
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "init")
    remote = parent / "origin.git"
    git(parent, "init", "-q", "--bare", "-b", "main", str(remote))
    git(repo, "remote", "add", "origin", str(remote))
    git(repo, "push", "-q", "origin", "main")
    git(repo, "remote", "set-head", "origin", "main")
    if not on_main:
        git(repo, "switch", "-q", "-c", BRANCH)
    return repo, remote


def gh_shim_env(parent: Path) -> dict[str, str]:
    """The env that puts the recording gh shim of tests/js/gh-shim.mjs first on PATH."""
    script = (
        f"const {{ installGhShim }} = await import({json.dumps(GH_SHIM.as_uri())});"
        "process.stdout.write(JSON.stringify(installGhShim({ parent: process.argv[1] }).env()));"
    )
    command = ["node", "--input-type=module", "-e", script, str(parent)]
    done = subprocess.run(command, env=clean_env(), check=True, capture_output=True, text=True)
    return json.loads(done.stdout)


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


class LedgerWatch:
    """Keeps the last readable ledger, and the code run's last one, which `pb task end` deletes."""

    def __init__(self, repo: Path):
        self.path = task_dir(repo) / "ledger.json"
        self.last: dict | None = None
        self.last_code: dict | None = None
        self.stage_started: dict[str, float] = {}
        self.stage_ended: dict[str, float] = {}
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._watch, daemon=True)

    def __enter__(self) -> "LedgerWatch":
        self._thread.start()
        return self

    def __exit__(self, *_) -> None:
        self._done.set()
        self._thread.join()

    def _watch(self) -> None:
        while not self._done.wait(WATCH_INTERVAL_S):
            try:
                ledger = json.loads(self.path.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            self.last = ledger
            if ledger.get("kind") == "code":
                self.last_code = ledger
                self._note_stage(ledger["stage"])

    def _note_stage(self, stage: dict) -> None:
        if stage["name"]:
            self.stage_started.setdefault(stage["name"], time.monotonic())
        if stage["status"] == "done":
            self.stage_ended.setdefault(stage["name"], time.monotonic())

    def stage_seconds(self) -> dict[str, float]:
        return {
            name: round(self.stage_ended[name] - started, 1)
            for name, started in self.stage_started.items()
            if name in self.stage_ended
        }


def code_run_open(repo: Path) -> bool:
    return task_dir(repo).exists() and read_ledger(repo).get("kind") == "code"


def run_position(repo: Path, last: dict | None) -> str:
    """Where a run that ended early was left, which names a stranded stage or a skipped start."""
    if last is None:
        return "no code run was opened, so nothing went through the gate"
    if not task_dir(repo).exists():
        return "the run ended"
    ledger = read_ledger(repo)
    stage = ledger["stage"]
    return (
        f"{ledger.get('kind')} run left open: stage {stage['name']!r} is {stage['status']!r} "
        f"with runId {stage['runId']!r}, finished {[s['name'] for s in ledger['stages']]}, "
        f"stop {ledger['stop']}, needsHuman {ledger['needsHuman']}"
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


def hook(script: Path, repo: Path, tool: str, tool_input: dict, **extra) -> str:
    payload = {
        "session_id": "smoke-evidence",
        "cwd": str(repo),
        "permission_mode": "auto",
        "tool_name": tool,
        "tool_input": tool_input,
    }
    done = subprocess.run(
        ["node", str(script)],
        cwd=repo,
        env=clean_env(),
        input=json.dumps(payload | extra),
        check=True,
        capture_output=True,
        text=True,
    )
    return done.stdout


def stage_start(stage: str, **drop: str) -> dict:
    args = {"attempt": 1, "pluginRoot": str(REPO_ROOT), "task": {"description": "a task"}}
    kept = {name: value for name, value in args.items() if name not in drop}
    return {"name": f"pairingbuddy:{stage}", "args": kept}


def start_stage(repo: Path, stage: str, run_id: str) -> None:
    start = stage_start(stage)
    hook(GATE_HOOK, repo, "Workflow", start)
    hook(TAP_HOOK, repo, "Workflow", start, tool_response={"runId": run_id})


def pass_intake(repo: Path) -> None:
    """Intake done on a certain config_change, and G:type approved by the human from this shell.

    With no lens return, G:type asks; the human's approve is what S2 does for a judgment reason.
    """
    start_stage(repo, "intake", "wf_intake")
    artifact = {
        "pb_key": CLASSIFY_KEY,
        "ambiguity": "",
        "task_type": "config_change",
        "confidence": "certain",
        "rationale": "it sets one value in settings.json",
    }
    agent = {"agent_id": "smoke-intake", "agent_type": "pairingbuddy:classify-task"}
    hook(TAP_HOOK, repo, "StructuredOutput", artifact, **agent)
    pb(repo, "stage", "finish")
    pb(repo, "gate", "eval")
    pb(repo, "human", "approve", "G:type")


def prepare_finishable_stage(parent: Path) -> Path:
    """code-config with all its evidence, reached by the real hooks and CLI and no model."""
    parent.mkdir(parents=True)
    repo, _ = make_repo(parent)
    pb(repo, "run", "open", "--kind", "code")
    pass_intake(repo)
    start_stage(repo, "code-config", "wf_smoke")
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


def assert_denied_untouched(repo: Path, tool: str, tool_input: dict, what: str) -> None:
    before = (task_dir(repo) / "ledger.json").read_text()
    answer = hook(GATE_HOOK, repo, tool, tool_input)
    decision = json.loads(answer or "{}").get("hookSpecificOutput", {}).get("permissionDecision")
    if decision != "deny":
        raise SmokeError(f"{what} was not denied: {answer!r}")
    if (task_dir(repo) / "ledger.json").read_text() != before:
        raise SmokeError(f"the denied {what} changed the ledger")


def check_out_of_order_denied(parent: Path) -> None:
    parent.mkdir(parents=True)
    repo, _ = make_repo(parent)
    pb(repo, "run", "open", "--kind", "code")
    assert_denied_untouched(repo, "Workflow", stage_start(STAGES[1]), "a stage ahead of its turn")
    agent = {"subagent_type": "pairingbuddy:apply-config-change", "prompt": "do it"}
    assert_denied_untouched(repo, "Agent", agent, "a direct pipeline agent")
    for missing in ("task", "pluginRoot"):
        start = stage_start(STAGES[0], **{missing: ""})
        assert_denied_untouched(repo, "Workflow", start, f"a stage start with no {missing}")
    answer = json.loads(hook(GATE_HOOK, repo, "Workflow", stage_start(STAGES[0])) or "{}")
    if answer.get("hookSpecificOutput", {}).get("permissionDecision") == "deny":
        raise SmokeError(f"the stage in its turn was denied, so the above proves nothing: {answer}")


def tool_uses(events: list[dict]) -> list[dict]:
    return [
        block
        for event in events
        if event.get("type") == "assistant"
        for block in event["message"]["content"]
        if block.get("type") == "tool_use"
    ]


def tool_errors(events: list[dict]) -> list[str]:
    results = [
        block
        for event in events
        if event.get("type") == "user" and isinstance(event["message"]["content"], list)
        for block in event["message"]["content"]
        if block.get("type") == "tool_result" and block.get("is_error")
    ]
    return [str(block.get("content"))[:300] for block in results]


def inputs_of(uses: list[dict], tool: str, key: str) -> list[str]:
    return [use["input"].get(key, "?") for use in uses if use["name"] == tool]


def read_agent(result: S1Result, transcript: Path) -> None:
    """Whether the triggering `/code` text reached this workflow agent, and what it did with it."""
    result.workflow_agents += 1
    lines = [json.loads(line) for line in transcript.read_text().splitlines()]
    records = [json.dumps(line) for line in lines if line.get("type") in AGENT_RECORDS]
    if any(mark in record for record in records for mark in RELAY_MARKS):
        result.relayed_to.append(transcript.stem)
    tools = [use["name"] for use in tool_uses(lines)]
    result.off_task += [f"{transcript.stem}: {tool}" for tool in tools if tool in OFF_TASK_TOOLS]


def read_stream(result: S1Result, stream: Path) -> None:
    """What the run shows of itself, for the record. It is reported, not asserted."""
    if not stream.exists():
        return
    events = parse_stream(stream.read_text())
    uses = tool_uses(events)
    result.workflows = inputs_of(uses, "Workflow", "name")
    result.skills = inputs_of(uses, "Skill", "skill")
    result.agents = inputs_of(uses, "Agent", "subagent_type")
    errors = tool_errors(events)
    result.tool_errors = len(errors)
    result.denials = [error for error in errors if DENIED in error]
    result.stop_blocks = sum(
        e.get("hook_event") == "Stop" and '"decision":"block"' in str(e.get("stdout"))
        for e in events
    )
    for directory in dict.fromkeys(TRANSCRIPT_DIR.findall(stream.read_text())):
        for transcript in sorted(Path(directory).glob("agent-*.jsonl")):
            read_agent(result, transcript)


def control_flow_run(task: str, budget: Budget, record: Path, result: S1Result) -> None:
    repo, _ = make_repo(record, on_main=True)
    gh = gh_shim_env(record)
    prompt = f"/pairingbuddy:code {TASKS[task]}"
    started = time.monotonic()
    with LedgerWatch(repo) as watch:
        try:
            run_claude(repo, prompt, budget, record / "session.stream", gh)
        except SmokeError as e:
            raise SmokeError(f"{e}; {run_position(repo, watch.last_code)}") from e
        finally:
            result.seconds = round(time.monotonic() - started, 1)
    result.stage_seconds = watch.stage_seconds()
    if watch.last_code is None or code_run_open(repo):
        raise SmokeError(run_position(repo, watch.last_code))
    assert_control_flow(watch.last_code, commit_subjects(repo))


def check_free(parent: Path) -> None:
    check_out_of_order_denied(parent / "order")
    check_finish_refused_without_evidence(parent / "evidence")


def run_s1(task: str, record: Path, budget: Budget | None = None) -> S1Result:
    """One smoke run. A failure lands in the result, with its cause, and never raises."""
    budget = budget or Budget()
    result = S1Result(task)
    record.mkdir(parents=True, exist_ok=True)
    try:
        control_flow_run(task, budget, record, result)
        check_free(record / "free")
        result.passed = True
    except SmokeError as e:
        result.cause = f"{type(e).__name__}: {e}"
    read_stream(result, record / "session.stream")
    result.cost_usd = round(budget.spent, 6)
    result.cost_known = budget.cost_known
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", choices=sorted(TASKS), default=DEFAULT_TASK)
    parser.add_argument("--free-only", action="store_true", help="the checks with no model alone")
    parser.add_argument("--budget-usd", type=float, default=BUDGET_USD)
    parser.add_argument("--record-dir", type=Path)
    options = parser.parse_args()
    record = options.record_dir or Path(tempfile.mkdtemp(prefix="pb-smoke-"))
    if options.free_only:
        check_free(record / "free")
        print(f"PASS free checks, recorded in {record}")
        return 0
    result = run_s1(options.task, record, Budget(options.budget_usd))
    print(json.dumps(result.__dict__))
    print(f"{'PASS' if result.passed else 'FAIL'} S1, recorded in {record}")
    return 0 if result.passed else 1


if __name__ == "__main__":
    sys.exit(main())
