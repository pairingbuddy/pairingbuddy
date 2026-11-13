import "./isolated-tmpdir.mjs";
// T1d: the Stop, SessionStart and compact hooks tell a turn what comes next. Every test drives the real hook as a
// subprocess against a temp repo, with the Stop payload recorded by probe P5.
import { INTAKE_DONE, withIntake } from "./ledger-fixture.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, updateLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { COMMIT_FAILED, HUMAN_STOPPED } from "../../shared-node/verbs.mjs";
import { runReport } from "../../shared-node/next-action.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const hook = (name) => join(ROOT, "hooks", name);
const STOP_PAYLOAD = JSON.parse(readFileSync(join(ROOT, "tests", "probes", "fixtures", "payloads", "stop.json"), "utf8"));

const CONFIG = "code-config";
const SAFETY_NET = "code-safety-net";
const TASK_END = "G:task-end";
const CONFIG_TEXT = '{"runners":{}}\n';
const IDLE = { name: "", status: "", runId: null, attempt: 0, startedAt: null };
const ACTIVE = { name: CONFIG, status: "active", runId: "wf_1", attempt: 1, startedAt: null };
const secondsAgo = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
const STRANDED = { ...ACTIVE, runId: null, startedAt: secondsAgo(3600) };
const STOP = { reason: "hook refused the commit", seq: 1, code: COMMIT_FAILED };
const OWNED = (sessionId) => ({ owner: { sessionId, lastSeen: "2026-11-02T00:00:00Z" } });
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
  return withIntake({
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "T38",
    plan: { path: "", title: "" }, configHash: createHash("sha256").update(CONFIG_TEXT).digest("hex"),
    policy: { mode: "", source: "" }, stage: IDLE, stages: [],
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
    ...over,
  });
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

const stopReason = (stdout) => JSON.parse(stdout).reason;

// ---------- a run reached through the real gate and CLI ----------

const TASK = 'Set "port" to 9090';
const REAL_CONFIG = `${JSON.stringify({ runners: { node: { command: "node --version", test_directory: ".", run_args: [] } }, default_runner: "node" })}\n`;
const CLI_ENV = () => {
  const { PAIRINGBUDDY_SOLO: _solo, CLAUDE_PLUGIN_ROOT: _root, ...env } = process.env;
  return env;
};

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

const pb = (cwd, ...args) => spawnSync("node", [join(ROOT, "cli", "pb.mjs"), ...args], { cwd, encoding: "utf8", env: CLI_ENV() });

function openRealRun() {
  const dir = makeDir();
  git(dir, "init", "-q", "-b", "feature/x");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  mkdirSync(join(dir, ".pairingbuddy"));
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), REAL_CONFIG);
  writeFileSync(join(dir, ".pairingbuddy", "task.json"), JSON.stringify({ description: TASK }));
  const opened = pb(dir, "run", "open", "--kind", "code");
  assert.equal(opened.status, 0, opened.stderr);
  const ledgerPath = join(dir, ".pairingbuddy", "run", "task", "ledger.json");
  // Intake is done and G:type passed, so the run starts at the stage these tests drive.
  updateLedger(ledgerPath, withIntake);
  return { dir, ledgerPath };
}

function gate(cwd, tool, toolInput, session = "stop-session") {
  const payload = { session_id: session, cwd, tool_name: tool, permission_mode: "default", tool_input: toolInput };
  const r = spawnSync("node", [hook("gate-boot.mjs")], { input: JSON.stringify(payload), cwd, encoding: "utf8", env: { ...CLI_ENV(), CLAUDE_PLUGIN_ROOT: ROOT } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === "" ? null : JSON.parse(r.stdout).hookSpecificOutput;
}

const startCall = (attempt = 1) => ({ name: `pairingbuddy:${CONFIG}`, args: { attempt, pluginRoot: ROOT, task: { description: TASK } } });

// The args a model would copy out of the text. The gate takes them or it does not.
const argsIn = (text) => JSON.parse(text.match(/with the args (\{.*\})\./)[1]);

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

  test("stays silent while a stage runs", () => {
    assert.equal(stop(makeRun({ stage: ACTIVE }).dir), "");
  });

  test("stays silent over a stage whose start lease still runs", () => {
    assert.equal(stop(makeRun({ stage: { ...STRANDED, startedAt: secondsAgo(1) } }).dir), "");
  });

  test("stays silent with run/unit.json and no task, which has no action to give", () => {
    const dir = makeDir();
    mkdirSync(join(dir, ".pairingbuddy", "run"), { recursive: true });
    writeFileSync(join(dir, ".pairingbuddy", "run", "unit.json"), "{}");
    assert.equal(stop(dir), "");
  });

  test("a stop with a stage active is told, with its reason and what clears it", () => {
    const stdout = stop(makeRun({ stage: ACTIVE, stop: STOP }).dir);
    assertBlocks(stdout, /hook refused the commit/);
    assertBlocks(stdout, /node \S*cli\/pb\.mjs stage fail/);
    assert.doesNotMatch(stopReason(stdout), /Wait for its workflow/);
  });

  test("the stop stage finish really raises is told, here and at SessionStart", () => {
    const { dir, ledgerPath } = openRealRun();
    assert.equal(gate(dir, "Workflow", startCall()), null);
    assert.equal(pb(dir, "stage", "finish").status, 1);
    assert.equal(readLedger(ledgerPath).stage.status, "active", "the stage is still active");

    assertBlocks(stop(dir), /The run has stopped: stage code-config cannot finish/);
    const context = sessionStart(dir, "resume");
    assert.match(context, /Next action: The run has stopped/);
    assert.doesNotMatch(context, /Wait for its workflow/);
  });

  test("a stage that never started is told once its lease is gone, and the gate takes the restart it gives", () => {
    const { dir, ledgerPath } = openRealRun();
    assert.equal(gate(dir, "Workflow", startCall()), null);
    assert.equal(stop(dir), "", "inside the lease");
    updateLedger(ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, startedAt: secondsAgo(3600) } }));

    const stdout = stop(dir);
    assertBlocks(stdout, /pairingbuddy:code-config/);
    assertBlocks(stdout, /node \S*cli\/pb\.mjs stage fail/);
    assert.doesNotMatch(stopReason(stdout), /Wait for its workflow/);
    assert.deepEqual(argsIn(stopReason(stdout)), startCall().args);
    assert.equal(gate(dir, "Workflow", { name: `pairingbuddy:${CONFIG}`, args: argsIn(stopReason(stdout)) }), null);
  });

  test("a stage past its lease with a recorded run stays silent", () => {
    assert.equal(stop(makeRun({ stage: { ...ACTIVE, startedAt: secondsAgo(3600) } }).dir), "");
  });

  for (const permission_mode of ["auto", "default", "acceptEdits", "bypassPermissions", "plan"]) {
    test(`gives the next stage in ${permission_mode} mode`, () => {
      assertBlocks(stop(makeRun().dir, { permission_mode }), /pairingbuddy:code-config.*"attempt":1,"pluginRoot":".*","task":\{"description"/);
    });
  }

  test("Solo stays silent, because it stays on the old path", () => {
    const env = { PAIRINGBUDDY_SOLO: "true", PAIRINGBUDDY_GATE_POLICY: "auto" };
    assert.equal(stop(makeRun().dir, {}, { env }), "");
    assert.equal(stop(makeRun({ stop: STOP }).dir, {}, { env }), "");
  });

  test("the auto policy alone is not Solo, and PAIRINGBUDDY_SOLO=false is not either", () => {
    assertBlocks(stop(makeRun().dir, {}, { env: { PAIRINGBUDDY_GATE_POLICY: "auto" } }), /pairingbuddy:code-config/);
    assertBlocks(stop(makeRun().dir, {}, { env: { PAIRINGBUDDY_SOLO: "false" } }), /pairingbuddy:code-config/);
  });

  test("the next stage carries the real task from the ledger, as JSON", () => {
    const { dir } = openRealRun();
    const reason = stopReason(stop(dir));
    assert.deepEqual(argsIn(reason), startCall().args);
    assert.doesNotMatch(reason, /<[^>]*task[^>]*>/);
    assert.equal(gate(dir, "Workflow", { name: `pairingbuddy:${CONFIG}`, args: argsIn(reason) }), null);
  });

  test("a run that stored no task says so, with no placeholder and no task in the args", () => {
    const reason = stopReason(stop(makeRun({ task: "" }).dir));
    assert.doesNotMatch(reason, /<[^>]*>/);
    assert.equal(argsIn(reason).task, undefined);
    assert.match(reason, /no task/);
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

  test("a stop comes before a gate waiting on the human", () => {
    const needsHuman = { gate: TASK_END, reason: "permission mode is default", seq: 1 };
    const stdout = stop(makeRun(allDone({ needsHuman, stop: STOP })).dir);
    assertBlocks(stdout, /The run has stopped: hook refused the commit/);
    assert.doesNotMatch(stopReason(stdout), /needs the human/);
  });

  test("a stop gives its reason and no way past it", () => {
    const stdout = stop(makeRun(allDone({ stop: STOP })).dir);
    assertBlocks(stdout, /hook refused the commit/);
    assert.doesNotMatch(JSON.parse(stdout).reason, /task end|pairingbuddy:code/);
  });

  test("a human's stop sends the model to the human", () => {
    const gates = { [TASK_END]: { source: "human", answer: "stop" } };
    const stdout = stop(makeRun(allDone({ gates, stop: { reason: "the human answered stop", seq: 1, code: HUMAN_STOPPED } })).dir);
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
    updateLedger(ledgerPath, (ledger) => ({ ...ledger, stages: [INTAKE_DONE, { name: CONFIG, status: "done" }] }));
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
    writeFileSync(join(taskDir, "stop-notice-stop-session.json"), JSON.stringify({ action: "old", chain: 1000 }));
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

  test("a second session is told what the first was told while the run has no owner", () => {
    const { dir } = makeRun();
    assertBlocks(stop(dir, { session_id: newSession() }), /code-config/);
    assertBlocks(stop(dir, { session_id: newSession() }), /code-config/);
  });

  test("two sessions cannot erase each other's memory: alternating, each is told once", () => {
    const { dir } = makeRun();
    const [first, second] = [newSession(), newSession()];
    const told = [];
    for (let i = 0; i < 12; i += 1) told.push(stop(dir, { session_id: i % 2 === 0 ? first : second, stop_hook_active: true }));
    assert.equal(told.filter((stdout) => stdout !== "").length, 2);
  });

  test("two sessions on one owned run: the owner is told once, the other never", () => {
    const owner = newSession();
    const { dir } = makeRun(OWNED(owner));
    const other = newSession();
    const told = [];
    for (let i = 0; i < 12; i += 1) told.push(stop(dir, { session_id: i % 2 === 0 ? owner : other, stop_hook_active: true }));
    assert.equal(told.filter((stdout) => stdout !== "").length, 1);
    assert.notEqual(told[0], "", "the owner went first and was told");
  });

  test("a session that does not own the run is told nothing, whatever the action", () => {
    for (const ledger of [{}, { stop: STOP }, allDone(), { stage: STRANDED }]) {
      assert.equal(stop(makeRun({ ...OWNED("the-owner"), ...ledger }).dir, { session_id: newSession() }), "");
    }
  });

  test("the session that owns the run is told", () => {
    const owner = newSession();
    assertBlocks(stop(makeRun(OWNED(owner)).dir, { session_id: owner }), /code-config/);
  });

  test("a ledger that cannot be read has no owner to go by, so it is told", () => {
    const { dir, ledgerPath } = makeRun(OWNED("the-owner"));
    writeFileSync(ledgerPath, "{");
    assertBlocks(stop(dir, { session_id: newSession() }), /cannot be read/);
  });
});

describe("hooks run from anywhere", () => {
  test("Stop reads the payload's cwd, not its own", () => {
    const { dir } = makeRun();
    const input = JSON.stringify({ ...STOP_PAYLOAD, cwd: dir, session_id: newSession() });
    assertBlocks(runHook("stop.mjs", { input, cwd: makeDir() }), /code-config/);
  });

  test("Stop falls back to its own cwd on a relative one", () => {
    const { dir } = makeRun();
    const input = JSON.stringify({ ...STOP_PAYLOAD, cwd: "not/absolute", session_id: newSession() });
    assert.ok(stopReason(runHook("stop.mjs", { input, cwd: dir })).startsWith(`Pairing Buddy run at ${dir}.`));
  });

  test("SessionStart reads the payload's cwd, not its own", () => {
    const { dir } = makeRun();
    const input = JSON.stringify({ session_id: newSession(), cwd: dir, source: "startup" });
    assert.ok(JSON.parse(runHook("session-start.mjs", { input, cwd: makeDir() })).hookSpecificOutput.additionalContext.includes(`A Pairing Buddy run is open at ${dir}.`));
  });

  test("SessionStart falls back to its own cwd on a relative one", () => {
    const { dir } = makeRun();
    const input = JSON.stringify({ session_id: newSession(), cwd: "not/absolute", source: "startup" });
    assert.ok(JSON.parse(runHook("session-start.mjs", { input, cwd: dir })).hookSpecificOutput.additionalContext.includes(`A Pairing Buddy run is open at ${dir}.`));
  });

  test("the guardian reads the payload's cwd, not its own", () => {
    const { dir } = makeRun();
    const input = JSON.stringify({ session_id: newSession(), cwd: dir, hook_event_name: "PostToolUse", tool_name: "Read" });
    assert.match(JSON.parse(runHook("guardian.mjs", { input, cwd: makeDir() })).hookSpecificOutput.additionalContext, /run is open/);
  });

  test("the guardian falls back to its own cwd on a relative one", () => {
    const { dir } = makeRun();
    const input = JSON.stringify({ session_id: newSession(), cwd: "not/absolute", hook_event_name: "PostToolUse", tool_name: "Read" });
    const context = JSON.parse(runHook("guardian.mjs", { input, cwd: dir, args: ["always"] })).hookSpecificOutput.additionalContext;
    assert.ok(context.includes(`A Pairing Buddy run is open at ${dir}.`));
  });

  test("a plugin path with a space comes out as one shell word in the text a model runs", () => {
    const plugin = join(makeDir(), "with space");
    for (const part of ["hooks", "shared-node", "cli", "contracts"]) cpSync(join(ROOT, part), join(plugin, part), { recursive: true });
    const { dir } = makeRun(allDone());
    const input = JSON.stringify({ ...STOP_PAYLOAD, cwd: dir, session_id: newSession() });
    const r = spawnSync("node", [join(plugin, "hooks", "stop.mjs")], { cwd: dir, input, encoding: "utf8", env: { ...process.env, PAIRINGBUDDY_SOLO: "" } });
    assert.ok(stopReason(r.stdout).includes(`node '${join(plugin, "cli", "pb.mjs")}' gate eval`), r.stdout);
  });
});

function sessionStart(cwd, source, sessionId = newSession()) {
  const input = JSON.stringify({ session_id: sessionId, cwd, hook_event_name: "SessionStart", source });
  return JSON.parse(runHook("session-start.mjs", { input, cwd })).hookSpecificOutput.additionalContext;
}

describe("SessionStart hook", () => {
  for (const source of ["startup", "resume", "clear"]) {
    test(`reports open run state on ${source}`, () => {
      const { dir } = makeRun({ stop: STOP });
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

  test("still injects the skill on a payload of null", () => {
    assert.match(JSON.parse(runHook("session-start.mjs", { input: "null", cwd: makeRun().dir })).hookSpecificOutput.additionalContext, /You have pairingbuddy/);
  });

  test("a ledger it cannot read gets no status line", () => {
    const { dir, ledgerPath } = makeRun();
    writeFileSync(ledgerPath, "{");
    assert.doesNotMatch(sessionStart(dir, "startup"), /pb status:/);
  });

  test("run/unit.json with no task reports that no task is open", () => {
    const dir = makeDir();
    mkdirSync(join(dir, ".pairingbuddy", "run"), { recursive: true });
    writeFileSync(join(dir, ".pairingbuddy", "run", "unit.json"), "{}");
    const context = sessionStart(dir, "startup");
    assert.match(context, /Next action: No task is open\./);
    assert.doesNotMatch(context, /pb status:/);
  });
});

const STAGE_AGENT = { agent_id: "a1", agent_type: "pairingbuddy:apply-config-change" };

function guardian(cwd, { args = [], env = {}, session = newSession(), over = {} } = {}) {
  const input = JSON.stringify({ session_id: session, cwd, hook_event_name: "PostToolUse", tool_name: "Read", ...over });
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

  test("gives a stage's agent nothing, because the run reminder is the main context's", () => {
    assert.equal(guardian(makeRun().dir, { over: STAGE_AGENT }), "");
    assert.equal(guardian(makeRun().dir, { over: STAGE_AGENT, env: { PAIRINGBUDDY_SOLO: "true" } }), "");
  });

  test("a stage agent's call leaves the main context's timer alone", () => {
    const { dir } = makeRun();
    const session = newSession();
    guardian(dir, { session, over: STAGE_AGENT });
    assert.match(guardian(dir, { session }), /run is open/);
  });

  test("a subagent with no run state keeps the plain reminder", () => {
    assert.ok(guardian(makeDir(), { over: STAGE_AGENT }).includes(GUARDIAN_TEXT));
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

  test("pb status --action gives the same next action, plugin root included", () => {
    const { dir } = makeRun();
    const context = guardian(dir, { args: ["always"] });
    const printed = spawnSync("node", [join(ROOT, "cli", "pb.mjs"), "status", "--action"], { cwd: dir, encoding: "utf8" });
    assert.ok(context.includes(`Next action: ${JSON.parse(printed.stdout).action}`));
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

// Scenario session-start-adoption-line: a session that does not own the run is told who does and how to adopt it; the owner and an unowned run get no such line.
describe("session-start-adoption-line", () => {
  test("other-session-gets-adoption-line", () => {
    const run = OWNED("session-A");
    const { dir } = makeRun(run);

    const context = sessionStart(dir, "resume");

    const lines = context.split("\n").filter((line) => line.includes("session-A"));
    assert.equal(lines.length, 1, context);
    assert.ok(lines[0].includes(run.owner.lastSeen), lines[0]);
    assert.match(lines[0], /must not drive/, lines[0]);
    assert.match(lines[0], /human adopt/, lines[0]);
  });

  test("owner-and-unowned-run-get-no-adoption-line", () => {
    const owner = newSession();
    const owned = makeRun(OWNED(owner)).dir;
    const unowned = makeRun().dir;

    const ownerContext = sessionStart(owned, "resume", owner);
    const unownedContext = sessionStart(unowned, "resume");

    assert.doesNotMatch(ownerContext, /human adopt/, ownerContext);
    assert.ok(!ownerContext.includes(owner), ownerContext);
    assert.doesNotMatch(ownerContext, /must not drive/, ownerContext);
    assert.doesNotMatch(unownedContext, /human adopt/, unownedContext);
    assert.doesNotMatch(unownedContext, /must not drive/, unownedContext);
  });

  test("run-report-without-session-id-has-no-adoption-line", () => {
    const report = runReport({ root: "/some/root", owner: "session-A", lastSeen: "2026-11-02T00:00:00Z", status: null, action: "Do the thing." });

    assert.doesNotMatch(report, /human adopt/, report);
    assert.doesNotMatch(report, /must not drive/, report);
    assert.ok(!report.includes("session-A"), report);
  });
});
