// Scenario end-state: when the unit's work is finished, the pane's DONE, GOAL and PR rows say whether it is done, what was
// done and whether it meets the goal, from what the run recorded only (docs/design/progress-mod/DIRECTION.md).
import { test } from "node:test";
import assert from "node:assert/strict";

import { codeRunOf, endRows, endReviewLines, prTitleOf, safetyNetRound } from "../../shared-node/end-state.mjs";

const DASH = "—";
const TASK = "Add order_total to cart.py. It sums the line totals.";
const finishedRun = (overrides = {}) => ({ task: TASK, taskEndPassed: true, testsPassing: 1, fullPassed: true, ...overrides });

test("before the task is done every end row reads a dash", () => {
  assert.deepEqual(endRows({}), { done: DASH, goal: DASH, pr: DASH }, "no code run recorded");
  assert.deepEqual(endRows({ codeRun: finishedRun({ taskEndPassed: false }), changed: ["cart.py"] }), { done: DASH, goal: DASH, pr: DASH }, "the task-end gate has not passed");
});

test("once the task-end gate passed, DONE names the changed files and the passing tests", () => {
  const { done } = endRows({ codeRun: finishedRun({ testsPassing: 2 }), changed: ["cart.py", "tests/test_cart.py"] });

  assert.equal(done, "cart.py, tests/test_cart.py · 2 tests passing");
});

test("DONE folds a long file list into a count", () => {
  const changed = ["a.py", "b.py", "c.py", "d.py", "e.py"];

  assert.equal(endRows({ codeRun: finishedRun(), changed }).done, "a.py, b.py, c.py + 2 more files · 1 test passing");
  assert.equal(endRows({ codeRun: finishedRun(), changed: null }).done, "1 test passing", "with no changed list the files are left out, never guessed");
});

// The safety-net round as lensRound gives it: each lens with its id and state, each finding with its id and word.
const round = ({ state = "returned", findings = [] } = {}) => ({
  lenses: [{ id: "code", name: "the code", state: "returned", found: 0 }, { id: "corpus-misalignment", name: "docs and plan", state, found: findings.length }],
  findings,
});

test("GOAL reads met only from a passed task-end gate and an alignment lens with no open finding", () => {
  const fixed = [{ id: "corpus-misalignment-1", title: "README says the old return", word: "fixed" }];
  const codeOnly = [{ id: "code-1", title: "Rounds half down", word: "left as is" }];

  assert.equal(endRows({ codeRun: finishedRun(), round: round() }).goal, "met · Add order_total to cart.py.");
  assert.equal(endRows({ codeRun: finishedRun(), round: round({ findings: fixed }) }).goal, "met · Add order_total to cart.py.", "a fixed alignment finding is closed");
  assert.equal(endRows({ codeRun: finishedRun(), round: { ...round(), findings: codeOnly } }).goal, "met · Add order_total to cart.py.", "another lens's open finding says nothing about the goal");
});

test("GOAL reads in doubt with the gist when the alignment lens has a finding still open", () => {
  const open = [{ id: "corpus-misalignment-1", claim: "The plan asks for a total with tax. The diff sums without it.", word: "left as is" }];

  assert.equal(endRows({ codeRun: finishedRun(), round: round({ findings: open }) }).goal, "in doubt · The plan asks for a total with tax.");
});

test("PR reads a dash until the publish result or the unit record names it", () => {
  const codeRun = finishedRun();

  assert.equal(endRows({ codeRun }).pr, DASH, "between the code run's end and the publish nothing is opened yet");
  assert.equal(endRows({ codeRun, pr: { url: "https://github.com/o/r/pull/7", title: "feat: add order_total" } }).pr, "opened · #7 feat: add order_total");
  assert.equal(endRows({ codeRun, pr: { url: "https://github.com/o/r/pull/7" } }).pr, "opened · #7", "a title not seen is left out");
  assert.equal(endRows({ codeRun, pr: { result: "kept-local" } }).pr, "not opened · kept local");
  assert.equal(endRows({ codeRun, pr: { result: "local" } }).pr, "not opened · kept local");
  assert.equal(endRows({ codeRun, pr: { result: "skip" } }).pr, "not opened · nothing to publish");
});

test("the pull request's title is the last one the draft or its fixes returned", () => {
  const call = (pb_key, input) => ({ input: { pb_key, ...input } });
  const calls = [
    call("pr-draft.draft-pull-request.-.r1.a1", { title: "fix: first" }),
    call("code-safety-net.fix.g1.r2.a1", { title: "not a pull request" }),
    call("pr-draft.fix.g1.r2.a1", { title: "fix: redrafted" }),
    call("pr-draft.lens.claims.r1.a1", { findings: [{ title: "a finding" }] }),
  ];

  assert.equal(prTitleOf(calls), "fix: redrafted");
  assert.equal(prTitleOf([]), undefined);
});

test("the end review is one summary line, then the findings by their gist", () => {
  const findings = [
    { id: "code-1", title: "Rounds half down", word: "fixed", where: "cart.py:3" },
    { id: "tests-1", claim: "The test aliases the function. It adds nothing.", word: "fixed" },
  ];
  const mixed = [...findings, { id: "code-2", title: "Odd name", word: "left as is" }, { id: "code-3", title: "Fine", word: "not a real problem" }];

  assert.deepEqual(endReviewLines({ findings }, 200).map(({ text }) => text), ["review: 2 issues, all fixed", "  fixed · Rounds half down · cart.py:3", "  fixed · The test aliases the function."]);
  assert.equal(endReviewLines({ findings: mixed }, 200)[0].text, "review: 4 issues · 2 fixed · 1 left as is · 1 not a real problem");
  assert.deepEqual(endReviewLines({ findings: [] }, 200), [{ text: "review: no issues found" }]);
  assert.deepEqual(endReviewLines(undefined, 200), [], "no round known, no lines");
});

const SAFETY_NET_START = "2026-11-14T10:02:00.000Z";
const codeLedger = (gates) => ({
  kind: "code",
  runId: "run-1",
  task: TASK,
  stage: { name: "code-safety-net", status: "done", attempt: 1, startedAt: SAFETY_NET_START },
  stages: [{ name: "code-tdd", status: "done", attempt: 1, startedAt: "2026-11-14T10:00:00.000Z" }, { name: "code-safety-net", status: "done", attempt: 1, startedAt: SAFETY_NET_START }],
  gates,
  needsHuman: null,
  tests: { perTest: { a: { green: { passed: true } }, b: { green: { passed: true } }, c: { red: { passed: true } } }, full: { passed: true } },
  fixes: { rollbacks: [] },
});

test("the code run's record: its task, whether the task-end gate passed, its passing tests and its safety-net round", () => {
  const passed = codeRunOf(codeLedger({ "G:task-end": { source: "human-cli", answer: "approve" } }));
  const waiting = codeRunOf({ ...codeLedger({}), needsHuman: { gate: "G:task-end" } });

  const perTest = { a: { green: { passed: true } }, b: { green: { passed: true } }, c: {} };
  assert.deepEqual(passed, { runId: "run-1", task: TASK, taskEndPassed: true, testsPassing: 2, perTest, safetyNet: { attempt: 1, startedAt: SAFETY_NET_START }, rollbacks: [] }, "each test keeps only the marks the TESTS row reads");
  assert.equal(waiting.taskEndPassed, false, "a gate still waiting has not passed");
  assert.equal(codeRunOf({ kind: "publish", stage: { name: "pr-draft" } }), null, "a publish run is no code run");
  assert.equal(codeRunOf(undefined), null);
});

test("the end round is the code run's safety-net round, read from the recorded returns once it is over", () => {
  const codeRun = codeRunOf(codeLedger({ "G:task-end": { source: "auto" } }));
  const calls = [{ at: "2026-11-14T10:03:00.000Z", input: { pb_key: "code-safety-net.lens.corpus-misalignment.r1.a1", findings: [] } }];

  const round = safetyNetRound({ codeRun, calls, spawns: [] });

  assert.deepEqual(round.lenses.map(({ id, state }) => ({ id, state })), [{ id: "corpus-misalignment", state: "returned" }]);
  assert.equal(endRows({ codeRun, round }).goal, "met · Add order_total to cart.py.");
  assert.equal(safetyNetRound({ codeRun: { ...codeRun, safetyNet: null }, calls, spawns: [] }), undefined, "no safety-net stage, no round");
});

test("GOAL reads not checked when no alignment verdict was recorded", () => {
  const noAlignmentLens = { lenses: [{ id: "code", name: "the code", state: "returned", found: 0 }], findings: [] };

  assert.equal(endRows({ codeRun: finishedRun() }).goal, "not checked", "no review round is known (the session that saw it is gone)");
  assert.equal(endRows({ codeRun: finishedRun(), round: round({ state: "uncovered" }) }).goal, "not checked", "the alignment lens returned nothing usable");
  assert.equal(endRows({ codeRun: finishedRun(), round: round({ state: "running" }) }).goal, "not checked", "the alignment lens never returned");
  assert.equal(endRows({ codeRun: finishedRun(), round: noAlignmentLens }).goal, "not checked", "no alignment lens ran");
});
