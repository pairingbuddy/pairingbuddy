"""Shared runner for T0 platform probes.

Each probe runs `claude -p` in a temp git repo with a private copy of
fixtures/plugin. Raw recordings stay in PROBE_RECORDINGS; only trimmed, scrubbed
payloads are saved to fixtures/payloads/. Nothing here is collected by pytest.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
SPIKE_DOC = REPO_ROOT / "docs/spikes/workflow-platform-spike.md"
PAYLOADS = ROOT / "fixtures/payloads"
SPEND_LIMIT_USD = 15.0
RUN_BUDGET_USD = 1.0
RUN_TIMEOUT_S = 600

TABLE_END = "<!-- probe-results-end -->"


def recordings_root() -> Path:
    default = Path(tempfile.gettempdir()) / "pb-probes"
    return Path(os.environ.get("PROBE_RECORDINGS", default)).resolve()


def spend_so_far() -> float:
    ledger = recordings_root() / "spend.jsonl"
    if not ledger.exists():
        return 0.0
    return sum(json.loads(line)["usd"] for line in ledger.read_text().splitlines())


def clean_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """No inherited session or policy variables, so a probe sees a fresh start."""
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("CLAUDE", "PAIRINGBUDDY", "ANTHROPIC_"))
    }
    return env | (extra or {})


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    ).stdout


@dataclass
class Run:
    label: str
    stream: list[dict]
    exit_code: int | None
    cost_usd: float | None
    stderr: str

    def results(self) -> list[dict]:
        return [e for e in self.stream if e.get("type") == "result"]

    def init(self) -> dict:
        return next(e for e in self.stream if e.get("subtype") == "init")

    def tool_uses(self, name: str | None = None) -> list[dict]:
        return [
            block
            for e in self.stream
            if e.get("type") == "assistant"
            for block in e["message"]["content"]
            if block["type"] == "tool_use" and name in (None, block["name"])
        ]

    def tool_results(self) -> list[dict]:
        return [
            block
            for e in self.stream
            if e.get("type") == "user" and isinstance(e["message"]["content"], list)
            for block in e["message"]["content"]
            if block.get("type") == "tool_result"
        ]

    def subtype(self, name: str) -> list[dict]:
        return [e for e in self.stream if e.get("subtype") == name]


@dataclass
class Context:
    probe: str
    dir: Path
    runs: dict[str, Run] = field(default_factory=dict)

    @property
    def repo(self) -> Path:
        return self.dir / "repo"

    @property
    def plugin(self) -> Path:
        return self.dir / "plugin"

    def setup(self, rules: dict | None = None, rewrite_model: str = "") -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "rules.json").write_text(json.dumps(rules or {}))
        shutil.copytree(ROOT / "fixtures/plugin", self.plugin)
        mod = self.plugin / "hooks/register.ts"
        mod.write_text(
            mod.read_text()
            .replace("__PROBE_DIR__", str(self.dir))
            .replace("__REWRITE_MODEL__", rewrite_model)
        )
        self.repo.mkdir()
        (self.repo / ".probe").mkdir()
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.email", "probe@example.invalid")
        git(self.repo, "config", "user.name", "probe")
        (self.repo / "notes.txt").write_text("PB-NOTES-CONTENT\n")
        (self.repo / "blocked.txt").write_text("PB-BLOCKED-CONTENT\n")
        (self.repo / ".gitignore").write_text(".probe/\n")

    def claude(
        self,
        prompt: str,
        label: str = "main",
        mode: str | None = "auto",
        fmt: str = "stream-json",
        env: dict[str, str] | None = None,
        flags: tuple[str, ...] = (),
        budget: float = RUN_BUDGET_USD,
    ) -> Run:
        spent = spend_so_far()
        if spent >= SPEND_LIMIT_USD:
            raise SystemExit(f"Spend ${spent:.2f} has reached the ${SPEND_LIMIT_USD} stop.")
        out = self.dir / f"{label}.stream"
        err = self.dir / f"{label}.stderr"
        cmd = [
            "claude", "-p", prompt,
            "--plugin-dir", str(self.plugin),
            "--model", "haiku",
            "--effort", "low",
            "--setting-sources", "project,local",
            "--strict-mcp-config",
            "--max-budget-usd", str(budget),
            "--output-format", fmt,
        ]  # fmt: skip
        if fmt == "stream-json":
            cmd.append("--verbose")
        if mode:
            cmd += ["--permission-mode", mode]
        cmd += flags
        code: int | None = None
        with open(out, "w") as stdout, open(err, "w") as stderr:
            try:
                code = subprocess.run(
                    cmd,
                    cwd=self.repo,
                    env=clean_env({"PROBE_DIR": str(self.dir)} | (env or {})),
                    stdin=subprocess.DEVNULL,
                    stdout=stdout,
                    stderr=stderr,
                    timeout=RUN_TIMEOUT_S,
                ).returncode
            except subprocess.TimeoutExpired:
                err.write_text(err.read_text() + "\nPROBE: timed out\n")
        run = load_run(label, self.dir)
        run.exit_code = code
        (self.dir / f"{label}.exit").write_text(str(code))
        self.runs[label] = run
        ledger = recordings_root() / "spend.jsonl"
        with open(ledger, "a") as f:
            usd = run.cost_usd or 0.0
            f.write(json.dumps({"t": time.time(), "probe": self.probe, "run": label, "usd": usd}))
            f.write("\n")
        print(f"  {label}: exit={code} cost={run.cost_usd} total={spend_so_far():.4f}")
        self.keep_transcripts()
        return run

    def keep_transcripts(self) -> None:
        """Copy workflow journals, agent transcripts and outputs beside the recording."""
        for hook in self.hooks("PostToolUse", "Workflow"):
            response = hook.get("tool_response")
            source = Path(response.get("transcriptDir", "")) if isinstance(response, dict) else None
            if source and source.is_dir():
                target = self.dir / "wf" / response["runId"]
                shutil.copytree(source, target, dirs_exist_ok=True)
        for hook in self.hooks("SubagentStop"):
            source = Path(hook.get("agent_transcript_path", ""))
            if source.is_file():
                shutil.copy(source, self.dir / source.name)
        outputs = self.dir / "outputs"
        outputs.mkdir(exist_ok=True)
        for run in self.runs.values():
            for note in run.subtype("task_notification"):
                source = Path(note.get("output_file", ""))
                if source.is_file():
                    shutil.copy(source, outputs / f"{note['task_id']}.json")

    def workflows(self) -> list[dict]:
        """Each started workflow, in order, with its final status and return value."""
        found = []
        for run in self.runs.values():
            notes = {n["task_id"]: n for n in run.subtype("task_notification")}
            for start in run.subtype("task_started"):
                if start.get("task_type") != "local_workflow":
                    continue
                task = start["task_id"]
                path = self.dir / "outputs" / f"{task}.json"
                note = notes.get(task, {})
                found.append(
                    {
                        "name": start.get("workflow_name"),
                        "task": task,
                        "status": note.get("status"),
                        "summary": note.get("summary"),
                        "usage": note.get("usage"),
                        "output": read_output(path),
                    }
                )
        return found

    def hooks(self, event: str | None = None, tool: str | None = None) -> list[dict]:
        path = self.dir / "hooks.jsonl"
        if not path.exists():
            return []
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        return [
            r
            for r in rows
            if event in (None, r.get("hook_event_name")) and tool in (None, r.get("tool_name"))
        ]

    def mod(self) -> list[dict]:
        path = self.dir / "mod.jsonl"
        return [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []

    def transcript_models(self) -> dict[str, set[str]]:
        """Agent id to the models its transcript's assistant turns really used."""
        models: dict[str, set[str]] = {}
        for path in self.dir.rglob("agent-*.jsonl"):
            for line in path.read_text().splitlines():
                msg = json.loads(line).get("message") or {}
                if msg.get("role") == "assistant" and msg.get("model"):
                    models.setdefault(path.stem.removeprefix("agent-"), set()).add(msg["model"])
        return models

    def transcript_text(self) -> str:
        return "\n".join(p.read_text() for p in self.dir.rglob("agent-*.jsonl"))

    def load(self) -> None:
        for path in sorted(self.dir.glob("*.stream")):
            self.runs[path.stem] = load_run(path.stem, self.dir)

    def save_fixture(self, name: str, payload: dict) -> None:
        PAYLOADS.mkdir(parents=True, exist_ok=True)
        text = scrub(json.dumps(payload, indent=2), self.dir)
        (PAYLOADS / f"{name}.json").write_text(text + "\n")


def read_output(path: Path) -> dict | None:
    """A workflow's output file: JSON on success, plain error text on failure."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {"error": path.read_text()}


def load_run(label: str, directory: Path) -> Run:
    text = (directory / f"{label}.stream").read_text()
    events = []
    for line in text.splitlines():
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            events.append(parsed)
    costs = [e["total_cost_usd"] for e in events if "total_cost_usd" in e]
    exit_file = directory / f"{label}.exit"
    code = exit_file.read_text() if exit_file.exists() else None
    return Run(
        label=label,
        stream=events,
        exit_code=int(code) if code not in (None, "None") else None,
        cost_usd=max(costs) if costs else None,
        stderr=(directory / f"{label}.stderr").read_text(),
    )


def scrub(text: str, run_dir: Path | None = None) -> str:
    """Remove home paths, recording paths, and anything shaped like a credential."""
    home = str(Path.home())
    user = Path.home().name
    if run_dir:
        text = text.replace(str(run_dir), "/tmp/probe")
    text = text.replace(str(recordings_root()), "/tmp/probes")
    text = text.replace(home, "/home/user")
    text = re.sub(rf"[-\w.]*-Users-{re.escape(user)}[-\w.]*", "encoded-project", text)
    text = re.sub(r"/private/tmp/claude-\d+/[^\s\"']*", "/tmp/session", text)
    text = re.sub(r"sk-ant-[\w-]+|gh[pousr]_\w+|github_pat_\w+", "<redacted>", text)
    text = re.sub(
        r"(?i)(token|secret|api[_-]?key)(\"?\s*[:=]\s*\"?)[\w.-]{20,}", r"\1\2<redacted>", text
    )
    return text.replace(user, "user")


def claude_version() -> str:
    version = subprocess.run(["claude", "--version"], capture_output=True, text=True)
    return version.stdout.split()[0]


def record_row(probe: str, verdict: str, evidence: str, change: str, run_dir: Path) -> None:
    """Append one row to the spike doc's results table."""
    relative = run_dir.relative_to(recordings_root())
    cells = [
        probe, claude_version(), time.strftime("%Y-%m-%d"), "auto", verdict, evidence,
        f"`$PROBE_RECORDINGS/{relative}`", change,
    ]  # fmt: skip
    row = "| " + " | ".join(scrub(c).replace("|", "\\|").replace("\n", " ") for c in cells) + " |\n"
    doc = SPIKE_DOC.read_text()
    SPIKE_DOC.write_text(doc.replace(TABLE_END, row + TABLE_END))
