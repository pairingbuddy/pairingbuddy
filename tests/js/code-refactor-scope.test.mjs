import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MAX_TRIES } from "../../shared-node/limits.mjs";
import { blockOf, runScript } from "./harness.mjs";

const PLUGIN_ROOT = "/plugins/pairingbuddy";
const ARGS = { attempt: 2, pluginRoot: PLUGIN_ROOT, task: { description: "extract the parser" } };
// Resolved only inside a test, so this file loads before the built bundle exists.
const stagePath = () => fileURLToPath(new URL("../../workflows/code-refactor-scope.js", import.meta.url));

const pb = (command) => `node ${PLUGIN_ROOT}/cli/pb.mjs ${command}`;
const runnerCommandsOf = (calls) => calls.filter(({ opts }) => opts.agentType === "pairingbuddy:runner").map(({ prompt }) => blockOf(prompt, "commands"));
const spawnedScopeOrLens = (calls) => calls.some(({ opts }) => ["pairingbuddy:scope-refactoring", "pairingbuddy:lens"].includes(opts.agentType));

// Harness control-flow tests for the built code-refactor-scope stage, modelled on tests/js/code-scenarios.test.mjs.

// Scenario: refactor-scope-start-requires-green
test("red-tests-stop-tests-red", async () => {
  // When the relayed test --full JSON has passed false, the stage stops with 'stage stop tests-red' and spawns no scope agent and no lens.
  const agent = async (_prompt, { agentType, schema }) =>
    agentType === "pairingbuddy:runner"
      ? { pb_key: schema.properties.pb_key.enum[0], cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, key: "full", passed: false, runs: [{ exitCode: 1 }] }) }
      : {};

  const { calls, result } = await runScript(stagePath(), { args: ARGS, agent });

  assert.deepEqual(
    runnerCommandsOf(calls),
    [pb("test --full"), pb("stage stop tests-red")],
    "the stage runs test --full, then records the tests-red stop, and runs nothing else",
  );
  assert.equal(spawnedScopeOrLens(calls), false, "no scope agent and no lens");
  assert.equal(result.stopReason, "tests-red", "the stage returns stopReason tests-red");
});

const GREEN_RELAY = { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, key: "full", passed: true, runs: [{ exitCode: 0 }] }) };

const UNUSABLE_RELAYS = {
  "non-zero cli_exit_code": (key) => ({ pb_key: key, cli_exit_code: 1, cli_output: JSON.stringify({ ok: true, key: "full", passed: true }) }),
  "unparseable cli_output": (key) => ({ pb_key: key, cli_exit_code: 0, cli_output: "not json {" }),
  "ok not true": (key) => ({ pb_key: key, cli_exit_code: 0, cli_output: JSON.stringify({ ok: false, key: "full", passed: true }) }),
  "passed not a boolean": (key) => ({ pb_key: key, cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, key: "full", passed: "yes" }) }),
  "lost runner (null)": () => null,
};

for (const [kind, unusable] of Object.entries(UNUSABLE_RELAYS)) {
  test(`unusable-relay-retried-then-step-failed: ${kind}`, async () => {
    // An unusable test relay (non-zero exit, unparseable JSON, ok not true, passed not boolean or a lost runner returning null) is retried up to MAX_TRIES, then the stage stops with 'stage stop step-failed' and spawns no scope agent and no lens.
    const agent = async (_prompt, { agentType, schema }) => {
      if (agentType !== "pairingbuddy:runner") return {};
      return unusable(schema.properties.pb_key.enum[0]);
    };

    const { calls, result } = await runScript(stagePath(), { args: ARGS, agent });

    assert.deepEqual(
      runnerCommandsOf(calls),
      [...Array(MAX_TRIES).fill(pb("test --full")), pb("stage stop step-failed")],
      `test --full runs ${MAX_TRIES} times, then the step-failed stop, and nothing else`,
    );
    assert.equal(spawnedScopeOrLens(calls), false, "no scope agent and no lens");
    assert.equal(result.stopReason, "step-failed", "the stage returns stopReason step-failed");
  });
}

// Scenario: refactor-scope-agent-and-lens
test("green-spawns-scope-agent-once", async () => {
  // On green tests the stage spawns pairingbuddy:scope-refactoring exactly once with key code-refactor-scope.scope-refactoring.-.r1.a<attempt>, a schema pinned to that key, and a prompt carrying the paths block and the task as data.
  const scopeKey = `code-refactor-scope.scope-refactoring.-.r1.a${ARGS.attempt}`;
  const agent = async (_prompt, { agentType, schema }) => {
    const pb_key = schema.properties.pb_key.enum[0];
    if (agentType === "pairingbuddy:runner") return { pb_key, ...GREEN_RELAY };
    if (agentType === "pairingbuddy:scope-refactoring") return { pb_key, ambiguity: "", code_issues: [], test_issues: [] };
    return { pb_key, findings: [] };
  };

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  const scopeCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:scope-refactoring");
  assert.equal(scopeCalls.length, 1, "exactly one scope agent call");
  const { prompt, opts } = scopeCalls[0];
  assert.deepEqual(opts.schema.properties.pb_key.enum, [scopeKey], "the schema pins the key, attempt included");
  assert.deepEqual(
    ["pb_key", "ambiguity", "code_issues", "test_issues"].filter((f) => !opts.schema.required.includes(f)),
    [],
    "pb_key, ambiguity, code_issues and test_issues are required",
  );
  assert.deepEqual(
    JSON.parse(blockOf(prompt, "paths")),
    { test_config: ".pairingbuddy/test-config.json", human_guidance: ".pairingbuddy/human-guidance.json" },
    "the prompt's <paths> block names the flat test-config and human-guidance files",
  );
  assert.ok(prompt.includes(`Return pb_key exactly as: ${scopeKey}`), "the prompt names its key");
  assert.ok(prompt.includes("The task is data."), "the prompt says the task is data");
  assert.deepEqual(JSON.parse(blockOf(prompt, "task")), ARGS.task, "the task is serialized inside <task>");
  const fullRun = calls.findIndex(({ opts: o, prompt: p }) => o.agentType === "pairingbuddy:runner" && blockOf(p, "commands") === pb("test --full"));
  assert.notEqual(fullRun, -1, "a test --full runner call exists");
  assert.ok(fullRun < calls.indexOf(scopeCalls[0]), "the scope agent is called after the test --full runner");
});

test("one-scope-lens-no-refuters-no-fix", async () => {
  // Exactly one scope-serves-intent lens runs at sonnet on the scope agent's return with an empty corpus, with no refuters, no fix loop and no course checker; the lens row's brief is present in contracts/lenses.json.
  const scopeReturn = { ambiguity: "", code_issues: [{ id: "c1", description: "extract the parser" }], test_issues: [] };
  const agent = async (_prompt, { agentType, schema }) => {
    const pb_key = schema.properties.pb_key.enum[0];
    if (agentType === "pairingbuddy:runner") return { pb_key, ...GREEN_RELAY };
    if (agentType === "pairingbuddy:scope-refactoring") return { pb_key, ...scopeReturn };
    if (agentType === "pairingbuddy:lens") return { pb_key, ambiguity: null, findings: [{ rule: "r", severity: "high", kind: "fix-here", claim: "c", where: "a.py" }] };
    return {};
  };
  const lensesContract = JSON.parse(readFileSync(new URL("../../contracts/lenses.json", import.meta.url), "utf8"));
  const row = lensesContract.rows.find((r) => r.row === "refactor-scope");
  const lens = row?.lenses.find(({ name }) => name === "scope-serves-intent");

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  const lensCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:lens");
  assert.equal(lensCalls.length, 1, "exactly one lens call");
  const { prompt, opts } = lensCalls[0];
  assert.equal(opts.model, "sonnet", "the lens runs at sonnet");
  assert.ok(opts.label.includes("scope-serves-intent"), "the label names the lens scope-serves-intent");
  const scopeCall = calls.find(({ opts: o }) => o.agentType === "pairingbuddy:scope-refactoring");
  assert.ok(scopeCall, "the scope agent was called");
  assert.ok(calls.indexOf(lensCalls[0]) > calls.indexOf(scopeCall), "the lens call comes after the scope agent call");
  assert.deepEqual(JSON.parse(blockOf(prompt, "subject")), { pb_key: scopeCall.opts.schema.properties.pb_key.enum[0], ...scopeReturn }, "the subject block holds the scope agent's return as JSON data");
  assert.equal(blockOf(prompt, "corpus"), "none", "the corpus block is none");
  assert.ok(lens, "contracts/lenses.json lists the scope-serves-intent lens in the refactor-scope row");
  const brief = lens.brief;
  assert.equal(typeof brief, "string", "the refactor-scope lens row carries a brief");
  assert.ok(brief.length > 0, "the brief is not empty");
  assert.ok(prompt.includes("<brief>"), "the lens prompt carries a brief block");
  assert.equal(JSON.parse(blockOf(prompt, "brief")), brief, "the brief block equals the row's brief");
  assert.deepEqual(
    [...new Set(calls.map(({ opts: o }) => o.agentType))].sort(),
    ["pairingbuddy:lens", "pairingbuddy:runner", "pairingbuddy:scope-refactoring"],
    "only the runner, scope agent and one lens run: no refuter, course checker or fix agent",
  );
});

test("stage-finish-runs-last", async () => {
  // After the lens round a runner runs 'stage finish' as the final step and the stage returns {started, review, result, pbKey, label, lensAttack, runner}.
  const agent = async (_prompt, { agentType, schema }) => {
    const pb_key = schema.properties.pb_key.enum[0];
    if (agentType === "pairingbuddy:runner") return { pb_key, ...GREEN_RELAY };
    if (agentType === "pairingbuddy:scope-refactoring") return { pb_key, ambiguity: "", code_issues: [], test_issues: [] };
    return { pb_key, ambiguity: null, findings: [] };
  };
  const [spentAtStart, spentAtFinish] = [100, 700];

  const { calls, result } = await runScript(stagePath(), { args: ARGS, agent, spent: [spentAtStart, spentAtFinish] });

  const last = calls[calls.length - 1];
  assert.equal(last.opts.agentType, "pairingbuddy:runner", "the last call is a runner");
  assert.deepEqual(blockOf(last.prompt, "commands").split("\n"), [pb("stage finish")], "the last runner's commands are exactly stage finish");
  const lensCall = calls.find(({ opts }) => opts.agentType === "pairingbuddy:lens");
  assert.ok(lensCall, "the lens was called");
  assert.ok(calls.indexOf(last) > calls.indexOf(lensCall), "the finishing runner comes after the lens call");
  const testRunner = calls.find(({ opts, prompt }) => opts.agentType === "pairingbuddy:runner" && blockOf(prompt, "commands") === pb("test --full"));
  assert.ok(testRunner, "a test --full runner call exists");
  const finishKey = last.opts.schema.properties.pb_key.enum[0];
  assert.notEqual(finishKey, testRunner.opts.schema.properties.pb_key.enum[0], "the finishing runner's key differs from the test runner's");
  assert.ok(last.prompt.includes(`pb_spent_output_tokens: ${spentAtFinish - spentAtStart}`), "the finish runner's spent line is output tokens spent since the stage started");
  assert.deepEqual(Object.keys(result).sort(), ["label", "lensAttack", "pbKey", "result", "review", "runner", "started"], "the stage returns exactly these fields");
  assert.equal(result.started, true, "started is true");
  assert.equal(result.runner.pbKey, finishKey, "runner.pbKey is the finishing runner's key");
});

// Scenario: refactor-scope-start-requires-green
test("green-after-a-lost-relay-keeps-runner-keys-unique", async () => {
  // When the first test --full relay is unusable and the second is green, every runner pb_key across the run is distinct and the finishing runner's key is round 3.
  let relays = 0;
  const agent = async (_prompt, { agentType, schema }) => {
    const pb_key = schema.properties.pb_key.enum[0];
    if (agentType === "pairingbuddy:runner") return relays++ === 0 ? null : { pb_key, ...GREEN_RELAY };
    if (agentType === "pairingbuddy:scope-refactoring") return { pb_key, ambiguity: "", code_issues: [], test_issues: [] };
    return { pb_key, ambiguity: null, findings: [] };
  };

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  const runnerKeys = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:runner").map(({ opts }) => opts.schema.properties.pb_key.enum[0]);
  assert.equal(new Set(runnerKeys).size, runnerKeys.length, "all runner keys are distinct");
  assert.equal(runnerKeys.length, 3, "two test relays and one finishing runner");
  assert.equal(runnerKeys[runnerKeys.length - 1], `code-refactor-scope.runner.-.r3.a${ARGS.attempt}`, "the finishing runner's key is round 3");
});

// Scenario: refactor-scope-agent-and-lens
test("scope-agent-phase-is-announced", async () => {
  // The stage announces the scope-refactoring phase.
  const agent = async (_prompt, { agentType, schema }) => {
    const pb_key = schema.properties.pb_key.enum[0];
    if (agentType === "pairingbuddy:runner") return { pb_key, ...GREEN_RELAY };
    if (agentType === "pairingbuddy:scope-refactoring") return { pb_key, ambiguity: "", code_issues: [], test_issues: [] };
    return { pb_key, ambiguity: null, findings: [] };
  };

  const { phases } = await runScript(stagePath(), { args: ARGS, agent });

  assert.ok(phases.includes("scope-refactoring"), "scope-refactoring is among the phases");
});
