import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { graphFor, loadStages, pipelineAgents, START_LEASE_SECONDS, validateStages } from "../../shared-node/stages.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const GATE = join(ROOT, "hooks", "gate.mjs");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");
const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));

const CONFIG = "code-config";
const SAFETY_NET = "code-safety-net";
const workflowName = (stage) => `pairingbuddy:${stage}`;
const BUNDLE_PATH = join(ROOT, "workflows", `${CONFIG}.js`);
const BUNDLE = readFileSync(BUNDLE_PATH, "utf8");
const SAFETY_NET_BUNDLE = "export const meta = { name: 'code-safety-net' };\n";
const GOOD_ARGS = { pluginRoot: ROOT, attempt: 1 };

// Deny mechanism: exit 0 with the JSON form the P1 probe proved, reason in permissionDecisionReason.
// Allow: exit 0, nothing on stdout or stderr.
const MESSAGES = {
  order: (called, next) => `Stage order: ${called} cannot start now. The next stage is ${next}.`,
  allDone: (called) => `Stage order: ${called} cannot start now. All stages for config_change are done.`,
  secondActive: (stage, attempt, called) => `Stage ${stage} is active at attempt ${attempt}. Wait for it to finish before starting ${called}.`,
  withinLease: (stage, attempt, called, seconds) => `${MESSAGES.secondActive(stage, attempt, called)} It has no recorded run yet: ${seconds} seconds remain on its start lease.`,
  neverStarted: (stage, attempt, called) => `Stage ${stage} is active at attempt ${attempt} with no recorded run, so it may never have started. Restart ${workflowName(stage)} at attempt ${attempt} before starting ${called}.`,
  missingBundle: (workflow, bundle) => `Cannot start ${workflow}: its built bundle ${bundle} is missing.`,
  byName: (stage) => `Stage ${stage} cannot run under another name or none. Call ${workflowName(stage)} by name.`,
  unreadable: (path, position) => `Script file ${path} could not be read. ${position}`,
  attempt: (workflow, got, right) => `Wrong attempt for ${workflow}: got ${JSON.stringify(got)}. Use attempt ${right}.`,
  pluginRoot: (workflow, got) => `Wrong pluginRoot for ${workflow}: got ${JSON.stringify(got)}. Use pluginRoot ${ROOT}.`,
  script: (workflow, bundle) => `Script for ${workflow} does not match the built bundle ${bundle}. Call ${workflow} by name with no script.`,
  inline: (next) => `Inline script containing pairingbuddy: is denied. The next stage is ${next}: call it by name.`,
  inlineActive: (stage, attempt) => `Inline script containing pairingbuddy: is denied. Stage ${stage} is active at attempt ${attempt}.`,
  inlineAllDone: () => "Inline script containing pairingbuddy: is denied. All stages for config_change are done.",
  agent: (agent, stage) => `Direct Agent call for ${agent} is denied during stage ${stage}. Start the workflow ${workflowName(stage)} instead.`,
  agentNext: (agent, next) => `Direct Agent call for ${agent} is denied during this run. Start the workflow ${next} instead.`,
  agentAllDone: (agent) => `Direct Agent call for ${agent} is denied during this run. All stages for config_change are done.`,
};

const secondsAgo = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
const EXPIRED = "2026-01-01T00:00:00.000Z";

const IDLE_STAGE = { name: "", status: "", runId: null, attempt: 0, startedAt: null };
const activeStage = (name, attempt = 1, startedAt = EXPIRED) => ({ name, status: "active", runId: "wf_1", attempt, startedAt });
// An active stage with no recorded run. By default its start lease has long expired.
const unstartedStage = (name, attempt = 1, startedAt = EXPIRED) => ({ name, status: "active", runId: null, attempt, startedAt });

function makeLedger({ stage = IDLE_STAGE, stages = [] } = {}) {
  return {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "Task 23",
    plan: { path: "", title: "" }, configHash: "a".repeat(64),
    policy: { mode: "", source: "" }, stage, stages,
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
  };
}

const CONFIG_DONE = {
  stage: { name: CONFIG, status: "done", runId: "wf_1", attempt: 1 },
  stages: [{ name: CONFIG, status: "done" }],
};
const ALL_DONE = {
  stage: { name: SAFETY_NET, status: "done", runId: "wf_2", attempt: 1 },
  stages: [{ name: CONFIG, status: "done" }, { name: SAFETY_NET, status: "done" }],
};
const CONFIG_FAILED = {
  stage: { name: CONFIG, status: "failed", runId: "wf_1", attempt: 1 },
  stages: [{ name: CONFIG, status: "failed" }],
};

function makeRepo({ ledger = makeLedger(), git = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-")));
  if (git) execFileSync("git", ["init", "-q"], { cwd: dir });
  const ledgerPath = join(dir, ".pairingbuddy", "run", "task", "ledger.json");
  if (ledger) {
    mkdirSync(join(dir, ".pairingbuddy", "run", "task"), { recursive: true });
    writeLedger(ledgerPath, ledger);
  }
  return { dir, ledgerPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function withRepo(opts, fn) {
  const repo = makeRepo(opts);
  try {
    await fn(repo);
  } finally {
    repo.cleanup();
  }
}

// A scratch plugin root: the real contracts, plus only the bundles the test names.
function makePlugin({ bundles = { [CONFIG]: BUNDLE, [SAFETY_NET]: SAFETY_NET_BUNDLE }, contract = null } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-plugin-")));
  mkdirSync(join(dir, "contracts"));
  mkdirSync(join(dir, "workflows"));
  copyFileSync(join(ROOT, "contracts", "agent-config.yaml"), join(dir, "contracts", "agent-config.yaml"));
  if (contract) writeFileSync(join(dir, "contracts", "stages.json"), JSON.stringify(contract));
  else copyFileSync(join(ROOT, "contracts", "stages.json"), join(dir, "contracts", "stages.json"));
  for (const [stage, text] of Object.entries(bundles)) writeFileSync(join(dir, "workflows", `${stage}.js`), text);
  return dir;
}

async function withPlugin(opts, fn) {
  const dir = makePlugin(opts);
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// pluginRoot null leaves CLAUDE_PLUGIN_ROOT unset. processCwd is the hook's own cwd, payload.cwd by default.
function runGate(payload, { pluginRoot = ROOT, processCwd = payload.cwd } = {}) {
  const { CLAUDE_PLUGIN_ROOT: _inherited, ...env } = process.env;
  if (pluginRoot !== null) env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  return new Promise((resolve, reject) => {
    const child = spawn("node", [GATE], {
      cwd: processCwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

function workflowCall(cwd, toolInput) {
  return { ...fixture("pretooluse-workflow.json"), cwd, tool_input: toolInput };
}

const stageCall = (cwd, stage, args = GOOD_ARGS, extra = {}) => workflowCall(cwd, { name: workflowName(stage), args, ...extra });

function agentCall(cwd, subagentType) {
  return {
    ...fixture("pretooluse-workflow.json"),
    cwd,
    tool_name: "Agent",
    tool_input: { subagent_type: subagentType, description: "apply the change", prompt: "do it" },
  };
}

function assertAllowed(result) {
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" }, "an allow is silent");
}

// The stage the gate marked, with startedAt stamped at or after `since`.
function assertMarkedActive(stage, name, attempt, since) {
  const { startedAt, ...rest } = stage;
  assert.deepEqual(rest, { name, status: "active", runId: null, attempt });
  assert.equal(new Date(Date.parse(startedAt)).toISOString(), startedAt, "startedAt is an ISO timestamp");
  assert.ok(Date.parse(startedAt) >= since && Date.parse(startedAt) <= Date.now(), `startedAt ${startedAt} is the time of this start`);
}

function assertDenied(result, reason) {
  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });
}

// The seconds remaining depend on how long the hook took, so the reason is matched within a range.
function assertDeniedWithinLease(result, stage, attempt, called, minSeconds, maxSeconds) {
  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const { permissionDecision, permissionDecisionReason: reason } = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(permissionDecision, "deny");
  const seconds = Number(/: (\d+) seconds remain/.exec(reason)?.[1]);
  assert.equal(reason, MESSAGES.withinLease(stage, attempt, called, seconds));
  assert.ok(seconds >= minSeconds && seconds <= maxSeconds, `${seconds} seconds remaining, expected ${minSeconds} to ${maxSeconds}`);
}

function assertExactlyOneThrough(results, stage, attempt) {
  const denied = results.filter((r) => r.stdout !== "");
  assert.equal(denied.length, 1, "exactly one start is denied");
  assertAllowed(results.find((r) => r.stdout === ""));
  assertDeniedWithinLease(denied[0], stage, attempt, workflowName(stage), START_LEASE_SECONDS - 10, START_LEASE_SECONDS);
}

async function assertDeniedWithoutWrite(repo, payload, reason, gateOptions) {
  const before = readFileSync(repo.ledgerPath, "utf8");

  const result = await runGate(payload, gateOptions);

  assertDenied(result, reason);
  assert.equal(readFileSync(repo.ledgerPath, "utf8"), before, "a deny leaves the ledger untouched");
}

// ---------- registration ----------

test("gate.mjs is registered as a PreToolUse hook covering Workflow and Agent", () => {
  const { hooks } = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));

  const entries = (hooks.PreToolUse ?? []).filter((e) => e.hooks.some((h) => h.command.includes("hooks/gate.mjs")));

  assert.equal(entries.length, 1, "PreToolUse must hold one entry for gate.mjs");
  const matches = (tool) => new RegExp(`^(?:${entries[0].matcher || ".*"})$`).test(tool);
  assert.ok(matches("Workflow"), "the matcher must cover Workflow");
  assert.ok(matches("Agent"), "the matcher must cover Agent");
});

// ---------- no run state ----------

const OUTSIDE_RUN_CALLS = [
  ["the unmodified P1 fixture payload", (cwd) => ({ ...fixture("pretooluse-workflow.json"), cwd })],
  ["an out-of-order stage", (cwd) => stageCall(cwd, SAFETY_NET, { pluginRoot: "/x", attempt: 9 })],
  ["an inline script containing pairingbuddy:", (cwd) => workflowCall(cwd, { script: "agent({agentType:'pairingbuddy:x'})" })],
  ["a direct pipeline Agent call", (cwd) => agentCall(cwd, "pairingbuddy:apply-config-change")],
];

for (const [label, payload] of OUTSIDE_RUN_CALLS) {
  test(`no run state allows ${label} silently`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertAllowed(await runGate(payload(repo.dir)));
    }));
}

test("a cwd outside any git repository allows silently", () =>
  withRepo({ ledger: null, git: false }, async (repo) => {
    assertAllowed(await runGate(stageCall(repo.dir, SAFETY_NET)));
  }));

// ---------- stage order ----------

test("the first stage is allowed and the gate marks it active", () =>
  withRepo({}, async (repo) => {
    const since = Date.now();

    const result = await runGate(stageCall(repo.dir, CONFIG));

    assertAllowed(result);
    const ledger = readLedger(repo.ledgerPath);
    assertMarkedActive(ledger.stage, CONFIG, 1, since);
    assert.equal(ledger.seq, 2, "marking the stage is one signed ledger write");
  }));

test("the next stage is allowed once the previous one is done", () =>
  withPlugin({}, (pluginRoot) =>
    withRepo({ ledger: makeLedger(CONFIG_DONE) }, async (repo) => {
      const since = Date.now();

      const result = await runGate(stageCall(repo.dir, SAFETY_NET, { pluginRoot, attempt: 1 }), { pluginRoot });

      assertAllowed(result);
      assertMarkedActive(readLedger(repo.ledgerPath).stage, SAFETY_NET, 1, since);
    })));

test("the next stage is denied and nothing is marked when its built bundle is missing", () =>
  withPlugin({ bundles: { [CONFIG]: BUNDLE } }, (pluginRoot) =>
    withRepo({ ledger: makeLedger(CONFIG_DONE) }, (repo) =>
      assertDeniedWithoutWrite(
        repo,
        stageCall(repo.dir, SAFETY_NET, { pluginRoot, attempt: 1 }),
        MESSAGES.missingBundle(workflowName(SAFETY_NET), join(pluginRoot, "workflows", `${SAFETY_NET}.js`)),
        { pluginRoot },
      ))));

test("an out-of-order stage is denied from a subdirectory of the repo", () =>
  withRepo({}, (repo) => {
    const subdirectory = join(repo.dir, "src", "deep");
    mkdirSync(subdirectory, { recursive: true });

    return assertDeniedWithoutWrite(repo, stageCall(subdirectory, SAFETY_NET), MESSAGES.order(workflowName(SAFETY_NET), workflowName(CONFIG)));
  }));

test("a stage ahead of the next one is denied and the message names the next stage", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, SAFETY_NET), MESSAGES.order(workflowName(SAFETY_NET), workflowName(CONFIG)))));

test("a finished stage cannot start again", () =>
  withRepo({ ledger: makeLedger(CONFIG_DONE) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG), MESSAGES.order(workflowName(CONFIG), workflowName(SAFETY_NET)))));

test("a pairingbuddy workflow that is not in the stage graph is denied", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, "code-nope"), MESSAGES.order(workflowName("code-nope"), workflowName(CONFIG)))));

test("no stage can start once every stage is done", () =>
  withRepo({ ledger: makeLedger(ALL_DONE) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, SAFETY_NET), MESSAGES.allDone(workflowName(SAFETY_NET)))));

// ---------- one active stage ----------

test("a different stage is denied while one is active", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, SAFETY_NET), MESSAGES.secondActive(CONFIG, 1, workflowName(SAFETY_NET)))));

test("the active stage cannot be started a second time", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG, 2) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2 }), MESSAGES.secondActive(CONFIG, 2, workflowName(CONFIG)))));

test("a stage the gate just started blocks the next call", () =>
  withRepo({}, async (repo) => {
    assertAllowed(await runGate(stageCall(repo.dir, CONFIG)));
    const before = readFileSync(repo.ledgerPath, "utf8");

    const result = await runGate(stageCall(repo.dir, CONFIG));

    assertDeniedWithinLease(result, CONFIG, 1, workflowName(CONFIG), START_LEASE_SECONDS - 10, START_LEASE_SECONDS);
    assert.equal(readFileSync(repo.ledgerPath, "utf8"), before, "a deny leaves the ledger untouched");
  }));

test("two simultaneous starts let exactly one through", () =>
  withRepo({}, async (repo) => {
    const since = Date.now();

    const results = await Promise.all([runGate(stageCall(repo.dir, CONFIG)), runGate(stageCall(repo.dir, CONFIG))]);

    assertExactlyOneThrough(results, CONFIG, 1);
    const ledger = readLedger(repo.ledgerPath);
    assertMarkedActive(ledger.stage, CONFIG, 1, since);
    assert.equal(ledger.seq, 2, "only the winner writes");
  }));

test("two simultaneous restarts after the lease let exactly one through", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG) }) }, async (repo) => {
    const since = Date.now();

    const results = await Promise.all([runGate(stageCall(repo.dir, CONFIG)), runGate(stageCall(repo.dir, CONFIG))]);

    assertExactlyOneThrough(results, CONFIG, 1);
    const ledger = readLedger(repo.ledgerPath);
    assertMarkedActive(ledger.stage, CONFIG, 1, since);
    assert.equal(ledger.seq, 2, "only the winner writes");
  }));

test("the start lease is 120 seconds", () => {
  assert.equal(START_LEASE_SECONDS, 120);
});

test("a stage with no recorded run is denied within the lease, with the seconds remaining", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG, 2, secondsAgo(30)) }) }, async (repo) => {
    const before = readFileSync(repo.ledgerPath, "utf8");

    const result = await runGate(stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2 }));

    assertDeniedWithinLease(result, CONFIG, 2, workflowName(CONFIG), START_LEASE_SECONDS - 40, START_LEASE_SECONDS - 29);
    assert.equal(readFileSync(repo.ledgerPath, "utf8"), before, "a deny leaves the ledger untouched");
  }));

test("a stage just inside the lease is still denied", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG, 1, secondsAgo(START_LEASE_SECONDS - 20)) }) }, async (repo) => {
    assertDeniedWithinLease(await runGate(stageCall(repo.dir, CONFIG)), CONFIG, 1, workflowName(CONFIG), 1, 20);
  }));

test("a different stage gets the same deny within the lease", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG, 2, secondsAgo(30)) }) }, async (repo) => {
    assertDeniedWithinLease(await runGate(stageCall(repo.dir, SAFETY_NET)), CONFIG, 2, workflowName(SAFETY_NET), START_LEASE_SECONDS - 40, START_LEASE_SECONDS - 29);
  }));

test("a stage with no recorded run restarts at the same attempt after the lease, and the restart renews it", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG, 2, secondsAgo(START_LEASE_SECONDS + 1)) }) }, async (repo) => {
    const since = Date.now();

    assertAllowed(await runGate(stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2 })));

    assertMarkedActive(readLedger(repo.ledgerPath).stage, CONFIG, 2, since);
    assertDeniedWithinLease(await runGate(stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2 })), CONFIG, 2, workflowName(CONFIG), START_LEASE_SECONDS - 10, START_LEASE_SECONDS);
  }));

const { startedAt: _dropped, ...STAGE_WITHOUT_STARTED_AT } = unstartedStage(CONFIG);

for (const [label, stage] of [
  ["a missing startedAt", STAGE_WITHOUT_STARTED_AT],
  ["a null startedAt", unstartedStage(CONFIG, 1, null)],
  ["an unparseable startedAt", unstartedStage(CONFIG, 1, "2026-13-45T25:61:00.000Z")],
  ["a startedAt in the future", unstartedStage(CONFIG, 1, secondsAgo(-2 * START_LEASE_SECONDS))],
]) {
  test(`${label} with no recorded run counts as expired, so a run cannot wedge`, () =>
    withRepo({ ledger: makeLedger({ stage }) }, async (repo) => {
      const since = Date.now();

      assertAllowed(await runGate(stageCall(repo.dir, CONFIG)));

      assertMarkedActive(readLedger(repo.ledgerPath).stage, CONFIG, 1, since);
    }));
}

test("a recorded run stays active however old its startedAt", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG, 1, EXPIRED) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG), MESSAGES.secondActive(CONFIG, 1, workflowName(CONFIG)))));

test("a restart at a later attempt is denied with the same attempt as the right value", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG, 2) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 3 }), MESSAGES.attempt(workflowName(CONFIG), 3, 2))));

test("a restart still needs the right pluginRoot", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot: "/x", attempt: 1 }), MESSAGES.pluginRoot(workflowName(CONFIG), "/x"))));

test("a restart still needs the built bundle", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, GOOD_ARGS, { script: `${BUNDLE}\n// tampered` }), MESSAGES.script(workflowName(CONFIG), BUNDLE_PATH))));

test("another stage is denied while one has no recorded run, and the message names the restart", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG, 2) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, SAFETY_NET), MESSAGES.neverStarted(CONFIG, 2, workflowName(SAFETY_NET)))));

// ---------- attempt ----------

for (const wrong of [2, 0, "1", null, undefined]) {
  test(`attempt ${JSON.stringify(wrong)} is denied with the right value`, () =>
    withRepo({}, (repo) =>
      assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: wrong }), MESSAGES.attempt(workflowName(CONFIG), wrong, 1))));
}

test("a failed stage re-runs only at the next attempt", () =>
  withRepo({ ledger: makeLedger(CONFIG_FAILED) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG), MESSAGES.attempt(workflowName(CONFIG), 1, 2))));

test("a failed stage starts at the next attempt", () =>
  withRepo({ ledger: makeLedger(CONFIG_FAILED) }, async (repo) => {
    const since = Date.now();

    const result = await runGate(stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2 }));

    assertAllowed(result);
    assertMarkedActive(readLedger(repo.ledgerPath).stage, CONFIG, 2, since);
  }));

test("a failed stage still holds back the stage after it", () =>
  withRepo({ ledger: makeLedger(CONFIG_FAILED) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, SAFETY_NET), MESSAGES.order(workflowName(SAFETY_NET), workflowName(CONFIG)))));

// ---------- pluginRoot ----------

for (const wrong of ["/x", "", undefined]) {
  test(`pluginRoot ${JSON.stringify(wrong)} is denied with the right value`, () =>
    withRepo({}, (repo) =>
      assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot: wrong, attempt: 1 }), MESSAGES.pluginRoot(workflowName(CONFIG), wrong))));
}

test("a stage call with no args is denied, not crashed on", () =>
  withRepo({}, async (repo) => {
    const payload = workflowCall(repo.dir, { name: workflowName(CONFIG) });

    const result = await runGate(payload);

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    const { permissionDecision, permissionDecisionReason } = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(permissionDecision, "deny");
    assert.match(permissionDecisionReason, /^Wrong (attempt|pluginRoot) for pairingbuddy:code-config: got undefined\./);
  }));

// ---------- script ----------

test("a script byte-identical to the built bundle is allowed", () =>
  withRepo({}, async (repo) => {
    assertAllowed(await runGate(stageCall(repo.dir, CONFIG, GOOD_ARGS, { script: BUNDLE })));
  }));

test("a script differing from the built bundle is denied", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, GOOD_ARGS, { script: `${BUNDLE}\n// tampered` }), MESSAGES.script(workflowName(CONFIG), BUNDLE_PATH))));

test("a stage cannot run another stage's bundle", () =>
  withPlugin({}, (pluginRoot) =>
    withRepo({ ledger: makeLedger(CONFIG_DONE) }, (repo) =>
      assertDeniedWithoutWrite(
        repo,
        stageCall(repo.dir, SAFETY_NET, { pluginRoot, attempt: 1 }, { script: BUNDLE }),
        MESSAGES.script(workflowName(SAFETY_NET), join(pluginRoot, "workflows", `${SAFETY_NET}.js`)),
        { pluginRoot },
      ))));

test("a scriptPath whose file matches the built bundle is allowed", () =>
  withRepo({}, async (repo) => {
    const copy = join(repo.dir, "copy.js");
    writeFileSync(copy, BUNDLE);

    assertAllowed(await runGate(stageCall(repo.dir, CONFIG, GOOD_ARGS, { scriptPath: copy })));
  }));

test("a relative scriptPath resolves against the payload cwd, not the hook's own cwd", () =>
  withRepo({}, async (repo) => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "gate-elsewhere-")));
    writeFileSync(join(repo.dir, "copy.js"), BUNDLE);
    try {
      assertAllowed(await runGate(stageCall(repo.dir, CONFIG, GOOD_ARGS, { scriptPath: "copy.js" }), { processCwd: elsewhere }));
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  }));

test("a scriptPath whose file differs from the built bundle is denied", () =>
  withRepo({}, (repo) => {
    const copy = join(repo.dir, "copy.js");
    writeFileSync(copy, `${BUNDLE}\n// tampered`);

    return assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, GOOD_ARGS, { scriptPath: copy }), MESSAGES.script(workflowName(CONFIG), BUNDLE_PATH));
  }));

test("a scriptPath that does not exist is denied", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, GOOD_ARGS, { scriptPath: join(repo.dir, "gone.js") }), MESSAGES.script(workflowName(CONFIG), BUNDLE_PATH))));

// ---------- inline scripts ----------

test("an unnamed inline script containing pairingbuddy: is denied", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { script: "agent({agentType:'pairingbuddy:apply-config-change'})" }), MESSAGES.inline(workflowName(CONFIG)))));

test("an unnamed inline script without pairingbuddy: is allowed and starts no stage", () =>
  withRepo({}, async (repo) => {
    const before = readFileSync(repo.ledgerPath, "utf8");

    const result = await runGate(workflowCall(repo.dir, { script: "export const meta = { name: 'mine' };" }));

    assertAllowed(result);
    assert.equal(readFileSync(repo.ledgerPath, "utf8"), before);
  }));

test("an unnamed copy of a built bundle cannot jump the stage order", () =>
  withRepo({ ledger: makeLedger(ALL_DONE) }, (repo) =>
    assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { script: BUNDLE, args: GOOD_ARGS }), MESSAGES.byName(CONFIG))));

for (const [label, input] of [
  ["an unnamed copy of the next stage's bundle", { script: BUNDLE, args: GOOD_ARGS }],
  ["a foreign-named copy of the next stage's bundle", { name: "mine", script: BUNDLE, args: GOOD_ARGS }],
  ["a bare stage name with no script", { name: CONFIG, args: GOOD_ARGS }],
  ["a bare stage name with the bundle", { name: CONFIG, script: BUNDLE, args: GOOD_ARGS }],
]) {
  test(`${label} is denied with a message to call the stage by name`, () =>
    withRepo({}, (repo) => assertDeniedWithoutWrite(repo, workflowCall(repo.dir, input), MESSAGES.byName(CONFIG))));
}

test("a bare stage name that is not the next stage gets the same deny", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { name: SAFETY_NET, args: GOOD_ARGS }), MESSAGES.byName(SAFETY_NET))));

test("an unnamed scriptPath copy of a bundle gets the same deny", () =>
  withRepo({}, (repo) => {
    const copy = join(repo.dir, "copy.js");
    writeFileSync(copy, BUNDLE);

    return assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { scriptPath: copy }), MESSAGES.byName(CONFIG));
  }));

test("a run opened before classification uses the default stage graph", () =>
  withRepo({ ledger: { ...makeLedger(), taskType: null } }, async (repo) => {
    assertAllowed(await runGate(stageCall(repo.dir, CONFIG)));

    assert.equal(readLedger(repo.ledgerPath).stage.name, CONFIG);
  }));

// ---------- unreadable scriptPath ----------

const NEXT_POSITION = `The next stage is ${workflowName(CONFIG)}: call it by name.`;

for (const [label, input] of [
  ["unnamed", {}],
  ["from outside the plugin", { name: "mine" }],
]) {
  test(`a missing scriptPath on a workflow ${label} is denied during a run`, () =>
    withRepo({}, (repo) => {
      const path = join(repo.dir, "gone.js");

      return assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { ...input, scriptPath: path }), MESSAGES.unreadable(path, NEXT_POSITION));
    }));
}

test("a scriptPath that is a directory is denied during a run", () =>
  withRepo({}, (repo) => assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { scriptPath: repo.dir }), MESSAGES.unreadable(repo.dir, NEXT_POSITION))));

test("a scriptPath the hook has no permission to read is denied during a run", () =>
  withRepo({}, (repo) => {
    const path = join(repo.dir, "locked.js");
    writeFileSync(path, "export const meta = { name: 'mine' };");
    chmodSync(path, 0o000);

    return assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { scriptPath: path }), MESSAGES.unreadable(path, NEXT_POSITION));
  }));

test("an unreadable scriptPath is denied with the position of an active stage", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG, 2) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { scriptPath: "~/evil.js" }), MESSAGES.unreadable("~/evil.js", `Stage ${CONFIG} is active at attempt 2.`))));

// ---------- plugin root ----------

test("CLAUDE_PLUGIN_ROOT decides which bundle and pluginRoot the gate compares against", () =>
  withPlugin({ bundles: { [CONFIG]: "export const meta = { name: 'code-config', scratch: true };\n" } }, (pluginRoot) =>
    withRepo({}, async (repo) => {
      const args = { pluginRoot, attempt: 1 };

      await assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, args, { script: BUNDLE }), MESSAGES.script(workflowName(CONFIG), join(pluginRoot, "workflows", `${CONFIG}.js`)), { pluginRoot });
      assertAllowed(await runGate(stageCall(repo.dir, CONFIG, args, { script: "export const meta = { name: 'code-config', scratch: true };\n" }), { pluginRoot }));
    })));

test("with CLAUDE_PLUGIN_ROOT unset the gate uses the plugin that holds the hook", () =>
  withRepo({}, async (repo) => {
    assertAllowed(await runGate(stageCall(repo.dir, CONFIG, GOOD_ARGS, { script: BUNDLE }), { pluginRoot: null }));
  }));

test("with CLAUDE_PLUGIN_ROOT unset a wrong pluginRoot is denied with the hook's plugin as the right value", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot: "/x", attempt: 1 }), MESSAGES.pluginRoot(workflowName(CONFIG), "/x"), { pluginRoot: null })));

// ---------- task type routing ----------

const OTHER_TYPE = "other_type";
const [OTHER_FIRST, OTHER_SECOND] = ["other-first", "other-second"];

function twoTypeContract() {
  const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));
  const node = (name) => ({ name, gate: null, evidence: [] });
  contract.taskTypes[OTHER_TYPE] = { nodes: [node(OTHER_FIRST), node(OTHER_SECOND)], gates: {} };
  return contract;
}

const OTHER_RUN = { plugin: { contract: twoTypeContract(), bundles: { [OTHER_FIRST]: "export const meta = { name: 'other-first' };\n" } }, ledger: { ...makeLedger(), taskType: OTHER_TYPE } };

test("a stage from the ledger's task type is allowed", () =>
  withPlugin(OTHER_RUN.plugin, (pluginRoot) =>
    withRepo({ ledger: OTHER_RUN.ledger }, async (repo) => {
      assertAllowed(await runGate(stageCall(repo.dir, OTHER_FIRST, { pluginRoot, attempt: 1 }), { pluginRoot }));

      assert.equal(readLedger(repo.ledgerPath).stage.name, OTHER_FIRST);
    })));

test("a stage from the default task type is denied when the ledger holds another type", () =>
  withPlugin(OTHER_RUN.plugin, (pluginRoot) =>
    withRepo({ ledger: OTHER_RUN.ledger }, (repo) =>
      assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot, attempt: 1 }), MESSAGES.order(workflowName(CONFIG), workflowName(OTHER_FIRST)), { pluginRoot }))));

test("a direct pipeline Agent call names the next stage of the ledger's task type", () =>
  withPlugin(OTHER_RUN.plugin, (pluginRoot) =>
    withRepo({ ledger: OTHER_RUN.ledger }, (repo) =>
      assertDeniedWithoutWrite(repo, agentCall(repo.dir, "pairingbuddy:apply-config-change"), MESSAGES.agentNext("pairingbuddy:apply-config-change", workflowName(OTHER_FIRST)), { pluginRoot }))));

test("graphFor returns the named task type's graph", () => {
  assert.deepEqual(graphFor(twoTypeContract(), OTHER_TYPE), { taskType: OTHER_TYPE, stages: [OTHER_FIRST, OTHER_SECOND] });
});

test("graphFor falls back to the default task type on null", () => {
  assert.deepEqual(graphFor(twoTypeContract(), null), { taskType: "config_change", stages: [CONFIG, SAFETY_NET] });
});

test("graphFor throws on an unknown task type", () => {
  assert.throws(() => graphFor(twoTypeContract(), "nope"), /no stage graph for task type nope/);
});

test("an inline script containing pairingbuddy: is denied while a stage is active", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG, 2) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { script: "agent({agentType:'pairingbuddy:x'})" }), MESSAGES.inlineActive(CONFIG, 2))));

test("an inline script containing pairingbuddy: is denied once every stage is done", () =>
  withRepo({ ledger: makeLedger(ALL_DONE) }, (repo) =>
    assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { script: "agent({agentType:'pairingbuddy:x'})" }), MESSAGES.inlineAllDone())));

test("a workflow with another name still cannot carry pairingbuddy: inline", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { name: "mine", script: "agent({agentType:'pairingbuddy:x'})" }), MESSAGES.inline(workflowName(CONFIG)))));

test("a scriptPath whose file contains pairingbuddy: is denied", () =>
  withRepo({}, (repo) => {
    const path = join(repo.dir, "mine.js");
    writeFileSync(path, "agent({agentType:'pairingbuddy:x'})");

    return assertDeniedWithoutWrite(repo, workflowCall(repo.dir, { scriptPath: path }), MESSAGES.inline(workflowName(CONFIG)));
  }));

test("a script and a scriptPath must both match the built bundle", () =>
  withRepo({}, (repo) => {
    const path = join(repo.dir, "mine.js");
    writeFileSync(path, "agent({agentType:'pairingbuddy:x'})");

    return assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, GOOD_ARGS, { script: BUNDLE, scriptPath: path }), MESSAGES.script(workflowName(CONFIG), BUNDLE_PATH));
  }));

for (const [label, input] of [
  ["named with no script", { name: "pbprobe:gated", args: { attempt: 1 } }],
  ["named with a clean script", { name: "mine", script: "export const meta = { name: 'mine' };" }],
]) {
  test(`a workflow from outside the plugin ${label} is allowed during a run and starts no stage`, () =>
    withRepo({}, async (repo) => {
      const before = readFileSync(repo.ledgerPath, "utf8");

      assertAllowed(await runGate(workflowCall(repo.dir, input)));

      assert.equal(readFileSync(repo.ledgerPath, "utf8"), before);
    }));
}

// ---------- direct Agent bypass ----------

test("a main-context Agent call for a pipeline agent is denied with no active stage, naming the next stage", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, agentCall(repo.dir, "pairingbuddy:apply-config-change"), MESSAGES.agentNext("pairingbuddy:apply-config-change", workflowName(CONFIG)))));

test("a pipeline agent named without the prefix is denied with no active stage", () =>
  withRepo({}, (repo) =>
    assertDeniedWithoutWrite(repo, agentCall(repo.dir, "apply-config-change"), MESSAGES.agentNext("apply-config-change", workflowName(CONFIG)))));

test("a pipeline agent named without the prefix is denied during an active stage", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, agentCall(repo.dir, "apply-config-change"), MESSAGES.agent("apply-config-change", CONFIG))));

test("a direct pipeline Agent call after a finished stage names the following stage", () =>
  withRepo({ ledger: makeLedger(CONFIG_DONE) }, (repo) =>
    assertDeniedWithoutWrite(repo, agentCall(repo.dir, "pairingbuddy:apply-config-change"), MESSAGES.agentNext("pairingbuddy:apply-config-change", workflowName(SAFETY_NET)))));

test("a direct pipeline Agent call after a failed stage names that stage", () =>
  withRepo({ ledger: makeLedger(CONFIG_FAILED) }, (repo) =>
    assertDeniedWithoutWrite(repo, agentCall(repo.dir, "pairingbuddy:apply-config-change"), MESSAGES.agentNext("pairingbuddy:apply-config-change", workflowName(CONFIG)))));

test("a direct pipeline Agent call is denied once every stage is done", () =>
  withRepo({ ledger: makeLedger(ALL_DONE) }, (repo) =>
    assertDeniedWithoutWrite(repo, agentCall(repo.dir, "pairingbuddy:apply-config-change"), MESSAGES.agentAllDone("pairingbuddy:apply-config-change"))));

test("a main-context Agent call with no subagent_type is allowed during a run", () =>
  withRepo({}, async (repo) => {
    const payload = agentCall(repo.dir, "unused");
    delete payload.tool_input.subagent_type;

    assertAllowed(await runGate(payload));
  }));

test("a main-context Agent call for a non-pipeline agent is allowed with no active stage", () =>
  withRepo({}, async (repo) => {
    assertAllowed(await runGate(agentCall(repo.dir, "general-purpose")));
  }));

test("a workflow's own subagent calling Agent for a pipeline agent is allowed with no active stage", () =>
  withRepo({}, async (repo) => {
    const { agent_id, agent_type } = fixture("pretooluse-workflow-agent-bash.json");
    const payload = { ...agentCall(repo.dir, "pairingbuddy:apply-config-change"), agent_id, agent_type };

    assertAllowed(await runGate(payload));
  }));

test("a main-context Agent call for a pipeline agent is denied during an active stage", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG) }) }, (repo) =>
    assertDeniedWithoutWrite(repo, agentCall(repo.dir, "pairingbuddy:apply-config-change"), MESSAGES.agent("pairingbuddy:apply-config-change", CONFIG))));

test("a workflow's own subagent calling Agent for a pipeline agent is allowed during an active stage", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG) }) }, async (repo) => {
    const { agent_id, agent_type } = fixture("pretooluse-workflow-agent-bash.json");
    const payload = { ...agentCall(repo.dir, "pairingbuddy:apply-config-change"), agent_id, agent_type };

    assertAllowed(await runGate(payload));
  }));

test("a main-context Agent call for a non-pipeline agent is allowed during an active stage", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG) }) }, async (repo) => {
    assertAllowed(await runGate(agentCall(repo.dir, "general-purpose")));
  }));

// ---------- other tools ----------

test("a tool with no gate rule yet is allowed during an active stage", () =>
  withRepo({ ledger: makeLedger({ stage: activeStage(CONFIG) }) }, async (repo) => {
    const payload = { ...fixture("pretooluse-workflow.json"), cwd: repo.dir, tool_name: "Read", tool_input: { file_path: "README.md" } };

    assertAllowed(await runGate(payload));
  }));

// ---------- stage contract ----------

const VALID_CONTRACT = () => JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));

test("the committed stage contract is valid and pins the config_change graph", () => {
  const contract = VALID_CONTRACT();

  assert.deepEqual(validateStages(contract), []);
  assert.deepEqual(contract.taskTypes.config_change.nodes.map((n) => n.name), [CONFIG, SAFETY_NET]);
});

test("a stage contract with a duplicate node is invalid", () => {
  const contract = VALID_CONTRACT();
  contract.taskTypes.config_change.nodes.push(contract.taskTypes.config_change.nodes[0]);

  assert.match(validateStages(contract).join("\n"), /duplicate node code-config/);
});

test("a stage contract naming an unknown gate is invalid", () => {
  const contract = VALID_CONTRACT();
  contract.taskTypes.config_change.nodes[0].gate = "G:nope";

  assert.match(validateStages(contract).join("\n"), /unknown gate G:nope/);
});

test("a stage contract naming an unknown gate class is invalid", () => {
  const contract = VALID_CONTRACT();
  contract.taskTypes.config_change.gates["G:task-end"].class = "nope";

  assert.match(validateStages(contract).join("\n"), /unknown gate class nope/);
});

test("a stage contract with an unknown default task type is invalid", () => {
  const contract = VALID_CONTRACT();
  contract.defaultTaskType = "nope";

  assert.match(validateStages(contract).join("\n"), /unknown default task type nope/);
});

const breakGraph = (change) => (contract) => {
  change(contract.taskTypes.config_change);
  return contract;
};

for (const [label, change, problem] of [
  ["null", () => null, /needs taskTypes and gateClasses/],
  ["no taskTypes object", (c) => ({ ...c, taskTypes: [] }), /needs taskTypes and gateClasses/],
  ["no gateClasses object", (c) => ({ ...c, gateClasses: null }), /needs taskTypes and gateClasses/],
  ["a null task type", (c) => ({ ...c, taskTypes: { ...c.taskTypes, config_change: null } }), /config_change: has no nodes/],
  ["a node with no name", breakGraph((g) => delete g.nodes[0].name), /a node has no name/],
  ["a node with an empty name", breakGraph((g) => (g.nodes[0].name = "")), /a node has no name/],
  ["a node with no evidence list", breakGraph((g) => delete g.nodes[0].evidence), /node code-config has no evidence list/],
  ["an empty node list", breakGraph((g) => (g.nodes = [])), /config_change: has no nodes/],
  ["no node list", breakGraph((g) => delete g.nodes), /config_change: has no nodes/],
  ["a null node", breakGraph((g) => g.nodes.push(null)), /config_change: a node is not an object/],
  ["a null gate", breakGraph((g) => (g.gates["G:task-end"] = null)), /config_change: gate G:task-end is not an object/],
]) {
  test(`a stage contract with ${label} reports a problem instead of throwing`, () => {
    assert.match(validateStages(change(VALID_CONTRACT())).join("\n"), problem);
  });
}

test("loadStages throws an error naming the file and the problem for an invalid contract", () => {
  const contract = VALID_CONTRACT();
  contract.taskTypes.config_change.nodes.push(null);

  return withPlugin({ contract }, async (pluginRoot) => {
    const path = join(pluginRoot, "contracts", "stages.json");

    assert.throws(() => loadStages(pluginRoot), (e) => e.message === `${path} is invalid: config_change: a node is not an object`);
  });
});

test("pipelineAgents reads only the agents section", () =>
  withPlugin({}, async (pluginRoot) => {
    writeFileSync(join(pluginRoot, "contracts", "agent-config.yaml"), "schemas:\n  a-schema: x\nagents:\n  real-agent:\n    model: y\nfocus_warning:\n  not-an-agent: z\n");

    assert.deepEqual([...pipelineAgents(pluginRoot)], ["real-agent"]);
  }));
