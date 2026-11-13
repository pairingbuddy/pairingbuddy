import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { glance } from "../../shared-node/glance.mjs";
import { buildLabel } from "../../shared-node/labels.mjs";
import { MAX_TRIES } from "../../shared-node/limits.mjs";
import { recording, ledgerAtSeq, SOME_TIME, TDD_ACTIVE_SEQ } from "./glance-fixture.mjs";

const probeSpawns = await recording("probe-2", "spawns");
const THROUGH_FIRST_RED_TRY = 10;
const THROUGH_GREEN_RUNNER_CHECKPOINT = 13;
const THROUGH_THIRD_ZERO_PERCENT_TRY = 18;
// Hand count of probe-2 spawns[0..17]: 2 Agent-kind (curate-guidance, classify-task) + 14 workflow_agent; the 2 Workflow-kind do not count.
const LIVE_AGENT_SPAWNS_THROUGH_THIRD_ZERO_PERCENT_TRY = 16;

// No recording reaches test 3 of 4; these spawns are built with buildLabel, not recorded.
function failingTestSpawn(item) {
  return { t: 1, kind: "workflow_agent", name: buildLabel({ stage: "code-tdd", phase: "RED", role: "implement-tests", item, round: 1 }) };
}

test("calm run at test 3 of 4 gives NOW 'writing a failing test ... test 3 of 4' and LEFT '1 more test, then the safety-net review and your sign-off'", async () => {
  const ledger = await ledgerAtSeq("g-open-1", TDD_ACTIVE_SEQ);
  const tests = ["first-test", "second-test", "ten-percent-off-hundred", "last-test"];
  const spawns = tests.slice(0, 3).map(failingTestSpawn);

  const result = glance({ ledger, spawns, tests, now: SOME_TIME, testsComplete: true });

  assert.match(result.rows.now, /writing a failing test/, "NOW names the step in plain words");
  assert.match(result.rows.now, /test 3 of 4/, "NOW says which test of how many");
  for (const id of ["pb1", "code-tdd", "implement-tests", "RED", "ten-percent-off-hundred"]) {
    assert.ok(!result.rows.now.includes(id), `NOW shows no id: ${id}`);
  }
  assert.equal(result.rows.left, "1 more test, then the safety-net review and your sign-off");
});

test("live agent count equals the number of agent.spawn events, not ledger spend.agents", async () => {
  const ledger = await ledgerAtSeq("probe-2", TDD_ACTIVE_SEQ);
  const spawns = probeSpawns.slice(0, THROUGH_THIRD_ZERO_PERCENT_TRY);

  const result = glance({ ledger, spawns, now: SOME_TIME });

  assert.equal(ledger.spend.agents, 1, "precondition: the ledger lags behind the live spawns");
  assert.match(result.rows.spent, new RegExp(`^${LIVE_AGENT_SPAWNS_THROUGH_THIRD_ZERO_PERCENT_TRY} agents`), "SPENT starts with the spawn count");
});

test("try 1 reads 'no, this step: try 1 of 3'; three tries at the same test read 'yes: 3 tries at the same step' with the NOW sentence ending '3rd try'", async () => {
  const ledger = await ledgerAtSeq("probe-2", TDD_ACTIVE_SEQ);
  const tests = ["ten-percent-off-hundred", "zero-percent-keeps-full-price"];
  const calmSpawns = probeSpawns.slice(0, THROUGH_FIRST_RED_TRY);
  const thirdTrySpawns = probeSpawns.slice(0, THROUGH_THIRD_ZERO_PERCENT_TRY);

  const calm = glance({ ledger, spawns: calmSpawns, tests, now: SOME_TIME });
  const looping = glance({ ledger, spawns: thirdTrySpawns, tests, now: SOME_TIME });

  assert.equal(calm.rows.looping, `no · this step: try 1 of ${MAX_TRIES}`);
  assert.equal(looping.rows.looping, "yes: 3 tries at the same step");
  assert.match(looping.rows.now, /writing a failing test/, "NOW still names the step");
  assert.match(looping.rows.now, /3rd try$/, "NOW ends with the try count");
});

test("one spawned agent reads '1 agent', not '1 agents'", () => {
  const spawns = [{ t: 1, kind: "Agent", name: "pairingbuddy:classify-task" }];

  const result = glance({ ledger: undefined, spawns, now: SOME_TIME });

  assert.match(result.rows.spent, /^1 agent ·/);
});

test("a calm cycle after a GREEN runner checkpoint does not read as looping, because runner rounds count per test across phases", async () => {
  const ledger = await ledgerAtSeq("probe-2", TDD_ACTIVE_SEQ);
  const tests = ["ten-percent-off-hundred", "zero-percent-keeps-full-price"];
  const spawns = probeSpawns.slice(0, THROUGH_GREEN_RUNNER_CHECKPOINT);

  const result = glance({ ledger, spawns, tests, now: SOME_TIME });

  assert.match(result.rows.looping, /^no/, "each agent ran once, so there is no loop");
  assert.match(result.rows.looping, new RegExp(`try 1 of ${MAX_TRIES}`), "each agent is on its first try");
  assert.doesNotMatch(result.rows.now, /2nd try/, "a runner checkpoint is not a retry");
});

test("with tokensKnown false, tokens and % of plan show 'unknown', and OFF TRACK shows 'unknown'; no number or 'no' is invented", async () => {
  const ledger = await ledgerAtSeq("g-open-1", 20);
  const spawns = await recording("g-open-1", "spawns");

  const result = glance({ ledger, spawns, now: SOME_TIME });

  assert.equal(ledger.spend.tokensKnown, false, "precondition: the recording has no token data");
  assert.match(result.rows.spent, /tokens unknown/, "SPENT shows tokens as unknown");
  assert.match(result.rows.spent, /% of plan unknown/, "SPENT shows plan share as unknown");
  assert.doesNotMatch(result.rows.spent, /\d\s*%|≈/, "no percentage of plan is invented");
  assert.equal(result.rows.offTrack, "unknown");
});

test("a missing, empty or partial ledger and no spawns return a defined result and do not throw", async () => {
  const partial = { stage: { name: "code-tdd", status: "active" } };
  const inputs = [
    { ledger: undefined, spawns: undefined, now: SOME_TIME },
    { ledger: null, spawns: [], now: SOME_TIME },
    { ledger: {}, spawns: [], now: SOME_TIME },
    { ledger: partial, spawns: [], now: SOME_TIME },
  ];

  const results = inputs.map((input) => glance(input));

  for (const result of results) {
    assert.deepEqual(Object.keys(result.rows).sort(), ["left", "looping", "now", "offTrack", "spent"]);
    assert.ok(Object.values(result.rows).every((row) => typeof row === "string" && row.length > 0), "every row is a sentence");
    assert.ok(Array.isArray(result.band), "band segments are a list");
    assert.equal(result.rows.offTrack, "unknown");
  }
});

const BAND_ORDER = ["where", "spent", "left", "looping", "offTrack", "needsYou"];

test("calm run at test 3 of 4 lists the band's six segments in the R4-1 order", async () => {
  const ledger = await ledgerAtSeq("g-open-1", TDD_ACTIVE_SEQ);
  const tests = ["first-test", "second-test", "ten-percent-off-hundred", "last-test"];
  const spawns = tests.slice(0, 3).map(failingTestSpawn);

  const result = glance({ ledger, spawns, tests, now: SOME_TIME });

  assert.deepEqual(result.band.map((segment) => segment.id), BAND_ORDER);
});

test("the band's left segment reads 'left: 1 test + review' at test 3 of 4 (R4-1)", async () => {
  const ledger = await ledgerAtSeq("g-open-1", TDD_ACTIVE_SEQ);
  const tests = ["first-test", "second-test", "ten-percent-off-hundred", "last-test"];
  const spawns = tests.slice(0, 3).map(failingTestSpawn);

  const result = glance({ ledger, spawns, tests, now: SOME_TIME, testsComplete: true });

  assert.equal(result.band.find((segment) => segment.id === "left").text, "left: 1 test + review");
});

// needsHuman and stop have the shapes ledger.mjs validates: needsHuman { gate, reason, seq }, stop { reason, seq }.
test("a needs-human ledger shows the gate's plain name in the band, never its id", async () => {
  const snapshot = await ledgerAtSeq("g-open-1", TDD_ACTIVE_SEQ);
  const ledger = { ...snapshot, needsHuman: { gate: "G:task-end", reason: "the work is done and waits for sign-off", seq: TDD_ACTIVE_SEQ } };

  const result = glance({ ledger, spawns: [], now: SOME_TIME });

  const needsYou = result.band.find((segment) => segment.id === "needsYou").text;
  assert.equal(needsYou, "needs you: your sign-off at the end");
  assert.ok(!needsYou.includes("G:task-end"), "no gate id in the band");
});

test("a stop shows 'needs you: stopped' in the band, never its reason or code", async () => {
  const snapshot = await ledgerAtSeq("g-open-1", TDD_ACTIVE_SEQ);
  const reason = "step-failed: a step of the stage failed past its retries, and nothing more can run";
  const ledger = { ...snapshot, stop: { reason, seq: TDD_ACTIVE_SEQ } };

  const result = glance({ ledger, spawns: [], now: SOME_TIME });

  const needsYou = result.band.find((segment) => segment.id === "needsYou").text;
  assert.equal(needsYou, "needs you: stopped");
  assert.ok(!needsYou.includes("step-failed"), "no stop code in the band");
});

test("a stop with a code shows 'stopped: <plain name>' in the pane's NOW, never its reason or code", async () => {
  const snapshot = await ledgerAtSeq("g-open-1", TDD_ACTIVE_SEQ);
  const reason = "step-failed: a step of the stage failed past its retries, and nothing more can run";
  const ledger = { ...snapshot, stop: { reason, seq: TDD_ACTIVE_SEQ, code: "step-failed" } };

  const result = glance({ ledger, spawns: [], now: SOME_TIME });

  assert.equal(result.rows.now, "stopped: a step kept failing");
  assert.ok(!result.rows.now.includes(reason), "no stop reason in the pane's NOW");
  assert.ok(!result.rows.now.includes("step-failed"), "no raw stop code in the pane's NOW");
});

test("a stop without a code shows plain 'stopped' in the pane's NOW", async () => {
  const snapshot = await ledgerAtSeq("g-open-1", TDD_ACTIVE_SEQ);
  const reason = "step-failed: a step of the stage failed past its retries, and nothing more can run";
  const ledger = { ...snapshot, stop: { reason, seq: TDD_ACTIVE_SEQ } };

  const result = glance({ ledger, spawns: [], now: SOME_TIME });

  assert.equal(result.rows.now, "stopped");
});

// Elapsed is run time: from the first stage's start, not the current stage's.
const RUN_START = "2026-11-03T07:10:00.000Z";
const SECOND_STAGE_START = "2026-11-03T07:12:00.000Z";
const THREE_MINUTES_IN = Date.parse("2026-11-03T07:13:00.000Z");
const closedStage = (name, startedAt) => ({ name, status: "done", attempt: 1, spend: { agents: 1, tokens: 0, tokensKnown: false }, ...(startedAt ? { startedAt } : {}) });
const runLedger = (stages, current) => ({ stage: { name: "code-tdd", status: "active", runId: "wf_1", attempt: 1, startedAt: current }, stages, spend: { agents: 1, tokens: 0, tokensKnown: false } });
const spentBand = (ledger) => glance({ ledger, spawns: [], now: THREE_MINUTES_IN }).band.find((segment) => segment.id === "spent").text;

test("across two stages SPENT counts from the first stage's start, in the pane and the band", () => {
  const ledger = runLedger([closedStage("code-scenarios", RUN_START)], SECOND_STAGE_START);

  const result = glance({ ledger, spawns: [], now: THREE_MINUTES_IN });

  assert.match(result.rows.spent, /^0 agents · 3:00 ·/, "run time, not the 1:00 of the current stage");
  assert.equal(spentBand(ledger), "3:00 · 0 agents");
});

test("with no stage closed yet SPENT counts from the current stage's start", () => {
  const ledger = runLedger([], RUN_START);

  const result = glance({ ledger, spawns: [], now: THREE_MINUTES_IN });

  assert.match(result.rows.spent, /^0 agents · 3:00 ·/);
  assert.equal(spentBand(ledger), "3:00 · 0 agents");
});

test("when a closed stage has no startedAt SPENT says 'time unknown', never the current stage's time", () => {
  const ledger = runLedger([closedStage("code-scenarios", undefined), closedStage("code-config", RUN_START)], SECOND_STAGE_START);

  const result = glance({ ledger, spawns: [], now: THREE_MINUTES_IN });

  assert.match(result.rows.spent, /^0 agents · time unknown ·/);
  assert.equal(spentBand(ledger), "time unknown · 0 agents");
});

test("glance lists the raw name of every workflow agent whose label does not read", () => {
  const spawns = [
    { kind: "workflow_agent", name: "not a pb1 label at all" },
    { kind: "workflow_agent", name: buildLabel({ stage: "code-tdd", phase: "RED", role: "tester", item: "t1", round: 1 }) },
  ];
  assert.deepEqual(glance({ spawns }).unknownLabels, ["not a pb1 label at all"]);
});

// Seq 10 of tests/smoke/recordings/t59-healthy/ledger.jsonl is the first ledger with tests.perTest; seq 9 is the last without.
async function t59Ledger(seq) {
  const lines = (await readFile(new URL("../smoke/recordings/t59-healthy/ledger.jsonl", import.meta.url), "utf8")).trim().split("\n");
  return JSON.parse(lines[seq - 1]).ledger;
}
const T59_TEST = "apply-discount-100-by-10-returns-90";

test("one-test-run-shows-test-1-of-1-and-left: a one-test bug_fix ledger whose current item is that test shows 'test 1 of 1' in NOW and a LEFT row that is not unknown", async () => {
  const ledger = await t59Ledger(10);
  const tests = Object.keys(ledger.tests.perTest);
  const spawns = [failingTestSpawn(T59_TEST)];

  const result = glance({ ledger, spawns, tests, now: SOME_TIME, testsComplete: true });

  assert.deepEqual(tests, [T59_TEST]);
  assert.match(result.rows.now, /test 1 of 1/, "NOW says test 1 of 1");
  assert.notEqual(result.rows.left, "unknown", "LEFT is known");
  assert.match(result.rows.left, /^this test, then /, "LEFT reads this test, then the safety net");
  assert.equal(result.band.find((segment) => segment.id === "left").text, "left: this test + review", "band left segment");
});

test("no-tests-recorded-stays-unknown: with ledger.tests empty or perTest absent and no tests.json, tests is empty, LEFT stays unknown and NOW has no 'test N of M'", async () => {
  const ledger = await t59Ledger(9);
  const spawns = [failingTestSpawn(T59_TEST)];

  const result = glance({ ledger, spawns, tests: Object.keys(ledger.tests?.perTest ?? {}), now: SOME_TIME });

  assert.deepEqual(ledger.tests, {});
  assert.equal(result.rows.left, "unknown", "LEFT stays unknown");
  assert.doesNotMatch(result.rows.now, /test \d+ of \d+/, "NOW invents no test position");
});

test("seen-only list shows test N without of M and LEFT unknown", () => {
  const tests = ["first-test", "second-test"];
  const spawns = tests.map(failingTestSpawn);

  const result = glance({ ledger: undefined, spawns, tests, now: SOME_TIME, testsComplete: false });

  assert.match(result.rows.now, /test 2(?! of)/, "NOW says which test, with no total");
  assert.doesNotMatch(result.rows.now, / of \d/, "NOW claims no total");
  assert.equal(result.rows.left, "unknown");
  assert.doesNotMatch(JSON.stringify(result.band), / of \d/, "the band claims no total");
});

test("glance-without-tests-complete-claims-no-total-or-left", async () => {
  const ledger = await ledgerAtSeq("g-open-1", TDD_ACTIVE_SEQ);
  const tests = ["first-test", "second-test", "third-test", "last-test"];
  const spawns = tests.slice(0, 3).map(failingTestSpawn);

  const result = glance({ ledger, spawns, tests, now: SOME_TIME });

  assert.match(result.rows.now, /test 3(?! of)/, "NOW says which test, with no total");
  assert.doesNotMatch(result.rows.now, / of \d/, "NOW claims no total");
  assert.equal(result.rows.left, "unknown", "LEFT claims no count");
  assert.doesNotMatch(JSON.stringify(result.band), / of \d/, "the band claims no total");
});
