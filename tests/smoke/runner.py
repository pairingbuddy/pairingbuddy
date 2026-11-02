"""One capped `claude -p` run against this worktree's plugin, for smoke.

`--plugin-dir` applies to the spawned run alone. The current session and the user's settings are
not touched, and `--setting-sources project,local` keeps user settings and installed plugins out of
the run. The env mechanism for a cheap model is P16's: `--model` does not override an agent's pin.

The spend cap covers a whole smoke run, so a stage after the first gets what is left of it.
"""

import json
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BUDGET_USD = 3.0
RUN_TIMEOUT_S = 600
CHEAP_MODEL = "claude-haiku-5-5"
DROPPED_PREFIXES = ("PAIRINGBUDDY", "PB_", "CLAUDE", "ANTHROPIC_", "GIT_")


class SmokeError(Exception):
    """The run failed. The message is the cause, as far as the run shows it."""


class SpendCapError(SmokeError):
    """The spend cap ended the run. Only the human raises the cap."""


class Budget:
    """What a smoke run may still spend. A cost the run did not report leaves cost_known False."""

    def __init__(self, total: float = BUDGET_USD):
        self.total = total
        self.spent = 0.0
        self.cost_known = True

    @property
    def remaining(self) -> float:
        return self.total - self.spent

    def charge(self, usd: float) -> None:
        self.spent += usd


@dataclass
class ClaudeRun:
    cost_usd: float
    seconds: float


def clean_env(inherited: dict[str, str] | None = None) -> dict[str, str]:
    source = os.environ if inherited is None else inherited
    env = {k: v for k, v in source.items() if not k.startswith(DROPPED_PREFIXES)}
    return env | {
        "ANTHROPIC_DEFAULT_OPUS_MODEL": CHEAP_MODEL,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": CHEAP_MODEL,
    }


def claude_command(prompt: str, budget_usd: float) -> list[str]:
    return [
        "claude", "-p", prompt,
        "--plugin-dir", str(REPO_ROOT),
        "--model", "haiku",
        "--effort", "low",
        "--setting-sources", "project,local",
        "--strict-mcp-config",
        "--permission-mode", "auto",
        "--max-budget-usd", str(budget_usd),
        "--output-format", "stream-json",
        "--verbose",
    ]  # fmt: skip


def parse_stream(text: str) -> list[dict]:
    events = []
    for line in text.splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def is_cap_result(event: dict) -> bool:
    return (
        event.get("subtype") == "error_max_budget_usd"
        or event.get("terminal_reason") == "budget_exhausted"
    )


def check_finished(results: list[dict], code: int, stderr: str) -> None:
    if any(is_cap_result(result) for result in results):
        raise SpendCapError(f"the spend cap ended the run: {results[-1].get('errors')}")
    if code != 0:
        raise SmokeError(f"claude exit {code}: {stderr[-500:]}")
    if not results:
        raise SmokeError("no result event in the stream")
    if results[-1].get("is_error"):
        raise SmokeError(f"result error {results[-1].get('subtype')}")


def refuse_repo_inside_plugin(repo: Path) -> None:
    """Auto mode fails an in-repo Write with no verdict when the cwd is inside `--plugin-dir`."""
    if repo.resolve().is_relative_to(REPO_ROOT):
        raise SmokeError(
            f"{repo} is inside the --plugin-dir {REPO_ROOT}: use a directory outside it"
        )


def spawn(repo: Path, prompt: str, budget: Budget, record: Path) -> subprocess.CompletedProcess:
    refuse_repo_inside_plugin(repo)
    try:
        return subprocess.run(
            claude_command(prompt, round(budget.remaining, 6)),
            cwd=repo,
            env=clean_env(),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=RUN_TIMEOUT_S,
            start_new_session=True,
        )
    except subprocess.TimeoutExpired as e:
        budget.cost_known = False
        partial = e.stdout or b""
        record.write_bytes(partial if isinstance(partial, bytes) else partial.encode())
        raise SmokeError(f"claude timed out after {RUN_TIMEOUT_S}s") from e


def run_claude(repo: Path, prompt: str, budget: Budget, record: Path) -> ClaudeRun:
    """Runs and charges `budget`, so spend is known to the caller even when this raises."""
    if budget.remaining <= 0:
        raise SpendCapError(f"the spend cap is used up at ${budget.spent:.4f}")
    started = time.monotonic()
    done = spawn(repo, prompt, budget, record)
    seconds = time.monotonic() - started
    record.write_text(done.stdout)
    events = parse_stream(done.stdout)
    costs = [event["total_cost_usd"] for event in events if "total_cost_usd" in event]
    if costs:
        budget.charge(max(costs))
    else:
        budget.cost_known = False
    check_finished(
        [event for event in events if event.get("type") == "result"], done.returncode, done.stderr
    )
    if budget.remaining <= 0:
        raise SpendCapError(
            f"the run ended at the spend cap, ${budget.spent:.4f} of ${budget.total}"
        )
    return ClaudeRun(cost_usd=max(costs, default=0.0), seconds=seconds)
