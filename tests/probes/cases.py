"""T0 probe definitions: each pairs a run with a judge that reads only the recording."""

from collections.abc import Callable
from dataclasses import dataclass

from harness import Context


@dataclass
class Verdict:
    result: str
    evidence: str
    change: str


@dataclass
class Case:
    name: str
    run: Callable[[Context], None]
    judge: Callable[[Context], Verdict]


CASES: dict[str, Case] = {}


def case(name: str, run: Callable, judge: Callable) -> None:
    CASES[name] = Case(name, run, judge)


def call(workflow: str, args: str = "") -> str:
    suffix = f" and args {args}" if args else ""
    return f"Call the Workflow tool with name `pbprobe:{workflow}`{suffix}."


# P1: PreToolUse deny on Workflow, with a positive control.
P1_ARGS = '{"pluginRoot": "/x", "attempt": 1}'


def run_p1(ctx: Context) -> None:
    ctx.setup(
        {"deny": [{"tool": "Workflow", "match": "gated", "reason": "PROBE-DENY stage order"}]}
    )
    ctx.claude(
        f"{call('gated', P1_ARGS)} Then, whatever happened, {call('open', P1_ARGS)} "
        "Then stop. Do not retry a denied call."
    )


def judge_p1(ctx: Context) -> Verdict:
    run = ctx.runs["main"]
    pre = ctx.hooks("PreToolUse", "Workflow")
    gated = [h for h in pre if h["tool_input"].get("name", "").endswith(":gated")]
    opened = [h for h in pre if h["tool_input"].get("name", "").endswith(":open")]
    if not gated or not opened:
        return Verdict(
            "INCONCLUSIVE", f"model made {len(gated)} gated, {len(opened)} open calls", "None"
        )
    sees = all(h["tool_input"].get("args") == {"pluginRoot": "/x", "attempt": 1} for h in gated)
    if sees:
        ctx.save_fixture("pretooluse-workflow", gated[0])
    denied = any(
        "PROBE-DENY" in str(r.get("content")) and r.get("is_error") for r in run.tool_results()
    )
    started = {e.get("workflow_name") for e in run.subtype("task_started")}
    stopped = "gated" not in started
    control = "open" in started
    ok = sees and denied and stopped and control
    return Verdict(
        "PASS" if ok else "FAIL",
        f"PreToolUse saw name and args={sees}; deny reason reached the model={denied}; "
        f"gated never started={stopped}; open control started={control}",
        "T1b blocks at the boundary" if ok else "NO FALLBACK: re-plan R2 to detection",
    )


case("P1", run_p1, judge_p1)
