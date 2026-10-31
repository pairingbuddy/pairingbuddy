"""T0 probe definitions: each pairs a run with a judge that reads only the recording."""

import json
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


# P2: PreToolUse inside workflow agents, including a deny.
def run_p2(ctx: Context) -> None:
    ctx.setup(
        {
            "deny": [
                {"tool": "Bash", "match": "pb-deny-me", "reason": "PROBE-DENY bash"},
                {"tool": "Read", "match": "blocked.txt", "reason": "PROBE-DENY read"},
            ]
        }
    )
    ctx.claude(f"{call('runner')} Wait for it to finish, then stop.")


def judge_p2(ctx: Context) -> Verdict:
    pre = ctx.hooks("PreToolUse")
    inside = [h for h in pre if h.get("agent_id")]
    types = sorted({str(h.get("agent_type")) for h in inside})
    paired = all("agent_type" in h for h in inside)
    main_clean = all("agent_type" not in h for h in pre if not h.get("agent_id"))
    typed = [h for h in inside if h.get("agent_type") == "pbprobe:echoer"]
    fired = {"Bash", "Read"} <= {h["tool_name"] for h in typed}
    ran = [json.dumps(h["tool_input"]) for h in ctx.hooks("PostToolUse") if h.get("agent_id")]
    leaked = [c for c in ran if "pb-deny-me" in c or ("blocked.txt" in c and "file_path" in c)]
    attempts = [
        h
        for h in inside
        if "pb-deny-me" in json.dumps(h["tool_input"])
        or "blocked.txt" in json.dumps(h["tool_input"])
    ]
    if typed:
        ctx.save_fixture("pretooluse-workflow-agent-bash", typed[0])
    if not attempts:
        return Verdict("INCONCLUSIVE", "no agent attempted a denied call", "None")
    ok = bool(typed) and paired and main_clean and fired and not leaked
    return Verdict(
        "PASS" if ok else "FAIL",
        f"PreToolUse fired in workflow agents, agent_type values {types}; agent_id and agent_type "
        f"paired={paired}; {len(attempts)} denied attempts, {len(leaked)} executed",
        "Runner rule, subagent denies and lens confinement stand"
        if ok
        else "NO FALLBACK: re-plan to detection",
    )


def request_tools(ctx: Context) -> list[tuple[str, bool]]:
    """(name, deferred) for each tool in the reader agent's first recorded API request."""
    for path in ctx.dir.rglob("agent-*.jsonl"):
        for line in path.read_text().splitlines():
            event = json.loads(line)
            if event.get("type") == "api-request-shape":
                tools = event["shape"].get("tools", [])
                return sorted((tool["name"], bool(tool.get("defer_loading"))) for tool in tools)
    return []


# P8: tools frontmatter with StructuredOutput still available.
def run_p8(ctx: Context) -> None:
    ctx.setup()
    ctx.claude(f"{call('readonly')} Wait for it to finish, then stop.")


def judge_p8(ctx: Context) -> Verdict:
    reader = [h for h in ctx.hooks() if h.get("agent_type") == "pbprobe:reader"]
    tools = sorted({h["tool_name"] for h in reader if "tool_name" in h})
    out = [
        h
        for h in reader
        if h.get("tool_name") == "StructuredOutput" and h["hook_event_name"] == "PostToolUse"
    ]
    if not reader:
        return Verdict("INCONCLUSIVE", "reader agent produced no hook events", "None")
    returned = bool(out) and "PB-NOTES-CONTENT" in out[0]["tool_input"].get("content", "")
    if out:
        ctx.save_fixture("posttooluse-structuredoutput", out[0])
    forbidden = {"Bash", "Write", "Edit"} & set(tools)
    wrote = [n for n in ("pwned-bash.txt", "pwned-write.txt") if (ctx.repo / n).exists()]
    offered = request_tools(ctx)
    usable = [name for name, deferred in offered if not deferred]
    extra = [name for name, deferred in offered if deferred]
    exact = usable == ["Glob", "Grep", "Read", "StructuredOutput"]
    ok = returned and not forbidden and not wrote and exact
    return Verdict(
        "PASS" if ok else "FAIL",
        f"reader tool events {tools}; StructuredOutput returned the file={returned}; "
        f"forbidden tools fired={sorted(forbidden)}; files written={wrote}; tools loaded in "
        f"the agent's API request {usable}; deferred entries in that request {extra} "
        "(no ToolSearch to load them)",
        "D8 stands" if ok else "NO FALLBACK: re-plan D8, using hook denial plus audit",
    )


# P9: unknown agentType.
def run_p9(ctx: Context) -> None:
    ctx.setup()
    ctx.claude(
        f"{call('unknown-caught')} Wait for it to finish. Then {call('unknown-raw')} "
        "Wait for it to finish, then stop."
    )


def judge_p9(ctx: Context) -> Verdict:
    flows = {w["name"]: w for w in ctx.workflows()}
    if {"unknown-caught", "unknown-raw"} - set(flows):
        return Verdict("INCONCLUSIVE", f"workflows run: {sorted(flows)}", "None")
    caught = flows["unknown-caught"]
    raw = flows["unknown-raw"]
    result = (caught["output"] or {}).get("result") or {}
    spawned = [m for m in ctx.mod() if m["tag"] == "spawned"]
    fails_loud = result.get("threw") is True and raw["status"] != "completed"
    return Verdict(
        "PASS" if fails_loud else "FAIL",
        f"caught form returned {json.dumps(result)[:160]}; uncaught status={raw['status']} "
        f"summary={str(raw['summary'])[:110]}; agents spawned={len(spawned)}",
        "Records behaviour: an unknown agentType throws and no agent runs"
        if fails_loud
        else "Harness check still catches it (D15)",
    )


case("P2", run_p2, judge_p2)
case("P8", run_p8, judge_p8)
case("P9", run_p9, judge_p9)
