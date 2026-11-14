import "./isolated-tmpdir.mjs";
// M1: a session stays bound to its run after its cwd leaves it. Every test drives the real hooks and the real CLI
// as subprocesses, against a temp git repo.
//
// A pointer is a file <os.tmpdir()>/pairingbuddy-sessions/<session_id> holding the run root. The gate writes it for
// a main-context payload inside a run, and both hooks read it when the walk up from the cwd finds nothing.
import { withIntake } from "./ledger-fixture.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { gateQuestion } from "../../shared-node/gates.mjs";
import { buildKey } from "../../shared-node/keys.mjs";
import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const GATE = join(ROOT, "hooks", "gate.mjs");
const BOOT = join(ROOT, "hooks", "gate-boot.mjs");
const TAP = join(ROOT, "hooks", "tap.mjs");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");
const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));

const CONFIG = "code-config";
const SAFETY_NET = "code-safety-net";
const TASK_END = "G:task-end";
const CONFIG_TEXT = '{"runners":{}}\n';

const tempDirs = [];
function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const IDLE = { name: "", status: "", runId: null, attempt: 0, startedAt: null };

function makeLedger(over = {}) {
  return withIntake({
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "M1",
    plan: { path: "", title: "" }, configHash: createHash("sha256").update(CONFIG_TEXT).digest("hex"),
    policy: { mode: "", source: "" }, stage: IDLE, stages: [],
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
    ...over,
  });
}

function makeRepo({ ledger = {}, parent = null } = {}) {
  const dir = parent === null ? makeDir("binding-") : parent;
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), CONFIG_TEXT);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, makeLedger(ledger));
  return { dir, taskDir, ledgerPath, ledger: () => readLedger(ledgerPath), bytes: () => readFileSync(ledgerPath, "utf8") };
}

const allDoneLedger = (over = {}) => ({
  stage: { name: SAFETY_NET, status: "done", runId: "wf_2", attempt: 1, startedAt: null },
  stages: [{ name: CONFIG, status: "done" }, { name: SAFETY_NET, status: "done" }],
  ...over,
});

const sessionsDir = () => join(tmpdir(), "pairingbuddy-sessions");
const pointerPath = (session) => join(sessionsDir(), session);

let sessions = 0;
const newSession = () => `session-${(sessions += 1)}`;

function hookEnv(plugin = ROOT) {
  const { PAIRINGBUDDY_GATE_POLICY: _inherited, ...env } = process.env;
  return { ...env, CLAUDE_PLUGIN_ROOT: plugin };
}

function runHook(script, payload, cwd) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [script], { cwd, input: JSON.stringify(payload), env: hookEnv(), encoding: "utf8" });
  return { code: status, stdout, stderr };
}

const runGate = (payload, { gate = BOOT } = {}) => runHook(gate, payload, payload.cwd);
const runTap = (payload) => runHook(TAP, payload, payload.cwd);

const decisionOf = (result) => (result.stdout === "" ? null : JSON.parse(result.stdout).hookSpecificOutput);

function assertSilent(result) {
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" }, "the gate adds no decision here");
}

function assertDenied(result, pattern) {
  assert.equal(result.code, 0, result.stderr);
  const decision = decisionOf(result);
  assert.equal(decision?.permissionDecision, "deny", `the hook must deny: ${result.stdout}`);
  assert.match(decision.permissionDecisionReason, pattern);
}

function mainCall(cwd, session, tool, toolInput, mode = "default") {
  const { agent_id: _id, agent_type: _type, ...base } = fixture("pretooluse-workflow.json");
  return { ...base, session_id: session, cwd, permission_mode: mode, tool_name: tool, tool_input: toolInput };
}

const bash = (cwd, session, command, mode) => mainCall(cwd, session, "Bash", { command, description: "run it" }, mode);
const write = (cwd, session, path) => mainCall(cwd, session, "Write", { file_path: path, content: "x" });
const stage = (cwd, session, name, args = { pluginRoot: ROOT, attempt: 1, task: { description: "set x" } }) => mainCall(cwd, session, "Workflow", { name: `pairingbuddy:${name}`, args });
const agent = (cwd, session) => mainCall(cwd, session, "Agent", { subagent_type: "pairingbuddy:classify-task", description: "x", prompt: "x" });

function subagent(cwd, session, command = "ls") {
  return { ...fixture("pretooluse-workflow-agent-bash.json"), session_id: session, cwd, permission_mode: "default", tool_name: "Bash", tool_input: { command, description: "x" } };
}

// The ordinary route into the state under test: a first call from inside the run.
function bindSession(repo, session = newSession()) {
  assertSilent(runGate(bash(repo.dir, session, "ls")));
  return session;
}

function boundRepo(ledger) {
  const repo = makeRepo({ ledger });
  return { repo, session: bindSession(repo), outside: makeDir("binding-outside-") };
}

// ---------- the claim and the pointer ----------

describe("a main-context payload inside a run binds its session", () => {
  test("it claims an unowned ledger, with lastSeen", () => {
    const repo = makeRepo();
    const session = newSession();
    const since = Date.now();

    assertSilent(runGate(bash(repo.dir, session, "ls")));

    const { owner } = repo.ledger();
    assert.equal(owner.sessionId, session);
    assert.ok(Date.parse(owner.lastSeen) >= since - 1000 && Date.parse(owner.lastSeen) <= Date.now(), `lastSeen ${owner.lastSeen} is the time of the claim`);
  });

  test("it writes a pointer holding the run root", () => {
    const repo = makeRepo();

    const session = bindSession(repo);

    assert.equal(readFileSync(pointerPath(session), "utf8").trim(), repo.dir);
  });

  test("a call from a subdirectory points at the run root", () => {
    const repo = makeRepo();
    const sub = join(repo.dir, "src", "deep");
    mkdirSync(sub, { recursive: true });
    const session = newSession();

    assertSilent(runGate(bash(sub, session, "ls")));

    assert.equal(readFileSync(pointerPath(session), "utf8").trim(), repo.dir);
  });

  test("the claim and a first policy are one ledger write", () => {
    const repo = makeRepo();
    const { seq } = repo.ledger();

    bindSession(repo);

    assert.equal(repo.ledger().seq, seq + 1);
  });

  test("a stage start claims the ledger in its own write", () => {
    const repo = makeRepo();
    const session = newSession();
    const { seq } = repo.ledger();

    assertSilent(runGate(stage(repo.dir, session, CONFIG)));

    assert.equal(repo.ledger().owner.sessionId, session);
    assert.equal(repo.ledger().seq, seq + 1);
  });

  test("a denied call writes the pointer and leaves the ledger alone", () => {
    const repo = makeRepo();
    const session = newSession();
    const before = repo.bytes();

    assertDenied(runGate(stage(repo.dir, session, SAFETY_NET)), /next stage/);

    assert.equal(repo.bytes(), before, "a deny writes no ledger");
    assert.equal(readFileSync(pointerPath(session), "utf8").trim(), repo.dir);
  });

  test("a broken ledger still gets a pointer", () => {
    const repo = makeRepo();
    const session = newSession();
    writeFileSync(repo.ledgerPath, "{");

    runGate(bash(repo.dir, session, "ls"));

    assert.equal(readFileSync(pointerPath(session), "utf8").trim(), repo.dir);
  });

  test("a subagent neither claims the ledger nor writes a pointer", () => {
    const repo = makeRepo();
    const session = newSession();

    assertSilent(runGate(subagent(repo.dir, session)));

    assert.equal(repo.ledger().owner.sessionId, null);
    assert.equal(existsSync(pointerPath(session)), false);
  });

  test("an owned ledger keeps its owner, and the other session still gets a pointer", () => {
    const repo = makeRepo();
    const owner = bindSession(repo);
    const { owner: claimed } = repo.ledger();
    const other = newSession();

    assertSilent(runGate(bash(repo.dir, other, "ls")));

    assert.deepEqual(repo.ledger().owner, claimed);
    assert.notEqual(owner, other);
    assert.equal(readFileSync(pointerPath(other), "utf8").trim(), repo.dir);
  });

  test("a later call from the owner writes no ledger", () => {
    const repo = makeRepo();
    const session = bindSession(repo);
    const before = repo.bytes();

    assertSilent(runGate(bash(repo.dir, session, "ls")));

    assert.equal(repo.bytes(), before);
  });

  test("moving into another run points the session there", () => {
    const first = makeRepo();
    const second = makeRepo();
    const session = bindSession(first);

    bindSession(second, session);

    assert.equal(readFileSync(pointerPath(session), "utf8").trim(), second.dir);
  });

  for (const session of ["../escaped", "a/b", "..", ".", ""]) {
    test(`session id ${JSON.stringify(session)} writes nothing beside the pointers`, () => {
      const repo = makeRepo();
      const before = existsSync(sessionsDir()) ? readdirSync(sessionsDir()) : [];

      runGate(bash(repo.dir, session, "ls"));

      assert.deepEqual(existsSync(sessionsDir()) ? readdirSync(sessionsDir()) : [], before);
      assert.equal(existsSync(join(tmpdir(), "escaped")), false);
    });
  }

  test("a pointer that cannot be written does not take the tools away", () => {
    const repo = makeRepo();
    const blocked = makeDir("binding-blocked-");
    writeFileSync(join(blocked, "pairingbuddy-sessions"), "a file where the directory goes");
    const session = newSession();
    const env = { ...hookEnv(), TMPDIR: blocked };

    const { status, stdout, stderr } = spawnSync(process.execPath, [BOOT], { cwd: repo.dir, input: JSON.stringify(bash(repo.dir, session, "ls")), env, encoding: "utf8" });

    assert.deepEqual({ status, stdout, stderr }, { status: 0, stdout: "", stderr: "" });
  });
});

// ---------- every rule holds outside the cwd ----------

describe("a bound session is held to the run from any cwd", () => {
  test("Bash pb human through a cd is denied", () => {
    const { repo, session, outside } = boundRepo(allDoneLedger());
    const before = repo.ledger().gates;

    assertDenied(runGate(bash(outside, session, `cd ${repo.dir} && node ${CLI} human approve ${TASK_END}`)), /human alone/);

    assert.deepEqual(repo.ledger().gates, before);
  });

  test("a Workflow out of order is denied", () => {
    const { session, outside } = boundRepo();

    assertDenied(runGate(stage(outside, session, SAFETY_NET, { pluginRoot: "/wrong", attempt: 9 })), /next stage is pairingbuddy:code-config/);
  });

  test("a direct pipeline Agent call is denied", () => {
    const { session, outside } = boundRepo();

    assertDenied(runGate(agent(outside, session)), /Direct Agent call/);
  });

  test("a Write to the run directory is denied", () => {
    const { repo, session, outside } = boundRepo();

    assertDenied(runGate(write(outside, session, repo.ledgerPath)), /\.pairingbuddy\/run/);
  });

  test("a wrong-class verb is denied", () => {
    const { session, outside } = boundRepo();

    assertDenied(runGate(bash(outside, session, `node ${CLI} stage finish`)), /runner agent/);
  });

  test("a subagent of the session is held too", () => {
    const { session, outside } = boundRepo();

    assertDenied(runGate(subagent(outside, session, `node ${CLI} run open`)), /main context/);
  });

  test("a mode switch from outside is recorded", () => {
    const { repo, session, outside } = boundRepo();

    assertSilent(runGate(bash(outside, session, "ls", "auto")));

    assert.equal(repo.ledger().policy.mode, "auto");
  });

  test("a stage started from outside runs, so the run can go on from there", () => {
    const { repo, session, outside } = boundRepo();

    assertSilent(runGate(stage(outside, session, CONFIG)));

    assert.equal(repo.ledger().stage.name, CONFIG);
  });

  test("a file outside the run can still be written", () => {
    const { session, outside } = boundRepo();

    assertSilent(runGate(write(outside, session, join(outside, "notes.txt"))));
  });

  test("another session's mode from outside changes nothing", () => {
    const repo = makeRepo();
    bindSession(repo);
    const other = bindSession(repo);
    const outside = makeDir("binding-outside-");

    assertSilent(runGate(bash(outside, other, "ls", "auto")));

    assert.equal(repo.ledger().policy.mode, "default");
  });

  test("another session is still held to the run from outside", () => {
    const repo = makeRepo();
    bindSession(repo);
    const other = bindSession(repo);

    assertDenied(runGate(agent(makeDir("binding-outside-"), other)), /Direct Agent call/);
  });

  test("the cwd wins over the pointer when it finds another run", () => {
    const { session } = boundRepo();
    const nearer = makeRepo({ ledger: { stage: { name: CONFIG, status: "active", runId: "wf_1", attempt: 1, startedAt: null } } });

    assertDenied(runGate(stage(nearer.dir, session, SAFETY_NET)), /Stage code-config is active/);
  });

  test("a hook that cannot load the run-root module still denies a bound session", () => {
    const { session, outside } = boundRepo();
    const plugin = makeDir("binding-partial-");
    mkdirSync(join(plugin, "hooks"));
    copyFileSync(GATE, join(plugin, "hooks", "gate.mjs"));
    cpSync(join(ROOT, "shared-node"), join(plugin, "shared-node"), { recursive: true });
    rmSync(join(plugin, "shared-node", "run-root.mjs"));

    const decision = decisionOf(runGate(bash(outside, session, "ls"), { gate: join(plugin, "hooks", "gate.mjs") }));

    assert.equal(decision?.permissionDecision, "deny");
  });

  test("a gate.mjs that does not parse still denies a bound session outside its run", () => {
    const { session, outside } = boundRepo();
    const plugin = makeDir("binding-boot-");
    cpSync(join(ROOT, "hooks"), join(plugin, "hooks"), { recursive: true });
    appendFileSync(join(plugin, "hooks", "gate.mjs"), "\n)broken(\n");

    const decision = decisionOf(runGate(bash(outside, session, "ls"), { gate: join(plugin, "hooks", "gate-boot.mjs") }));

    assert.equal(decision?.permissionDecision, "deny");
  });

  test("a Write to the session's pointer is denied during a run", () => {
    const { repo, session } = boundRepo();

    assertDenied(runGate(write(repo.dir, session, pointerPath(session))), /pairingbuddy-sessions/);
  });
});

// ---------- when the pointer does not apply ----------

describe("with no usable pointer the call stays outside any run", () => {
  test("a session never seen inside a run gets no decision", () => {
    makeRepo();

    assertSilent(runGate(agent(makeDir("binding-outside-"), newSession())));
  });

  test("a pointer whose run has ended gets no decision", () => {
    const { repo, session, outside } = boundRepo();
    rmSync(join(repo.dir, ".pairingbuddy", "run"), { recursive: true });

    assertSilent(runGate(agent(outside, session)));
  });

  test("a pointer at a repository that is gone gets no decision", () => {
    const { repo, session, outside } = boundRepo();
    rmSync(repo.dir, { recursive: true });

    assertSilent(runGate(agent(outside, session)));
  });

  for (const [label, contents] of [["a relative path", ".pairingbuddy"], ["no text", ""], ["garbage", "\0\0"]]) {
    test(`a pointer holding ${label} gets no decision`, () => {
      const { session, outside } = boundRepo();
      writeFileSync(pointerPath(session), contents);

      assertSilent(runGate(agent(outside, session)));
    });
  }

  test("a pointer that is a directory gets no decision", () => {
    const { session, outside } = boundRepo();
    rmSync(pointerPath(session));
    mkdirSync(pointerPath(session));

    assertSilent(runGate(agent(outside, session)));
  });
});

// ---------- the tap ----------

// The question gate eval issued for the pending gate, as the ledger stores it.
const pending = (gate, reason) => ({ gate, reason, seq: 1, question: gateQuestion(gate, { reason }) });

function questionAnswer(cwd, session, gate, answer) {
  const recorded = fixture("posttooluse-askuserquestion.json");
  const asked = gateQuestion(gate, { reason: "asked" });
  const response = { ...recorded.tool_input, questions: [asked], answers: { [asked.question]: answer } };
  return { ...recorded, session_id: session, cwd, tool_input: response, tool_response: response };
}

describe("the tap uses the same lookup", () => {
  test("a human's answer from outside is recorded", () => {
    const { repo, session, outside } = boundRepo(allDoneLedger({ needsHuman: pending(TASK_END, "asked") }));

    runTap(questionAnswer(outside, session, TASK_END, "approve"));

    assert.deepEqual(repo.ledger().gates[TASK_END], { source: "human", answer: "approve" });
    assert.equal(repo.ledger().needsHuman, null);
  });

  test("a Workflow runId from outside is recorded", () => {
    const { repo, session, outside } = boundRepo();
    assertSilent(runGate(stage(outside, session, CONFIG)));
    const payload = { ...fixture("posttooluse-workflow.json"), session_id: session, cwd: outside };
    payload.tool_input = { ...payload.tool_input, name: `pairingbuddy:${CONFIG}`, args: { attempt: 1 } };

    runTap(payload);

    assert.equal(repo.ledger().stage.runId, payload.tool_response.runId);
  });

  test("a structured return from outside lands in the run's artifacts", () => {
    const { repo, session, outside } = boundRepo({ stage: { name: CONFIG, status: "active", runId: "wf_1", attempt: 1, startedAt: null } });
    const pbKey = buildKey({ stage: CONFIG, role: "worker", item: "t1", round: 1, attempt: 1 });
    const payload = { ...fixture("posttooluse-structuredoutput.json"), agent_type: "pairingbuddy:worker", session_id: session, cwd: outside, tool_input: { pb_key: pbKey } };

    runTap(payload);

    assert.equal(existsSync(join(repo.taskDir, "artifacts", `${pbKey}.json`)), true);
  });

  test("an unbound session from outside reaches no run", () => {
    const repo = makeRepo({ ledger: allDoneLedger({ needsHuman: pending(TASK_END, "asked") }) });

    runTap(questionAnswer(makeDir("binding-outside-"), newSession(), TASK_END, "approve"));

    assert.equal(repo.ledger().needsHuman?.gate, TASK_END);
  });
});

// ---------- the printed command ----------

function printedCommand(repo) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, "gate", "eval"], { cwd: repo.dir, env: hookEnv(), encoding: "utf8" });
  assert.equal(status, 0, stderr);
  return JSON.parse(stdout).humanCommand;
}

function runPrinted(command, cwd) {
  assert.equal(command[0], "!", "the human types it with its !");
  return spawnSync("sh", ["-c", command.slice(1)], { cwd, env: hookEnv(), encoding: "utf8" });
}

describe("the printed ! command works from anywhere", () => {
  test("it starts with a cd into the run root", () => {
    const repo = makeRepo({ ledger: allDoneLedger() });

    assert.equal(printedCommand(repo), `!cd ${repo.dir} && node ${CLI} human approve ${TASK_END}`);
  });

  test("run as printed from outside the run it passes the gate", () => {
    const repo = makeRepo({ ledger: allDoneLedger() });
    const command = printedCommand(repo);

    const result = runPrinted(command, makeDir("binding-outside-"));

    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.ledger().gates[TASK_END]?.source, "human-cli");
  });

  test("a run root holding a space and a quote still works as printed", () => {
    const repo = makeRepo({ ledger: allDoneLedger(), parent: join(makeDir("binding-parent-"), "it's a repo") });
    const command = printedCommand(repo);

    const result = runPrinted(command, makeDir("binding-outside-"));

    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.ledger().gates[TASK_END]?.source, "human-cli");
  });

  test("the same command pasted by the model is denied, from outside too", () => {
    const { repo, session, outside } = boundRepo(allDoneLedger());
    const command = printedCommand(repo);

    assertDenied(runGate(bash(outside, session, command)), /human alone/);
  });
});
