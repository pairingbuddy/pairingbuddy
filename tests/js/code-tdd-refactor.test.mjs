import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runScript } from "./harness.mjs";
import { readLabel } from "../../shared-node/labels.mjs";

// Task 48: the per-cycle refactor of the built code-tdd stage, for new_feature only. identify-* find and refactor-* fix,
// and each fix group goes through pb checkpoint --step refactor. The agents are recording stand-ins, and a runner
// stand-in answers the way the runner relays the CLI.
const STAGE = fileURLToPath(new URL("../../workflows/code-tdd.js", import.meta.url));
const PLUGIN_ROOT = "/plugins/pairingbuddy";
const PB = `node ${PLUGIN_ROOT}/cli/pb.mjs`;
const ARGS = { attempt: 1, pluginRoot: PLUGIN_ROOT, task: { description: "add a discount" } };
const SCENARIOS_PATH = ".pairingbuddy/run/task/artifacts/code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1.json";
const MAX_AGENTS = JSON.parse(readFileSync(new URL("../../contracts/stages.json", import.meta.url), "utf8")).stageMaxAgents["code-tdd"];
const RUNNER = "pairingbuddy:runner";
const PLACEHOLDERS = "pairingbuddy:create-test-placeholders";
const FIND_TESTS = "pairingbuddy:identify-test-issues";
const FIND_CODE = "pairingbuddy:identify-code-issues";
const FIX_TESTS = "pairingbuddy:refactor-tests";
const FIX_CODE = "pairingbuddy:refactor-code";
const COVERAGE = "pairingbuddy:verify-test-coverage";
const artifact = (key) => `.pairingbuddy/run/task/artifacts/${key}.json`;

const row = (test_id) => ({ test_id, test_case_id: "c", scenario_id: "s", runner_id: "pytest", test_file: "tests/test_a.py", test_function: `test_${test_id}` });
const blockOf = (prompt, tag) => prompt.slice(prompt.indexOf(`<${tag}>\n`) + tag.length + 3, prompt.indexOf(`\n</${tag}>`));
const commandsOf = ({ prompt }) => blockOf(prompt, "commands").split("\n").map((line) => line.replace(`${PB} `, ""));
const isRunner = ({ opts }) => opts.agentType === RUNNER;
const pbKeyOf = ({ opts }) => opts.schema.properties.pb_key.enum[0];
const issue = { file: "src/a.py", issue_type: "naming", description: "a vague name" };

const accepted = { cli_exit_code: 0, cli_output: "{\"ok\":true}" };
const refused = (text) => ({ cli_exit_code: 1, cli_output: `pb: ${text}` });
const stateOutput = (over) => JSON.stringify({ ok: true, taskType: "new_feature", scenarios: SCENARIOS_PATH, tests: null, red: [], green: [], covered: [], ...over });

function standIn({ tests = [row("t1")], state = {}, runner = () => undefined, worker = () => undefined, issues = [issue] } = {}) {
  return async (prompt, opts) => {
    const pb_key = opts.schema.properties.pb_key.enum[0];
    if (opts.agentType === RUNNER) {
      const commands = commandsOf({ prompt });
      const override = runner(commands, pb_key);
      if (override !== undefined) return override === null ? null : { pb_key, ...override };
      return { pb_key, ...(commands[0] === "tdd state" ? { cli_exit_code: 0, cli_output: stateOutput(state) } : accepted) };
    }
    const override = worker(opts.agentType, pb_key, prompt);
    if (override !== undefined) return override;
    if (opts.agentType === FIND_TESTS || opts.agentType === FIND_CODE) return { pb_key, ambiguity: "", issues };
    if (opts.agentType === COVERAGE) return { pb_key, ambiguity: "", status: "complete", scenarios_covered: 1, scenarios_total: 1, test_cases_covered: 1, test_cases_total: 1, gaps: [] };
    return { pb_key, ambiguity: "", commit_subject: "x", files_changed: [], ...(opts.agentType === PLACEHOLDERS ? { tests } : {}) };
  };
}

const runStage = (options, args = ARGS) => runScript(STAGE, { args, agent: standIn(options) });

const stepsOf = (calls) => calls.map((call) => (isRunner(call) ? commandsOf(call).join(" && ") : `${call.opts.agentType.replace("pairingbuddy:", "")} ${pbKeyOf(call)}`));
const callsOf = (calls, agentType) => calls.filter(({ opts }) => opts.agentType === agentType);

const refactorSteps = (id, round = 1) => [
  `identify-test-issues code-tdd.identify-test-issues.${id}.r${round}.a1`,
  `refactor-tests code-tdd.refactor-tests.${id}.r${round}.a1`,
  `checkpoint --step refactor --from code-tdd.refactor-tests.${id}.r${round}.a1`,
  `identify-code-issues code-tdd.identify-code-issues.${id}.r${round}.a1`,
  `refactor-code code-tdd.refactor-code.${id}.r${round}.a1`,
  `checkpoint --step refactor --from code-tdd.refactor-code.${id}.r${round}.a1`,
];

test("code-tdd-new-feature-refactors-after-each-green-tests-first-then-code", async () => {
  const { calls, result } = await runStage({ tests: [row("t1"), row("t2")] });

  assert.deepEqual(stepsOf(calls).slice(3), [
    "implement-tests code-tdd.implement-tests.t1.r1.a1",
    "checkpoint --step red --from code-tdd.implement-tests.t1.r1.a1",
    "implement-code code-tdd.implement-code.t1.r1.a1",
    "checkpoint --step green --from code-tdd.implement-code.t1.r1.a1",
    ...refactorSteps("t1"),
    "implement-tests code-tdd.implement-tests.t2.r1.a1",
    "checkpoint --step red --from code-tdd.implement-tests.t2.r1.a1",
    "implement-code code-tdd.implement-code.t2.r1.a1",
    "checkpoint --step green --from code-tdd.implement-code.t2.r1.a1",
    ...refactorSteps("t2"),
    "verify-test-coverage code-tdd.verify-test-coverage.-.r1.a1",
    "stage finish",
  ]);
  assert.equal(result.stopReason, null);
});

for (const [name, taskType] of [["bug_fix", "bug_fix"], ["a state with no task type", undefined]]) {
  test(`code-tdd-${name.replaceAll(" ", "-")}-has-no-per-cycle-refactor`, async () => {
    const { calls, result } = await runStage({ state: { taskType } });

    for (const agentType of [FIND_TESTS, FIND_CODE, FIX_TESTS, FIX_CODE]) assert.equal(callsOf(calls, agentType).length, 0, agentType);
    assert.equal(calls.some(({ prompt }) => prompt.includes("--step refactor")), false);
    assert.equal(result.stopReason, null);
  });
}

test("code-tdd-a-finder-that-finds-nothing-spawns-no-fixer-and-no-checkpoint", async () => {
  const { calls } = await runStage({ issues: [] });

  assert.equal(callsOf(calls, FIND_TESTS).length, 1);
  assert.equal(callsOf(calls, FIND_CODE).length, 1);
  assert.equal(callsOf(calls, FIX_TESTS).length + callsOf(calls, FIX_CODE).length, 0);
  assert.equal(calls.some(({ prompt }) => prompt.includes("--step refactor")), false);
});

test("code-tdd-only-the-finder-with-issues-gets-a-fixer", async () => {
  const { calls } = await runStage({ worker: (agentType, pb_key) => (agentType === FIND_TESTS ? { pb_key, ambiguity: "", issues: [] } : undefined) });

  assert.equal(callsOf(calls, FIX_TESTS).length, 0);
  assert.equal(callsOf(calls, FIX_CODE).length, 1);
});

test("code-tdd-refactor-labels-carry-the-refactor-phase-and-the-cycle", async () => {
  const { calls } = await runStage();

  assert.deepEqual(calls.slice(7, 13).map(({ opts }) => opts.label), [
    "pb1 code-tdd REFACTOR identify-test-issues t1 r1",
    "pb1 code-tdd REFACTOR refactor-tests t1 r1",
    "pb1 code-tdd REFACTOR runner t1 r3",
    "pb1 code-tdd REFACTOR identify-code-issues t1 r1",
    "pb1 code-tdd REFACTOR refactor-code t1 r1",
    "pb1 code-tdd REFACTOR runner t1 r4",
  ]);
  for (const { opts } of calls) assert.equal(readLabel(opts.label).unknown, false, opts.label);
  const keys = calls.map(pbKeyOf);
  assert.equal(new Set(keys).size, keys.length, keys.join("\n"));
});

test("code-tdd-each-refactor-agent-gets-its-paths-under-the-one-input-rule", async () => {
  const { calls } = await runStage();
  const tests = artifact("code-tdd.create-test-placeholders.-.r1.a1");
  const shared = { test_config: ".pairingbuddy/test-config.json", human_guidance: ".pairingbuddy/human-guidance.json" };
  const pathsOf = (agentType) => JSON.parse(blockOf(callsOf(calls, agentType)[0].prompt, "paths"));

  assert.deepEqual(pathsOf(FIND_TESTS), { tests, ...shared });
  assert.deepEqual(pathsOf(FIX_TESTS), { issues: artifact("code-tdd.identify-test-issues.t1.r1.a1"), tests, ...shared });
  assert.deepEqual(pathsOf(FIND_CODE), { code: artifact("code-tdd.implement-code.t1.r1.a1"), ...shared });
  assert.deepEqual(pathsOf(FIX_CODE), { issues: artifact("code-tdd.identify-code-issues.t1.r1.a1"), tests, ...shared });
  for (const agentType of [FIND_TESTS, FIX_TESTS, FIND_CODE, FIX_CODE]) assert.equal(blockOf(callsOf(calls, agentType)[0].prompt, "test_id"), "t1", agentType);
});

test("code-tdd-the-code-finder-reads-the-green-that-was-accepted", async () => {
  let refusals = 1;
  const { calls } = await runStage({
    runner: ([command]) => {
      if (!command.startsWith("checkpoint --step green") || refusals === 0) return undefined;
      refusals -= 1;
      return refused("not GREEN");
    },
  });

  assert.equal(JSON.parse(blockOf(callsOf(calls, FIND_CODE)[0].prompt, "paths")).code, artifact("code-tdd.implement-code.t1.r2.a1"));
});

for (const [name, schemaFile, agentType] of [
  ["identify-test-issues", "identify-test-issues-result", FIND_TESTS],
  ["identify-code-issues", "identify-code-issues-result", FIND_CODE],
  ["refactor-tests", "refactor-tests-result", FIX_TESTS],
  ["refactor-code", "refactor-code-result", FIX_CODE],
]) {
  test(`code-tdd-${name}-schema-is-the-contract-with-the-key-pinned`, async () => {
    const { calls } = await runStage();
    const contract = JSON.parse(readFileSync(new URL(`../../contracts/schemas/${schemaFile}.schema.json`, import.meta.url), "utf8"));
    const [call] = callsOf(calls, agentType);

    const { schema } = call.opts;
    assert.deepEqual(schema.properties.pb_key.enum, [pbKeyOf(call)]);
    const { enum: _pinned, ...pbKey } = schema.properties.pb_key;
    assert.deepEqual({ ...schema, properties: { ...schema.properties, pb_key: pbKey } }, contract);
  });
}

// ---------- a refused fix group ----------

test("code-tdd-a-refused-refactor-goes-back-to-a-new-fixer-at-the-next-round", async () => {
  let refusals = 1;
  const { calls, result } = await runStage({
    runner: ([command]) => {
      if (!command.startsWith("checkpoint --step refactor --from code-tdd.refactor-code") || refusals === 0) return undefined;
      refusals -= 1;
      return refused("the tests failed, so nothing was committed: exit codes 1");
    },
  });

  const fixers = callsOf(calls, FIX_CODE);
  assert.deepEqual(fixers.map(pbKeyOf), ["code-tdd.refactor-code.t1.r1.a1", "code-tdd.refactor-code.t1.r2.a1"]);
  assert.match(blockOf(fixers[1].prompt, "previous_refusal"), /the tests failed/);
  assert.equal(callsOf(calls, FIND_CODE).length, 1, "the finder's issues stand");
  assert.equal(result.stopReason, null);
});

test("code-tdd-a-refactor-that-keeps-breaking-the-tests-stops-within-its-bound", async () => {
  const { calls, result } = await runStage({ tests: [row("t1"), row("t2")], runner: ([command]) => (command.startsWith("checkpoint --step refactor") ? refused("the tests failed") : undefined) });

  assert.equal(callsOf(calls, FIX_TESTS).length, 3, "three tries");
  assert.equal(result.stopReason, "step-failed");
  assert.deepEqual(commandsOf(calls.at(-1)), ["stage stop step-failed"]);
  assert.equal(calls.some(({ prompt }) => prompt.includes("<test_id>\nt2\n")), false, "the next test does not start");
});

test("code-tdd-a-finder-that-returns-nothing-is-spawned-again-then-stops", async () => {
  let lost = 1;
  const once = await runStage({ worker: (agentType) => (agentType === FIND_TESTS && lost-- > 0 ? null : undefined) });
  assert.deepEqual(callsOf(once.calls, FIND_TESTS).map(pbKeyOf), ["code-tdd.identify-test-issues.t1.r1.a1", "code-tdd.identify-test-issues.t1.r2.a1"]);
  assert.equal(once.result.stopReason, null);

  const always = await runStage({ worker: (agentType) => (agentType === FIND_TESTS ? null : undefined) });
  assert.equal(callsOf(always.calls, FIND_TESTS).length, 3);
  assert.equal(always.result.stopReason, "step-failed");
});

test("code-tdd-a-refactor-the-cli-stopped-is-not-retried", async () => {
  const { calls, result } = await runStage({ runner: ([command]) => (command.startsWith("checkpoint --step refactor") ? refused("the run stopped: the commit could not be signed") : undefined) });

  assert.equal(callsOf(calls, FIX_TESTS).length, 1);
  assert.equal(result.stopReason, "run-stopped");
});

// ---------- what a cycle refactors ----------

test("code-tdd-a-covered-test-has-no-green-so-no-refactor", async () => {
  const covered = JSON.stringify({ ok: true, outcome: "covered" });
  const { calls } = await runStage({ tests: [row("t1"), row("t2")], runner: ([command]) => (command.startsWith("checkpoint --step red --from code-tdd.implement-tests.t2") ? { cli_exit_code: 0, cli_output: covered } : undefined) });

  assert.deepEqual(callsOf(calls, FIND_TESTS).map((call) => blockOf(call.prompt, "test_id")), ["t1"]);
});

test("code-tdd-a-re-run-does-not-refactor-a-cycle-whose-green-was-already-done", async () => {
  const { calls } = await runStage({ tests: [row("t1"), row("t2")], state: { red: ["t1", "t2"], green: ["t1"] } }, { ...ARGS, attempt: 2 });

  assert.deepEqual(callsOf(calls, FIND_TESTS).map((call) => blockOf(call.prompt, "test_id")), ["t2"]);
});

// ---------- the spawn cap ----------

test("code-tdd-refactor-spawns-count-against-the-cap", async () => {
  const { calls, result } = await runStage({ tests: Array.from({ length: MAX_AGENTS }, (_, i) => row(`t${i}`)) });

  assert.equal(calls.length, MAX_AGENTS);
  assert.deepEqual(commandsOf(calls.at(-1)), ["stage stop agent-budget"]);
  assert.equal(result.stopReason, "agent-budget");
  assert.ok(callsOf(calls, FIX_CODE).length > 0);
});
