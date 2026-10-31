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


# P5: Stop hook drives a two-workflow run across a gate, from a prompt naming only stage 1.
STOP_REASON = (
    "PROBE-NEXT: stage1 finished. Run the Bash command `sh .probe/gate-eval.sh`, "
    "then call the Workflow tool with name `pbprobe:stage2`."
)


def run_p5(ctx: Context) -> None:
    ctx.setup(
        {
            "deny": [
                {"tool": "Workflow", "match": "stage2", "unless": ".probe/gate.ok",
                 "reason": "PROBE-DENY gate not passed"},
            ],
            "stop": [
                {
                    "if": ".probe/stage1.done",
                    "unless": ".probe/stage2.called",
                    "reason": STOP_REASON,
                }
            ],
        }
    )  # fmt: skip
    (ctx.repo / ".probe/gate-eval.sh").write_text(
        "echo auto-pass > .probe/gate.ok\ntouch .probe/stage2.called\necho auto-pass\n"
    )
    ctx.claude(f"{call('stage1')} Do nothing else.")


def judge_p5(ctx: Context) -> Verdict:
    stops = ctx.hooks("Stop")
    blocks = ctx.dir / "stop-decisions.jsonl"
    blocked = len(blocks.read_text().splitlines()) if blocks.exists() else 0
    flows = [(w["name"], w["status"]) for w in ctx.workflows()]
    run = ctx.runs["main"]
    gate = any("gate-eval" in u["input"].get("command", "") for u in run.tool_uses("Bash"))
    both = (ctx.repo / ".probe/stage1.done").exists() and (ctx.repo / ".probe/stage2.done").exists()
    reached = any(
        "PROBE-NEXT" in json.dumps(e)
        for e in run.stream
        if e.get("type") in ("user", "assistant", "system")
    )
    if stops:
        ctx.save_fixture("stop", stops[-1])
    ok = bool(stops) and blocked >= 1 and gate and both and run.exit_code == 0
    return Verdict(
        "PASS" if ok else "FAIL",
        f"Stop fired {len(stops)} times, blocked {blocked}; next-action text in stream={reached}; "
        f"gate script ran={gate}; workflows {flows}; both stages ran={both}; exit={run.exit_code}",
        "T1d as designed" if ok else "Solo drives stages from its script",
    )


# P7: same-type fan-out with pb_key, a slow synchronous tap, and a large return.
LARGE_LINES = 240


def large_text() -> str:
    return "\n".join(
        f"{n:04d}-large-return-line-abcdefghijklmnopqrstuvwxyz-0123456789-abcd"
        for n in range(LARGE_LINES)
    )


def run_p7(ctx: Context) -> None:
    ctx.setup({"tap": {"sleepMs": 3000}})
    (ctx.repo / "large.txt").write_text(large_text())
    ctx.claude(f"{call('fanout')} Wait for it to finish, then stop.")


def judge_p7(ctx: Context) -> Verdict:
    keys = {i: f"fan.worker.{i}.r1.a1" for i in ("alpha", "bravo", "charlie")}
    folder = ctx.repo / ".probe/artifacts"
    arts = (
        {p.stem: json.loads(p.read_text()) for p in folder.glob("*.json")}
        if folder.exists()
        else {}
    )
    separate = all(
        keys[i] in arts and arts[keys[i]]["value"]["token"] == f"{i}-{len(i)}" for i in keys
    )
    agents = {a["agent_id"] for a in arts.values()}
    stops = {h["agent_id"]: h["_t"] for h in ctx.hooks("SubagentStop")}
    timed = [a for a in arts.values() if a["agent_id"] in stops]
    sync = bool(timed) and all(a["end"] <= stops[a["agent_id"]] for a in timed)
    held = [a["end"] - a["start"] for a in arts.values()]
    large = arts.get("fan.worker.large.r1.a1")
    size = len(large["value"]["token"]) if large else 0
    flows = ctx.workflows()
    output = flows[0]["output"] if flows else None
    after = str((output or {}).get("result", {}).get("after", ""))
    seen_after = all(k in after for k in keys.values())
    returned = (output or {}).get("result", {}).get("returned") or []
    large_ret = next((r for r in returned if r and r["pb_key"].endswith("large.r1.a1")), None)
    intact = bool(large_ret) and large_ret["tokenLength"] == size
    exact = bool(large) and large["value"]["token"].strip() == large_text()
    full = len(large_text())
    ok = separate and len(agents) == 4 and sync and seen_after and intact and exact
    if not flows:
        return Verdict("INCONCLUSIVE", "workflow did not start", "None")
    return Verdict(
        "PASS" if ok else "FAIL",
        f"3 same-type returns kept separate={separate}, distinct agents={len(agents)}; tap held "
        f"{min(held, default=0)}-{max(held, default=0)}ms and finished before SubagentStop={sync}; "
        f"next agent saw all artifacts={seen_after}; large return {size} of {full} chars, "
        f"byte-equal to the source={exact}, tap and script agree={intact}",
        "D3 stands" if ok else "Runner reads via `pb artifact check`",
    )


def line_count(ctx: Context, name: str) -> int:
    path = ctx.repo / ".probe" / name
    return len(path.read_text().splitlines()) if path.exists() else 0


# P10: resumeFromRunId after a failed run, then a same-args resume.
def run_p10(ctx: Context) -> None:
    ctx.setup()
    ctx.claude(
        "Three steps, one at a time. Wait for each workflow's completion notification before "
        "the next step.\n"
        '1. Call Workflow with name `pbprobe:resumable` and args {"stopAfterFirst": true}. '
        "It will fail with PROBE_STOP_AFTER_FIRST. That is expected.\n"
        '2. Call Workflow with name `pbprobe:resumable`, args {"stopAfterFirst": false}, and '
        "resumeFromRunId set to the wf_ id from step 1's transcript dir.\n"
        '3. Call Workflow with name `pbprobe:resumable`, args {"stopAfterFirst": false}, and '
        "resumeFromRunId set to the wf_ id from step 2's transcript dir.\n"
        "If a call errors, do not retry it with different parameters. Then stop."
    )


def judge_p10(ctx: Context) -> Verdict:
    calls = [h["tool_input"] for h in ctx.hooks("PostToolUse", "Workflow")]
    resumes = [c for c in calls if c.get("resumeFromRunId")]
    flows = [(w["name"], w["status"]) for w in ctx.workflows()]
    first, second = line_count(ctx, "first.count"), line_count(ctx, "second.count")
    posted = [h["tool_response"].get("runId") for h in ctx.hooks("PostToolUse", "Workflow")]
    errors = [str(r["content"])[:140] for r in ctx.runs["main"].tool_results() if r.get("is_error")]
    if len(resumes) < 2:
        return Verdict(
            "INCONCLUSIVE",
            f"{len(resumes)} resume calls; errors {errors}; workflows {flows}",
            "None",
        )
    done = [s for _, s in flows[1:]] == ["completed", "completed"]
    ok = done and second == 1
    return Verdict(
        "PASS" if ok else "FAIL",
        f"workflows {flows}; runIds {posted}; first agent ran {first} times, second ran {second} "
        "times across one failed run and two resumes",
        "Same-session resume in T7d" if ok else "Redo always re-runs",
    )


# P17: Workflow PostToolUse carries runId.
def run_p17(ctx: Context) -> None:
    ctx.setup()
    ctx.claude(f"{call('stage1')} Wait for it to finish, then stop.")


def judge_p17(ctx: Context) -> Verdict:
    posts = ctx.hooks("PostToolUse", "Workflow")
    if not posts:
        return Verdict("INCONCLUSIVE", "no Workflow PostToolUse recorded", "None")
    response = posts[0]["tool_response"]
    run_id = response.get("runId") if isinstance(response, dict) else None
    ctx.save_fixture("posttooluse-workflow", posts[0])
    spawn = [
        m["data"]["wf"]["runId"] for m in ctx.mod() if m["tag"] == "spawn" and m["data"].get("wf")
    ]
    matches_mod = run_id in spawn
    in_dir = bool(run_id) and str(response.get("transcriptDir", "")).endswith(run_id)
    stream_ids = sorted({e.get("run_id") for e in ctx.runs["main"].subtype("task_started")})
    ok = bool(run_id) and matches_mod and in_dir
    return Verdict(
        "PASS" if ok else "FAIL",
        f"tool_response.runId={run_id}, status={response.get('status')}; same id in agent.spawn="
        f"{matches_mod} and transcriptDir={in_dir}; stream run_id is a different id {stream_ids}",
        "Data flow step 4 stands. Use runId, not stream run_id" if ok else "Resume off; redo only",
    )


case("P2", run_p2, judge_p2)
case("P5", run_p5, judge_p5)
case("P7", run_p7, judge_p7)
case("P8", run_p8, judge_p8)
case("P9", run_p9, judge_p9)
case("P10", run_p10, judge_p10)
case("P17", run_p17, judge_p17)
