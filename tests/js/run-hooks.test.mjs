import "./isolated-tmpdir.mjs";
// T1d: the Stop, SessionStart and compact hooks tell a turn what comes next. Every test drives the real hook as a
// subprocess against a temp repo, with the Stop payload recorded by probe P5.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, updateLedger, writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const hook = (name) => join(ROOT, "hooks", name);
const STOP_PAYLOAD = JSON.parse(readFileSync(join(ROOT, "tests", "probes", "fixtures", "payloads", "stop.json"), "utf8"));

const CONFIG = "code-config";
const SAFETY_NET = "code-safety-net";
const TASK_END = "G:task-end";
const CONFIG_TEXT = '{"runners":{}}\n';
const IDLE = { name: "", status: "", runId: null, attempt: 0, startedAt: null };
const ACTIVE = { name: CONFIG, status: "active", runId: "wf_1", attempt: 1, startedAt: null };
const GUARDIAN_TEXT = "Make sure to follow Pairing Buddy workflows strictly.";

const tempDirs = [];
function makeDir(prefix = "run-hooks-") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeLedger(over) {
  return {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "T38",
    plan: { path: "", title: "" }, configHash: createHash("sha256").update(CONFIG_TEXT).digest("hex"),
    policy: { mode: "", source: "" }, stage: IDLE, stages: [],
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
    ...over,
  };
}

function makeRun(ledger = {}) {
  const dir = makeDir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, makeLedger(ledger));
  return { dir, taskDir, ledgerPath };
}

const allDone = (over = {}) => ({
  stage: { name: SAFETY_NET, status: "done", runId: "wf_2", attempt: 1, startedAt: null },
  stages: [{ name: CONFIG, status: "done" }, { name: SAFETY_NET, status: "done" }],
  ...over,
});

function runHook(file, { input, cwd, args = [], env = {} }) {
  const r = spawnSync("node", [hook(file), ...args], { cwd, input, encoding: "utf8", env: { ...process.env, PAIRINGBUDDY_SOLO: "", ...env } });
  assert.equal(r.status, 0, `${file} exits 0: ${r.stderr}`);
  return r.stdout;
}

let sessions = 0;
const newSession = () => `hook-session-${(sessions += 1)}`;

function stop(cwd, over = {}, opts = {}) {
  const payload = { ...STOP_PAYLOAD, cwd, session_id: "stop-session", ...over };
  return runHook("stop.mjs", { input: JSON.stringify(payload), cwd, ...opts });
}

function assertBlocks(stdout, pattern) {
  const output = JSON.parse(stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, pattern);
}

describe("Stop hook", () => {
  test("is registered for Stop, with the form the probe plugin used", () => {
    const { hooks } = JSON.parse(readFileSync(hook("hooks.json"), "utf8"));
    assert.deepEqual(hooks.Stop, [{ hooks: [{ type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs" }] }]);
  });

  test("stays silent outside a run", () => {
    assert.equal(stop(makeDir()), "");
  });

  test("stays silent over an empty run directory", () => {
    const dir = makeDir();
    mkdirSync(join(dir, ".pairingbuddy", "run"), { recursive: true });
    assert.equal(stop(dir), "");
  });

  test("stays silent while a stage is active, even with a stop set", () => {
    assert.equal(stop(makeRun({ stage: ACTIVE }).dir), "");
    assert.equal(stop(makeRun({ stage: ACTIVE, stop: { reason: "broken", seq: 1 } }).dir), "");
  });

  for (const permission_mode of ["auto", "default", "acceptEdits", "bypassPermissions", "plan"]) {
    test(`gives the next stage in ${permission_mode} mode`, () => {
      assertBlocks(stop(makeRun().dir, { permission_mode }), /pairingbuddy:code-config.*"attempt":1,"pluginRoot":".*","task":\{"description"/);
    });
  }

  test("gives the next stage under Solo's environment too", () => {
    const env = { PAIRINGBUDDY_SOLO: "true", PAIRINGBUDDY_GATE_POLICY: "auto" };
    assertBlocks(stop(makeRun().dir, {}, { env }), /pairingbuddy:code-config/);
  });

  test("a stage sent to a next attempt names that attempt", () => {
    const ledger = { stage: { ...ACTIVE, status: "failed" }, stages: [{ name: CONFIG, status: "failed" }] };
    assertBlocks(stop(makeRun(ledger).dir), /pairingbuddy:code-config.*"attempt":2/);
  });

  test("a due gate comes before anything else", () => {
    assertBlocks(stop(makeRun(allDone()).dir), /node \S*cli\/pb\.mjs gate eval/);
  });

  test("a gate waiting on the human names the command only they run", () => {
    const { dir } = makeRun(allDone({ needsHuman: { gate: TASK_END, reason: "permission mode is default", seq: 1 } }));
    const stdout = stop(dir);
    assertBlocks(stdout, /G:task-end/);
    assertBlocks(stdout, /permission mode is default/);
    assertBlocks(stdout, /human approve G:task-end/);
  });

  test("a stop gives its reason and no way past it", () => {
    const stdout = stop(makeRun(allDone({ stop: { reason: "hook refused the commit", seq: 1 } })).dir);
    assertBlocks(stdout, /hook refused the commit/);
    assert.doesNotMatch(JSON.parse(stdout).reason, /task end|pairingbuddy:code/);
  });

  test("a human's stop sends the model to the human", () => {
    const gates = { [TASK_END]: { source: "human", answer: "stop" } };
    const stdout = stop(makeRun(allDone({ gates, stop: { reason: "the human answered stop", seq: 1 } })).dir);
    assertBlocks(stdout, /human approve G:task-end/);
  });

  test("a finished run says to end the task", () => {
    assertBlocks(stop(makeRun(allDone({ gates: { [TASK_END]: { source: "auto" } } })).dir), /node \S*cli\/pb\.mjs task end/);
  });

  test("finds the run a session left, from any cwd", () => {
    const { dir } = makeRun();
    const session = newSession();
    mkdirSync(join(tmpdir(), "pairingbuddy-sessions"), { recursive: true });
    writeFileSync(join(tmpdir(), "pairingbuddy-sessions", session), dir);
    assertBlocks(stop(makeDir(), { session_id: session }), /pairingbuddy:code-config/);
  });

  test("never writes the ledger", () => {
    const { dir, ledgerPath } = makeRun();
    const before = readFileSync(ledgerPath, "utf8");
    stop(dir);
    assert.equal(readFileSync(ledgerPath, "utf8"), before);
  });

  test("a payload it cannot read gives nothing", () => {
    const { dir } = makeRun();
    assert.equal(runHook("stop.mjs", { input: "not json", cwd: dir }), "");
    assert.equal(runHook("stop.mjs", { input: "null", cwd: dir }), "");
    assert.equal(runHook("stop.mjs", { input: "", cwd: dir }), "");
  });

  test("a ledger edited by hand is reported, not hidden", () => {
    const { dir, ledgerPath } = makeRun();
    writeFileSync(ledgerPath, readFileSync(ledgerPath, "utf8").replace('"task": "T38"', '"task": "edited"'));
    assertBlocks(stop(dir), /human accept/);
  });

  test("a ledger that is not JSON is reported once, and does not throw", () => {
    const { dir, ledgerPath } = makeRun();
    writeFileSync(ledgerPath, "{");
    assertBlocks(stop(dir), /cannot be read/);
    assert.equal(stop(dir, { stop_hook_active: true }), "");
  });
});

describe("Stop hook cannot loop a turn", () => {
  test("the same next action is told once, whatever stop_hook_active says", () => {
    const { dir } = makeRun();
    assertBlocks(stop(dir), /code-config/);
    assert.equal(stop(dir, { stop_hook_active: true }), "");
    assert.equal(stop(dir, { stop_hook_active: true }), "");
    assert.equal(stop(dir, { stop_hook_active: false }), "");
  });

  test("ledger writes that leave the next action alone do not retell it", () => {
    const { dir, ledgerPath } = makeRun();
    stop(dir);
    updateLedger(ledgerPath, (ledger) => ({ ...ledger, owner: { sessionId: "s", lastSeen: "2026-11-02T00:00:00Z" } }));
    updateLedger(ledgerPath, (ledger) => ({ ...ledger, tests: { ...ledger.tests, full: { passed: true } } }));
    assert.equal(stop(dir, { stop_hook_active: true }), "");
  });

  test("a chain goes on while the next action changes, so a multi-stage run stays driven", () => {
    const { dir, ledgerPath } = makeRun();
    assertBlocks(stop(dir), /code-config/);
    updateLedger(ledgerPath, (ledger) => ({ ...ledger, stages: [{ name: CONFIG, status: "done" }] }));
    assertBlocks(stop(dir, { stop_hook_active: true }), /code-safety-net/);
  });

  test("a chain ends at the ceiling even if the action changes every time", () => {
    const { dir, ledgerPath } = makeRun({ stage: { ...ACTIVE, status: "failed" }, stages: [{ name: CONFIG, status: "failed" }] });
    const told = [];
    for (let i = 0; i < 60; i += 1) {
      updateLedger(ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, attempt: ledger.stage.attempt + 1 } }));
      told.push(stop(dir, { stop_hook_active: i > 0 }));
    }
    assert.equal(told.at(-1), "");
    const silent = told.findIndex((stdout) => stdout === "");
    assert.ok(silent > 0, "the first calls still tell");
    assert.ok(told.slice(silent).every((stdout) => stdout === ""), "once silent, the chain stays silent");
  });

  test("a new turn starts a new chain", () => {
    const { dir, taskDir, ledgerPath } = makeRun();
    writeFileSync(join(taskDir, "stop-notice.json"), JSON.stringify({ sessionId: "stop-session", action: "old", chain: 1000 }));
    assert.equal(stop(dir, { stop_hook_active: true }), "");
    assertBlocks(stop(dir, { stop_hook_active: false }), /code-config/);
    assert.ok(existsSync(ledgerPath));
  });

  test("with nowhere to remember, only a fresh turn is told", (t) => {
    const { dir, taskDir } = makeRun();
    chmodSync(taskDir, 0o500);
    t.after(() => chmodSync(taskDir, 0o700));
    assertBlocks(stop(dir, { stop_hook_active: false }), /code-config/);
    assert.equal(stop(dir, { stop_hook_active: true }), "");
  });

  test("a second session is told what the first was told", () => {
    const { dir } = makeRun();
    assertBlocks(stop(dir, { session_id: newSession() }), /code-config/);
    assertBlocks(stop(dir, { session_id: newSession() }), /code-config/);
  });
});

function sessionStart(cwd, source) {
  const input = JSON.stringify({ session_id: newSession(), cwd, hook_event_name: "SessionStart", source });
  return JSON.parse(runHook("session-start.mjs", { input, cwd })).hookSpecificOutput.additionalContext;
}

describe("SessionStart hook", () => {
  for (const source of ["startup", "resume", "clear"]) {
    test(`reports open run state on ${source}`, () => {
      const { dir } = makeRun({ stop: { reason: "hook refused the commit", seq: 1 } });
      const context = sessionStart(dir, source);
      assert.match(context, /You have pairingbuddy/);
      assert.ok(context.includes(dir));
      assert.match(context, /hook refused the commit/);
    });
  }

  test("reports the active stage, and how to clear a stranded one", () => {
    const context = sessionStart(makeRun({ stage: ACTIVE }).dir, "resume");
    assert.match(context, /code-config/);
    assert.match(context, /cli\/pb\.mjs stage fail/);
  });

  test("adds nothing outside a run", () => {
    const context = sessionStart(makeDir(), "startup");
    assert.match(context, /You have pairingbuddy/);
    assert.doesNotMatch(context, /<pairingbuddy-run>/);
  });

  test("leaves a compaction to the compact hook, so the report is not injected twice", () => {
    assert.doesNotMatch(sessionStart(makeRun().dir, "compact"), /<pairingbuddy-run>/);
  });

  test("still injects the skill with no payload, or a ledger it cannot read", () => {
    const { dir, ledgerPath } = makeRun();
    assert.match(JSON.parse(runHook("session-start.mjs", { input: "", cwd: dir })).hookSpecificOutput.additionalContext, /You have pairingbuddy/);
    writeFileSync(ledgerPath, "{");
    assert.match(sessionStart(dir, "startup"), /cannot be read/);
  });
});

function guardian(cwd, { args = [], env = {}, session = newSession() } = {}) {
  const input = JSON.stringify({ session_id: session, cwd, hook_event_name: "PostToolUse", tool_name: "Read" });
  return JSON.parse(runHook("guardian.mjs", { input, cwd, args, env })).hookSpecificOutput.additionalContext;
}

describe("guardian", () => {
  test("keeps its text with no run state, on a timer and after compaction", () => {
    for (const args of [[], ["always"]]) {
      const context = guardian(makeDir(), { args });
      assert.ok(context.includes(GUARDIAN_TEXT));
      assert.doesNotMatch(context, /run is open/);
    }
  });

  test("an empty run directory is no run state", () => {
    const dir = makeDir();
    mkdirSync(join(dir, ".pairingbuddy", "run"), { recursive: true });
    assert.ok(guardian(dir).includes(GUARDIAN_TEXT));
  });

  test("rewords the timer reminder when run state exists", () => {
    const context = guardian(makeRun().dir);
    assert.ok(!context.includes(GUARDIAN_TEXT));
    assert.match(context, /run is open/);
    assert.match(context, /^<pairingbuddy-guardian>/);
  });

  test("keeps Solo's additions when run state exists", () => {
    assert.match(guardian(makeRun().dir, { env: { PAIRINGBUDDY_SOLO: "true" } }), /SOLO MODE/);
  });

  test("injects nothing between timer intervals, run or not", () => {
    const { dir } = makeRun();
    const session = newSession();
    assert.notEqual(guardian(dir, { session }), "");
    assert.equal(guardian(dir, { session }), "");
  });

  test("after compaction injects pb status and the next action in place of the reminder", () => {
    const { dir } = makeRun({ spend: { agents: 7, tokens: 0 } });
    const context = guardian(dir, { args: ["always"] });
    assert.ok(!context.includes(GUARDIAN_TEXT));
    assert.match(context, /pairingbuddy:code-config.*"attempt":1,"pluginRoot":".*","task":\{"description"/);
    const status = JSON.parse(context.match(/pb status: (\{.*\})/)[1]);
    assert.deepEqual(status.next, { stage: CONFIG, attempt: 1 });
    assert.equal(status.spend.task.agents, 7);
  });

  test("after compaction with an active stage says so", () => {
    assert.match(guardian(makeRun({ stage: ACTIVE }).dir, { args: ["always"] }), /Stage code-config is active/);
  });

  test("the compact status is what pb status prints", () => {
    const { dir } = makeRun();
    const context = guardian(dir, { args: ["always"] });
    const printed = spawnSync("node", [join(ROOT, "cli", "pb.mjs"), "status"], { cwd: dir, encoding: "utf8" });
    const { ok, ...status } = JSON.parse(printed.stdout);
    assert.equal(ok, true);
    assert.deepEqual(JSON.parse(context.match(/pb status: (\{.*\})/)[1]), status);
  });

  test("with a ledger it cannot read, after compaction it still answers", () => {
    const { dir, ledgerPath } = makeRun();
    writeFileSync(ledgerPath, "{");
    assert.match(guardian(dir, { args: ["always"] }), /cannot be read/);
  });

  test("the hooks read the ledger and leave it alone", () => {
    const { dir, ledgerPath } = makeRun();
    guardian(dir, { args: ["always"] });
    sessionStart(dir, "startup");
    assert.equal(readLedger(ledgerPath).seq, 1);
  });
});
