import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { blockOf, runScript } from "./harness.mjs";
import { readLabel } from "../../shared-node/labels.mjs";

// Task 49: the coverage loop of the built code-tdd stage, for new_feature and bug_fix. After the cycles
// verify-test-coverage reports gaps, and each gap sends the stage back to placeholders and cycles for the new tests, up
// to a bound. Gaps left after it finish the stage as usual, and the gate asks about them. The agents are recording
// stand-ins, and a runner stand-in answers the way the runner relays the CLI.
const STAGE = fileURLToPath(new URL("../../workflows/code-tdd.js", import.meta.url));
const PLUGIN_ROOT = "/plugins/pairingbuddy";
const PB = `node ${PLUGIN_ROOT}/cli/pb.mjs`;
const ARGS = { attempt: 1, pluginRoot: PLUGIN_ROOT, task: { description: "add a discount" } };
const SCENARIOS_PATH = ".pairingbuddy/run/task/artifacts/code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1.json";
const MAX_AGENTS = JSON.parse(readFileSync(new URL("../../contracts/stages.json", import.meta.url), "utf8")).stageMaxAgents["code-tdd"];
const MAX_LOOPS = 2;
const RUNNER = "pairingbuddy:runner";
const PLACEHOLDERS = "pairingbuddy:create-test-placeholders";
const TESTS = "pairingbuddy:implement-tests";
const COVERAGE = "pairingbuddy:verify-test-coverage";
const artifact = (key) => `.pairingbuddy/run/task/artifacts/${key}.json`;

const row = (test_id) => ({ test_id, test_case_id: "c", scenario_id: "s", runner_id: "pytest", test_file: "tests/test_a.py", test_function: `test_${test_id}` });
const gap = { scenario_id: "s", test_case_id: "c2", description: "no test for a zero discount" };
const commandsOf = ({ prompt }) => blockOf(prompt, "commands").split("\n").map((line) => line.replace(`${PB} `, ""));
const isRunner = ({ opts }) => opts.agentType === RUNNER;
const pbKeyOf = ({ opts }) => opts.schema.properties.pb_key.enum[0];
const callsOf = (calls, agentType) => calls.filter(({ opts }) => opts.agentType === agentType);

const accepted = { cli_exit_code: 0, cli_output: "{\"ok\":true}" };
const stateOutput = (over) => JSON.stringify({ ok: true, taskType: "bug_fix", scenarios: SCENARIOS_PATH, tests: null, red: [], green: [], covered: [], ...over });
const report = (gaps) => ({ ambiguity: "", status: gaps.length === 0 ? "complete" : "incomplete", scenarios_covered: 1, scenarios_total: 1, test_cases_covered: 1, test_cases_total: 1 + gaps.length, gaps });

// Each placeholders call returns the next list of rows, and each coverage round the next list of gaps. The last stays.
function standIn({ rows = [[row("t1")]], gaps = [[]], state = {}, worker = () => undefined } = {}) {
  let placeholders = 0;
  let rounds = 0;
  return async (prompt, opts) => {
    const pb_key = opts.schema.properties.pb_key.enum[0];
    if (opts.agentType === RUNNER) return { pb_key, ...(commandsOf({ prompt })[0] === "tdd state" ? { cli_exit_code: 0, cli_output: stateOutput(state) } : accepted) };
    const override = worker(opts.agentType, pb_key, prompt);
    if (override !== undefined) return override;
    if (opts.agentType === COVERAGE) return { pb_key, ...report(gaps[Math.min(rounds++, gaps.length - 1)]) };
    if (opts.agentType === PLACEHOLDERS) return { pb_key, ambiguity: "", commit_subject: "x", files_changed: [], tests: rows[Math.min(placeholders++, rows.length - 1)] };
    return { pb_key, ambiguity: "", commit_subject: "x", files_changed: [], issues: [] };
  };
}

const runStage = (options, args = ARGS) => runScript(STAGE, { args, agent: standIn(options) });

const stepsOf = (calls) => calls.map((call) => (isRunner(call) ? commandsOf(call).join(" && ") : `${call.opts.agentType.replace("pairingbuddy:", "")} ${pbKeyOf(call)}`));

for (const taskType of ["bug_fix", "new_feature"]) {
  test(`code-tdd-${taskType}-checks-coverage-once-after-the-cycles-when-nothing-is-missing`, async () => {
    const { calls, result } = await runStage({ state: { taskType } });

    assert.deepEqual(stepsOf(calls).slice(-2), ["verify-test-coverage code-tdd.verify-test-coverage.-.r1.a1", "stage finish"]);
    assert.equal(callsOf(calls, COVERAGE).length, 1);
    assert.equal(result.stopReason, null);
  });
}

test("code-tdd-the-coverage-check-gets-its-paths-under-the-one-input-rule", async () => {
  const { calls } = await runStage();

  assert.deepEqual(JSON.parse(blockOf(callsOf(calls, COVERAGE)[0].prompt, "paths")), {
    scenarios: SCENARIOS_PATH,
    tests: artifact("code-tdd.create-test-placeholders.-.r1.a1"),
    test_config: ".pairingbuddy/test-config.json",
    human_guidance: ".pairingbuddy/human-guidance.json",
  });
});

test("code-tdd-a-gap-loops-back-to-placeholders-and-cycles-only-the-new-tests", async () => {
  const { calls, result } = await runStage({ rows: [[row("t1")], [row("t1"), row("t2")]], gaps: [[gap], []] });

  assert.deepEqual(stepsOf(calls).slice(7), [
    "verify-test-coverage code-tdd.verify-test-coverage.-.r1.a1",
    "create-test-placeholders code-tdd.create-test-placeholders.-.r2.a1",
    "checkpoint --step placeholders --from code-tdd.create-test-placeholders.-.r2.a1",
    "implement-tests code-tdd.implement-tests.t2.r1.a1",
    "checkpoint --step red --from code-tdd.implement-tests.t2.r1.a1",
    "implement-code code-tdd.implement-code.t2.r1.a1",
    "checkpoint --step green --from code-tdd.implement-code.t2.r1.a1",
    "verify-test-coverage code-tdd.verify-test-coverage.-.r2.a1",
    "stage finish",
  ]);
  assert.deepEqual(result.tests, ["t1", "t2"]);
  assert.equal(result.stopReason, null);
});

test("code-tdd-the-loop-gives-placeholders-the-gaps-and-the-rows-so-far, and the next check the new rows", async () => {
  const { calls } = await runStage({ rows: [[row("t1")], [row("t1"), row("t2")]], gaps: [[gap], []] });
  const [, again] = callsOf(calls, PLACEHOLDERS);

  assert.deepEqual(JSON.parse(blockOf(again.prompt, "paths")), {
    scenarios: SCENARIOS_PATH,
    test_config: ".pairingbuddy/test-config.json",
    human_guidance: ".pairingbuddy/human-guidance.json",
    tests: artifact("code-tdd.create-test-placeholders.-.r1.a1"),
    coverage_report: artifact("code-tdd.verify-test-coverage.-.r1.a1"),
  });
  assert.equal(JSON.parse(blockOf(callsOf(calls, COVERAGE)[1].prompt, "paths")).tests, artifact("code-tdd.create-test-placeholders.-.r2.a1"));
  assert.equal(JSON.parse(blockOf(callsOf(calls, TESTS)[1].prompt, "paths")).tests, artifact("code-tdd.create-test-placeholders.-.r2.a1"));
});

test("code-tdd-the-loop-holds-its-bound-and-leaves-the-gaps-for-the-gate", async () => {
  const { calls, result } = await runStage({ rows: [[row("t1")], [row("t1"), row("t2")], [row("t1"), row("t2"), row("t3")]], gaps: [[gap]] });

  assert.equal(callsOf(calls, COVERAGE).length, MAX_LOOPS + 1);
  assert.equal(callsOf(calls, PLACEHOLDERS).length, MAX_LOOPS + 1, "the first placeholders, then one per loop");
  assert.deepEqual(stepsOf(calls).slice(-2), [`verify-test-coverage code-tdd.verify-test-coverage.-.r${MAX_LOOPS + 1}.a1`, "stage finish"]);
  assert.equal(result.stopReason, null, "gaps are no stop: the stage finishes, and the gate asks");
  assert.deepEqual(result.tests, ["t1", "t2", "t3"]);
});

test("code-tdd-a-loop-that-adds-no-test-still-holds-its-bound", async () => {
  const { calls, result } = await runStage({ gaps: [[gap]] });

  assert.equal(callsOf(calls, COVERAGE).length, MAX_LOOPS + 1);
  assert.equal(callsOf(calls, TESTS).length, 1, "only t1 ever cycles");
  assert.equal(result.stopReason, null);
});

test("code-tdd-loop-labels-and-keys-follow-the-contract", async () => {
  const { calls } = await runStage({ rows: [[row("t1")], [row("t1"), row("t2")]], gaps: [[gap], []] });

  assert.deepEqual(callsOf(calls, COVERAGE).map(({ opts }) => opts.label), ["pb1 code-tdd - verify-test-coverage - r1", "pb1 code-tdd - verify-test-coverage - r2"]);
  for (const { opts } of calls) assert.equal(readLabel(opts.label).unknown, false, opts.label);
  const keys = calls.map(pbKeyOf);
  assert.equal(new Set(keys).size, keys.length, keys.join("\n"));
});

test("code-tdd-the-coverage-schema-is-the-contract-with-the-key-pinned", async () => {
  const { calls } = await runStage();
  const contract = JSON.parse(readFileSync(new URL("../../contracts/schemas/verify-test-coverage-result.schema.json", import.meta.url), "utf8"));
  const [call] = callsOf(calls, COVERAGE);

  const { schema } = call.opts;
  assert.deepEqual(schema.properties.pb_key.enum, [pbKeyOf(call)]);
  const { enum: _pinned, ...pbKey } = schema.properties.pb_key;
  assert.deepEqual({ ...schema, properties: { ...schema.properties, pb_key: pbKey } }, contract);
});

test("code-tdd-a-coverage-check-that-returns-nothing-is-spawned-again-then-stops", async () => {
  let lost = 1;
  const once = await runStage({ worker: (agentType) => (agentType === COVERAGE && lost-- > 0 ? null : undefined) });
  assert.deepEqual(callsOf(once.calls, COVERAGE).map(pbKeyOf), ["code-tdd.verify-test-coverage.-.r1.a1", "code-tdd.verify-test-coverage.-.r2.a1"]);
  assert.equal(once.result.stopReason, null);

  const always = await runStage({ worker: (agentType) => (agentType === COVERAGE ? null : undefined) });
  assert.equal(callsOf(always.calls, COVERAGE).length, 3);
  assert.equal(always.result.stopReason, "step-failed");
  assert.equal(always.calls.some(({ prompt }) => prompt.includes("stage finish")), false);
});

test("code-tdd-new-feature-refactors-the-cycles-the-loop-adds", async () => {
  const issues = [{ file: "src/a.py", issue_type: "naming", description: "vague" }];
  const { calls } = await runStage({
    state: { taskType: "new_feature" },
    rows: [[row("t1")], [row("t1"), row("t2")]],
    gaps: [[gap], []],
    worker: (agentType, pb_key) => (agentType.includes("identify-") ? { pb_key, ambiguity: "", issues } : undefined),
  });

  assert.deepEqual(callsOf(calls, "pairingbuddy:identify-code-issues").map(({ prompt }) => blockOf(prompt, "test_id")), ["t1", "t2"]);
});

test("code-tdd-the-maxAgents-stop-covers-the-loop", async () => {
  const many = (from) => Array.from({ length: MAX_AGENTS }, (_, i) => row(`t${from + i}`));
  const { calls, result } = await runStage({ rows: [[row("t0")], [row("t0"), ...many(1)]], gaps: [[gap]] });

  assert.equal(calls.length, MAX_AGENTS);
  assert.deepEqual(commandsOf(calls.at(-1)), ["stage stop agent-budget"]);
  assert.equal(result.stopReason, "agent-budget");
  assert.equal(callsOf(calls, PLACEHOLDERS).length, 2, "the stop came inside the loop");
});
