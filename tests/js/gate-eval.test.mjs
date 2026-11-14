// Task 26: pb gate eval, the recorded gate policy, and gate answers through the tap.
// Every test drives the real hooks and the real CLI as subprocesses, against a temp git repo.
//
// Output contract of `pb gate eval` (no arguments; the gate comes from the ledger: the first gate
// in node order whose stage is done and which has no record, or the one needsHuman already names).
//   auto-pass:           {ok, result:"auto-pass", gate, source:"auto"}
//   first ask:           {ok, result:"needs-human", gate, reason, question, humanCommand}
//   tap recorded nothing:{ok, result:"needs-human-command", gate, reason, humanCommand}
//   question:            {question:"Approve <gate>?", header:"PB gate: <gate>", options:[{label,...}] approve|redo|stop, multiSelect:false}
//   humanCommand:        !cd <run root> && node <absolute path>/pb.mjs human approve <gate>
//   answered redo:       the gate record and the stage's done state go, so no gate is due and the stage re-runs at attempt+1
//   answered stop:       {ok, result:"answered", gate, answer:"stop", reason, humanCommand}, with ledger.stop set
// All three exit 0. No gate due, or a broken ledger, exits 1. Any argument exits 2.
import { INTAKE_DONE, withTypePassed } from "./ledger-fixture.mjs";
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, updateLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { COMMIT_FAILED } from "../../shared-node/verbs.mjs";
import { fixture, recordedAnswer, sha256, SESSION } from "./tap-fixture.mjs";

const AGENT_BUDGET = "agent-budget";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

const TASK_END = "G:task-end";
const CONFIG = "code-config";
const SAFETY_NET = "code-safety-net";
const CONFIG_TEXT = '{"runners":{}}\n';
const ANSWERS = ["approve", "redo", "stop"];

const tempDirs = [];
function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const doneStages = (...names) => names.map((name) => ({ name, status: "done" }));

function makeLedger(over = {}) {
  return {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "Task 26",
    plan: { path: "", title: "" }, configHash: sha256(CONFIG_TEXT),
    policy: { mode: "", source: "" },
    stage: { name: SAFETY_NET, status: "done", runId: "wf_1", attempt: 1, startedAt: null },
    stages: doneStages(CONFIG, SAFETY_NET),
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
    ...over,
  };
}

// A repo whose run has finished its last stage, so G:task-end is due.
function makeRepo({ ledger = {}, plugin = ROOT } = {}) {
  const dir = makeDir("gate-eval-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), CONFIG_TEXT);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, makeLedger(ledger));
  return { dir, taskDir, ledgerPath, plugin, ledger: () => readLedger(ledgerPath) };
}

// Inherited policy must not reach a test: only `env` sets it.
function baseEnv(plugin, env) {
  const { PAIRINGBUDDY_GATE_POLICY: _inherited, ...rest } = process.env;
  return { ...rest, CLAUDE_PLUGIN_ROOT: plugin, ...env };
}

function runNode(script, { cwd, input, env, args = [], plugin }) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [script, ...args], { cwd, input, env: baseEnv(plugin, env), encoding: "utf8" });
  return { code: status, stdout, stderr };
}

const runGate = (repo, payload, { env } = {}) =>
  runNode(join(repo.plugin, "hooks", "gate-boot.mjs"), { cwd: repo.dir, input: JSON.stringify(payload), env, plugin: repo.plugin });

const runTap = (repo, payload) =>
  runNode(join(repo.plugin, "hooks", "tap.mjs"), { cwd: repo.dir, input: JSON.stringify(payload), plugin: repo.plugin });

const runPb = (repo, args = ["gate", "eval"], { env } = {}) =>
  runNode(join(repo.plugin, "cli", "pb.mjs"), { cwd: repo.dir, args, env, plugin: repo.plugin });

const evalCommand = (repo) => `node ${join(repo.plugin, "cli", "pb.mjs")} gate eval`;

function mainBash(repo, command, mode, over = {}) {
  const { agent_id: _id, agent_type: _type, ...base } = fixture("pretooluse-workflow.json");
  return { ...base, session_id: SESSION, cwd: repo.dir, permission_mode: mode, tool_name: "Bash", tool_input: { command, description: "run it" }, ...over };
}

function subagentBash(repo, mode) {
  return { ...fixture("pretooluse-workflow-agent-bash.json"), cwd: repo.dir, permission_mode: mode, tool_name: "Bash", tool_input: { command: "ls", description: "list" } };
}

function stageCall(repo, stage, mode = "default") {
  return {
    ...fixture("pretooluse-workflow.json"), session_id: SESSION, cwd: repo.dir, permission_mode: mode,
    tool_input: { name: `pairingbuddy:${stage}`, args: { pluginRoot: repo.plugin, attempt: 1, task: { description: "set x" } } },
  };
}

const decisionOf = (result) => (result.stdout === "" ? null : JSON.parse(result.stdout).hookSpecificOutput);

function assertNotDenied(result) {
  assert.equal(result.code, 0, `the hook exits 0: ${result.stderr}`);
  assert.notEqual(decisionOf(result)?.permissionDecision, "deny", `the hook must not deny: ${result.stdout}`);
}

function assertDenied(result, pattern) {
  const decision = decisionOf(result);
  assert.equal(decision?.permissionDecision, "deny", `the hook must deny: ${result.stdout}`);
  assert.match(decision.permissionDecisionReason, pattern);
}

// The main context's own route: PreToolUse for the Bash call, then the CLI.
function gateEval(repo, mode = "default", { hookEnv, cliEnv } = {}) {
  assertNotDenied(runGate(repo, mainBash(repo, evalCommand(repo), mode), { env: hookEnv }));
  const result = runPb(repo, ["gate", "eval"], { env: cliEnv });
  assert.equal(result.code, 0, `pb gate eval exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assertAsks(output, gate = TASK_END) {
  assert.equal(output.result, "needs-human", `the gate asks: ${JSON.stringify(output)}`);
  assert.equal(output.gate, gate);
  assert.equal(output.source, undefined, "a gate that asks has no source yet");
}

function assertNoRecord(repo, gate = TASK_END) {
  assert.equal(repo.ledger().gates[gate], undefined, "nothing is recorded for the gate");
}

function assertAutoPassed(repo, output, gate = TASK_END) {
  assert.deepEqual(output, { ok: true, result: "auto-pass", gate, source: "auto" });
  assert.equal(repo.ledger().gates[gate]?.source, "auto", "the gate record carries source auto");
  assert.equal(repo.ledger().needsHuman, null, "an auto-pass leaves needsHuman empty");
}

function recordedQuestion(repo, input) {
  return { ...fixture("pretooluse-askuserquestion.json"), session_id: SESSION, cwd: repo.dir, ...(input && { tool_input: input }) };
}

// The real CLI's question goes through the tap, so header and tap are tested together (D4).
function askedRepo(opts) {
  const repo = makeRepo(opts);
  const asked = gateEval(repo);
  assertAsks(asked, asked.gate);
  return { repo, asked };
}

// ---------- a plugin copy, for contracts config_change does not have ----------

const FIRST = "first-stage";
const SECOND = "second-stage";
const G_FIRST = "G:first";
const G_SECOND = "G:second";

function makePlugin({ secondClass = "continue" } = {}) {
  const dir = makeDir("gate-eval-plugin-");
  for (const part of ["cli", "hooks", "shared-node", "contracts"]) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  mkdirSync(join(dir, "workflows"));
  const contractPath = join(dir, "contracts", "stages.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.taskTypes.two_gates = {
    nodes: [{ name: FIRST, gate: G_FIRST, evidence: [] }, { name: SECOND, gate: G_SECOND, evidence: [] }],
    gates: { [G_FIRST]: { class: "continue" }, [G_SECOND]: { class: secondClass } },
  };
  writeFileSync(contractPath, JSON.stringify(contract));
  for (const stage of [FIRST, SECOND]) writeFileSync(join(dir, "workflows", `${stage}.js`), `export const meta = { name: '${stage}' };\n`);
  return dir;
}

function twoGateRepo({ done = [FIRST], plugin = makePlugin(), ledger = {} } = {}) {
  const stage = done.length === 0 ? { name: "", status: "", runId: null, attempt: 0, startedAt: null } : { name: done[done.length - 1], status: "done", runId: "wf_1", attempt: 1, startedAt: null };
  return makeRepo({ plugin, ledger: { taskType: "two_gates", stage, stages: doneStages(...done), ...ledger } });
}

// ---------- gate.mjs records the policy ----------

describe("gate.mjs records the policy", () => {
  for (const mode of ["default", "auto", "bypassPermissions"]) {
    test(`a main-context Bash call records permission_mode ${mode}`, () => {
      const repo = makeRepo();

      assertNotDenied(runGate(repo, mainBash(repo, "ls", mode)));

      assert.deepEqual(repo.ledger().policy, { mode, source: "permission_mode" });
    });
  }

  test("a main-context Write call records permission_mode", () => {
    const repo = makeRepo();
    const payload = mainBash(repo, "", "auto", { tool_name: "Write", tool_input: { file_path: join(repo.dir, "notes.txt"), content: "x" } });

    assertNotDenied(runGate(repo, payload));

    assert.equal(repo.ledger().policy.mode, "auto");
  });

  test("a main-context stage start records permission_mode as well as the stage", () => {
    const repo = twoGateRepo({ done: [] });

    assertNotDenied(runGate(repo, stageCall(repo, FIRST, "auto")));

    assert.equal(repo.ledger().policy.mode, "auto");
    assert.equal(repo.ledger().stage.name, FIRST);
  });

  test("a subagent's payload does not change the policy", () => {
    const repo = makeRepo({ ledger: { policy: { mode: "default", source: "permission_mode" } } });

    assertNotDenied(runGate(repo, subagentBash(repo, "auto")));

    assert.equal(repo.ledger().policy.mode, "default");
  });

  test("an unchanged mode writes nothing, so a plain Bash call stays a read", () => {
    const repo = makeRepo();
    assertNotDenied(runGate(repo, mainBash(repo, "ls", "default")));
    const { seq } = repo.ledger();

    assertNotDenied(runGate(repo, mainBash(repo, "ls", "default")));

    assert.equal(repo.ledger().policy.mode, "default", "the first call recorded the mode");
    assert.equal(repo.ledger().seq, seq);
  });

  test("another session's payload cannot change an owned run's policy", () => {
    const repo = makeRepo({ ledger: { owner: { sessionId: "the-owner", lastSeen: null }, policy: { mode: "default", source: "permission_mode" } } });

    assertNotDenied(runGate(repo, mainBash(repo, "ls", "auto", { session_id: "someone-else" })));

    assert.equal(repo.ledger().policy.mode, "default");
  });

  test("the owning session's payload changes the policy", () => {
    const repo = makeRepo({ ledger: { owner: { sessionId: SESSION, lastSeen: null }, policy: { mode: "default", source: "permission_mode" } } });

    assertNotDenied(runGate(repo, mainBash(repo, "ls", "auto")));

    assert.equal(repo.ledger().policy.mode, "auto");
  });

  test("a broken ledger does not take Bash away from the recovery route", () => {
    const repo = makeRepo();
    writeFileSync(repo.ledgerPath, readFileSync(repo.ledgerPath, "utf8").replace('"Task 26"', '"edited by hand"'));

    assertNotDenied(runGate(repo, mainBash(repo, "ls", "auto")));
  });

  test("a unit run with no ledger keeps Bash working", () => {
    const repo = makeRepo();
    rmSync(repo.taskDir, { recursive: true });
    writeFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), "{}");

    assertNotDenied(runGate(repo, mainBash(repo, "ls", "auto")));
  });
});

// ---------- auto passes a continue gate ----------

describe("auto policy", () => {
  test("auto passes a continue gate with source auto", () => {
    const repo = makeRepo();

    const output = gateEval(repo, "auto");

    assertAutoPassed(repo, output);
  });

  test("Solo's env var, seen by the hook, passes a continue gate under another mode", () => {
    const repo = makeRepo();

    const output = gateEval(repo, "bypassPermissions", { hookEnv: { PAIRINGBUDDY_GATE_POLICY: "auto" } });

    assertAutoPassed(repo, output);
    assert.deepEqual(repo.ledger().policy, { mode: "auto", source: "PAIRINGBUDDY_GATE_POLICY" });
  });

  test("any other value of Solo's env var is not a policy", () => {
    const repo = makeRepo();

    assertAsks(gateEval(repo, "default", { hookEnv: { PAIRINGBUDDY_GATE_POLICY: "yes" } }));
    assert.deepEqual(repo.ledger().policy, { mode: "default", source: "permission_mode" });
  });

  test("a decide-class gate asks under auto", () => {
    const repo = twoGateRepo({ done: [FIRST, SECOND], plugin: makePlugin({ secondClass: "decide" }), ledger: { gates: { [G_FIRST]: { source: "auto" } } } });

    assertAsks(gateEval(repo, "auto"), G_SECOND);
    assertNoRecord(repo, G_SECOND);
  });

  test("a conditional gate asks under auto while no classifier reports certain", () => {
    const repo = twoGateRepo({ done: [FIRST, SECOND], plugin: makePlugin({ secondClass: "conditional" }), ledger: { gates: { [G_FIRST]: { source: "auto" } } } });

    assertAsks(gateEval(repo, "auto"), G_SECOND);
  });

  test("the two gates of one run are evaluated in node order", () => {
    const repo = twoGateRepo({ done: [FIRST, SECOND] });

    const first = gateEval(repo, "auto");
    const second = gateEval(repo, "auto");

    assert.deepEqual([first.gate, second.gate], [G_FIRST, G_SECOND]);
  });
});

// ---------- any other mode asks ----------

describe("any other mode asks", () => {
  for (const mode of ["default", "acceptEdits", "plan", "bypassPermissions", "dontAsk"]) {
    test(`${mode} asks at a continue gate and names the mode as the reason`, () => {
      const repo = makeRepo();

      const output = gateEval(repo, mode);

      assertAsks(output);
      assert.match(output.reason, new RegExp(mode));
      assertNoRecord(repo);
    });
  }

  test("a run with no recorded policy asks", () => {
    const repo = makeRepo();

    const result = runPb(repo);

    assert.equal(result.code, 0, `exit 0 expected: ${result.stderr}`);
    assertAsks(JSON.parse(result.stdout));
  });
});

// ---------- a mode switch applies at the next gate ----------

describe("a mode switch", () => {
  test("from default to auto applies at the next evaluation of a gate not yet asked", () => {
    const repo = makeRepo();
    assertNotDenied(runGate(repo, mainBash(repo, "ls", "default")));

    const output = gateEval(repo, "auto");

    assertAutoPassed(repo, output);
  });

  test("from auto to default makes the next gate ask", () => {
    const repo = makeRepo();
    assertNotDenied(runGate(repo, mainBash(repo, "ls", "auto")));

    assertAsks(gateEval(repo, "default"));
    assertNoRecord(repo);
  });

  test("to auto does not pass the gate already asking: it applies to the next one", () => {
    const { repo } = askedRepo();

    const output = gateEval(repo, "auto");

    assert.notEqual(output.result, "auto-pass");
    assertNoRecord(repo);
    assert.equal(repo.ledger().needsHuman?.gate, TASK_END);
  });

  test("to auto after a human answered the first gate passes the second", () => {
    const { repo, asked } = askedRepo({ plugin: makePlugin(), ledger: twoGateLedger() });
    runTap(repo, recordedAnswer(repo, asked.question, "approve"));

    const output = gateEval(repo, "auto");

    assertAutoPassed(repo, output, G_SECOND);
    assert.equal(repo.ledger().gates[G_FIRST].source, "human", "the first gate keeps its human source");
  });
});

function twoGateLedger() {
  return { taskType: "two_gates", stage: { name: SECOND, status: "done", runId: "wf_1", attempt: 1, startedAt: null }, stages: doneStages(FIRST, SECOND) };
}

// ---------- always-stop conditions from Section 4 ----------

const writeReport = (repo, report) => writeFileSync(join(repo.taskDir, "report.json"), JSON.stringify(report));
const writeReturn = (repo, ambiguity) =>
  writeFileSync(join(repo.taskDir, "artifacts", `${CONFIG}.apply-config-change.-.r1.a1.json`), JSON.stringify({ pb_key: `${CONFIG}.apply-config-change.-.r1.a1`, ambiguity, commit_subject: "x", files_changed: [] }));

const ALWAYS_STOP = [
  { condition: "a decide finding", reason: /decide/, arrange: (repo) => writeReport(repo, { survivors: [{ id: "f1", class: "decide" }] }) },
  { condition: "a non-null ambiguity", reason: /ambiguity/, arrange: (repo) => writeReturn(repo, "Which file did the task mean?") },
  { condition: "coverage gaps", reason: /coverage/, arrange: (repo) => writeReport(repo, { gaps: [{ scenario_id: "s1", description: "no test" }] }) },
  { condition: "exhausted retries", reason: /retries/, ledger: { retries: { [CONFIG]: { used: 3, max: 3 } } } },
  { condition: "an uncovered lens", reason: /uncovered/, arrange: (repo) => writeReport(repo, { uncovered: ["security"] }) },
  { condition: "an unrefuted high-severity finding past the cap", reason: /unrefuted/, arrange: (repo) => writeReport(repo, { unrefuted: [{ id: "f2", severity: "high" }] }) },
  { condition: "a config hash change", reason: /config hash/, arrange: (repo) => writeFileSync(join(repo.dir, ".pairingbuddy", "test-config.json"), '{"runners":{"x":{}}}\n') },
  { condition: "a failed publish", reason: /publish/, ledger: { stop: { reason: "publish-failed", seq: 0, code: COMMIT_FAILED } } },
  { condition: "a stop", reason: /agent-budget/, ledger: { stop: { reason: AGENT_BUDGET, seq: 0, code: AGENT_BUDGET } } },
];

describe("always-stop conditions", () => {
  for (const { condition, reason, ledger, arrange } of ALWAYS_STOP) {
    test(`${condition} asks under auto`, () => {
      const repo = makeRepo({ ledger });
      arrange?.(repo);

      const output = gateEval(repo, "auto");

      assertAsks(output);
      assert.match(output.reason, reason);
      assertNoRecord(repo);
    });

    test(`${condition} asks under Solo's env var`, () => {
      const repo = makeRepo({ ledger });
      arrange?.(repo);

      assertAsks(gateEval(repo, "bypassPermissions", { hookEnv: { PAIRINGBUDDY_GATE_POLICY: "auto" } }));
      assertNoRecord(repo);
    });
  }

  test("under default mode the stop condition is the reason given, not the mode", () => {
    const repo = makeRepo({ ledger: { stop: { reason: AGENT_BUDGET, seq: 0, code: AGENT_BUDGET } } });

    assert.match(gateEval(repo, "default").reason, /agent-budget/);
  });

  const CLEAR = [
    { state: "an empty-string ambiguity, which is the schema's none", arrange: (repo) => writeReturn(repo, "") },
    { state: "a null ambiguity", arrange: (repo) => writeReturn(repo, null) },
    { state: "an empty report", arrange: (repo) => writeReport(repo, { survivors: [], gaps: [], uncovered: [], unrefuted: [] }) },
    { state: "a survivor not marked decide", arrange: (repo) => writeReport(repo, { survivors: [{ id: "f1", class: "fix-here" }] }) },
    { state: "an unrefuted finding below high severity", arrange: (repo) => writeReport(repo, { unrefuted: [{ id: "f2", severity: "low" }] }) },
    { state: "retries left", ledger: { retries: { [CONFIG]: { used: 1, max: 3 } } } },
  ];
  for (const { state, ledger, arrange } of CLEAR) {
    test(`${state} still auto-passes`, () => {
      const repo = makeRepo({ ledger });
      arrange?.(repo);

      assertAutoPassed(repo, gateEval(repo, "auto"));
    });
  }
});

// ---------- a gate question is the emitted question ----------

const OPTION_CHANGES = {
  relabelled: (q) => ({ ...q, options: q.options.map((o) => (o.label === "stop" ? { ...o, label: "halt" } : o)) }),
  "with a reworded description": (q) => ({ ...q, options: q.options.map((o) => (o.label === "approve" ? { ...o, description: "Discard the failing run and restart; nothing is passed." } : o)) }),
  "with the descriptions swapped": (q) => {
    const [approve, redo, stop] = q.options;
    return { ...q, options: [{ ...approve, description: stop.description }, redo, { ...stop, description: approve.description }] };
  },
  reordered: (q) => ({ ...q, options: [...q.options].reverse() }),
  "with an option dropped": (q) => ({ ...q, options: q.options.slice(0, 2) }),
  "with an option added": (q) => ({ ...q, options: [...q.options, { label: "later", description: "Decide later." }] }),
  "with an extra field": (q) => ({ ...q, options: q.options.map((o) => ({ ...o, preview: "Passing is safe." })) }),
};

const ALTERED_QUESTIONS = [
  ...Object.entries(OPTION_CHANGES).map(([label, change]) => ({ name: `a question with options ${label}`, altered: (q) => [change(q)] })),
  { name: "a question with other text", altered: (q) => [{ ...q, question: "Shall I go on?" }] },
  { name: "a question with another gate's header", altered: (q) => [{ ...q, header: "PB gate: G:publish" }] },
  { name: "a multi-select question", altered: (q) => [{ ...q, multiSelect: true }] },
  { name: "a question with no multiSelect", altered: ({ multiSelect: _dropped, ...q }) => [q] },
  { name: "a question followed by a decoy", altered: (q) => [q, { ...q, question: "Anything else?", header: "Other" }] },
  { name: "a question after a decoy", altered: (q) => [{ ...q, question: "Anything else?", header: "Other" }, q] },
  { name: "the question asked twice", altered: (q) => [q, q] },
];

// ---------- a model cannot supply the policy ----------

describe("a model cannot supply the policy", () => {
  for (const args of [["--auto"], ["--policy", "auto"], ["--mode", "auto"], ["--source", "human"], [TASK_END]]) {
    test(`pb gate eval ${args.join(" ")} is a usage error that changes nothing`, () => {
      const repo = makeRepo({ ledger: { policy: { mode: "default", source: "permission_mode" } } });
      const before = readFileSync(repo.ledgerPath, "utf8");

      const result = runPb(repo, ["gate", "eval", ...args]);

      assert.equal(result.code, 2, "usage errors exit 2");
      assert.match(result.stderr, /usage: pb gate eval/);
      assert.equal(readFileSync(repo.ledgerPath, "utf8"), before);
    });
  }

  test("the env var set on the CLI call is ignored: only hooks read it", () => {
    const repo = makeRepo();

    assertAsks(gateEval(repo, "default", { cliEnv: { PAIRINGBUDDY_GATE_POLICY: "auto" } }));
  });

  test("the env var written into the command text does not reach the hook", () => {
    const repo = makeRepo();
    const command = `PAIRINGBUDDY_GATE_POLICY=auto ${evalCommand(repo)}`;

    assertDenied(runGate(repo, mainBash(repo, command, "default")), /environment/);

    assert.notEqual(repo.ledger().policy.mode, "auto");
  });

  test("a permission_mode inside tool_input is not the payload's mode", () => {
    const repo = makeRepo();
    const payload = mainBash(repo, "ls", "default", { tool_input: { command: "ls", description: "x", permission_mode: "auto" } });

    assertNotDenied(runGate(repo, payload));

    assert.equal(repo.ledger().policy.mode, "default");
  });

  test("a ledger edited to auto refuses rather than passes", () => {
    const repo = makeRepo();
    writeFileSync(repo.ledgerPath, readFileSync(repo.ledgerPath, "utf8").replace('"mode": ""', '"mode": "auto"'));

    const result = runPb(repo);

    assert.equal(result.code, 1, "the sha mismatch refuses");
    assert.doesNotMatch(result.stdout, /auto-pass/);
  });

  test("an AskUserQuestion carrying its own answers is denied before it runs", () => {
    const { repo, asked } = askedRepo();
    const payload = recordedQuestion(repo, { questions: [asked.question], answers: { [asked.question.question]: "approve" } });

    assertDenied(runGate(repo, payload), /answers/);
  });

  test("the recorded AskUserQuestion, with no answers, is not denied", () => {
    const repo = makeRepo();

    assertNotDenied(runGate(repo, recordedQuestion(repo)));
  });

  test("the emitted question, exactly, is not denied", () => {
    const { repo, asked } = askedRepo();

    assertNotDenied(runGate(repo, recordedQuestion(repo, { questions: [asked.question] })));
  });

  for (const { name, altered } of ALTERED_QUESTIONS) {
    test(`${name} is denied at PreToolUse, stating the right question`, () => {
      const { repo, asked } = askedRepo();
      const before = readFileSync(repo.ledgerPath, "utf8");

      const result = runGate(repo, recordedQuestion(repo, { questions: altered(asked.question) }));

      assertDenied(result, new RegExp(JSON.stringify(asked.question).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal(readFileSync(repo.ledgerPath, "utf8"), before, "a deny records nothing");
    });

    test(`${name} records nothing through the tap, and needsHuman stays`, () => {
      const { repo, asked } = askedRepo();
      const payload = recordedAnswer(repo, asked.question, "approve");
      const questions = altered(asked.question);
      payload.tool_input = { ...payload.tool_input, questions };
      payload.tool_response = { ...payload.tool_response, questions };

      runTap(repo, payload);

      assertNoRecord(repo);
      assert.equal(repo.ledger().needsHuman?.gate, TASK_END);
    });
  }

  test("a question that is no gate's is left alone while a gate waits", () => {
    const { repo } = askedRepo();
    const recorded = fixture("pretooluse-askuserquestion.json").tool_input.questions[0];

    assertNotDenied(runGate(repo, recordedQuestion(repo, { questions: [{ ...recorded, question: "Which name?", header: "Naming" }] })));
  });

  test("a gate question over a broken ledger keeps to the recovery route", () => {
    const { repo, asked } = askedRepo();
    writeFileSync(repo.ledgerPath, "{");

    assertNotDenied(runGate(repo, recordedQuestion(repo, { questions: [{ ...asked.question, header: "PB gate: other" }] })));
  });

  test("a decoy question in the same call does not pass the tap, whichever comes first", () => {
    const { repo, asked } = askedRepo();
    const decoy = { ...asked.question, question: "Anything else?", header: "Other" };
    for (const questions of [[asked.question, decoy], [decoy, asked.question]]) {
      const payload = recordedAnswer(repo, asked.question, "approve");
      payload.tool_response = { ...payload.tool_response, questions };

      runTap(repo, payload);

      assertNoRecord(repo);
    }
  });

  test("gate-boot.mjs is wired to see AskUserQuestion", () => {
    const hooks = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks.PreToolUse;
    const entry = hooks.find((h) => h.hooks.some((hook) => hook.command.includes("gate-boot.mjs")));

    assert.match("AskUserQuestion", new RegExp(`^(${entry.matcher})$`));
  });
});

// ---------- the question and the needsHuman record ----------

describe("needs-human output", () => {
  test("carries the exact question text, the PB gate header and the three answers", () => {
    const repo = makeRepo();

    const { question } = gateEval(repo);

    assert.equal(question.question, `Approve ${TASK_END}?`);
    assert.equal(question.header, `PB gate: ${TASK_END}`);
    assert.deepEqual(question.options.map(({ label }) => label), ANSWERS);
    assert.equal(question.multiSelect, false);
  });

  test("carries the ! command for this plugin's CLI", () => {
    const repo = makeRepo();

    const { humanCommand } = gateEval(repo);

    assert.equal(humanCommand, `!cd ${repo.dir} && node ${join(ROOT, "cli", "pb.mjs")} human approve ${TASK_END}`);
  });

  test("writes needsHuman with the gate, the reason and a seq from this write", () => {
    const repo = makeRepo();
    assertNotDenied(runGate(repo, mainBash(repo, "ls", "default")));
    const { seq } = repo.ledger();

    const { reason } = gateEval(repo);

    const ledger = repo.ledger();
    assert.equal(ledger.needsHuman?.gate, TASK_END);
    assert.equal(ledger.needsHuman.reason, reason);
    assert.ok(ledger.needsHuman.seq >= seq && ledger.needsHuman.seq <= ledger.seq, `seq ${ledger.needsHuman.seq} is between ${seq} and ${ledger.seq}`);
  });

  test("an auto-pass writes no needsHuman", () => {
    const repo = makeRepo();

    gateEval(repo, "auto");

    assert.equal(repo.ledger().needsHuman, null);
  });
});

// ---------- the tap records the answer ----------

describe("the tap records AskUserQuestion answers", () => {
  test("an approve records the gate with source human and clears needsHuman", () => {
    const { repo, asked } = askedRepo();

    const result = runTap(repo, recordedAnswer(repo, asked.question, "approve"));

    assert.equal(result.code, 0);
    assert.equal(result.stdout, "", "the tap prints nothing");
    const ledger = repo.ledger();
    assert.equal(ledger.gates[TASK_END]?.source, "human");
    assert.equal(ledger.gates[TASK_END].answer, "approve");
    assert.equal(ledger.needsHuman, null);
  });

  test("a stop records that answer, and is not an approval", () => {
    const { repo, asked } = askedRepo();

    runTap(repo, recordedAnswer(repo, asked.question, "stop"));

    const ledger = repo.ledger();
    assert.deepEqual([ledger.gates[TASK_END]?.source, ledger.gates[TASK_END]?.answer], ["human", "stop"]);
    assert.equal(ledger.needsHuman, null);
  });

  test("a redo clears the gate record, and is not an approval", () => {
    const { repo, asked } = askedRepo();

    runTap(repo, recordedAnswer(repo, asked.question, "redo"));

    const ledger = repo.ledger();
    assert.equal(Object.hasOwn(ledger.gates, TASK_END), false);
    assert.equal(ledger.needsHuman, null);
  });

  test("after an approve no gate is due", () => {
    const { repo, asked } = askedRepo();
    runTap(repo, recordedAnswer(repo, asked.question, "approve"));

    const result = runPb(repo);

    assert.equal(result.code, 1, "no gate is due");
    assert.match(result.stderr, /no gate is due/);
  });

  test("the tap is wired to see AskUserQuestion", () => {
    const hooks = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks.PostToolUse;
    const entry = hooks.find((h) => h.hooks.some((hook) => hook.command.includes("tap.mjs")));

    assert.match("AskUserQuestion", new RegExp(`^(${entry.matcher})$`));
  });

  const NOT_RECORDED = [
    { name: "a free-text answer", payload: (repo, q) => recordedAnswer(repo, q, "yes, go on") },
    { name: "a question with no PB gate header", payload: (repo, q) => recordedAnswer(repo, { ...q, header: "Approve" }, "approve") },
    { name: "a header naming another gate", payload: (repo, q) => recordedAnswer(repo, { ...q, header: "PB gate: G:publish" }, "approve") },
    { name: "the right header on another question", payload: (repo, q) => recordedAnswer(repo, { ...q, question: "Shall I go on?" }, "approve") },
    { name: "a subagent's question", payload: (repo, q) => recordedAnswer(repo, q, "approve", { over: { agent_id: "a1", agent_type: "pairingbuddy:apply-config-change" } }) },
    { name: "answers in tool_input but none in the response", payload: (repo, q) => recordedAnswer(repo, q, "approve", { toolResponse: "the tool failed" }) },
  ];
  for (const { name, payload } of NOT_RECORDED) {
    test(`${name} records nothing and leaves needsHuman`, () => {
      const { repo, asked } = askedRepo();

      const result = runTap(repo, payload(repo, asked.question));

      assert.equal(result.code, 0);
      assertNoRecord(repo);
      assert.equal(repo.ledger().needsHuman?.gate, TASK_END);
    });
  }

  test("an answer when no gate is asking records nothing", () => {
    const { asked } = askedRepo();
    const repo = makeRepo();

    runTap(repo, recordedAnswer(repo, asked.question, "approve"));

    assertNoRecord(repo);
  });
});

// ---------- what an answer does ----------

const attemptCall = (repo, stage, attempt) => {
  const call = stageCall(repo, stage);
  return { ...call, tool_input: { ...call.tool_input, args: { ...call.tool_input.args, attempt } } };
};

function answeredRepo(answer) {
  const { repo, asked } = askedRepo({ plugin: makePlugin(), ledger: oneGateDoneLedger() });
  runTap(repo, recordedAnswer(repo, asked.question, answer));
  return repo;
}

describe("a human's redo reopens the stage", () => {
  test("the stage's done state goes and needsHuman clears", () => {
    const repo = answeredRepo("redo");

    const ledger = repo.ledger();
    assert.equal(ledger.stages.some(({ name, status }) => name === FIRST && status === "done"), false);
    assert.equal(ledger.stage.status === "done", false, "the current stage no longer reads as done");
    assert.equal(ledger.stop, null, "a redo is no stop");
  });

  test("the same stage restarts at attempt + 1, through the real gate", () => {
    const repo = answeredRepo("redo");

    assertNotDenied(runGate(repo, attemptCall(repo, FIRST, 2)));

    assert.deepEqual([repo.ledger().stage.name, repo.ledger().stage.attempt, repo.ledger().stage.status], [FIRST, 2, "active"]);
  });

  test("the old attempt is denied, naming the right one", () => {
    const repo = answeredRepo("redo");

    assertDenied(runGate(repo, attemptCall(repo, FIRST, 1)), /Use attempt 2/);
  });

  test("the finished redo brings the same gate due again", () => {
    const repo = answeredRepo("redo");
    runGate(repo, attemptCall(repo, FIRST, 2));
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, status: "done" }, stages: doneStages(FIRST) }));

    assertAsks(gateEval(repo), G_FIRST);
  });

  test("gate eval names the restart instead of a bare refusal", () => {
    const repo = answeredRepo("redo");

    const result = runPb(repo);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no gate is due/);
    assert.match(result.stderr, new RegExp(`${FIRST}[^\\n]*attempt 2`));
  });

  test("a direct pipeline Agent call names the restart", () => {
    const repo = answeredRepo("redo");
    const call = { ...mainBash(repo, "ls", "default"), tool_name: "Agent", tool_input: { subagent_type: "pairingbuddy:apply-config-change", description: "x", prompt: "x" } };

    assertDenied(runGate(repo, call), new RegExp(`pairingbuddy:${FIRST}`));
  });

  test("redo-answer-clears-run-id", () => {
    const { repo, asked } = askedRepo({ plugin: makePlugin(), ledger: oneGateDoneLedger() });
    assert.equal(repo.ledger().stage.runId, "wf_1", "setup: the stage had a run id before the answer");

    runTap(repo, recordedAnswer(repo, asked.question, "redo"));

    const ledger = repo.ledger();
    assert.equal(ledger.stage.name, FIRST, "the redone stage is the current one");
    assert.equal(ledger.stage.status, "redo");
    assert.equal(ledger.stage.runId, null, "the old run id is gone, so it cannot be resumed");
  });

  test("redo-leaves-another-current-stage-run-alone", () => {
    const otherStage = { name: SECOND, status: "active", runId: "wf_9", attempt: 1, startedAt: null };
    const { repo, asked } = askedRepo({ plugin: makePlugin(), ledger: { ...oneGateDoneLedger(), stage: otherStage } });
    assert.equal(asked.gate, G_FIRST, "setup: the gate asked is the first stage's");
    assert.equal(repo.ledger().stage.name, SECOND, "setup: the ledger's current stage is a different stage");

    runTap(repo, recordedAnswer(repo, asked.question, "redo"));

    const ledger = repo.ledger();
    assert.equal(ledger.stage.name, SECOND, "the current stage is still the other one");
    assert.equal(ledger.stage.runId, "wf_9", "a redo of another stage leaves the current stage's run id alone");
  });
});

describe("a human's stop sets ledger.stop", () => {
  const stopped = () => answeredRepo("stop");

  test("the stop names the gate and carries this write's seq", () => {
    const repo = stopped();

    const ledger = repo.ledger();
    assert.match(ledger.stop?.reason, new RegExp(G_FIRST));
    assert.equal(ledger.stop.seq, ledger.seq);
    assert.deepEqual(ledger.gates[G_FIRST], { source: "human", answer: "stop" });
  });

  test("gate eval reports the answer and the way on, rather than refusing", () => {
    const repo = stopped();

    const output = JSON.parse(runPb(repo).stdout);

    assert.equal(output.result, "answered");
    assert.equal(output.gate, G_FIRST);
    assert.equal(output.answer, "stop");
    assert.match(output.humanCommand, new RegExp(`human approve ${G_FIRST}$`));
    assert.equal(repo.ledger().gates[G_FIRST].answer, "stop", "reporting it changes nothing");
  });

  test("a Workflow deny names the human's way on, not gate eval", () => {
    const repo = stopped();
    const result = runGate(repo, nextStageCall(repo));

    assertDenied(result, /human/);
    const reason = decisionOf(result).permissionDecisionReason;
    assert.match(reason, /stop/);
    assert.match(reason, new RegExp(`human approve ${G_FIRST}`));
    assert.doesNotMatch(reason, /gate eval/);
    assert.doesNotMatch(reason, /abandon/i);
  });

  test("restarting the stopped stage gets the same deny, not 'next stage'", () => {
    const repo = stopped();

    assertDenied(runGate(repo, stageCall(repo, FIRST)), new RegExp(`human approve ${G_FIRST}`));
  });

  test("on the last gate the deny names the way on, not 'all stages are done'", () => {
    const { repo, asked } = askedRepo();
    runTap(repo, recordedAnswer(repo, asked.question, "stop"));

    const result = runGate(repo, stageCall(repo, CONFIG));

    assertDenied(result, new RegExp(`human approve ${TASK_END}`));
    assert.doesNotMatch(decisionOf(result).permissionDecisionReason, /are done/);
  });

  test("a direct pipeline Agent call names the human's way on", () => {
    const repo = stopped();
    const call = { ...mainBash(repo, "ls", "default"), tool_name: "Agent", tool_input: { subagent_type: "pairingbuddy:apply-config-change", description: "x", prompt: "x" } };

    assertDenied(runGate(repo, call), new RegExp(`human approve ${G_FIRST}`));
  });

  test("an inline script's deny names the human's way on", () => {
    const repo = stopped();
    const call = { ...stageCall(repo, FIRST), tool_input: { script: "pairingbuddy:x" } };

    assertDenied(runGate(repo, call), new RegExp(`human approve ${G_FIRST}`));
  });

  test("the human's approve clears the stop and opens the next stage", () => {
    const repo = stopped();

    const result = runPb(repo, ["human", "approve", G_FIRST]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(repo.ledger().stop, null);
    assert.deepEqual(repo.ledger().gates[G_FIRST], { source: "human-cli", answer: "approve" });
    assertNotDenied(runGate(repo, nextStageCall(repo)));
  });

  test("a stop the gate answer did not set survives an approve", () => {
    const stop = { reason: AGENT_BUDGET, seq: 0, code: AGENT_BUDGET };
    const repo = makeRepo({ ledger: { stop } });

    assert.equal(runPb(repo, ["human", "approve", TASK_END]).code, 0);

    assert.deepEqual(repo.ledger().stop, stop);
  });
});

// ---------- a stale mode cannot decide ----------

describe("pb gate eval needs the policy recorded first", () => {
  function heldLock(repo) {
    const lock = `${repo.ledgerPath}.lock`;
    writeFileSync(lock, "live writer");
    return lock;
  }

  test("a held lock with a changed mode denies the Bash call, and the auto stays unused", () => {
    const repo = makeRepo({ ledger: { policy: { mode: "auto", source: "permission_mode" } } });
    const lock = heldLock(repo);

    const result = runGate(repo, mainBash(repo, evalCommand(repo), "default"));

    assertDenied(result, /policy/);
    rmSync(lock);
    assert.equal(repo.ledger().policy.mode, "auto", "nothing was written");
  });

  test("a chained eval is covered too", () => {
    const repo = makeRepo({ ledger: { policy: { mode: "auto", source: "permission_mode" } } });
    heldLock(repo);

    assertDenied(runGate(repo, mainBash(repo, `true && (${evalCommand(repo)})`, "default")), /policy/);
  });

  test("a held lock with no policy change does not deny, even when lastSeen is due a refresh", () => {
    const repo = makeRepo({ ledger: { owner: { sessionId: SESSION, lastSeen: null }, policy: { mode: "default", source: "permission_mode" } } });
    heldLock(repo);

    assertNotDenied(runGate(repo, mainBash(repo, evalCommand(repo), "default")));
  });

  test("any other Bash call stays lenient over a held lock", () => {
    const repo = makeRepo({ ledger: { policy: { mode: "auto", source: "permission_mode" } } });
    heldLock(repo);

    assertNotDenied(runGate(repo, mainBash(repo, "ls", "default")));
  });

  for (const [label, corrupt] of [
    ["a hand edit", (text) => text.replace('"task": "Task 26"', '"task": "Edited"')],
    ["corrupt JSON", () => "{"],
  ]) {
    test(`${label} reaches the CLI's own refusal`, () => {
      const repo = makeRepo();
      writeFileSync(repo.ledgerPath, corrupt(readFileSync(repo.ledgerPath, "utf8")));

      assertNotDenied(runGate(repo, mainBash(repo, evalCommand(repo), "default")));
    });
  }
});

// ---------- a sha mismatch points at the way out ----------

describe("a sha mismatch names pb human accept", () => {
  const edited = (ledger) => {
    const repo = makeRepo({ ledger });
    writeFileSync(repo.ledgerPath, readFileSync(repo.ledgerPath, "utf8").replace('"task": "Task 26"', '"task": "Edited"'));
    return repo;
  };
  const acceptPattern = (repo) => new RegExp(`!cd ${repo.dir} && node \\S*pb\\.mjs human accept`);

  test("gate eval refuses cleanly with the command", () => {
    const repo = edited();

    const result = runPb(repo);

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /sha mismatch/);
    assert.match(result.stderr, acceptPattern(repo));
    assert.doesNotMatch(result.stderr, /unexpected failure/);
  });

  test("the command it prints works, and eval runs again", () => {
    const repo = edited();
    const [command] = /!cd .*$/m.exec(runPb(repo).stderr);

    const accepted = spawnSync("sh", ["-c", command.slice(1)], { cwd: makeDir("gate-eval-outside-"), env: baseEnv(repo.plugin), encoding: "utf8" });

    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(runPb(repo).code, 0);
  });

  const DENIED_TOOLS = [
    ["Workflow", (repo) => stageCall(repo, CONFIG)],
    ["Write", (repo) => ({ ...mainBash(repo, "ls", "default"), tool_name: "Write", tool_input: { file_path: join(repo.dir, "x.txt"), content: "x" } })],
    ["Edit", (repo) => ({ ...mainBash(repo, "ls", "default"), tool_name: "Edit", tool_input: { file_path: join(repo.dir, "x.txt"), old_string: "a", new_string: "b" } })],
    ["Agent", (repo) => ({ ...mainBash(repo, "ls", "default"), tool_name: "Agent", tool_input: { subagent_type: "general-purpose", description: "x", prompt: "x" } })],
  ];
  for (const [tool, call] of DENIED_TOOLS) {
    test(`a ${tool} deny carries the same command, with no gate error wrapper`, () => {
      const repo = edited();

      const result = runGate(repo, call(repo));

      assertDenied(result, acceptPattern(repo));
      assert.match(decisionOf(result).permissionDecisionReason, /sha mismatch/);
      assert.doesNotMatch(decisionOf(result).permissionDecisionReason, /Gate error/);
      assert.doesNotMatch(decisionOf(result).permissionDecisionReason, /abandon/i);
    });
  }
});

// ---------- the tap recorded nothing ----------

describe("when the tap recorded nothing", () => {
  test("a second eval stops and prints the ! command, without asking again", () => {
    const { repo, asked } = askedRepo();

    const output = gateEval(repo);

    assert.deepEqual(output, { ok: true, result: "needs-human-command", gate: TASK_END, reason: asked.reason, humanCommand: asked.humanCommand });
  });

  test("the stop leaves needsHuman in place and records no gate", () => {
    const { repo } = askedRepo();

    gateEval(repo);

    assert.equal(repo.ledger().needsHuman?.gate, TASK_END);
    assertNoRecord(repo);
  });
});

// ---------- evidence of a needs-human gate ----------

const nextStageCall = (repo) => stageCall(repo, SECOND);

describe("a needs-human gate needs a human source", () => {
  test("the next stage is denied while the gate is asking", () => {
    const { repo } = askedRepo({ plugin: makePlugin(), ledger: oneGateDoneLedger() });

    assertDenied(runGate(repo, nextStageCall(repo)), new RegExp(G_FIRST));
    assert.equal(repo.ledger().stage.name, FIRST, "the deny leaves the stage alone");
  });

  test("the next stage is denied when the gate was never evaluated", () => {
    const repo = twoGateRepo();

    assertDenied(runGate(repo, nextStageCall(repo)), new RegExp(G_FIRST));
  });

  test("a tap approve opens the next stage", () => {
    const { repo, asked } = askedRepo({ plugin: makePlugin(), ledger: oneGateDoneLedger() });
    runTap(repo, recordedAnswer(repo, asked.question, "approve"));

    assertNotDenied(runGate(repo, nextStageCall(repo)));

    assert.equal(repo.ledger().stage.name, SECOND);
  });

  for (const [answer, reason] of [["redo", new RegExp(`next stage is pairingbuddy:${FIRST}`)], ["stop", new RegExp(G_FIRST)]]) {
    test(`a tap ${answer} does not open the next stage`, () => {
      const { repo, asked } = askedRepo({ plugin: makePlugin(), ledger: oneGateDoneLedger() });
      runTap(repo, recordedAnswer(repo, asked.question, answer));

      assertDenied(runGate(repo, nextStageCall(repo)), reason);
    });
  }

  test("an auto pass opens the next stage", () => {
    const repo = twoGateRepo();
    assertAutoPassed(repo, gateEval(repo, "auto"), G_FIRST);

    assertNotDenied(runGate(repo, nextStageCall(repo)));
  });

  test("an auto record cannot stand in while the gate is asking", () => {
    const { repo } = askedRepo({ plugin: makePlugin(), ledger: oneGateDoneLedger() });
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, gates: { [G_FIRST]: { source: "auto" } } }));

    assertDenied(runGate(repo, nextStageCall(repo)), new RegExp(G_FIRST));
    assert.notEqual(gateEval(repo, "auto").result, "auto-pass");
  });

  test("a human-cli record with needsHuman cleared opens the next stage", () => {
    const { repo } = askedRepo({ plugin: makePlugin(), ledger: oneGateDoneLedger() });
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, needsHuman: null, gates: { [G_FIRST]: { source: "human-cli", answer: "approve" } } }));

    assertNotDenied(runGate(repo, nextStageCall(repo)));
  });

  test("a record with any other source does not open the next stage", () => {
    const repo = twoGateRepo({ ledger: { gates: { [G_FIRST]: { source: "model", answer: "approve" } } } });

    assertDenied(runGate(repo, nextStageCall(repo)), new RegExp(G_FIRST));
  });
});

function oneGateDoneLedger() {
  return { taskType: "two_gates", stage: { name: FIRST, status: "done", runId: "wf_1", attempt: 1, startedAt: null }, stages: doneStages(FIRST) };
}

// ---------- refusals ----------

describe("pb gate eval refuses", () => {
  test("in a repo with no run", () => {
    const repo = makeRepo();
    rmSync(repo.taskDir, { recursive: true });

    const result = runPb(repo);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no run/);
  });

  test("while the gate's stage has not finished, even under auto", () => {
    const repo = makeRepo({ ledger: { stage: { name: SAFETY_NET, status: "active", runId: "wf_1", attempt: 1, startedAt: null }, stages: doneStages(CONFIG), policy: { mode: "auto", source: "permission_mode" } } });
    const before = readFileSync(repo.ledgerPath, "utf8");

    const result = runPb(repo);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no gate is due/);
    assert.equal(readFileSync(repo.ledgerPath, "utf8"), before);
  });

  test("after an auto-pass, since no gate is left", () => {
    const repo = makeRepo();
    gateEval(repo, "auto");

    const result = runPb(repo);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no gate is due/);
  });
});

// ---------- the bug_fix graph: code-scenarios and G:scenarios ----------

describe("code-scenarios and G:scenarios on the real contract", () => {
  const SCENARIOS = "code-scenarios";
  const G_SCENARIOS = "G:scenarios";
  const AGENT = "enumerate-scenarios-and-test-cases";
  const keyAt = (attempt) => `${SCENARIOS}.${AGENT}.-.r1.a${attempt}`;
  const GUIDANCE = (repo) => join(repo.dir, ".pairingbuddy", "human-guidance.json");
  const guidanceOf = (repo) => JSON.parse(readFileSync(GUIDANCE(repo), "utf8")).guidance;

  const scenariosRepo = ({ attempt = 1, mode = "auto", ambiguity = "" } = {}) => {
    const repo = makeRepo({
      ledger: {
        taskType: "bug_fix", policy: { mode, source: "permission_mode" },
        stage: { name: SCENARIOS, status: "done", runId: "wf_1", attempt, startedAt: null },
        stages: [INTAKE_DONE, { name: SCENARIOS, status: "done", attempt }],
        gates: withTypePassed(),
      },
    });
    writeScenarios(repo, attempt, ambiguity);
    return repo;
  };

  function writeScenarios(repo, attempt, ambiguity) {
    writeFileSync(join(repo.taskDir, "artifacts", `${keyAt(attempt)}.json`), JSON.stringify({ pb_key: keyAt(attempt), ambiguity, scenarios: [] }));
  }

  const redo = (repo, asked, annotations = {}) => {
    const payload = recordedAnswer(repo, asked.question, "redo");
    return runTap(repo, { ...payload, tool_response: { ...payload.tool_response, annotations } });
  };

  const askedAtScenarios = (opts) => {
    const repo = scenariosRepo({ mode: "default", ...opts });
    const asked = gateEval(repo);
    assertAsks(asked, G_SCENARIOS);
    return { repo, asked };
  };

  test("the graph is the stage and its gate, as a continue gate", () => {
    const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));

    assert.deepEqual(contract.taskTypes.bug_fix.nodes, [
      { name: "intake", gate: "G:type", evidence: ["artifact:classify-task"] },
      { name: SCENARIOS, gate: G_SCENARIOS, evidence: [`artifact:${AGENT}`] },
      { name: "code-tdd", gate: null, evidence: ["artifact:create-test-placeholders", "checkpoint:placeholders", "tests:cycle", "artifact:verify-test-coverage"] },
      { name: SAFETY_NET, gate: TASK_END, evidence: ["artifact:update-documentation", "checkpoint:docs", "tests:full"] },
    ]);
    assert.deepEqual(contract.taskTypes.bug_fix.gates, { "G:type": { class: "conditional" }, [G_SCENARIOS]: { class: "continue" }, [TASK_END]: { class: "continue" } });
    assert.equal(contract.stageMaxAgents["code-tdd"], 600);
    assert.equal(contract.migratedTypes.includes("bug_fix"), true);
  });

  test("new_feature has the same graph as bug_fix, and is migrated", () => {
    const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));

    assert.deepEqual(contract.taskTypes.new_feature, contract.taskTypes.bug_fix);
    assert.equal(contract.migratedTypes.includes("new_feature"), true);
  });

  test("with no ambiguity the gate auto-passes under auto", () => {
    const repo = scenariosRepo();

    assertAutoPassed(repo, gateEval(repo, "auto"), G_SCENARIOS);
  });

  test("a non-null ambiguity asks under auto", () => {
    const repo = scenariosRepo({ ambiguity: "Does the fix cover the retry path?" });

    const asked = gateEval(repo, "auto");

    assertAsks(asked, G_SCENARIOS);
    assert.match(asked.reason, /ambiguity/);
    assert.deepEqual(asked.question.options.map(({ label }) => label), ANSWERS);
  });

  // ---------- a doubt the round knocked down ----------

  const lensKey = (lens = "necessity", attempt = 1) => `${SCENARIOS}.lens.${lens}.r1.a${attempt}`;
  const refuterKey = (finding = "necessity-1", attempt = 1) => `${SCENARIOS}.refuter.${finding}.r1.a${attempt}`;
  const FINDING = { rule: "one-test-per-behaviour", severity: "medium", kind: "fix-here", claim: "scenario 2 repeats scenario 1", where: "scenarios.json" };
  const writeArtifact = (repo, key, body) => writeFileSync(join(repo.taskDir, "artifacts", `${key}.json`), JSON.stringify({ pb_key: key, ...body }));
  const writeLens = (repo, { ambiguity = "Is scenario 2 a separate case?", findings = [FINDING] } = {}) => writeArtifact(repo, lensKey(), { ambiguity, findings });
  const writeRefuter = (repo, { verdict, ambiguity = "The task text is short.", finding = "necessity-1" }) => writeArtifact(repo, refuterKey(finding), { finding_id: finding, verdict, ambiguity });

  test("a lens doubt whose only finding the refuter knocked down passes, and so does the refuter's doubt", () => {
    const repo = scenariosRepo();
    writeLens(repo);
    writeRefuter(repo, { verdict: "refuted" });

    assertAutoPassed(repo, gateEval(repo, "auto"), G_SCENARIOS);
  });

  test("a finding the refuter upheld keeps both doubts, and the gate names both returns", () => {
    const repo = scenariosRepo();
    writeLens(repo);
    writeRefuter(repo, { verdict: "survives" });

    const asked = gateEval(repo, "auto");

    assertAsks(asked, G_SCENARIOS);
    assert.equal(asked.reason, `these returns carry an open ambiguity: ${lensKey()}.json, ${refuterKey()}.json`);
  });

  test("a lens with one finding knocked down and one not challenged keeps its doubt", () => {
    const repo = scenariosRepo();
    writeLens(repo, { findings: [FINDING, { ...FINDING, claim: "scenario 3 repeats scenario 1" }] });
    writeRefuter(repo, { verdict: "refuted", ambiguity: null });

    const asked = gateEval(repo, "auto");

    assertAsks(asked, G_SCENARIOS);
    assert.equal(asked.reason, `the return ${lensKey()}.json carries an open ambiguity`);
  });

  test("a lens doubt with no findings stands, since nothing in the round answered it", () => {
    const repo = scenariosRepo();
    writeLens(repo, { findings: [] });

    const asked = gateEval(repo, "auto");

    assertAsks(asked, G_SCENARIOS);
    assert.equal(asked.reason, `the return ${lensKey()}.json carries an open ambiguity`);
  });

  test("the subject's doubt always counts, and the gate names only it beside a knocked-down lens", () => {
    const repo = scenariosRepo({ ambiguity: "Which path?" });
    writeLens(repo);
    writeRefuter(repo, { verdict: "refuted" });

    const asked = gateEval(repo, "auto");

    assertAsks(asked, G_SCENARIOS);
    assert.equal(asked.reason, `the return ${keyAt(1)}.json carries an open ambiguity`);
  });

  test("stage finish refuses with no return at this attempt, and finishes with one", () => {
    const repo = makeRepo({
      ledger: {
        taskType: "bug_fix",
        stage: { name: SCENARIOS, status: "active", runId: "wf_1", attempt: 2, startedAt: null },
        stages: [],
      },
    });
    writeScenarios(repo, 1, "");

    assert.notEqual(runPb(repo, ["stage", "finish"]).code, 0, "a return from attempt 1 is no evidence for attempt 2");
    assert.notEqual(repo.ledger().stop, null);

    runPb(repo, ["stage", "fail"]);
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, status: "active", attempt: 3 } }));
    writeScenarios(repo, 3, "");

    const finished = runPb(repo, ["stage", "finish"]);
    assert.equal(finished.code, 0, finished.stderr);
    assert.equal(repo.ledger().stage.status, "done");
  });

  test("a redo appends the human's note to human-guidance, as a schema row", () => {
    const { repo, asked } = askedAtScenarios();
    writeFileSync(GUIDANCE(repo), JSON.stringify({ guidance: [{ agent: "curate-guidance", timestamp: "2026-01-01T00:00:00Z", context: "kept", feedback: "keep me", persistent: true }] }));

    redo(repo, asked, { [asked.question.question]: { notes: "Cover the retry path too" } });

    const [kept, added] = guidanceOf(repo);
    assert.equal(kept.feedback, "keep me", "what was there stays");
    assert.equal(added.feedback, "Cover the retry path too");
    assert.equal(added.agent, SCENARIOS);
    assert.match(added.context, /G:scenarios/);
    assert.equal(Number.isNaN(Date.parse(added.timestamp)), false);
    assert.deepEqual(Object.keys(added).sort(), ["agent", "context", "feedback", "timestamp"], "not persistent: curation decides that");
  });

  test("a redo with no note still tells the next attempt the last one was sent back", () => {
    const { repo, asked } = askedAtScenarios();

    redo(repo, asked);

    assert.match(guidanceOf(repo)[0].feedback, /sent code-scenarios back at G:scenarios.*attempt 1/);
  });

  test("a redo creates human-guidance.json when there is none", () => {
    const { repo, asked } = askedAtScenarios();
    assert.equal(existsSync(GUIDANCE(repo)), false);

    redo(repo, asked);

    assert.equal(guidanceOf(repo).length, 1);
  });

  for (const [name, text] of [["an unreadable", "{not json"], ["a wrongly shaped", '{"guidance":3}']]) {
    test(`${name} human-guidance.json is left alone, and the redo still lands`, () => {
      const { repo, asked } = askedAtScenarios();
      writeFileSync(GUIDANCE(repo), text);

      const result = redo(repo, asked);

      assert.equal(result.code, 0);
      assert.equal(readFileSync(GUIDANCE(repo), "utf8"), text, "someone's file is not overwritten");
      assert.equal(repo.ledger().stage.status, "redo");
      assert.match(readFileSync(join(repo.taskDir, "tap-errors.log"), "utf8"), /human-guidance/);
    });
  }

  for (const answer of ["approve", "stop"]) {
    test(`${answer} appends nothing`, () => {
      const { repo, asked } = askedAtScenarios();

      runTap(repo, recordedAnswer(repo, asked.question, answer));

      assert.equal(existsSync(GUIDANCE(repo)), false);
    });
  }

  test("a note in tool_input alone is the model's, so it is not the human's feedback", () => {
    const { repo, asked } = askedAtScenarios();
    const payload = recordedAnswer(repo, asked.question, "redo");

    runTap(repo, { ...payload, tool_input: { ...payload.tool_input, annotations: { [asked.question.question]: { notes: "written by the model" } } } });

    assert.doesNotMatch(guidanceOf(repo)[0].feedback, /written by the model/);
  });

  test("a redo re-runs the stage at the next attempt, through the real gate, and the old return stops counting", () => {
    const { repo, asked } = askedAtScenarios({ ambiguity: "Which path?" });
    redo(repo, asked, { [asked.question.question]: { notes: "The retry path" } });

    assert.equal(JSON.parse(runPb(repo, ["status"]).stdout).next.attempt, 2);
    const call = stageCall(repo, SCENARIOS);
    assertDenied(runGate(repo, call), /Use attempt 2/);

    assertNotDenied(runGate(repo, { ...call, tool_input: { ...call.tool_input, args: { ...call.tool_input.args, attempt: 2 } } }));
    assert.deepEqual([repo.ledger().stage.attempt, repo.ledger().stage.status], [2, "active"]);
    writeScenarios(repo, 2, "");
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, status: "done" }, stages: [{ name: SCENARIOS, status: "done", attempt: 2 }] }));

    assertAutoPassed(repo, gateEval(repo, "auto"), G_SCENARIOS);
  });

  // ---------- an ambiguity a human already approved ----------

  const TDD = "code-tdd";
  const tddKey = (test, attempt = 1) => `${TDD}.implement-code.${test}.r1.a${attempt}`;
  const writeTdd = (repo, ambiguity, test = "t1", attempt = 1) => writeFileSync(join(repo.taskDir, "artifacts", `${tddKey(test, attempt)}.json`), JSON.stringify({ pb_key: tddKey(test, attempt), ambiguity, commit_subject: "x", files_changed: [] }));

  // G:scenarios answered as `gates` says, every stage done, and G:task-end due.
  function atTaskEnd({ gates, ambiguity = "Which path?" }) {
    const repo = makeRepo({
      ledger: {
        taskType: "bug_fix", policy: { mode: "auto", source: "permission_mode" }, gates,
        stage: { name: SAFETY_NET, status: "done", runId: "wf_1", attempt: 1, startedAt: null },
        stages: [{ name: SCENARIOS, status: "done", attempt: 1 }, { name: TDD, status: "done", attempt: 1 }, { name: SAFETY_NET, status: "done", attempt: 1 }],
      },
    });
    writeScenarios(repo, 1, ambiguity);
    return repo;
  }

  for (const [source, record] of [["the dialog", { source: "human", answer: "approve" }], ["the human's command", { source: "human-cli", answer: "approve" }]]) {
    test(`an ambiguity approved through ${source} does not ask again at a later gate`, () => {
      const repo = atTaskEnd({ gates: { [G_SCENARIOS]: record } });

      assertAutoPassed(repo, gateEval(repo, "auto"), TASK_END);
    });
  }

  test("through the real tap: approved at G:scenarios, then G:task-end passes", () => {
    const { repo, asked } = askedAtScenarios({ ambiguity: "Which path?" });
    runTap(repo, recordedAnswer(repo, asked.question, "approve"));
    updateLedger(repo.ledgerPath, (ledger) => ({
      ...ledger,
      stage: { name: SAFETY_NET, status: "done", runId: "wf_1", attempt: 1, startedAt: null },
      stages: [...ledger.stages, { name: TDD, status: "done", attempt: 1 }, { name: SAFETY_NET, status: "done", attempt: 1 }],
    }));

    assertAutoPassed(repo, gateEval(repo, "auto"), TASK_END);
  });

  test("an auto pass settles nothing, so an ambiguity it never saw still asks", () => {
    const repo = atTaskEnd({ gates: { [G_SCENARIOS]: { source: "auto" } } });

    assert.match(gateEval(repo, "auto").reason, /ambiguity/);
  });

  test("a new ambiguity from a stage after the approved gate still asks", () => {
    const repo = atTaskEnd({ gates: { [G_SCENARIOS]: { source: "human", answer: "approve" } } });
    writeTdd(repo, "Could not satisfy t1");

    const asked = gateEval(repo, "auto");

    assertAsks(asked, TASK_END);
    assert.match(asked.reason, new RegExp(tddKey("t1").replaceAll(".", "\\.")));
    assert.doesNotMatch(asked.reason, /enumerate-scenarios/, "what was approved is not asked about again");
  });

  test("a gate names every open ambiguity, because approving it settles them all", () => {
    const repo = atTaskEnd({ gates: { [G_SCENARIOS]: { source: "human", answer: "approve" } } });
    writeTdd(repo, "One", "t1");
    writeTdd(repo, "Two", "t2");

    const { reason } = gateEval(repo, "auto");

    assert.match(reason, /\.t1\./);
    assert.match(reason, /\.t2\./);
  });

  test("a redo's new attempt carries a new ambiguity, and that one asks at its own gate", () => {
    const { repo, asked } = askedAtScenarios({ ambiguity: "Which path?" });
    redo(repo, asked);
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, status: "done", attempt: 2 }, stages: [{ name: SCENARIOS, status: "done", attempt: 2 }] }));
    writeScenarios(repo, 2, "A new question");

    assert.match(gateEval(repo, "auto").reason, /a2/);
  });

  // ---------- a RED pass the CLI recorded as covered ----------

  const redKey = (agent, test) => `${TDD}.${agent}.${test}.r1.a1`;
  const writeRed = (repo, ambiguity, { agent = "implement-tests", test = "t1" } = {}) =>
    writeFileSync(join(repo.taskDir, "artifacts", `${redKey(agent, test)}.json`), JSON.stringify({ pb_key: redKey(agent, test), ambiguity, commit_subject: "x", files_changed: [] }));
  const covered = { covered: { stage: TDD, attempt: 1, done: true, exitCodes: [0], timedOut: false, excerpt: "1 passed", head: "abc", sha: "abc", after: "t0" } };
  const PASS_AT_RED = "t1 passed at RED: an earlier GREEN already covers it. Keep it, or redo?";

  const coveredAtTaskEnd = (perTest) => {
    const repo = atTaskEnd({ gates: { [G_SCENARIOS]: { source: "auto" } }, ambiguity: "" });
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, tests: { perTest } }));
    return repo;
  };

  test("an implement-tests ambiguity on a test the CLI recorded covered is settled, so the gate auto-passes", () => {
    const repo = coveredAtTaskEnd({ t1: covered });
    writeRed(repo, PASS_AT_RED);

    assertAutoPassed(repo, gateEval(repo, "auto"), TASK_END);
  });

  test("the same ambiguity on a test that is not covered still asks", () => {
    const repo = coveredAtTaskEnd({ t1: covered });
    writeRed(repo, PASS_AT_RED, { test: "t2" });

    const asked = gateEval(repo, "auto");

    assertAsks(asked, TASK_END);
    assert.match(asked.reason, new RegExp(redKey("implement-tests", "t2").replaceAll(".", "\\.")));
  });

  // ---------- coverage gaps the loop left ----------

  const coverageKey = (round, attempt = 1) => `${TDD}.verify-test-coverage.-.r${round}.a${attempt}`;
  const gap = { scenario_id: "s1", test_case_id: "c2", description: "no test for a zero percent discount" };
  const writeCoverage = (repo, round, gaps, attempt = 1) =>
    writeFileSync(join(repo.taskDir, "artifacts", `${coverageKey(round, attempt)}.json`), JSON.stringify({ pb_key: coverageKey(round, attempt), ambiguity: "", status: gaps.length === 0 ? "complete" : "incomplete", scenarios_covered: 1, scenarios_total: 1, test_cases_covered: 1, test_cases_total: 1 + gaps.length, gaps }));
  const coverageAtTaskEnd = () => atTaskEnd({ gates: { [G_SCENARIOS]: { source: "auto" } }, ambiguity: "" });

  test("gaps the coverage loop left make G:task-end ask under auto", () => {
    const repo = coverageAtTaskEnd();
    writeCoverage(repo, 1, [gap]);
    writeCoverage(repo, 2, [gap]);

    const asked = gateEval(repo, "auto");

    assertAsks(asked, TASK_END);
    assert.match(asked.reason, /coverage gaps remain: 1/);
    assert.match(asked.reason, new RegExp(coverageKey(2).replaceAll(".", "\\.")));
  });

  test("gaps an earlier round left and a later round closed do not ask", () => {
    const repo = coverageAtTaskEnd();
    writeCoverage(repo, 1, [gap]);
    writeCoverage(repo, 2, []);

    assertAutoPassed(repo, gateEval(repo, "auto"), TASK_END);
  });

  test("gaps of an attempt a re-run replaced do not ask", () => {
    const repo = coverageAtTaskEnd();
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stages: ledger.stages.map((entry) => (entry.name === TDD ? { ...entry, attempt: 2 } : entry)) }));
    writeCoverage(repo, 3, [gap], 1);
    writeCoverage(repo, 1, [], 2);

    assertAutoPassed(repo, gateEval(repo, "auto"), TASK_END);
  });

  test("a coverage return with no gaps list asks, since it may hide gaps", () => {
    const repo = coverageAtTaskEnd();
    writeFileSync(join(repo.taskDir, "artifacts", `${coverageKey(1)}.json`), JSON.stringify({ pb_key: coverageKey(1), ambiguity: "" }));

    assert.match(gateEval(repo, "auto").reason, /cannot be read/);
  });

  test("an ambiguity on another agent's return for a covered test still asks", () => {
    const repo = coveredAtTaskEnd({ t1: covered });
    writeRed(repo, PASS_AT_RED, { agent: "implement-code" });

    const asked = gateEval(repo, "auto");

    assertAsks(asked, TASK_END);
    assert.match(asked.reason, new RegExp(redKey("implement-code", "t1").replaceAll(".", "\\.")));
  });
});

// Scenario: uncovered-stops-under-auto. Gate eval treats a non-empty uncovered as an always-stop.
test("Under auto policy, a report from the scenarios stage with uncovered [necessity] makes gate eval ask, with a reason naming the lens", () => {
  const repo = makeRepo();
  writeReport(repo, { stage: "scenarios", attempt: 1, uncovered: ["necessity"] });

  const output = gateEval(repo, "auto");

  assertAsks(output);
  assert.match(output.reason, /necessity/, "the reason names the uncovered lens");
});

test("Same stage with uncovered [] and no other stop lets the gate pass under auto", () => {
  const repo = makeRepo();
  writeReport(repo, { stage: "scenarios", attempt: 1, uncovered: [] });

  const output = gateEval(repo, "auto");

  assertAutoPassed(repo, output);
});

test("high-finding-past-cap-stops-gate-under-auto", () => {
  const repo = makeRepo();
  const finding = { id: "necessity-3", rule: "r1", severity: "high", claim: "a high finding past the cap", where: "a.mjs:1", blocking: false };
  writeReport(repo, { stage: "scenarios", attempt: 1, unrefuted: [finding] });

  const output = gateEval(repo, "auto");

  assertAsks(output);
  assert.match(output.reason, /unrefuted high-severity/, "the reason names the unrefuted high-severity finding");
});

test("unrefuted-low-or-medium-does-not-stop-gate", () => {
  const repo = makeRepo();
  const medium = { id: "necessity-1", rule: "r1", severity: "medium", claim: "a medium finding", where: "a.mjs:1", blocking: false };
  const low = { id: "necessity-2", rule: "r1", severity: "low", claim: "a low finding", where: "a.mjs:2", blocking: false };
  writeReport(repo, { stage: "scenarios", attempt: 1, unrefuted: [medium, low] });

  const output = gateEval(repo, "auto");

  assertAutoPassed(repo, output);
});
