import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { BOOT, ROOT, assertAllowed, assertDenied, fixture, runGate } from "./gate-harness.mjs";
import { graphFor, loadStages, pipelineAgents, START_LEASE_SECONDS, validateStages } from "../../shared-node/stages.mjs";

const GATE = join(ROOT, "hooks", "gate.mjs");

const CONFIG = "code-config";
const SAFETY_NET = "code-safety-net";
const workflowName = (stage) => `pairingbuddy:${stage}`;
const BUNDLE_PATH = join(ROOT, "workflows", `${CONFIG}.js`);
const BUNDLE = readFileSync(BUNDLE_PATH, "utf8");
const SAFETY_NET_BUNDLE = "export const meta = { name: 'code-safety-net' };\n";
const GOOD_ARGS = { pluginRoot: ROOT, attempt: 1, task: { description: "set x" } };

// Deny mechanism: exit 0 with the JSON form the P1 probe proved, reason in permissionDecisionReason.
// Allow: exit 0, nothing on stdout or stderr.
const MESSAGES = {
  order: (called, next) => `Stage order: ${called} cannot start now. The next stage is ${next}.`,
  allDone: (called) => `Stage order: ${called} cannot start now. All stages for config_change are done.`,
  secondActive: (stage, attempt, called) => `Stage ${stage} is active at attempt ${attempt}. Wait for it to finish before starting ${called}. A stranded stage is cleared by the human running pb stage fail.`,
  withinLease: (stage, attempt, called, seconds) => `${MESSAGES.secondActive(stage, attempt, called)} It has no recorded run yet: ${seconds} seconds remain on its start lease.`,
  neverStarted: (stage, attempt, called) => `Stage ${stage} is active at attempt ${attempt} with no recorded run, so it may never have started. Restart ${workflowName(stage)} at attempt ${attempt} before starting ${called}.`,
  missingBundle: (workflow, bundle) => `Cannot start ${workflow}: its built bundle ${bundle} is missing.`,
  byName: (stage) => `Stage ${stage} cannot run under another name or none. Call ${workflowName(stage)} by name.`,
  unreadable: (path, position) => `Script file ${path} could not be read. ${position}`,
  attempt: (workflow, got, right) => `Wrong attempt for ${workflow}: got ${JSON.stringify(got)}. Use attempt ${right}.`,
  pluginRoot: (workflow, got) => `Wrong pluginRoot for ${workflow}: got ${JSON.stringify(got)}. Use pluginRoot ${ROOT}.`,
  task: (workflow, got, task = "Task 23") => `Missing task for ${workflow}: got ${JSON.stringify(got)}. Pass the task as args.task, as ${JSON.stringify({ description: task })}.`,
  placeholder: (workflow, got, task = "Task 23") => `Placeholder task for ${workflow}: got ${JSON.stringify(got)}. Pass the task as args.task, as ${JSON.stringify({ description: task })}.`,
  script: (workflow, bundle) => `Script for ${workflow} does not match the built bundle ${bundle}. Call ${workflow} by name with no script.`,
  inline: (next) => `Inline script containing pairingbuddy: is denied. The next stage is ${next}: call it by name.`,
  inlineActive: (stage, attempt) => `Inline script containing pairingbuddy: is denied. Stage ${stage} is active at attempt ${attempt}.`,
  inlineAllDone: () => "Inline script containing pairingbuddy: is denied. All stages for config_change are done.",
  agent: (agent, stage) => `Direct Agent call for ${agent} is denied during stage ${stage}. Start the workflow ${workflowName(stage)} instead.`,
  agentNext: (agent, next) => `Direct Agent call for ${agent} is denied during this run. Start the workflow ${next} instead.`,
  agentAllDone: (agent) => `Direct Agent call for ${agent} is denied during this run. All stages for config_change are done.`,
  noRun: (stage) => `Stage ${stage} cannot start with no run open. Use /pairingbuddy:code, which opens the run.`,
  noRunAgent: (agent) => `Agent ${workflowName(agent)} runs only inside a stage, and no run is open. Use /pairingbuddy:code, which opens the run.`,
  solo: (workflow) => `Solo stays on the old path until T10, so ${workflow} cannot start. The run stays as it is: report pb status.`,
  noHumanHere: "No human answers under the auto policy, so nothing is asked. Carry the guidance over as it stands, write the output, and finish.",
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

function workflowCall(cwd, toolInput) {
  return { ...fixture("pretooluse-workflow.json"), cwd, tool_input: toolInput };
}

const stageCall = (cwd, stage, args = GOOD_ARGS, extra = {}) => workflowCall(cwd, { name: workflowName(stage), args, ...extra });
const stageNamed = (cwd, name) => workflowCall(cwd, { name, args: GOOD_ARGS });

function agentCall(cwd, subagentType) {
  return {
    ...fixture("pretooluse-workflow.json"),
    cwd,
    tool_name: "Agent",
    tool_input: { subagent_type: subagentType, description: "apply the change", prompt: "do it" },
  };
}

// The stage the gate marked, with startedAt stamped at or after `since`.
function assertMarkedActive(stage, name, attempt, since) {
  const { startedAt, ...rest } = stage;
  assert.deepEqual(rest, { name, status: "active", runId: null, attempt });
  assert.equal(new Date(Date.parse(startedAt)).toISOString(), startedAt, "startedAt is an ISO timestamp");
  assert.ok(Date.parse(startedAt) >= since && Date.parse(startedAt) <= Date.now(), `startedAt ${startedAt} is the time of this start`);
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

test("gate-boot.mjs is the registered PreToolUse hook, covering Workflow and Agent", () => {
  const { hooks } = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));

  const entries = (hooks.PreToolUse ?? []).filter((e) => e.hooks.some((h) => h.command.includes("hooks/gate-boot.mjs")));

  assert.equal(entries.length, 1, "PreToolUse must hold one entry for gate-boot.mjs");
  assert.ok(!(hooks.PreToolUse ?? []).some((e) => e.hooks.some((h) => h.command.includes("hooks/gate.mjs"))), "a syntax error in a registered gate.mjs fails open");
  const matches = (tool) => new RegExp(`^(?:${entries[0].matcher || ".*"})$`).test(tool);
  assert.ok(matches("Workflow"), "the matcher must cover Workflow");
  assert.ok(matches("Agent"), "the matcher must cover Agent");
});

// ---------- no run state ----------

const OUTSIDE_RUN_CALLS = [
  ["the unmodified P1 fixture payload", (cwd) => ({ ...fixture("pretooluse-workflow.json"), cwd })],
  ["a plugin workflow that is not a stage", (cwd) => workflowCall(cwd, { name: workflowName("helper"), args: GOOD_ARGS })],
  ["a workflow of another plugin sharing a stage's name", (cwd) => stageNamed(cwd, `other:${CONFIG}`)],
  ["a workflow from outside the plugin with its own script", (cwd) => workflowCall(cwd, { name: "mine", script: "export const meta = { name: 'mine' };" })],
  ["a script with neither name nor bundle", (cwd) => workflowCall(cwd, { script: "export const meta = { name: 'mine' };" })],
  ["a scriptPath that cannot be read", (cwd) => workflowCall(cwd, { name: "mine", scriptPath: join(cwd, "gone.js") })],
  ["an inline script naming neither a stage nor a new-path agent", (cwd) => workflowCall(cwd, { script: "agent({agentType:'pairingbuddy:x'})" })],
  ["an inline script naming an old-path agent", (cwd) => workflowCall(cwd, { script: "agent({agentType:'pairingbuddy:classify-task'})" })],
  ["a direct old-path Agent call", (cwd) => agentCall(cwd, "pairingbuddy:classify-task")],
  ["an Agent call for an agent both paths use", (cwd) => agentCall(cwd, "pairingbuddy:update-documentation")],
  ["a project's own agent sharing a new-path agent's bare name", (cwd) => agentCall(cwd, "runner")],
  ["another plugin's agent sharing a new-path agent's name", (cwd) => agentCall(cwd, "other:runner")],
  ["an Agent call with no subagent_type", (cwd) => ({ ...agentCall(cwd, "x"), tool_input: { prompt: "p" } })],
  ["a tool that is no Workflow but carries a stage's name", (cwd) => ({ ...agentCall(cwd, "general-purpose"), tool_input: { subagent_type: "general-purpose", name: CONFIG, prompt: "p" } })],
  ["a tool that is no Workflow but carries a prefixed stage's name", (cwd) => ({ ...agentCall(cwd, "general-purpose"), tool_input: { subagent_type: "general-purpose", name: workflowName(CONFIG), script: BUNDLE, prompt: "p" } })],
];

for (const [label, payload] of OUTSIDE_RUN_CALLS) {
  test(`no run state allows ${label} silently`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertAllowed(await runGate(payload(repo.dir)));
    }));
}

test("a cwd outside any git repository allows silently", () =>
  withRepo({ ledger: null, git: false }, async (repo) => {
    assertAllowed(await runGate(workflowCall(repo.dir, { name: "mine" })));
  }));

// ---------- a stage with no run ----------

const SCRIPT_COPIES = [
  ["unnamed", () => ({ script: BUNDLE })],
  ["under another name", () => ({ name: "mine", script: BUNDLE })],
  ["under a plugin name that is not a stage", () => ({ name: workflowName("helper"), script: BUNDLE })],
  ["read from its built path", () => ({ scriptPath: BUNDLE_PATH })],
  ["read from a copy, by a path relative to the cwd", (cwd) => {
    writeFileSync(join(cwd, "copy.js"), BUNDLE);
    return { name: "mine", scriptPath: "copy.js" };
  }],
  ["beside a clean inline script", () => ({ name: "mine", script: "export const meta = { name: 'mine' };", scriptPath: BUNDLE_PATH })],
  ["beside a scriptPath that cannot be read", (cwd) => ({ name: "mine", script: BUNDLE, scriptPath: join(cwd, "gone.js") })],
];

const STAGE_CALLS_WITH_NO_RUN = [
  ["a stage with bad args", CONFIG, (cwd) => stageCall(cwd, CONFIG, { pluginRoot: "/x", attempt: 9 })],
  ["a later stage", SAFETY_NET, (cwd) => stageCall(cwd, SAFETY_NET)],
  ["a stage with no args", CONFIG, (cwd) => workflowCall(cwd, { name: workflowName(CONFIG) })],
  ["a stage named without the prefix", CONFIG, (cwd) => stageNamed(cwd, CONFIG)],
  ["a stage name over a different script", CONFIG, (cwd) => stageCall(cwd, CONFIG, GOOD_ARGS, { script: "export const meta = { name: 'mine' };" })],
  ...SCRIPT_COPIES.map(([label, input]) => [`a bundle copy ${label}`, CONFIG, (cwd) => workflowCall(cwd, input(cwd))]),
];

for (const [label, stage, call] of STAGE_CALLS_WITH_NO_RUN) {
  test(`no run state denies ${label}, pointing at /pairingbuddy:code`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertDenied(await runGate(call(repo.dir)), MESSAGES.noRun(stage));

      assert.equal(existsSync(join(repo.dir, ".pairingbuddy")), false, "a deny opens nothing");
    }));
}

const FRAGMENTS = BUNDLE.replaceAll("pairingbuddy:", "pairingbuddy' + ':");

const NEAR_COPIES = [
  ["with a newline at its end", `${BUNDLE}\n`],
  ["with spaces at its end", `${BUNDLE}   `],
  ["with its last newline gone", BUNDLE.trimEnd()],
  ["with spaces at the end of one line", BUNDLE.replace("\n", "  \n")],
  ["with a carriage return on each line", BUNDLE.replaceAll("\n", "\r\n")],
];

for (const [label, text] of NEAR_COPIES) {
  test(`no run state denies a bundle copy ${label}, as an inline script`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertDenied(await runGate(workflowCall(repo.dir, { script: text })), MESSAGES.noRun(CONFIG));
    }));

  test(`no run state denies a bundle copy ${label}, read from a scriptPath`, () =>
    withRepo({ ledger: null }, async (repo) => {
      writeFileSync(join(repo.dir, "copy.js"), text);
      assertDenied(await runGate(workflowCall(repo.dir, { name: "mine", scriptPath: "copy.js" })), MESSAGES.noRun(CONFIG));
    }));
}

test("a run still takes only the exact bundle under a stage's name", () =>
  withRepo({}, async (repo) => {
    const payload = stageCall(repo.dir, CONFIG, GOOD_ARGS, { script: `${BUNDLE}\n` });
    await assertDeniedWithoutWrite(repo, payload, MESSAGES.script(workflowName(CONFIG), BUNDLE_PATH));
  }));

const NO_RUN_SCRIPTS = [
  ["a stage", `workflow('pairingbuddy:${SAFETY_NET}')`, MESSAGES.noRun(SAFETY_NET)],
  ["a new-path agent", "agent('x', { agentType: 'pairingbuddy:apply-config-change' })", MESSAGES.noRunAgent("apply-config-change")],
  ["the runner", 'agent("x", { agentType: "pairingbuddy:runner" })', MESSAGES.noRunAgent("runner")],
];

for (const [label, script, reason] of NO_RUN_SCRIPTS) {
  test(`no run state denies an inline script naming ${label}`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertDenied(await runGate(workflowCall(repo.dir, { script })), reason);
    }));

  test(`no run state denies a scriptPath naming ${label}, under a name of its own`, () =>
    withRepo({ ledger: null }, async (repo) => {
      writeFileSync(join(repo.dir, "mine.js"), script);
      assertDenied(await runGate(workflowCall(repo.dir, { name: "mine", scriptPath: "mine.js" })), reason);
    }));
}

test("a script that names its stage's agents only in fragments still passes: Section 8 accepts this bypass", () =>
  withRepo({ ledger: null }, async (repo) => {
    assertAllowed(await runGate(workflowCall(repo.dir, { script: FRAGMENTS })));
  }));

for (const agent of ["apply-config-change", "runner"]) {
  test(`no run state denies a direct Agent call for ${agent}`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertDenied(await runGate(agentCall(repo.dir, workflowName(agent))), MESSAGES.noRunAgent(agent));
      assert.equal(existsSync(join(repo.dir, ".pairingbuddy")), false, "a deny opens nothing");
    }));
}

test("the agents denied with no run come from the contract, not from code", () =>
  withPlugin({ contract: { ...loadStages(ROOT), newPathAgents: ["classify-task"] } }, (plugin) =>
    withRepo({ ledger: null }, async (repo) => {
      assertDenied(await runGate(agentCall(repo.dir, "pairingbuddy:classify-task"), { pluginRoot: plugin }), MESSAGES.noRunAgent("classify-task"));
      assertAllowed(await runGate(agentCall(repo.dir, "pairingbuddy:runner"), { pluginRoot: plugin }));
    })));

test("the contract's list holds exactly the agents only a stage spawns", () => {
  const spawned = new Set(["code-config", "code-safety-net"].flatMap((stage) => [...readFileSync(join(ROOT, "workflows", `${stage}.js`), "utf8").matchAll(/agentType: 'pairingbuddy:([\w-]+)'/g)].map((match) => match[1])));
  const skill = readFileSync(join(ROOT, "skills", "coding", "SKILL.md"), "utf8");
  const onlyStages = [...spawned].filter((agent) => !skill.includes(`${agent.replaceAll("-", "_")}(`) && !skill.includes(agent));

  assert.deepEqual(onlyStages.sort(), [...loadStages(ROOT).newPathAgents].sort());
});

test("validateStages refuses a contract whose new-path list is missing or holds no names", () => {
  const { newPathAgents: _list, ...contract } = structuredClone(loadStages(ROOT));
  for (const newPathAgents of [undefined, "runner", [1], [""]]) {
    assert.match(validateStages({ ...contract, newPathAgents }).join(), /newPathAgents/);
  }
  assert.deepEqual(validateStages(loadStages(ROOT)), []);
});

test("an invalid stage contract leaves an Agent call allowed with no run state", () =>
  withPlugin({ contract: { nope: true } }, (plugin) =>
    withRepo({ ledger: null }, async (repo) => {
      assertAllowed(await runGate(agentCall(repo.dir, "pairingbuddy:runner"), { pluginRoot: plugin }));
    })));

// ---------- curate-guidance with nobody to ask ----------

const question = (cwd, over = {}) => ({
  ...fixture("pretooluse-workflow.json"),
  cwd,
  tool_name: "AskUserQuestion",
  tool_input: { questions: [{ question: "Keep these entries?" }] },
  permission_mode: "auto",
  agent_id: "a1",
  agent_type: "pairingbuddy:curate-guidance",
  ...over,
});

test("curate-guidance asks nobody under the auto permission mode", () =>
  withRepo({ ledger: null }, async (repo) => {
    assertDenied(await runGate(question(repo.dir)), MESSAGES.noHumanHere);
  }));

test("curate-guidance asks nobody under PAIRINGBUDDY_GATE_POLICY=auto", () =>
  withRepo({ ledger: null }, async (repo) => {
    assertDenied(await runGate(question(repo.dir, { permission_mode: "default" }), { env: { PAIRINGBUDDY_GATE_POLICY: "auto" } }), MESSAGES.noHumanHere);
  }));

test("curate-guidance still asks a human outside the auto policy", () =>
  withRepo({ ledger: null }, async (repo) => {
    assertAllowed(await runGate(question(repo.dir, { permission_mode: "default" })));
  }));

test("under the auto policy, every other question still reaches the human", () =>
  withRepo({ ledger: null }, async (repo) => {
    assertAllowed(await runGate(question(repo.dir, { agent_type: "pairingbuddy:brainstorm-requirements" })));
    const { agent_id: _id, agent_type: _type, ...fromTheMainContext } = question(repo.dir);
    assertAllowed(await runGate(fromTheMainContext));
  }));

// ---------- Solo ----------

async function withSolo(fn) {
  process.env.PAIRINGBUDDY_SOLO = "true";
  try {
    await fn();
  } finally {
    delete process.env.PAIRINGBUDDY_SOLO;
  }
}

test("Solo denies starting a new-path stage on a run it found open, and marks nothing", () =>
  withRepo({}, (repo) =>
    withSolo(() => assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG), MESSAGES.solo(workflowName(CONFIG))))));

test("Solo denies a stage's restart too", () =>
  withRepo({ ledger: makeLedger({ stage: unstartedStage(CONFIG) }) }, (repo) =>
    withSolo(() => assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG), MESSAGES.solo(workflowName(CONFIG))))));

test("PAIRINGBUDDY_SOLO=false starts a stage", () =>
  withRepo({}, async (repo) => {
    process.env.PAIRINGBUDDY_SOLO = "false";
    try {
      assertAllowed(await runGate(stageCall(repo.dir, CONFIG)));
    } finally {
      delete process.env.PAIRINGBUDDY_SOLO;
    }
  }));

test("Solo leaves a workflow of its own alone on an open run", () =>
  withRepo({}, (repo) =>
    withSolo(async () => assertAllowed(await runGate(workflowCall(repo.dir, { name: "mine", script: "export const meta = { name: 'mine' };" }))))));

test("a stage with no run is denied outside any git repository", () =>
  withRepo({ ledger: null, git: false }, async (repo) => {
    assertDenied(await runGate(stageCall(repo.dir, SAFETY_NET)), MESSAGES.noRun(SAFETY_NET));
  }));

test("an empty run directory is no run, so a stage is denied", () =>
  withRepo({ ledger: null }, async (repo) => {
    mkdirSync(join(repo.dir, ".pairingbuddy", "run"), { recursive: true });

    assertDenied(await runGate(stageCall(repo.dir, CONFIG)), MESSAGES.noRun(CONFIG));
  }));

test("a stage with no run is denied on a payload missing the fields a run requires", () =>
  withRepo({ ledger: null }, async (repo) => {
    const { session_id: _session, permission_mode: _mode, ...payload } = stageCall(repo.dir, CONFIG);

    assertDenied(await runGate(payload), MESSAGES.noRun(CONFIG));
  }));

const ADDED_STAGE = "code-added";
const CONTRACT_WITH_ADDED_STAGE = () => {
  const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));
  contract.taskTypes.other_type = { nodes: [{ name: ADDED_STAGE, gate: null, evidence: [] }], gates: {} };
  return contract;
};
const ADDED_BUNDLE = "export const meta = { name: 'code-added' };\n";

test("the stages come from the contract: a stage added to any task type is denied by name", () =>
  withPlugin({ contract: CONTRACT_WITH_ADDED_STAGE() }, (pluginRoot) =>
    withRepo({ ledger: null }, async (repo) => {
      assertDenied(await runGate(stageCall(repo.dir, ADDED_STAGE), { pluginRoot }), MESSAGES.noRun(ADDED_STAGE));
    })));

test("the stages come from the contract: a copy of an added stage's bundle is denied", () =>
  withPlugin({ contract: CONTRACT_WITH_ADDED_STAGE(), bundles: { [ADDED_STAGE]: ADDED_BUNDLE } }, (pluginRoot) =>
    withRepo({ ledger: null }, async (repo) => {
      assertDenied(await runGate(workflowCall(repo.dir, { script: ADDED_BUNDLE }), { pluginRoot }), MESSAGES.noRun(ADDED_STAGE));
    })));

test("a stage whose bundle is not built is still denied by name", () =>
  withPlugin({ bundles: {} }, (pluginRoot) =>
    withRepo({ ledger: null }, async (repo) => {
      assertDenied(await runGate(stageCall(repo.dir, CONFIG), { pluginRoot }), MESSAGES.noRun(CONFIG));
    })));

test("a Workflow outside a run does not load the rules module", async () => {
  const plugin = realpathSync(mkdtempSync(join(tmpdir(), "gate-no-rules-")));
  try {
    for (const dir of ["hooks", "shared-node", "contracts"]) cpSync(join(ROOT, dir), join(plugin, dir), { recursive: true });
    rmSync(join(plugin, "shared-node", "gate-rules.mjs"));

    await withRepo({ ledger: null }, async (repo) => {
      const gate = join(plugin, "hooks", "gate-boot.mjs");
      assertDenied(await runGate(stageCall(repo.dir, CONFIG), { gate, pluginRoot: plugin }), MESSAGES.noRun(CONFIG));
      assertAllowed(await runGate(workflowCall(repo.dir, { name: "mine" }), { gate, pluginRoot: plugin }));
    });
  } finally {
    rmSync(plugin, { recursive: true, force: true });
  }
});

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

      const result = await runGate(stageCall(repo.dir, SAFETY_NET, { pluginRoot, attempt: 1, task: { description: "set x" } }), { pluginRoot });

      assertAllowed(result);
      assertMarkedActive(readLedger(repo.ledgerPath).stage, SAFETY_NET, 1, since);
    })));

test("the next stage is denied and nothing is marked when its built bundle is missing", () =>
  withPlugin({ bundles: { [CONFIG]: BUNDLE } }, (pluginRoot) =>
    withRepo({ ledger: makeLedger(CONFIG_DONE) }, (repo) =>
      assertDeniedWithoutWrite(
        repo,
        stageCall(repo.dir, SAFETY_NET, { pluginRoot, attempt: 1, task: { description: "set x" } }),
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
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2, task: { description: "set x" } }), MESSAGES.secondActive(CONFIG, 2, workflowName(CONFIG)))));

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

    const result = await runGate(stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2, task: { description: "set x" } }));

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

    assertAllowed(await runGate(stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2, task: { description: "set x" } })));

    assertMarkedActive(readLedger(repo.ledgerPath).stage, CONFIG, 2, since);
    assertDeniedWithinLease(await runGate(stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2, task: { description: "set x" } })), CONFIG, 2, workflowName(CONFIG), START_LEASE_SECONDS - 10, START_LEASE_SECONDS);
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
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 3, task: { description: "set x" } }), MESSAGES.attempt(workflowName(CONFIG), 3, 2))));

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

    const result = await runGate(stageCall(repo.dir, CONFIG, { pluginRoot: ROOT, attempt: 2, task: { description: "set x" } }));

    assertAllowed(result);
    assertMarkedActive(readLedger(repo.ledgerPath).stage, CONFIG, 2, since);
  }));

test("a failed stage still holds back the stage after it", () =>
  withRepo({ ledger: makeLedger(CONFIG_FAILED) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, SAFETY_NET), MESSAGES.order(workflowName(SAFETY_NET), workflowName(CONFIG)))));

// ---------- pluginRoot ----------

const wrongPluginRoot = (expected, got) => `Wrong pluginRoot for ${workflowName(CONFIG)}: got ${JSON.stringify(got)}. Use pluginRoot ${expected}.`;

test("symlinked-plugin-root-accepted", () =>
  withPlugin({}, (pluginRoot) =>
    withRepo({}, async (repo) => {
      const parent = realpathSync(mkdtempSync(join(tmpdir(), "gate-link-")));
      try {
        const link = join(parent, "plugin-link");
        symlinkSync(pluginRoot, link);

        const result = await runGate(stageCall(repo.dir, CONFIG, { pluginRoot: link, attempt: 1, task: { description: "set x" } }), { pluginRoot });

        assertAllowed(result);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    })));

test("different-real-root-denied-unchanged-message", () =>
  withPlugin({}, (pluginRoot) =>
    withPlugin({}, (other) =>
      withRepo({}, (repo) =>
        assertDeniedWithoutWrite(
          repo,
          stageCall(repo.dir, CONFIG, { pluginRoot: other, attempt: 1, task: { description: "set x" } }),
          wrongPluginRoot(pluginRoot, other),
          { pluginRoot },
        )))));

test("nonexistent-root-falls-back-to-string", () =>
  withPlugin({}, (pluginRoot) =>
    withRepo({}, (repo) => {
      const missing = join(pluginRoot, "does-not-exist");
      return assertDeniedWithoutWrite(
        repo,
        stageCall(repo.dir, CONFIG, { pluginRoot: missing, attempt: 1, task: { description: "set x" } }),
        wrongPluginRoot(pluginRoot, missing),
        { pluginRoot },
      );
    })));

for (const wrong of ["/x", "", undefined]) {
  test(`pluginRoot ${JSON.stringify(wrong)} is denied with the right value`, () =>
    withRepo({}, (repo) =>
      assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot: wrong, attempt: 1 }), MESSAGES.pluginRoot(workflowName(CONFIG), wrong))));
}

// A stage refuses these inside the workflow, after the gate marked it active, and that strands it where no Stop hook speaks.
const PLACEHOLDERS = [
  { description: "<this task>" },
  { description: " <this task> " },
  { description: "<task>" },
  { description: "<the task description>", context: "c" },
  "<this task>",
];

for (const wrong of PLACEHOLDERS) {
  test(`a placeholder for the task is denied: ${JSON.stringify(wrong)}`, () =>
    withRepo({}, (repo) =>
      assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { ...GOOD_ARGS, task: wrong }), MESSAGES.placeholder(workflowName(CONFIG), wrong))));
}

for (const task of [{ description: "Render <div> tags" }, { description: "a <b> c" }, "plain text"]) {
  test(`a task that only holds angle brackets starts: ${JSON.stringify(task)}`, () =>
    withRepo({}, async (repo) => {
      assertAllowed(await runGate(stageCall(repo.dir, CONFIG, { ...GOOD_ARGS, task })));
    }));
}

test("a run that stored no task asks for one without a placeholder in the deny", () =>
  withRepo({ ledger: { ...makeLedger(), task: "" } }, async (repo) => {
    const { permissionDecisionReason: reason } = JSON.parse((await runGate(stageCall(repo.dir, CONFIG, { ...GOOD_ARGS, task: undefined }))).stdout).hookSpecificOutput;
    assert.doesNotMatch(reason, /<[^>]*>/);
    assert.match(reason, /a description/);
  }));

for (const wrong of ["", null, undefined]) {
  test(`task ${JSON.stringify(wrong)} is denied at the gate, so no stage is left active`, () =>
    withRepo({}, (repo) =>
      assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { ...GOOD_ARGS, task: wrong }), MESSAGES.task(workflowName(CONFIG), wrong))));
}

test("a restart still needs the task", () =>
  withRepo({ stage: unstartedStage(CONFIG) }, (repo) =>
    assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { ...GOOD_ARGS, task: undefined }), MESSAGES.task(workflowName(CONFIG), undefined))));

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
        stageCall(repo.dir, SAFETY_NET, { pluginRoot, attempt: 1, task: { description: "set x" } }, { script: BUNDLE }),
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
      const args = { pluginRoot, attempt: 1, task: { description: "set x" } };

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
      assertAllowed(await runGate(stageCall(repo.dir, OTHER_FIRST, { pluginRoot, attempt: 1, task: { description: "set x" } }), { pluginRoot }));

      assert.equal(readLedger(repo.ledgerPath).stage.name, OTHER_FIRST);
    })));

test("a stage from the default task type is denied when the ledger holds another type", () =>
  withPlugin(OTHER_RUN.plugin, (pluginRoot) =>
    withRepo({ ledger: OTHER_RUN.ledger }, (repo) =>
      assertDeniedWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot, attempt: 1, task: { description: "set x" } }), MESSAGES.order(workflowName(CONFIG), workflowName(OTHER_FIRST)), { pluginRoot }))));

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

test("every migrated type needs a stage graph, and the list must be a list", () => {
  const contract = VALID_CONTRACT();
  delete contract.taskTypes.spike;

  assert.match(validateStages({ ...contract, migratedTypes: ["spike"] }).join(), /migrated type spike has no stage graph/);
  for (const migratedTypes of [undefined, "config_change", [1]]) assert.match(validateStages({ ...contract, migratedTypes }).join(), /migratedTypes/);
});

test("pipelineAgents reads only the agents section", () =>
  withPlugin({}, async (pluginRoot) => {
    writeFileSync(join(pluginRoot, "contracts", "agent-config.yaml"), "schemas:\n  a-schema: x\nagents:\n  real-agent:\n    model: y\nfocus_warning:\n  not-an-agent: z\n");

    assert.deepEqual([...pipelineAgents(pluginRoot)], ["real-agent"]);
  }));

// ---------- Task 24 helpers ----------
// Deny reasons here are matched on the fact they must name, so wording stays with the gate.

const fileCall = (cwd, toolName, toolInput) => ({ ...fixture("pretooluse-workflow.json"), cwd, tool_name: toolName, tool_input: toolInput });
const writeCall = (cwd, filePath, content = "x\n") => fileCall(cwd, "Write", { file_path: filePath, content });
const editCall = (cwd, filePath, oldString = "old", newString = "new", extra = {}) =>
  fileCall(cwd, "Edit", { file_path: filePath, old_string: oldString, new_string: newString, replace_all: false, ...extra });

function asSubagent(payload) {
  const { agent_id, agent_type } = fixture("pretooluse-workflow-agent-bash.json");
  return { ...payload, agent_id, agent_type };
}

function assertDeniedNaming(result, pattern) {
  assert.equal(result.code, 0, `the JSON deny form needs exit 0, a crash fails open; stderr: ${result.stderr}`);
  assert.notEqual(result.stdout, "", "expected a deny, got a silent allow");
  const { hookEventName, permissionDecision, permissionDecisionReason: reason } = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(hookEventName, "PreToolUse");
  assert.equal(permissionDecision, "deny");
  assert.match(reason, pattern);
}

async function assertDeniedNamingWithoutWrite(repo, payload, pattern, gateOptions) {
  const before = readFileSync(repo.ledgerPath, "utf8");

  const result = await runGate(payload, gateOptions);

  assertDeniedNaming(result, pattern);
  assert.equal(readFileSync(repo.ledgerPath, "utf8"), before, "a deny leaves the ledger untouched");
}

function touch(dir, relative, text = "old\n") {
  const path = join(dir, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

function makeSubdir(repo, relative = "src/deep") {
  const path = join(repo.dir, relative);
  mkdirSync(path, { recursive: true });
  return path;
}

async function withElsewhere(fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-elsewhere-")));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const notebookCall = (cwd, notebookPath) => fileCall(cwd, "NotebookEdit", { notebook_path: notebookPath, new_source: "x", edit_mode: "replace" });

const FILE_TOOLS = [["Write", writeCall], ["Edit", editCall], ["NotebookEdit", notebookCall]];

// ---------- Task 24 registration ----------

test("the gate's matcher also covers Write, Edit and NotebookEdit", () => {
  const { hooks } = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
  const [entry] = hooks.PreToolUse.filter((e) => e.hooks.some((h) => h.command.includes("hooks/gate-boot.mjs")));

  const matches = (tool) => new RegExp(`^(?:${entry.matcher || ".*"})$`).test(tool);

  assert.ok(matches("Write"), "the matcher must cover Write");
  assert.ok(matches("Edit"), "the matcher must cover Edit");
  assert.ok(matches("NotebookEdit"), "the matcher must cover NotebookEdit");
});

// ---------- protected paths ----------

const RUN_PATTERN = /\.pairingbuddy\/run/;
const TEST_CONFIG_PATTERN = /test-config\.json/;
const GIT_CONFIG_PATTERN = /git-config\.json/;
const SETTINGS_PATTERN = /\.claude\/settings/;

const PROTECTED_PATHS = [
  [".pairingbuddy/run/task/ledger.json", RUN_PATTERN],
  [".pairingbuddy/run/task/artifacts/apply.json", RUN_PATTERN],
  [".pairingbuddy/run/task/report.json", RUN_PATTERN],
  [".pairingbuddy/run/unit.json", RUN_PATTERN],
  [".pairingbuddy/run/pr-body.md", RUN_PATTERN],
  [".pairingbuddy/test-config.json", TEST_CONFIG_PATTERN],
  [".pairingbuddy/git-config.json", GIT_CONFIG_PATTERN],
  [".claude/settings.json", SETTINGS_PATTERN],
  [".claude/settings.local.json", SETTINGS_PATTERN],
];

for (const [toolName, call] of FILE_TOOLS) {
  for (const [path, pattern] of PROTECTED_PATHS) {
    test(`${toolName} to ${path} is denied during a run`, () =>
      withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, call(repo.dir, join(repo.dir, path)), pattern)));

    test(`${toolName} to ${path} is denied for a subagent during a run`, () =>
      withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, asSubagent(call(repo.dir, join(repo.dir, path))), pattern)));

    test(`${toolName} to ${path} is allowed outside a run`, () =>
      withRepo({ ledger: null }, async (repo) => {
        assertAllowed(await runGate(call(repo.dir, join(repo.dir, path))));
      }));
  }
}

for (const [label, path] of [
  ["user-level settings, which set a hook's environment too", (home) => join(home, ".claude", "settings.json")],
  ["another letter case of a file that does not exist yet", (home) => join(home, ".claude", "Settings.Local.JSON")],
  ["another letter case of the directory", (home) => join(home, ".CLAUDE", "settings.json")],
]) {
  test(`Write to ${label} is denied during a run`, () =>
    withRepo({}, (repo) => withElsewhere((home) => {
      mkdirSync(join(home, ".claude"));

      return assertDeniedNamingWithoutWrite(repo, writeCall(repo.dir, path(home)), SETTINGS_PATTERN);
    })));
}

test("a symlink to .claude/settings.local.json is denied during a run", () =>
  withRepo({}, (repo) => {
    mkdirSync(join(repo.dir, ".claude"));
    symlinkSync(join(repo.dir, ".claude", "settings.local.json"), join(repo.dir, "notes.json"));

    return assertDeniedNamingWithoutWrite(repo, writeCall(repo.dir, "notes.json"), SETTINGS_PATTERN);
  }));

for (const path of [".claude/agents/x.md", ".claude/settings.json.bak", "claude/settings.json", "settings.json"]) {
  test(`Write to ${path} is allowed during a run`, () =>
    withRepo({}, async (repo) => {
      assertAllowed(await runGate(writeCall(repo.dir, path)));
    }));
}

test("a publish unit with no task ledger still counts as run state and protects the run directory", () =>
  withRepo({ ledger: null }, async (repo) => {
    const unit = touch(repo.dir, ".pairingbuddy/run/unit.json", "{}\n");

    assertDeniedNaming(await runGate(writeCall(repo.dir, unit)), RUN_PATTERN);
  }));

// ---------- path tricks ----------

// Each builder returns the cwd and file_path of the call, after making any links it needs.
const PATH_TRICKS = [
  ["a path relative to the cwd", ({ dir }) => [dir, ".pairingbuddy/run/task/ledger.json"], RUN_PATTERN],
  ["a dotted path with doubled slashes", ({ dir }) => [dir, "./.pairingbuddy//run/./task/ledger.json"], RUN_PATTERN],
  ["a relative path climbing out of a subdirectory", (repo) => [makeSubdir(repo), "../../.pairingbuddy/run/task/ledger.json"], RUN_PATTERN],
  ["an absolute path with .. segments", (repo) => [repo.dir, `${makeSubdir(repo)}/../../.pairingbuddy/run/unit.json`], RUN_PATTERN],
  ["a .. through a directory that does not exist", ({ dir }) => [dir, `${dir}/nope/nada/../../.pairingbuddy/run/unit.json`], RUN_PATTERN],
  ["a new file in a new directory under the run dir", ({ dir }) => [dir, ".pairingbuddy/run/task/artifacts/new/thing.json"], RUN_PATTERN],
  ["a relative path to a config file through ..", (repo) => [makeSubdir(repo), "../../.pairingbuddy/../.pairingbuddy/git-config.json"], GIT_CONFIG_PATTERN],
  ["a symlink to the ledger file", ({ dir, ledgerPath }) => {
    symlinkSync(ledgerPath, join(dir, "notes.json"));
    return [dir, join(dir, "notes.json")];
  }, RUN_PATTERN],
  ["a relative symlink to the ledger file", ({ dir }) => {
    symlinkSync(".pairingbuddy/run/task/ledger.json", join(dir, "notes.json"));
    return [dir, "notes.json"];
  }, RUN_PATTERN],
  ["a chain of symlinks to the ledger file", ({ dir, ledgerPath }) => {
    symlinkSync(ledgerPath, join(dir, "first.json"));
    symlinkSync(join(dir, "first.json"), join(dir, "second.json"));
    return [dir, join(dir, "second.json")];
  }, RUN_PATTERN],
  ["a symlinked directory leading into the run dir", ({ dir }) => {
    symlinkSync(join(dir, ".pairingbuddy", "run"), join(dir, "state"));
    return [dir, "state/task/ledger.json"];
  }, RUN_PATTERN],
  ["a new file beneath a symlinked directory", ({ dir }) => {
    symlinkSync(join(dir, ".pairingbuddy", "run"), join(dir, "state"));
    return [dir, "state/task/new.json"];
  }, RUN_PATTERN],
  ["a symlink to the .pairingbuddy directory", ({ dir }) => {
    symlinkSync(join(dir, ".pairingbuddy"), join(dir, "pb"));
    return [dir, "pb/run/unit.json"];
  }, RUN_PATTERN],
  ["a dangling symlink to a new file in the run dir", ({ dir }) => {
    symlinkSync(join(dir, ".pairingbuddy", "run", "task", "new.json"), join(dir, "dangling.json"));
    return [dir, "dangling.json"];
  }, RUN_PATTERN],
  ["a symlink to test-config.json", ({ dir }) => {
    const config = touch(dir, ".pairingbuddy/test-config.json");
    symlinkSync(config, join(dir, "harmless.json"));
    return [dir, "harmless.json"];
  }, TEST_CONFIG_PATTERN],
  ["a symlink outside the repo pointing into the run dir", ({ ledgerPath }, elsewhere) => {
    symlinkSync(ledgerPath, join(elsewhere, "notes.json"));
    return [elsewhere, join(elsewhere, "notes.json")];
  }, RUN_PATTERN],
  ["a symlinked alias of the repo as both cwd and path", ({ dir }, elsewhere) => {
    const alias = join(elsewhere, "alias");
    symlinkSync(dir, alias);
    return [alias, join(alias, ".pairingbuddy/run/unit.json")];
  }, RUN_PATTERN],
  ["a .. taken after a symlinked directory", ({ dir }) => {
    symlinkSync(join(dir, ".pairingbuddy", "run", "task", "artifacts"), join(dir, "out"));
    mkdirSync(join(dir, ".pairingbuddy", "run", "task", "artifacts"));
    return [dir, "out/../ledger.json"];
  }, RUN_PATTERN],
  ["an absolute path into the run dir from a cwd outside the repo", ({ ledgerPath }, elsewhere) => [elsewhere, ledgerPath], RUN_PATTERN],
];

for (const [toolName, call] of FILE_TOOLS) {
  for (const [label, build, pattern] of PATH_TRICKS) {
    test(`${toolName} through ${label} is denied during a run`, () =>
      withElsewhere((elsewhere) =>
        withRepo({}, (repo) => {
          const [cwd, filePath] = build(repo, elsewhere);

          return assertDeniedNamingWithoutWrite(repo, call(cwd, filePath), pattern);
        })));
  }
}

const CASE_INSENSITIVE_FS = existsSync(join(ROOT, "HOOKS", "GATE.MJS"));

test("Write with another letter case of the run dir is denied on a case-insensitive filesystem", { skip: !CASE_INSENSITIVE_FS }, () =>
  withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, writeCall(repo.dir, ".PairingBuddy/RUN/task/ledger.json"), RUN_PATTERN)));

// ---------- paths left open during a run ----------

for (const [toolName, call] of FILE_TOOLS) {
  for (const path of [
    "src/app.py",
    ".pairingbuddy/task.json",
    ".pairingbuddy/human-guidance.json",
    ".pairingbuddy/run.json",
    ".pairingbuddy/runner/notes.json",
    "docs/run/notes.md",
    "docs/test-config.json",
  ]) {
    test(`${toolName} to ${path} is allowed during a run`, () =>
      withRepo({}, async (repo) => {
        assertAllowed(await runGate(call(repo.dir, path)));
      }));
  }

  test(`${toolName} outside the repo is allowed during a run`, () =>
    withElsewhere((elsewhere) =>
      withRepo({}, async (repo) => {
        assertAllowed(await runGate(call(repo.dir, join(elsewhere, "scratch.txt"))));
      })));
}

// ---------- plan checkboxes ----------

const PLAN = "docs/plans/plan.md";
const PLAN_TEXT = "# Plan\n\n- [ ] Task 1\n\n  Some notes.\n\n- [x] Task 2\n\n  - [ ] Sub step\n";
const CHECKBOX_PATTERN = /checkbox/;

function planLedger(path = PLAN) {
  return { ...makeLedger(), plan: { path, title: "Plan" } };
}

async function withPlanRepo(fn, planPath = () => PLAN) {
  const repo = makeRepo({ ledger: null });
  try {
    mkdirSync(dirname(repo.ledgerPath), { recursive: true });
    writeLedger(repo.ledgerPath, planLedger(planPath(repo.dir)));
    touch(repo.dir, PLAN, PLAN_TEXT);
    await fn(repo);
  } finally {
    repo.cleanup();
  }
}

for (const [label, oldString, newString, extra] of [
  ["ticking a box", "- [ ] Task 1", "- [x] Task 1"],
  ["ticking a box with an edit that cuts the marker in half", " ] Task 1", "x] Task 1"],
  ["ticking a box with an edit of the brackets alone", "[ ] Task 1", "[x] Task 1"],
  ["unticking a box", "- [x] Task 2", "- [ ] Task 2"],
  ["ticking a box with a capital X", "- [ ] Task 1", "- [X] Task 1"],
  ["ticking an indented box", "  - [ ] Sub step", "  - [x] Sub step"],
  ["ticking every open box with replace_all", "- [ ]", "- [x]", { replace_all: true }],
  ["swapping two boxes so the counts stay equal", "- [ ] Task 1\n\n  Some notes.\n\n- [x] Task 2", "- [x] Task 1\n\n  Some notes.\n\n- [ ] Task 2"],
]) {
  test(`a main-context Edit ${label} in the plan is denied during a run`, () =>
    withPlanRepo((repo) => assertDeniedNamingWithoutWrite(repo, editCall(repo.dir, PLAN, oldString, newString, extra), CHECKBOX_PATTERN)));
}

for (const [label, content] of [
  ["ticking a box", PLAN_TEXT.replace("- [ ] Task 1", "- [x] Task 1")],
  ["ticking a box alongside a prose change", PLAN_TEXT.replace("- [ ] Task 1", "- [x] Task 1").replace("Some notes.", "Other notes.")],
  ["swapping two boxes so the counts stay equal", PLAN_TEXT.replace("- [ ] Task 1", "- [x] Task 1").replace("- [x] Task 2", "- [ ] Task 2")],
]) {
  test(`a main-context Write ${label} in the plan is denied during a run`, () =>
    withPlanRepo((repo) => assertDeniedNamingWithoutWrite(repo, writeCall(repo.dir, PLAN, content), CHECKBOX_PATTERN)));
}

for (const [label, oldString] of [
  ["an open box line", "- [ ] Task 1\n"],
  ["a ticked box line", "- [x] Task 2\n"],
  ["an indented box line", "  - [ ] Sub step\n"],
]) {
  test(`a main-context Edit deleting ${label} from the plan is denied during a run`, () =>
    withPlanRepo((repo) => assertDeniedNamingWithoutWrite(repo, editCall(repo.dir, PLAN, oldString, ""), CHECKBOX_PATTERN)));
}

test("a main-context Write dropping a box line from the plan is denied during a run", () =>
  withPlanRepo((repo) => assertDeniedNamingWithoutWrite(repo, writeCall(repo.dir, PLAN, PLAN_TEXT.replace("- [ ] Task 1\n", "")), CHECKBOX_PATTERN)));

test("an Edit turning a box into a plain list item in the plan is denied during a run", () =>
  withPlanRepo((repo) => assertDeniedNamingWithoutWrite(repo, editCall(repo.dir, PLAN, "- [ ] Task 1", "- Task 1"), CHECKBOX_PATTERN)));

test("a Write adding a ticked box to the plan is denied during a run", () =>
  withPlanRepo((repo) => assertDeniedNamingWithoutWrite(repo, writeCall(repo.dir, PLAN, `${PLAN_TEXT}\n- [x] Task 3\n`), CHECKBOX_PATTERN)));

test("a Write swapping the ticks between two titles is denied during a run", () =>
  withPlanRepo((repo) => {
    writeFileSync(join(repo.dir, PLAN), "- [ ] Task A\n- [x] Task B\n");

    return assertDeniedNamingWithoutWrite(repo, writeCall(repo.dir, PLAN, "- [ ] Task B\n- [x] Task A\n"), CHECKBOX_PATTERN);
  }));

test("an Edit swapping the labels of two boxes is denied during a run", () =>
  withPlanRepo((repo) => {
    writeFileSync(join(repo.dir, PLAN), "- [ ] Task A\n- [x] Task B\n");

    return assertDeniedNamingWithoutWrite(repo, editCall(repo.dir, PLAN, "- [ ] Task A\n- [x] Task B", "- [ ] Task B\n- [x] Task A"), CHECKBOX_PATTERN);
  }));

test("a tick moved onto a title that has a twin is denied during a run", () =>
  withPlanRepo((repo) => {
    writeFileSync(join(repo.dir, PLAN), "- [ ] Twin\n- [ ] Twin\n- [x] Other\n");

    return assertDeniedNamingWithoutWrite(repo, writeCall(repo.dir, PLAN, "- [x] Twin\n- [ ] Twin\n- [ ] Other\n"), CHECKBOX_PATTERN);
  }));

test("two boxes swapping places, each keeping its tick, is allowed during a run", () =>
  withPlanRepo(async (repo) => {
    writeFileSync(join(repo.dir, PLAN), "- [ ] Task A\n- [x] Task B\n");

    assertAllowed(await runGate(writeCall(repo.dir, PLAN, "- [x] Task B\n- [ ] Task A\n")));
  }));

const TICK = ["- [ ] Task 1", "- [x] Task 1"];

for (const [label, build] of [
  ["an absolute path", ({ dir }) => [dir, join(dir, PLAN)]],
  ["a relative path climbing out of a subdirectory", (repo) => [makeSubdir(repo), `../../${PLAN}`]],
  ["a path with .. segments", ({ dir }) => [dir, "docs/plans/../plans/plan.md"]],
  ["a symlink to the plan", ({ dir }) => {
    symlinkSync(join(dir, PLAN), join(dir, "todo.md"));
    return [dir, "todo.md"];
  }],
  ["a symlinked directory holding the plan", ({ dir }) => {
    symlinkSync(join(dir, "docs", "plans"), join(dir, "plans"));
    return [dir, "plans/plan.md"];
  }],
]) {
  test(`a checkbox change reaching the plan through ${label} is denied during a run`, () =>
    withPlanRepo((repo) => {
      const [cwd, filePath] = build(repo);

      return assertDeniedNamingWithoutWrite(repo, editCall(cwd, filePath, ...TICK), CHECKBOX_PATTERN);
    }));
}

test("a checkbox change is denied when the ledger holds the plan path as absolute", () =>
  withPlanRepo((repo) => assertDeniedNamingWithoutWrite(repo, editCall(repo.dir, PLAN, ...TICK), CHECKBOX_PATTERN), (dir) => join(dir, PLAN)));

test("a subagent's checkbox change in the plan is denied during a run", () =>
  withPlanRepo((repo) => assertDeniedNamingWithoutWrite(repo, asSubagent(editCall(repo.dir, PLAN, ...TICK)), CHECKBOX_PATTERN)));

test("a plan the hook cannot read denies an Edit, since old and new text cannot be compared", () =>
  withPlanRepo((repo) => {
    chmodSync(join(repo.dir, PLAN), 0o000);

    return assertDeniedNamingWithoutWrite(repo, editCall(repo.dir, PLAN, "Some notes.", "Other notes."), /./);
  }));

for (const [label, payload] of [
  ["an Edit of prose in the plan", (cwd) => editCall(cwd, PLAN, "Some notes.", "Other notes.")],
  ["an Edit of a checkbox label that keeps its state", (cwd) => editCall(cwd, PLAN, "- [ ] Task 1", "- [ ] Task 1: renamed")],
  ["a Write of the plan that keeps every box", (cwd) => writeCall(cwd, PLAN, PLAN_TEXT.replace("Some notes.", "Other notes."))],
  ["a Write adding an open box to the plan", (cwd) => writeCall(cwd, PLAN, `${PLAN_TEXT}\n- [ ] Task 3\n`)],
  ["a Write moving a box line within the plan", (cwd) => writeCall(cwd, PLAN, `# Plan\n\n- [x] Task 2\n\n  - [ ] Sub step\n\n- [ ] Task 1\n\n  Some notes.\n`)],
  ["an Edit of a box between the two spellings of a tick", (cwd) => editCall(cwd, PLAN, "- [x] Task 2", "- [X] Task 2")],
  ["a tick in another markdown file", (cwd) => editCall(cwd, "docs/other.md", ...TICK)],
]) {
  test(`${label} is allowed during a run`, () =>
    withPlanRepo(async (repo) => {
      touch(repo.dir, "docs/other.md", PLAN_TEXT);

      assertAllowed(await runGate(payload(repo.dir)));
    }));
}

test("a run with no plan path leaves markdown checkboxes alone", () =>
  withRepo({}, async (repo) => {
    touch(repo.dir, PLAN, PLAN_TEXT);

    assertAllowed(await runGate(editCall(repo.dir, PLAN, ...TICK)));
  }));

test("a checkbox change is allowed outside a run", () =>
  withRepo({ ledger: null }, async (repo) => {
    touch(repo.dir, PLAN, PLAN_TEXT);

    assertAllowed(await runGate(editCall(repo.dir, PLAN, ...TICK)));
  }));

// ---------- fail closed ----------

const CALLS_DURING_A_RUN = [
  ["a Workflow stage call", (cwd) => stageCall(cwd, CONFIG)],
  ["an Agent call for a non-pipeline agent", (cwd) => agentCall(cwd, "general-purpose")],
  ["a Write to an open path", (cwd) => writeCall(cwd, "src/app.py")],
  ["an Edit of an open path", (cwd) => editCall(cwd, "src/app.py")],
  ["a NotebookEdit of an open path", (cwd) => notebookCall(cwd, "src/app.ipynb")],
];

const handEdited = (text) => text.replace('"task": "Task 23"', '"task": "Task 99"');

for (const [corruption, corrupt, pattern] of [
  ["invalid JSON", () => '{"v":1,', /not valid JSON/],
  ["an empty file", () => "", /not valid JSON/],
  ["an unsupported version", () => '{"v":2}', /unsupported version/],
  ["a hand edit", handEdited, /sha mismatch/],
]) {
  for (const [label, call] of CALLS_DURING_A_RUN) {
    test(`a ledger holding ${corruption} denies ${label}`, () =>
      withRepo({}, async (repo) => {
        writeFileSync(repo.ledgerPath, corrupt(readFileSync(repo.ledgerPath, "utf8")));

        assertDeniedNaming(await runGate(call(repo.dir)), pattern);
      }));
  }
}

test("a ledger path that is a directory denies a Write", () =>
  withRepo({}, async (repo) => {
    rmSync(repo.ledgerPath);
    mkdirSync(repo.ledgerPath);

    assertDeniedNaming(await runGate(writeCall(repo.dir, "src/app.py")), /cannot read ledger/);
  }));

for (const [label, call] of [
  ["a Workflow stage call", (cwd) => stageCall(cwd, CONFIG)],
  ["an Agent call for a pipeline agent", (cwd) => agentCall(cwd, "pairingbuddy:apply-config-change")],
  ["a Write to an open path", (cwd) => writeCall(cwd, "src/app.py")],
]) {
  test(`an unknown task type denies ${label}`, () =>
    withRepo({ ledger: { ...makeLedger(), taskType: "nope" } }, async (repo) => {
      assertDeniedNaming(await runGate(call(repo.dir)), /no stage graph for task type nope/);
    }));
}

const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

test("a stale lock that cannot be cleared denies a stage start", () =>
  withRepo({}, async (repo) => {
    const lock = `${repo.ledgerPath}.lock`;
    writeFileSync(lock, "dead-owner");
    utimesSync(lock, LONG_AGO, LONG_AGO);
    chmodSync(dirname(repo.ledgerPath), 0o555);
    try {
      assertDeniedNaming(await runGate(stageCall(repo.dir, CONFIG)), /EACCES/);
    } finally {
      chmodSync(dirname(repo.ledgerPath), 0o755);
    }
  }));

test("a stale lock that can be cleared lets a stage start", () =>
  withRepo({}, async (repo) => {
    const lock = `${repo.ledgerPath}.lock`;
    writeFileSync(lock, "dead-owner");
    utimesSync(lock, LONG_AGO, LONG_AGO);

    assertAllowed(await runGate(stageCall(repo.dir, CONFIG)));
  }));

const INVALID_CONTRACT = () => {
  const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));
  contract.taskTypes.config_change.nodes.push(null);
  return contract;
};

test("an invalid stage contract denies a stage call during a run", () =>
  withPlugin({ contract: INVALID_CONTRACT() }, (pluginRoot) =>
    withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, stageCall(repo.dir, CONFIG, { pluginRoot, attempt: 1, task: { description: "set x" } }), /is invalid/, { pluginRoot }))));

test("a plugin root with no contracts denies a stage call during a run", () =>
  withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, stageCall(repo.dir, CONFIG), /ENOENT/, { pluginRoot: "/nonexistent/plugin" })));

test("a missing agent config denies a direct Agent call during a run", () =>
  withPlugin({}, (pluginRoot) =>
    withRepo({}, (repo) => {
      rmSync(join(pluginRoot, "contracts", "agent-config.yaml"));

      return assertDeniedNamingWithoutWrite(repo, agentCall(repo.dir, "pairingbuddy:apply-config-change"), /ENOENT/, { pluginRoot });
    })));

// With no contract nothing can say this plugin's name is not a stage, and only this plugin's workflows pay for that.
test("an invalid stage contract denies a plugin workflow with no run state", () =>
  withPlugin({ contract: INVALID_CONTRACT() }, (pluginRoot) =>
    withRepo({ ledger: null }, async (repo) => {
      assertDeniedNaming(await runGate(stageCall(repo.dir, CONFIG, { pluginRoot, attempt: 1, task: { description: "set x" } }), { pluginRoot }), /stages\.json is invalid/);
    })));

test("a missing stage contract denies a plugin workflow with no run state", () =>
  withPlugin({}, (pluginRoot) =>
    withRepo({ ledger: null }, async (repo) => {
      rmSync(join(pluginRoot, "contracts", "stages.json"));

      assertDeniedNaming(await runGate(stageCall(repo.dir, CONFIG), { pluginRoot }), /ENOENT/);
    })));

for (const [label, input] of [
  ["a workflow from outside the plugin", { name: "mine" }],
  ["an unnamed inline script", { script: "export const meta = { name: 'mine' };" }],
]) {
  test(`an invalid stage contract allows ${label} silently with no run state`, () =>
    withPlugin({ contract: INVALID_CONTRACT() }, (pluginRoot) =>
      withRepo({ ledger: null }, async (repo) => {
        assertAllowed(await runGate(workflowCall(repo.dir, input), { pluginRoot }));
      })));
}

const BAD_TOOL_INPUTS = [
  ["a Workflow call with no tool_input", (cwd) => ({ ...workflowCall(cwd, {}), tool_input: undefined })],
  ["a Workflow call with a null tool_input", (cwd) => workflowCall(cwd, null)],
  ["an Agent call with no tool_input", (cwd) => ({ ...agentCall(cwd, "x"), tool_input: undefined })],
  ["a Write with no tool_input", (cwd) => fileCall(cwd, "Write", undefined)],
  ["a Write with no file_path", (cwd) => fileCall(cwd, "Write", { content: "x" })],
  ["a Write with a non-string file_path", (cwd) => fileCall(cwd, "Write", { file_path: 7, content: "x" })],
  ["an Edit with no file_path", (cwd) => fileCall(cwd, "Edit", { old_string: "a", new_string: "b" })],
  ["a NotebookEdit with no notebook_path", (cwd) => fileCall(cwd, "NotebookEdit", { new_source: "x" })],
];

for (const [label, call] of BAD_TOOL_INPUTS) {
  test(`${label} denies during a run`, () =>
    withRepo({}, async (repo) => {
      assertDeniedNaming(await runGate(call(repo.dir)), /./);
    }));

  test(`${label} allows silently with no run state`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertAllowed(await runGate(call(repo.dir)));
    }));
}

test("a checkbox change with no new_string on the plan denies during a run", () =>
  withPlanRepo((repo) => assertDeniedNamingWithoutWrite(repo, fileCall(repo.dir, "Edit", { file_path: PLAN, old_string: "- [ ] Task 1" }), /./)));

for (const [label, stdin] of [
  ["malformed JSON", "{not json"],
  ["an empty payload", ""],
  ["a null payload", "null"],
  ["an array payload", "[]"],
]) {
  test(`${label} on stdin denies from a cwd inside a run`, () =>
    withRepo({}, async (repo) => {
      assertDeniedNaming(await runGate(stdin, { processCwd: repo.dir }), /./);
    }));

  test(`${label} on stdin allows silently with no run state`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertAllowed(await runGate(stdin, { processCwd: repo.dir }));
    }));
}

// A copy of the hook with no shared-node beside it, so its own imports fail.
async function withBrokenGate(fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-broken-")));
  try {
    mkdirSync(join(dir, "hooks"));
    copyFileSync(GATE, join(dir, "hooks", "gate.mjs"));
    await fn(join(dir, "hooks", "gate.mjs"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a hook whose imports fail denies during a run", () =>
  withBrokenGate((gate) =>
    withRepo({}, async (repo) => {
      assertDeniedNaming(await runGate(writeCall(repo.dir, "src/app.py"), { gate }), /./);
    })));

test("a hook whose imports fail allows silently with no run state", () =>
  withBrokenGate((gate) =>
    withRepo({ ledger: null }, async (repo) => {
      assertAllowed(await runGate(writeCall(repo.dir, "src/app.py"), { gate }));
    })));

test("a hook whose imports fail denies a plugin workflow with no run state", () =>
  withBrokenGate((gate) =>
    withRepo({ ledger: null }, async (repo) => {
      assertDeniedNaming(await runGate(stageCall(repo.dir, CONFIG), { gate }), /./);
    })));

test("a hook whose imports fail allows a workflow from outside the plugin with no run state", () =>
  withBrokenGate((gate) =>
    withRepo({ ledger: null }, async (repo) => {
      assertAllowed(await runGate(workflowCall(repo.dir, { name: "mine" }), { gate }));
    })));

test("a hook whose imports fail denies a write into a run from outside it", () =>
  withBrokenGate((gate) =>
    withRepo({}, async (repo) => {
      const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "gate-elsewhere-")));
      try {
        assertDeniedNaming(await runGate(writeCall(elsewhere, repo.ledgerPath), { gate }), /./);
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    })));

// A whole copy of the plugin, started as hooks.json starts it, with its gate.mjs broken.
async function withBootOver(breakGate, fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-boot-")));
  try {
    for (const part of ["hooks", "shared-node", "contracts"]) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
    breakGate(join(dir, "hooks", "gate.mjs"));
    await fn(join(dir, "hooks", "gate-boot.mjs"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const RECOVERY = /git -C \S+ checkout -- hooks/;
const GATE_BREAKS = [
  ["a syntax error", (gate) => appendFileSync(gate, "\n)drill: forced parse failure(\n")],
  ["a throw as it loads", (gate) => writeFileSync(gate, 'throw new Error("broken");\n')],
  ["a file that is gone", (gate) => rmSync(gate)],
  ["an import that does not resolve", (gate) => writeFileSync(gate, 'import "./no-such-module.mjs";\n')],
];

for (const [name, breakGate] of GATE_BREAKS) {
  test(`${name} in gate.mjs denies a Write into run state, naming the recovery`, () =>
    withBootOver(breakGate, (gate) =>
      withRepo({}, async (repo) => {
        assertDeniedNaming(await runGate(writeCall(repo.dir, repo.ledgerPath), { gate }), RECOVERY);
      })));

  test(`${name} in gate.mjs denies every other tool during a run`, () =>
    withBootOver(breakGate, (gate) =>
      withRepo({}, async (repo) => {
        assertDeniedNaming(await runGate(stageCall(repo.dir, CONFIG), { gate }), RECOVERY);
      })));

  test(`${name} in gate.mjs denies a write into a run from outside it`, () =>
    withBootOver(breakGate, (gate) =>
      withRepo({}, async (repo) => {
        const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "gate-elsewhere-")));
        try {
          assertDeniedNaming(await runGate(writeCall(elsewhere, repo.ledgerPath), { gate, processCwd: elsewhere }), RECOVERY);
        } finally {
          rmSync(elsewhere, { recursive: true, force: true });
        }
      })));

  test(`${name} in gate.mjs allows silently with no run`, () =>
    withBootOver(breakGate, (gate) =>
      withRepo({ ledger: null }, async (repo) => {
        assertAllowed(await runGate(writeCall(repo.dir, "src/app.py"), { gate }));
      })));
}

test("a broken gate.mjs denies on a payload it cannot read, from the hook's own cwd", () =>
  withBootOver(GATE_BREAKS[0][1], (gate) =>
    withRepo({}, async (repo) => {
      assertDeniedNaming(await runGate("not json", { gate, processCwd: repo.dir }), RECOVERY);
    })));

test("gate-boot.mjs imports node built-ins only, and gate.mjs only dynamically", () => {
  const source = readFileSync(BOOT, "utf8");

  const staticImports = [...source.matchAll(/^import .* from "(.+)";$/gm)].map(([, name]) => name);

  assert.ok(staticImports.length > 0);
  assert.deepEqual(staticImports.filter((name) => !name.startsWith("node:")), []);
  assert.match(source, /await import\("\.\/gate\.mjs"\)/);
});

test("a hook missing only the run-root module denies during a run", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-partial-")));
  try {
    mkdirSync(join(dir, "hooks"));
    copyFileSync(GATE, join(dir, "hooks", "gate.mjs"));
    cpSync(join(ROOT, "shared-node"), join(dir, "shared-node"), { recursive: true });
    cpSync(join(ROOT, "contracts"), join(dir, "contracts"), { recursive: true });
    rmSync(join(dir, "shared-node", "run-root.mjs"), { force: true });
    await withRepo({}, async (repo) => {
      assertDeniedNaming(await runGate(writeCall(repo.dir, "src/app.py"), { gate: join(dir, "hooks", "gate.mjs") }), /./);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty run directory does not hide the run above it", () =>
  withRepo({}, async (repo) => {
    const nested = join(repo.dir, "vendor", "lib");
    mkdirSync(join(nested, ".pairingbuddy", "run"), { recursive: true });

    // An Agent call has no target path, so only the walk from the cwd can reach the run.
    await assertDeniedNamingWithoutWrite(repo, agentCall(nested, "pairingbuddy:apply-config-change"), /Direct Agent call/);
  }));

test("an empty run directory with nothing above it allows silently", () =>
  withRepo({ ledger: null }, async (repo) => {
    mkdirSync(join(repo.dir, ".pairingbuddy", "run"), { recursive: true });

    assertAllowed(await runGate(writeCall(repo.dir, "src/app.py")));
  }));

const NO_GIT_PATH = "/nonexistent/bin";

test("git being unavailable does not hide run state", () =>
  withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, writeCall(repo.dir, repo.ledgerPath), RUN_PATTERN, { path: NO_GIT_PATH })));

test("git being unavailable allows silently with no run state", () =>
  withRepo({ ledger: null }, async (repo) => {
    assertAllowed(await runGate(writeCall(repo.dir, "src/app.py"), { path: NO_GIT_PATH }));
  }));

// ---------- drift: missing fields ----------

const without = (payload, field) => {
  const { [field]: _dropped, ...rest } = payload;
  return rest;
};

for (const field of ["session_id", "cwd", "tool_name", "permission_mode"]) {
  for (const [label, call] of CALLS_DURING_A_RUN) {
    test(`a missing ${field} denies ${label} during a run`, () =>
      withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, without(call(repo.dir), field), new RegExp(field), { processCwd: repo.dir })));

    test(`a null ${field} denies ${label} during a run`, () =>
      withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, { ...call(repo.dir), [field]: null }, new RegExp(field), { processCwd: repo.dir })));
  }

  test(`a missing ${field} allows silently with no run state`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertAllowed(await runGate(without(writeCall(repo.dir, "src/app.py"), field), { processCwd: repo.dir }));
    }));
}

test("a payload cwd that does not exist still denies from a hook cwd inside a run", () =>
  withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, writeCall("/nonexistent/place", repo.ledgerPath), RUN_PATTERN, { processCwd: repo.dir })));

// ---------- drift: agent fields ----------

const SUBAGENT = fixture("pretooluse-workflow-agent-bash.json");
const AGENT_PAIR_PATTERN = /agent_id|agent_type/;

for (const [label, call] of CALLS_DURING_A_RUN) {
  test(`agent_id without agent_type denies ${label} during a run`, () =>
    withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, { ...call(repo.dir), agent_id: SUBAGENT.agent_id }, AGENT_PAIR_PATTERN)));

  test(`agent_type without agent_id denies ${label} during a run`, () =>
    withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, { ...call(repo.dir), agent_type: SUBAGENT.agent_type }, AGENT_PAIR_PATTERN)));

  for (const renamed of ["agentId", "subagent_id", "parent_agent_id", "agent_name", "AGENT_ID", "Agent_Id"]) {
    test(`a renamed agent_id ${renamed} denies ${label} during a run`, () =>
      withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, { ...call(repo.dir), [renamed]: SUBAGENT.agent_id }, new RegExp(renamed))));
  }
}

test("a renamed agent_id on a pipeline Agent call denies as drift, not as a main-context call", () =>
  withRepo({}, (repo) =>
    assertDeniedNamingWithoutWrite(repo, { ...agentCall(repo.dir, "pairingbuddy:apply-config-change"), subagent_id: SUBAGENT.agent_id }, /subagent_id/)));

test("an unknown agent key beside a complete pair denies during a run", () =>
  withRepo({}, (repo) => assertDeniedNamingWithoutWrite(repo, { ...asSubagent(writeCall(repo.dir, "src/app.py")), agent_name: "x" }, /agent_name/)));

test("a complete agent pair is allowed on an open path during a run", () =>
  withRepo({}, async (repo) => {
    assertAllowed(await runGate(asSubagent(writeCall(repo.dir, "src/app.py"))));
  }));

test("an unknown top-level key with no agent in it is allowed during a run", () =>
  withRepo({}, async (repo) => {
    assertAllowed(await runGate({ ...writeCall(repo.dir, "src/app.py"), brand_new_field: 1 }));
  }));

test("a tool_input key containing agent is not drift", () =>
  withRepo({}, async (repo) => {
    assertAllowed(await runGate(fileCall(repo.dir, "Write", { file_path: "src/app.py", content: "x", agent_note: "y" })));
  }));

for (const [label, drift] of [
  ["agent_id without agent_type", { agent_id: SUBAGENT.agent_id }],
  ["agent_type without agent_id", { agent_type: SUBAGENT.agent_type }],
  ["a renamed agent_id", { subagent_id: SUBAGENT.agent_id }],
]) {
  test(`${label} allows silently with no run state`, () =>
    withRepo({ ledger: null }, async (repo) => {
      assertAllowed(await runGate({ ...writeCall(repo.dir, "src/app.py"), ...drift }));
    }));
}

test("skill-coding-names-pr-refresh", () => {
  const skill = readFileSync(join(ROOT, "skills", "coding", "SKILL.md"), "utf8");

  assert.match(skill, /pb pr refresh/, "the coding skill names pb pr refresh");
  assert.match(skill, /review fixes/, "the coding skill ties pb pr refresh to review fixes");
  assert.match(skill, /never[^.\n]*gh pr edit|gh pr edit[^.\n]*never/i, "the coding skill says never to run gh pr edit yourself");
});
