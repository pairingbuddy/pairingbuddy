"""T0 probe definitions: each pairs a run with a judge that reads only the recording."""

import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from harness import Context, git


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


# P6, auto part: permission_mode under skip-permissions.
def run_p6(ctx: Context) -> None:
    ctx.setup()
    ctx.claude(
        f"Run the Bash command `echo hi`. Then {call('stage1')} Wait for it to finish, then stop.",
        mode=None,
        flags=("--dangerously-skip-permissions",),
    )


def judge_p6(ctx: Context) -> Verdict:
    hooks = [h for h in ctx.hooks() if "permission_mode" in h]
    main = sorted({h["permission_mode"] for h in hooks if not h.get("agent_id")})
    agents = sorted({h["permission_mode"] for h in hooks if h.get("agent_id")})
    missing = [h["hook_event_name"] for h in ctx.hooks() if "permission_mode" not in h]
    if not main:
        return Verdict("INCONCLUSIVE", "no main-context payload", "None")
    ok = main == ["bypassPermissions"]
    return Verdict(
        "PASS" if ok else "FAIL",
        f"main-context permission_mode {main}, workflow-agent permission_mode {agents}, "
        f"payloads missing the key {sorted(set(missing))}. Mode switch is the human part, not run",
        "D13 stands for this mode; mode switch awaits the human probe"
        if ok
        else "Solo uses its env var",
    )


# P11: CLAUDE_PLUGIN_ROOT in a command body.
def run_p11(ctx: Context) -> None:
    ctx.setup()
    ctx.claude("/pbprobe:where")


def judge_p11(ctx: Context) -> Verdict:
    root = str(ctx.plugin)
    run = ctx.runs["main"]
    bash = [u["input"].get("command", "") for u in run.tool_uses("Bash")]
    flows = [u["input"] for u in run.tool_uses("Workflow")]
    if not bash and not flows:
        return Verdict("INCONCLUSIVE", "model made neither call", "None")
    in_bash = any(root in c for c in bash)
    literal = any("CLAUDE_PLUGIN_ROOT" in c for c in bash)
    in_args = any((f.get("args") or {}).get("pluginRoot") == root for f in flows)
    marker = any("PB-PROBE-MARKER" in str(r.get("content")) for r in run.tool_results())
    ok = in_bash and in_args and marker and not literal
    return Verdict(
        "PASS" if ok else "FAIL",
        f"expanded path in Bash text={in_bash}, literal variable left={literal}; marker file read="
        f"{marker}; expanded path in Workflow args={in_args}",
        "Thin commands" if ok else "Move it to the skill",
    )


# P14: --output-format json with an async workflow, and budget.spent() with no target.
BUDGET_PROMPT = (
    f"{call('budget')} Wait for its completion notification. Then read its output file and print "
    "its result field as JSON, then stop."
)


def run_p14(ctx: Context) -> None:
    ctx.setup()
    ctx.claude(BUDGET_PROMPT, label="json", fmt="json")
    ctx.claude(BUDGET_PROMPT, label="stream")


def judge_p14(ctx: Context) -> Verdict:
    final = ctx.runs["json"]
    results = final.results()
    if not results:
        return Verdict(
            "INCONCLUSIVE", f"json run gave no result object, exit={final.exit_code}", "None"
        )
    last = results[-1]
    text = str(last.get("result", ""))
    json_has_result = '"spent"' in text
    stream = ctx.workflows()
    output = (stream[-1]["output"] or {}) if stream else {}
    value = output.get("result") or {}
    total = (value.get("before") or {}).get("total")
    before = (value.get("before") or {}).get("spent")
    after = (value.get("after") or {}).get("spent")
    numeric = isinstance(before, int | float) and isinstance(after, int | float)
    grew = numeric and after > before
    usage = [m["data"].get("usage") or {} for m in ctx.mod() if m["tag"] == "turn.complete"]
    agent_turns = [m for m in ctx.mod() if m["tag"] == "turn.complete" and m["data"].get("agentId")]
    model_usage = (
        ctx.runs["stream"].results()[-1].get("modelUsage", {})
        if ctx.runs["stream"].results()
        else {}
    )
    ok = json_has_result and grew
    return Verdict(
        "PASS" if ok else "FAIL",
        f"json run: {len(results)} result object(s), final text held the workflow result="
        f"{json_has_result}, total_cost_usd={last.get('total_cost_usd')}; budget.total={total}, "
        f"spent before={before}, after={after}; output totalTokens={output.get('totalTokens')}; "
        f"mod turns={len(usage)}, agent turns={len(agent_turns)}; modelUsage output tokens="
        f"{ {k: v.get('outputTokens') for k, v in model_usage.items()} }",
        "Report as designed" if ok else "Stream-json; spend unknown",
    )


# P15: publish path under -p, against a local bare remote and a gh shim.
GH_SHIM = """#!/bin/sh
printf '%s\\n' "$*" >> "$PROBE_DIR/gh.log"
echo "https://example.invalid/shim/pull/1"
"""
P15_LIMITS = (
    "Local bare remote and gh shim: NOT proven: GitHub auth or network for push, real gh auth, a "
    "real PR being created, branch protection or remote hooks"
)


def run_p15(ctx: Context) -> None:
    ctx.setup()
    remote = ctx.dir / "remote.git"
    git(ctx.dir, "init", "-q", "--bare", "-b", "main", str(remote))
    git(ctx.repo, "add", "notes.txt", ".gitignore")
    git(ctx.repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base")
    git(ctx.repo, "remote", "add", "origin", str(remote))
    git(ctx.repo, "push", "-q", "-u", "origin", "main")
    shim = ctx.dir / "shim"
    shim.mkdir()
    (shim / "gh").write_text(GH_SHIM)
    (shim / "gh").chmod(0o755)
    empty_gh = ctx.dir / "gh-config"
    empty_gh.mkdir()
    ctx.claude(
        "Run these Bash commands in order, one at a time, and report each outcome. Do not work "
        "around a failure.\n1. `git checkout -b probe/publish`\n2. `echo x > pub.txt && git add "
        "pub.txt`\n3. `git commit -m 'probe: publish'`\n4. `git push -u origin probe/publish`\n"
        "5. `gh pr create --title T --body B --base main --head probe/publish`",
        env={"PATH": f"{shim}:{os.environ['PATH']}", "GH_CONFIG_DIR": str(empty_gh)},
    )


def judge_p15(ctx: Context) -> Verdict:
    remote = ctx.dir / "remote.git"
    refs = git(remote, "for-each-ref", "--format=%(refname)")
    pushed = "refs/heads/probe/publish" in refs
    gh_log = ctx.dir / "gh.log"
    gh_log_text = gh_log.read_text() if gh_log.exists() else ""
    gh_call = " ".join(line for line in gh_log_text.splitlines() if line.startswith("pr create"))
    signed = False
    if pushed:
        status = git(remote, "log", "-1", "--format=%G?", "refs/heads/probe/publish").strip()
        signed = status == "G"
    errors = [str(r["content"])[:160] for r in ctx.runs["main"].tool_results() if r.get("is_error")]
    ok = pushed and signed and "pr create" in gh_call
    return Verdict(
        "PASS" if ok else "FAIL",
        f"push reached the local bare remote={pushed}; commit has a good signature from the "
        f"user's inherited SSH signer={signed}; gh shim got [{gh_call}]; tool errors {errors}. "
        f"{P15_LIMITS}",
        "T3b as designed, GitHub leg unproven" if ok else "Solo publishes from its script",
    )


# P16: which mechanism beats a pinned agent model.
P16_VARIANTS = {
    "baseline": ({}, ""),
    "subagent-env": ({"CLAUDE_CODE_SUBAGENT_MODEL": "haiku"}, ""),
    "default-env": (
        {
            "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-haiku-5-5",
            "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-haiku-5-5",
        },
        "",
    ),
    "mod-rewrite": ({}, "haiku"),
}
P16_PROMPT = (
    f"{call('pinned')} Wait for it to finish. Then use the Agent tool once with subagent_type "
    "`pbprobe:pinned-opus` and prompt `Reply ok`. Then stop."
)


def run_p16(ctx: Context) -> None:
    ctx.dir.mkdir(parents=True, exist_ok=True)
    for name, (env, rewrite) in P16_VARIANTS.items():
        child = Context(f"P16-{name}", ctx.dir / name)
        child.setup(rewrite_model=rewrite)
        child.claude(P16_PROMPT, env=env)


def judge_p16(ctx: Context) -> Verdict:
    parts = []
    cheap = []
    for name in P16_VARIANTS:
        child = Context(f"P16-{name}", ctx.dir / name)
        child.load()
        stops = child.hooks("SubagentStop")
        kinds = {h["agent_id"]: h.get("agent_type") for h in stops}
        models = child.transcript_models()
        seen = {f"{kinds.get(a, a)}": sorted(m) for a, m in models.items()}
        usage = (
            child.runs["main"].results()[-1].get("modelUsage", {})
            if child.runs["main"].results()
            else {}
        )
        parts.append(f"{name}: agents {seen}, session models {sorted(usage)}")
        if (
            models
            and len(models) >= 3
            and all(all("haiku" in x for x in m) for m in models.values())
        ):
            cheap.append(name)
    native = [c for c in cheap if c not in ("baseline", "mod-rewrite")]
    chosen = "baseline" if "baseline" in cheap else (native[0] if native else None)
    if chosen:
        result, change = "PASS", f"Smoke design fixed: use {chosen}"
    elif cheap:
        result, change = "FAIL", "Test-only mod rewriting `model`, per the spike"
    else:
        result, change = (
            "FAIL",
            "No mechanism forced a cheap model in this run; re-plan smoke spend",
        )
    return Verdict(
        result, f"all pinned agents ran cheap under {cheap}. " + "; ".join(parts), change
    )


# U1-U8: spike checks on the installed version.
def run_u(ctx: Context) -> None:
    ctx.setup()
    ctx.claude(
        "Make these Workflow calls in order, one at a time, waiting for each completion "
        "notification. A failure does not stop the sequence. Do not retry anything.\n"
        "1. name `pbprobe:u-importer`\n2. name `pbprobe:modgated`\n3. name `pbprobe:u-env`\n"
        "4. name `pbprobe:u-probe`\nThen stop."
    )


def judge_u(ctx: Context) -> Verdict:
    run = ctx.runs["main"]
    flows = {w["name"]: w for w in ctx.workflows()}
    errors = [str(r["content"]) for r in run.tool_results() if r.get("is_error")]
    env_out = ((flows.get("u-env") or {}).get("output") or {}).get("result") or {}
    probe_out = ((flows.get("u-probe") or {}).get("output") or {}).get("result") or {}
    mod = ctx.mod()
    spawn = next((m["data"] for m in mod if m["tag"] == "spawn"), {})
    tools = {m["data"]["tool"] for m in mod if m["tag"] == "tool"}
    agent_turn = any(
        m["tag"] == "turn.complete" and m["data"].get("agentId") and m["data"].get("usage")
        for m in mod
    )
    post = ctx.hooks("PostToolUse")
    results = {
        "U1": any("gate not approved" in e for e in errors)
        and "denied by a plugin" in str(probe_out.get("deniedError")),
        "U2": (ctx.repo / "ledger-probe.txt").exists(),
        "U3": bool(spawn.get("wf")) and "StructuredOutput" in tools and agent_turn,
        "U4": (probe_out.get("plugin") or {}).get("word") == "PERSIMMON-41"
        and (probe_out.get("plain") or {}).get("word") == "none",
        "U5": any(h.get("agent_id") and h.get("agent_type") for h in post)
        and bool(ctx.hooks("SubagentStop")),
        "U6": run.exit_code == 0 and len(run.results()) >= 1 and "u-probe" in flows,
        "U7": any("u-importer" in e and "not found" in e for e in errors)
        and (probe_out.get("child") or {}).get("fromChild") is True,
        "U8": bool(env_out.get("wrote")) and "denied" not in str(env_out.get("wrote")).lower(),
    }
    ctx.save_fixture("mod-agent-spawn", spawn)
    root = str(env_out.get("root"))[:80]
    changed = [k for k, v in results.items() if not v]
    summary = " ".join(f"{k}={'same' if v else 'CHANGED'}" for k, v in results.items())
    return Verdict(
        "PASS" if not changed else "FAIL",
        f"{summary}; CLAUDE_PLUGIN_ROOT in agent Bash: {root}; agent pwd is the repo="
        f"{Path(str(env_out.get('pwd'))).name == 'repo'}",
        "Spike results stand on this version" if not changed else f"Review {changed}",
    )


# P21: a per-call `model` against an agent's frontmatter pin.
P21_LABELS = {
    "percall:haiku-pin+sonnet": "claude-sonnet-5-5",
    "percall:sonnet-pin+haiku": "claude-haiku-5-5",
    "percall:plain+sonnet": "claude-sonnet-5-5",
}


def run_p21(ctx: Context) -> None:
    ctx.setup()
    ctx.claude(f"{call('percall')} Wait for it to finish, then stop.")


def spawn_pairs(ctx: Context) -> list[tuple[dict, dict]]:
    """Each mod `spawn` line with the `spawned` line that follows it (spawns are sequential)."""
    pairs, pending = [], None
    for line in ctx.mod():
        if line["tag"] == "spawn":
            pending = line["data"]
        elif line["tag"] == "spawned" and pending is not None:
            pairs.append((pending, line["data"] or {}))
            pending = None
    return pairs


def judge_p21(ctx: Context) -> Verdict:
    models = ctx.transcript_models()
    rows, wins = [], {}
    for spawn, spawned in spawn_pairs(ctx):
        label = spawn.get("desc")
        if label not in P21_LABELS:
            continue
        agent = str(spawned.get("agentId", ""))
        ran = sorted(next((m for a, m in models.items() if agent and agent in a), set()))
        asked = P21_LABELS[label]
        wins[label] = ran == [asked]
        rows.append(
            f"{label}: type={spawn.get('type')} spawn.model={spawn.get('model')} "
            f"spawned.model={spawned.get('model')} transcript={ran}"
        )
    results = ctx.runs["main"].results()
    usage = sorted(results[-1].get("modelUsage", {})) if results else []
    rows.append(f"session modelUsage {usage}")
    if len(wins) < len(P21_LABELS) or not wins.get("percall:plain+sonnet"):
        return Verdict("INCONCLUSIVE", "; ".join(rows), "None: control or an agent missing")
    pinned = [k for k in P21_LABELS if "pin+" in k]
    if all(wins[k] for k in pinned):
        return Verdict(
            "PASS",
            "per-call model beat the pin both ways. " + "; ".join(rows),
            "Per-call `model` overrides a pinned agentType",
        )
    if not any(wins[k] for k in pinned):
        return Verdict(
            "FAIL",
            "the pin beat the per-call model both ways. " + "; ".join(rows),
            "Model choice lives in agent frontmatter, not the script",
        )
    return Verdict("FAIL", "mixed. " + "; ".join(rows), "Review: precedence depends on direction")


case("P2", run_p2, judge_p2)
case("P5", run_p5, judge_p5)
case("P6", run_p6, judge_p6)
case("P7", run_p7, judge_p7)
case("P8", run_p8, judge_p8)
case("P9", run_p9, judge_p9)
case("P10", run_p10, judge_p10)
case("P11", run_p11, judge_p11)
case("P14", run_p14, judge_p14)
case("P15", run_p15, judge_p15)
case("P16", run_p16, judge_p16)
case("P17", run_p17, judge_p17)
case("P21", run_p21, judge_p21)
case("U", run_u, judge_u)
