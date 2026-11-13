// Scenario progress-row: pure folding of per-test progress into one row of marks and short names (node:test on shared-node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLabel } from "../../shared-node/labels.mjs";
import { fitProgress, progressRow } from "../../shared-node/now-building.mjs";

const GREEN_RECORD = { red: { passed: true, exitCodes: [1] }, green: { passed: true, exitCodes: [0] } };

const COVERED_RECORD = { red: { passed: true, exitCodes: [0] }, covered: { done: true } };

function spawnFor(phase, role, item) {
  return { kind: "workflow_agent", name: buildLabel({ stage: "tdd", phase, role, item, round: 1 }) };
}

function eightTestsWithThreeDone() {
  const tests = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"].map((test_id) => ({ test_id }));
  const perTest = { t1: GREEN_RECORD, t2: GREEN_RECORD, t3: GREEN_RECORD };
  const spawns = [spawnFor("RED", "implement-tests", "t4")];
  return { tests, perTest, spawns };
}

test("marks-done-current-waiting", () => {
  const tests = [{ test_id: "login-works" }, { test_id: "logout-works" }, { test_id: "reset-works" }];
  const perTest = { "login-works": GREEN_RECORD };
  const spawns = [
    spawnFor("GREEN", "implement-code", "login-works"),
    spawnFor("RED", "implement-tests", "logout-works"),
  ];

  const row = progressRow({ tests, perTest, spawns, testsComplete: true });

  assert.deepEqual(
    row.entries.map((entry) => [entry.id, entry.mark]),
    [["login-works", "done"], ["logout-works", "current"], ["reset-works", "waiting"]],
    "marks follow tests.json order: green is done, the latest labelled spawn is current, the rest wait",
  );
});

test("long-list-folds", () => {
  const { tests, perTest, spawns } = eightTestsWithThreeDone();

  const row = progressRow({ tests, perTest, spawns, testsComplete: true });

  assert.equal(row.folded, 3, "the three finished tests collapse to one line that counts them");
  assert.deepEqual(
    row.entries.map((entry) => [entry.id, entry.mark]),
    [["t4", "current"], ["t5", "waiting"], ["t6", "waiting"]],
    "after the fold, only the current test and the next two show",
  );
  assert.equal(row.more, 2, "the two tests past those are counted as '+ 2 more'");
});

test("short-list-does-not-fold", () => {
  const tests = [{ test_id: "t1" }, { test_id: "t2" }, { test_id: "t3" }];
  const spawns = [spawnFor("RED", "implement-tests", "t1")];

  const row = progressRow({ tests, perTest: {}, spawns, testsComplete: true });

  assert.deepEqual(
    row.entries.map((entry) => [entry.id, entry.mark]),
    [["t1", "current"], ["t2", "waiting"], ["t3", "waiting"]],
    "a list that fits shows every test, in order",
  );
  assert.equal(row.folded, undefined, "nothing finished, so there is no fold line");
  assert.equal(row.more, undefined, "nothing is hidden, so there is no '+ n more'");
});

test("unknown-total-claims-no-more", () => {
  const { tests, perTest, spawns } = eightTestsWithThreeDone();

  const row = progressRow({ tests, perTest, spawns, testsComplete: false });

  assert.deepEqual(
    row.entries.map((entry) => [entry.id, entry.mark]),
    [["t4", "current"], ["t5", "waiting"], ["t6", "waiting"]],
    "the row still shows the tests it knows about",
  );
  assert.equal(row.more, undefined, "the rest is unknown, so the row never claims a '+ n more' number");
});

test("covered-test-marks-circle", () => {
  const tests = [{ test_id: "login-works" }, { test_id: "logout-works" }, { test_id: "reset-works" }];
  const perTest = { "login-works": GREEN_RECORD, "logout-works": COVERED_RECORD };
  const spawns = [spawnFor("RED", "implement-tests", "reset-works")];

  const row = progressRow({ tests, perTest, spawns, testsComplete: true });

  assert.deepEqual(
    row.entries.map((entry) => [entry.id, entry.mark]),
    [["login-works", "done"], ["logout-works", "covered"], ["reset-works", "current"]],
    "a test whose RED passed straight away is marked covered (shown as the circle mark), not waiting or done",
  );
});

test("current-test-is-never-pushed-out-by-covered-tests", () => {
  const tests = ["t1", "t2", "t3", "t4", "t5"].map((test_id) => ({ test_id }));
  const perTest = { t1: GREEN_RECORD, t2: COVERED_RECORD, t3: COVERED_RECORD, t4: COVERED_RECORD };
  const spawns = [spawnFor("RED", "implement-tests", "t5")];

  const row = progressRow({ tests, perTest, spawns, testsComplete: true });

  assert.deepEqual(
    row.entries.map((entry) => [entry.id, entry.mark]),
    [["t5", "current"]],
    "the current test stays shown however many covered tests precede it",
  );
  assert.equal(row.folded, 1, "the one green test folds into the done count");
  assert.equal(row.coveredFolded, 3, "the three covered tests fold into their own count");
  assert.equal(
    fitProgress({ ...row, entries: row.entries.map((entry) => ({ ...entry, name: entry.id })), known: true }, 0),
    "✓ 1 done   ◌ 3 covered   ▸ t5",
    "the folded line counts done and covered apart and still names the current test",
  );
});
