import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { blockOf, runScript } from "./harness.mjs";
import { readLabel } from "../../shared-node/labels.mjs";

// Task 48: the per-cycle refactor of the built code-tdd stage, for new_feature only. the light review finds and refactor-* fix,
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
const LENS = "pairingbuddy:lens";
const FIX_TESTS = "pairingbuddy:refactor-tests";
const FIX_CODE = "pairingbuddy:refactor-code";
const COVERAGE = "pairingbuddy:verify-test-coverage";
const artifact = (key) => `.pairingbuddy/run/task/artifacts/${key}.json`;

const row = (test_id) => ({ test_id, test_case_id: "c", scenario_id: "s", runner_id: "pytest", test_file: "tests/test_a.py", test_function: `test_${test_id}` });
const commandsOf = ({ prompt }) => blockOf(prompt, "commands").split("\n").map((line) => line.replace(`${PB} `, ""));
const isRunner = ({ opts }) => opts.agentType === RUNNER;
const pbKeyOf = ({ opts }) => opts.schema.properties.pb_key.enum[0];
const lensFinding = (focus) => ({ focus, rule: "r", severity: "medium", kind: "fix-here", claim: `a ${focus} claim`, where: focus === "code-smell" ? "shared-node/a.mjs:1" : "tests/js/a.test.mjs:1" });
const lensReturn = (pb_key, ...focuses) => ({ pb_key, ambiguity: null, focus_changes: [], findings: focuses.map(lensFinding) });

const accepted = { cli_exit_code: 0, cli_output: "{\"ok\":true}" };
const refused = (text) => ({ cli_exit_code: 1, cli_output: `pb: ${text}` });
const stateOutput = (over) => JSON.stringify({ ok: true, taskType: "new_feature", scenarios: SCENARIOS_PATH, tests: null, red: [], green: [], covered: [], ...over });

function standIn({ tests = [row("t1")], state = {}, runner = () => undefined, worker = () => undefined } = {}) {
  return async (prompt, opts) => {
    const pb_key = opts.schema.properties.pb_key.enum[0];
    if (opts.agentType === RUNNER) {
      const commands = commandsOf({ prompt });
      const override = runner(commands, pb_key);
      if (override !== undefined) return override === null ? null : { pb_key, ...override };
      if (commands[0].startsWith("snapshot")) return { pb_key, cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: ["CLAUDE.md"] }) };
      return { pb_key, ...(commands[0] === "tdd state" ? { cli_exit_code: 0, cli_output: stateOutput({ testRunners: { node: { test_directory: "tests/js", file_pattern: "*.test.mjs" } }, ...state }) } : accepted) };
    }
    const override = worker(opts.agentType, pb_key, prompt);
    if (override !== undefined) return override;
    if (opts.agentType === LENS) return lensReturn(pb_key, "test-quality", "code-smell");
    if (opts.agentType === "pairingbuddy:implement-tests" || opts.agentType === "pairingbuddy:implement-code") return { pb_key, ambiguity: "", commit_subject: "x", files_changed: [opts.agentType.endsWith("tests") ? "tests/js/a.test.mjs" : "shared-node/a.mjs"] };
    if (opts.agentType === COVERAGE) return { pb_key, ambiguity: "", status: "complete", scenarios_covered: 1, scenarios_total: 1, test_cases_covered: 1, test_cases_total: 1, gaps: [] };
    return { pb_key, ambiguity: "", commit_subject: "x", files_changed: [], ...(opts.agentType === PLACEHOLDERS ? { tests } : {}) };
  };
}

const runStage = (options, args = ARGS) => runScript(STAGE, { args, agent: standIn(options) });

const stepsOf = (calls) => calls.map((call) => (isRunner(call) ? commandsOf(call).join(" && ") : `${call.opts.agentType.replace("pairingbuddy:", "")} ${pbKeyOf(call)}`));
const callsOf = (calls, agentType) => calls.filter(({ opts }) => opts.agentType === agentType);

const refactorSteps = (id, round = 1) => [
  "snapshot",
  `lens code-tdd.lens.${id}.r${round}.a1`,
  `refactor-tests code-tdd.refactor-tests.${id}.r${round}.a1`,
  `checkpoint --step refactor --from code-tdd.refactor-tests.${id}.r${round}.a1`,
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

    for (const agentType of [LENS, FIX_TESTS, FIX_CODE]) assert.equal(callsOf(calls, agentType).length, 0, agentType);
    assert.equal(calls.some((call) => isRunner(call) && commandsOf(call)[0] === "snapshot"), false);
    assert.equal(calls.some(({ prompt }) => prompt.includes("--step refactor")), false);
    assert.deepEqual(result.lightReviews, []);
    assert.equal(result.stopReason, null);
  });
}

for (const tests of [[row("t1")], [row("t1"), row("t2")]]) {
  test(`code-tdd-a-review-that-finds-nothing-spawns-no-fixer-and-no-checkpoint (${tests.length} tests)`, async () => {
    const { calls, result } = await runStage({ tests, worker: (agentType, pb_key) => (agentType === LENS ? lensReturn(pb_key) : undefined) });

    assert.equal(callsOf(calls, LENS).length, tests.length, "one review per cycle");
    assert.equal(callsOf(calls, FIX_TESTS).length + callsOf(calls, FIX_CODE).length, 0, "no fixer is spawned");
    assert.equal(calls.some(({ prompt }) => prompt.includes("--step refactor")), false, "nothing is checkpointed");
    assert.equal(callsOf(calls, "pairingbuddy:implement-tests").length, tests.length, "every test's RED still runs");
    assert.equal(result.stopReason, null);
  });
}

for (const [focus, spawned, skipped] of [["code-smell", FIX_CODE, FIX_TESTS], ["test-quality", FIX_TESTS, FIX_CODE]]) {
  test(`code-tdd-only-the-side-with-findings-gets-a-fixer (${focus})`, async () => {
    const { calls } = await runStage({ worker: (agentType, pb_key) => (agentType === LENS ? lensReturn(pb_key, focus) : undefined) });

    assert.equal(callsOf(calls, skipped).length, 0, `${skipped} is not spawned`);
    assert.equal(callsOf(calls, spawned).length, 1, `${spawned} is spawned`);
    assert.equal(calls.some(({ prompt }) => prompt.includes(`--step refactor --from ${skipped.replace("pairingbuddy:", "code-tdd.")}`)), false, `${skipped} has no checkpoint`);
  });
}

test("code-tdd-refactor-labels-carry-the-refactor-phase-and-the-cycle", async () => {
  const { calls } = await runStage();

  const labels = calls.filter(({ opts }) => /^pb1 code-tdd REFACTOR/.test(opts.label)).map(({ opts }) => opts.label);
  assert.ok(labels.includes("pb1 code-tdd REFACTOR lens t1 r1"), labels.join("\n"));
  assert.ok(labels.includes("pb1 code-tdd REFACTOR refactor-tests t1 r1"), labels.join("\n"));
  assert.ok(labels.includes("pb1 code-tdd REFACTOR refactor-code t1 r1"), labels.join("\n"));
  const checkpoint = calls.find((call) => isRunner(call) && commandsOf(call)[0].startsWith("checkpoint --step refactor"));
  assert.equal(readLabel(checkpoint.opts.label).phase, "REFACTOR", "the refactor checkpoint runner is labelled REFACTOR");
  assert.equal(readLabel(checkpoint.opts.label).role, "runner");
  for (const { opts } of calls) assert.equal(readLabel(opts.label).unknown, false, opts.label);
  const keys = calls.map(pbKeyOf);
  assert.equal(new Set(keys).size, keys.length, keys.join("\n"));
});

test("code-tdd-each-refactor-fixer-gets-its-paths-and-a-findings-block", async () => {
  const { calls } = await runStage();
  const tests = artifact("code-tdd.create-test-placeholders.-.r1.a1");
  const shared = { test_config: ".pairingbuddy/test-config.json", human_guidance: ".pairingbuddy/human-guidance.json" };

  for (const agentType of [FIX_TESTS, FIX_CODE]) {
    const { prompt } = callsOf(calls, agentType)[0];
    assert.deepEqual(JSON.parse(blockOf(prompt, "paths")), { tests, ...shared }, agentType);
    assert.equal(blockOf(prompt, "test_id"), "t1", agentType);
    assert.equal(JSON.parse(blockOf(prompt, "findings")).length, 1, agentType);
  }
});

for (const [name, schemaFile, agentType] of [
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
  assert.equal(callsOf(calls, LENS).length, 1, "the review's findings stand");
  assert.equal(result.stopReason, null);
});

test("code-tdd-a-refactor-that-keeps-breaking-the-tests-stops-within-its-bound", async () => {
  const { calls, result } = await runStage({ tests: [row("t1"), row("t2")], runner: ([command]) => (command.startsWith("checkpoint --step refactor") ? refused("the tests failed") : undefined) });

  assert.equal(callsOf(calls, FIX_TESTS).length, 3, "three tries");
  assert.equal(result.stopReason, "step-failed");
  assert.deepEqual(commandsOf(calls.at(-1)), ["stage stop step-failed"]);
  assert.equal(calls.some(({ prompt }) => prompt.includes("<test_id>\nt2\n")), false, "the next test does not start");
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

  assert.deepEqual(callsOf(calls, LENS).map(pbKeyOf), ["code-tdd.lens.t1.r1.a1"]);
});

test("code-tdd-a-re-run-does-not-refactor-a-cycle-whose-green-was-already-done", async () => {
  const { calls } = await runStage({ tests: [row("t1"), row("t2")], state: { red: ["t1", "t2"], green: ["t1"] } }, { ...ARGS, attempt: 2 });

  assert.deepEqual(callsOf(calls, LENS).map(pbKeyOf), ["code-tdd.lens.t2.r1.a2"]);
});

// ---------- the spawn cap ----------

const noFindings = (agentType, pb_key) => (agentType === LENS ? lensReturn(pb_key) : undefined);
for (const [name, worker, spawned] of [["a review with findings", undefined, FIX_CODE], ["a review with no findings", noFindings, LENS]]) {
  test(`code-tdd-refactor-spawns-count-against-the-cap (${name})`, async () => {
    const { calls, result } = await runStage({ tests: Array.from({ length: MAX_AGENTS }, (_, i) => row(`t${i}`)), worker });

    assert.equal(calls.length, MAX_AGENTS);
    assert.deepEqual(commandsOf(calls.at(-1)), ["stage stop agent-budget"]);
    assert.equal(result.stopReason, "agent-budget");
    assert.ok(callsOf(calls, spawned).length > 0, `${spawned} was spawned before the cap`);
  });
}

// Task 82: light review replaces identify-* on new paths. Placeholders: each body fails with a not-implemented message until implement-tests writes the real test.
test("code-tdd-light-review-runs-snapshot-then-one-sonnet-lens-then-fixers", async () => {
  const { calls } = await runStage();

  const lensCalls = callsOf(calls, LENS);
  assert.equal(lensCalls.length, 1);
  assert.equal(lensCalls[0].opts.model, "sonnet");
  for (const agentType of ["pairingbuddy:identify-test-issues", "pairingbuddy:identify-code-issues"]) assert.equal(callsOf(calls, agentType).length, 0, agentType);
  assert.equal(calls.some(({ opts }) => /refuter/.test(opts.agentType)), false);
});

const swap = [
  { change: "drop", focus: "test-quality", reason: "no test smell here" },
  { change: "drop", focus: "code-smell", reason: "no code smell here" },
  { change: "add", focus: "test-level", reason: "the test sits at the wrong level" },
  { change: "add", focus: "design-fit", reason: "the code drifts from the design" },
];
test("code-tdd-light-review-findings-split-tests-first (test-level and design-fit)", async () => {
  const { calls } = await runStage({ worker: (agentType, pb_key) => (agentType === LENS ? { ...lensReturn(pb_key, "test-level", "design-fit"), focus_changes: swap } : undefined) });

  const [fixTests] = callsOf(calls, FIX_TESTS);
  const [fixCode] = callsOf(calls, FIX_CODE);
  assert.deepEqual(JSON.parse(blockOf(fixTests.prompt, "findings")).map(({ focus }) => focus), ["test-level"]);
  assert.deepEqual(JSON.parse(blockOf(fixCode.prompt, "findings")).map(({ focus }) => focus), ["design-fit"]);
  assert.ok(calls.indexOf(fixTests) < calls.indexOf(fixCode), "refactor-tests is spawned first");
});

test("code-tdd-light-review-at-most-two-focuses-per-cycle", async () => {
  const adds = { change: "add", focus: "design-fit", reason: "the code drifts from the design" };
  const { calls, result } = await runStage({ worker: (agentType, pb_key) => (agentType === LENS ? { ...lensReturn(pb_key, "test-quality", "code-smell", "design-fit"), focus_changes: [adds] } : undefined) });

  const [lens] = callsOf(calls, LENS);
  assert.deepEqual(JSON.parse(blockOf(lens.prompt, "focuses")).map(({ name }) => name).sort(), ["code-smell", "test-quality"], "the lens is asked for the two rule focuses");
  for (const { prompt } of [...callsOf(calls, FIX_TESTS), ...callsOf(calls, FIX_CODE)]) assert.equal(prompt.includes("a design-fit claim"), false, "the third focus's finding reaches no fixer");
  assert.deepEqual([...result.lightReviews[0].focuses].sort(), ["code-smell", "test-quality"]);
  assert.equal(result.lightReviews[0].findings, 2);
});

test("code-tdd-light-review-changed-files-union-red-green", async () => {
  const subjectOf = ({ calls }) => JSON.parse(blockOf(callsOf(calls, LENS)[0].prompt, "subject")).files_changed;

  const full = await runStage();
  const rerun = await runStage({ state: { red: ["t1"] } }, { ...ARGS, attempt: 2 });

  assert.deepEqual(subjectOf(full).sort(), ["shared-node/a.mjs", "tests/js/a.test.mjs"]);
  assert.deepEqual(subjectOf(rerun), ["shared-node/a.mjs"]);
});

test("code-tdd-light-review-uncovered-reviewer-retried-then-stops", async () => {
  let spawned = 0;
  const once = await runStage({ worker: (agentType) => (agentType === LENS && ++spawned === 1 ? null : undefined) });
  const always = await runStage({ worker: (agentType) => (agentType === LENS ? null : undefined) });

  assert.deepEqual(callsOf(once.calls, LENS).map(pbKeyOf), ["code-tdd.lens.t1.r1.a1", "code-tdd.lens.t1.r2.a1"]);
  assert.equal(once.result.stopReason, null);
  assert.equal(callsOf(always.calls, LENS).length, 3);
  assert.equal(always.result.stopReason, "step-failed");
  assert.deepEqual(commandsOf(always.calls.at(-1)), ["stage stop step-failed"]);
});

test("code-tdd-light-review-unusable-snapshot-relay-retried-then-stops", async () => {
  const unusable = (commands) => (commands[0] === "snapshot" ? { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: [1] }) } : undefined);
  let relays = 0;
  const once = await runStage({ runner: (commands) => (commands[0] === "snapshot" && ++relays === 1 ? unusable(commands) : undefined) });
  const always = await runStage({ runner: unusable });

  const snapshotRelays = (calls) => calls.filter((call) => isRunner(call) && commandsOf(call)[0] === "snapshot").length;
  assert.equal(snapshotRelays(once.calls), 2, "the unusable relay is asked for again");
  assert.equal(callsOf(once.calls, LENS).length, 1, "the retry's paths reach the lens");
  assert.equal(once.result.stopReason, null);
  assert.equal(snapshotRelays(always.calls), 3, "the relay is retried to its bound");
  assert.equal(callsOf(always.calls, LENS).length, 0, "no lens runs on an unusable relay");
  assert.equal(always.result.stopReason, "step-failed");
});

test("code-tdd-light-review-stage-return-record-per-cycle", async () => {
  const threeFindings = (agentType, pb_key) => {
    if (agentType !== LENS) return undefined;
    const base = lensReturn(pb_key, "test-quality", "code-smell", "code-smell");
    base.findings[2] = { ...base.findings[2], claim: "a second code-smell claim", where: "shared-node/b.mjs:2" };
    return base;
  };

  const { result } = await runStage({ tests: [row("t1"), row("t2")], worker: threeFindings });

  const record = (item) => ({ item, focuses: ["code-smell", "test-quality"], findings: 3 });
  assert.deepEqual(result.lightReviews, [record("t1"), record("t2")]);
});

test("built-code-tdd-has-no-identify-reference", () => {
  const built = readFileSync(STAGE, "utf8");

  assert.doesNotMatch(built, /pairingbuddy:identify-(test|code)-issues/, "the built stage names no identify agent");
});

test("code-tdd-light-review-snapshot-relay-with-no-paths-is-retried", async () => {
  let relays = 0;
  const { calls, result } = await runStage({ runner: (commands) => (commands[0] === "snapshot" && ++relays === 1 ? { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true }) } : undefined) });

  assert.equal(calls.filter((call) => isRunner(call) && commandsOf(call)[0] === "snapshot").length, 2);
  assert.equal(result.stopReason, null);
});

test("code-tdd-light-review-snapshot-runner-is-labelled-refactor-for-the-cycle", async () => {
  const { calls } = await runStage();

  const snapshot = calls.find((call) => isRunner(call) && commandsOf(call)[0] === "snapshot");
  assert.equal(readLabel(snapshot.opts.label).phase, "REFACTOR");
  assert.equal(readLabel(snapshot.opts.label).item, "t1");
});

test("code-tdd-light-review-subject-names-the-cycle-and-the-snapshot-diff", async () => {
  const { calls } = await runStage();

  const subject = JSON.parse(blockOf(callsOf(calls, LENS)[0].prompt, "subject"));
  assert.equal(subject.test_id, "t1");
  assert.equal(subject.subject_diff, ".pairingbuddy/run/subject.diff");
});

test("code-tdd-light-review-corpus-is-the-snapshot-paths", async () => {
  const paths = ["CLAUDE.md", "docs/a.md"];
  const { calls } = await runStage({ runner: (commands) => (commands[0] === "snapshot" ? { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths }) } : undefined) });

  assert.deepEqual(blockOf(callsOf(calls, LENS)[0].prompt, "corpus").split("\n").map((line) => JSON.parse(line)), paths);
});

test("code-tdd-light-review-retried-reviewer-label-carries-its-round", async () => {
  let spawned = 0;
  const { calls } = await runStage({ worker: (agentType) => (agentType === LENS && ++spawned === 1 ? null : undefined) });

  assert.deepEqual(callsOf(calls, LENS).map(({ opts }) => opts.label), ["pb1 code-tdd REFACTOR lens t1 r1", "pb1 code-tdd REFACTOR lens t1 r2"]);
});

test("code-tdd-light-review-a-fixer-stop-keeps-the-cycle-review-record", async () => {
  const { result } = await runStage({ runner: ([command]) => (command.startsWith("checkpoint --step refactor") ? refused("the tests failed") : undefined) });

  assert.equal(result.stopReason, "step-failed");
  assert.deepEqual(result.lightReviews, [{ item: "t1", focuses: ["code-smell", "test-quality"], findings: 2 }]);
});
