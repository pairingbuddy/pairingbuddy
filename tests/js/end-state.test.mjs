// Scenario end-state: when the unit's work is finished, the pane's STATUS, PR and BUILT rows say whether it is done, what was
// done and whether it meets the goal, from what the run recorded only (docs/design/progress-mod/DIRECTION.md).
import { test } from "node:test";
import assert from "node:assert/strict";

import { codeRunOf, doneStatus, endRows, endReviewLines, goalGist, goalLines, goalOf, isUnitDone, prTitleOf, safetyNetRound, wrapAtParts } from "../../shared-node/end-state.mjs";

const DASH = "—";
const TASK = "Add order_total to cart.py. It sums the line totals.";
const finishedRun = (overrides = {}) => ({ task: TASK, taskEndPassed: true, testsPassing: 1, fullPassed: true, ...overrides });

test("before the task is done every end row reads a dash", () => {
  assert.deepEqual(endRows({}), { done: DASH, pr: DASH }, "no code run recorded");
  assert.deepEqual(endRows({ codeRun: finishedRun({ taskEndPassed: false }), changed: ["cart.py"] }), { done: DASH, pr: DASH }, "the task-end gate has not passed");
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

test("STATUS says goal met only from a passed task-end gate and an alignment lens with no open finding", () => {
  const fixed = [{ id: "corpus-misalignment-1", title: "README says the old return", word: "fixed" }];
  const codeOnly = [{ id: "code-1", title: "Rounds half down", word: "left as is" }];

  assert.equal(doneStatus({ codeRun: finishedRun(), round: round() }), "goal met · ready for your next task");
  assert.equal(doneStatus({ codeRun: finishedRun(), round: round({ findings: fixed }) }), "goal met · ready for your next task", "a fixed alignment finding is closed");
  assert.equal(doneStatus({ codeRun: finishedRun(), round: { ...round(), findings: codeOnly } }), "goal met · ready for your next task", "another lens's open finding says nothing about the goal");
});

test("STATUS says goal in doubt with the gist when the alignment lens has a finding still open", () => {
  const open = [{ id: "corpus-misalignment-1", claim: "The plan asks for a total with tax. The diff sums without it.", word: "left as is" }];

  assert.equal(doneStatus({ codeRun: finishedRun(), round: round({ findings: open }) }), "goal in doubt: The plan asks for a total with tax.", "a doubt is the human's to look at, so ready-for-your-next-task is left out");
});

test("STATUS says goal in doubt when the alignment lens said an open finding the code lens said first for the same lines", () => {
  const merged = [{ id: "code-1", ids: ["code-1", "corpus-misalignment-1"], title: "Total leaves out tax", word: "left as is" }];

  assert.equal(doneStatus({ codeRun: finishedRun(), round: round({ findings: merged }) }), "goal in doubt: Total leaves out tax", "the finding shown once stands for the alignment lens's too");
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

// Live Task 107 run: BUILT read "9 tests passing" while TESTS read "17 of 17 passing · 8 covered".
test("a test an earlier test already covered counts as passing, as the TESTS row counts it", () => {
  const ledger = { ...codeLedger({ "G:task-end": { source: "auto" } }), tests: { perTest: { a: { green: { passed: true } }, b: { covered: { done: true } }, c: {} } } };

  assert.equal(codeRunOf(ledger).testsPassing, 2, "a passed GREEN and a covered pass, not the test with neither");
});

test("the end round is the code run's safety-net round, read from the recorded returns once it is over", () => {
  const codeRun = codeRunOf(codeLedger({ "G:task-end": { source: "auto" } }));
  const calls = [{ at: "2026-11-14T10:03:00.000Z", input: { pb_key: "code-safety-net.lens.corpus-misalignment.r1.a1", findings: [] } }];

  const round = safetyNetRound({ codeRun, calls, spawns: [] });

  assert.deepEqual(round.lenses.map(({ id, state }) => ({ id, state })), [{ id: "corpus-misalignment", state: "returned" }]);
  assert.equal(doneStatus({ codeRun, round }), "goal met · ready for your next task");
  assert.equal(safetyNetRound({ codeRun: { ...codeRun, safetyNet: null }, calls, spawns: [] }), undefined, "no safety-net stage, no round");
});

// With no verdict there is nothing about the goal to tell, so STATUS leaves the goal out rather than say it was "not checked".
test("STATUS says nothing of the goal when no alignment verdict was recorded", () => {
  const noAlignmentLens = { lenses: [{ id: "code", name: "the code", state: "returned", found: 0 }], findings: [] };

  assert.equal(doneStatus({ codeRun: finishedRun() }), "ready for your next task", "no review round is known (the session that saw it is gone)");
  assert.equal(doneStatus({ codeRun: finishedRun(), round: round({ state: "uncovered" }) }), "ready for your next task", "the alignment lens returned nothing usable");
  assert.equal(doneStatus({ codeRun: finishedRun(), round: round({ state: "running" }) }), "ready for your next task", "the alignment lens never returned");
  assert.equal(doneStatus({ codeRun: finishedRun(), round: noAlignmentLens, pr: { url: "https://github.com/o/r/pull/7" } }), "PR #7 opened · ready for your next task", "no alignment lens ran");
});

test("a goal too wide for its room is cut at the last clause break that fits, else at the last word", () => {
  const goal = "met · Add order_total to cart.py so it sums price times quantity over them, so the checkout can show one total";

  assert.equal(goalGist(goal, 200), goal, "a goal that fits is left whole");
  assert.equal(goalGist(goal, 100), "met · Add order_total to cart.py so it sums price times quantity over them", "cut at the comma, never mid-clause");
  assert.equal(goalGist("met · Goal: sum the lines; keep the tax apart", 30), "met · Goal: sum the lines", "a semicolon and a colon are clause breaks too");
  assert.equal(goalGist("met · Add order_total to cart.py so it sums price", 30), "met · Add order_total to", "with no clause break that fits, cut at the last word");
  assert.equal(goalGist("met · Fix discount.py: apply_discount(100, 10) returns 10 and it should return 90", 50), "met · Fix discount.py", "a comma inside brackets or code is not a clause break");
});

test("STATUS names the pull request's fate once the unit is done", () => {
  const codeRun = finishedRun();
  const met = { lenses: [{ id: "corpus-misalignment", state: "returned" }], findings: [] };

  assert.equal(doneStatus({ codeRun, round: met, pr: { url: "https://github.com/o/r/pull/7" } }), "goal met · PR #7 opened · ready for your next task");
  assert.equal(doneStatus({ codeRun, round: met, pr: { url: "https://example.com/review" } }), "goal met · PR opened · ready for your next task", "a url with no number");
  assert.equal(doneStatus({ codeRun, round: met, pr: { result: "kept-local" } }), "goal met · kept local · ready for your next task");
});

test("the unit is done only when no run is live, the task was signed off, and nothing is left to publish", () => {
  const codeRun = finishedRun();
  const pr = { url: "https://github.com/o/r/pull/7" };

  assert.equal(isUnitDone({ codeRun, pr }), true, "the pull request is open");
  assert.equal(isUnitDone({ codeRun, unitOpen: false }), true, "no unit is open that would publish");
  assert.equal(isUnitDone({ codeRun, unitOpen: true }), false, "the open unit still publishes");
  assert.equal(isUnitDone({ codeRun, pr: { result: "kept-local" }, unitOpen: true }), true, "kept local is a fate too");
  assert.equal(isUnitDone({ live: true, codeRun, pr }), false, "a run is live");
  assert.equal(isUnitDone({ codeRun: finishedRun({ taskEndPassed: false }), pr }), false, "not signed off");
  assert.equal(isUnitDone({}), false, "nothing known");
});

test("the goal is the task's first sentence on its first line, wrapped onto two lines before any cut", () => {
  assert.equal(goalOf("Add order_total. It sums lines."), "Add order_total.");
  assert.equal(goalOf("Add order_total to cart.py\n\nContext: the checkout."), "Add order_total to cart.py", "the context after a blank line is not the goal");
  assert.equal(goalOf(undefined), "");

  assert.deepEqual(goalLines("Add order_total to cart.py", 0), ["Add order_total to cart.py"], "no room known, one line");
  assert.deepEqual(goalLines("Add order_total to cart.py so it sums", 20), ["Add order_total to", "cart.py so it sums"], "wrapped, nothing cut");
  assert.deepEqual(goalLines("Add order_total to cart.py, so it sums every line price", 20), ["Add order_total to", "cart.py"], "past two lines, cut at the clause that fits");
  assert.deepEqual(goalLines("Fix src/shop/checkout/order_total.py", 12), ["Fix", "src/shop/che"], "a word wider than the room is split, never ended with an ellipsis");
});

test("a status wraps at its parts, then at words", () => {
  assert.deepEqual(wrapAtParts("working · writing a failing test · test 2 of 2", 34), ["working · writing a failing test", "test 2 of 2"]);
  assert.deepEqual(wrapAtParts("done · goal met", 0), ["done · goal met"]);
  assert.deepEqual(wrapAtParts("stopped · a step kept failing at the same place", 20), ["stopped", "a step kept failing", "at the same place"]);
});

// S6 at 60 columns: "left as is · Needless alias sut in regression" read as a whole title. A finding too long for the
// columns keeps what happens to it and cuts its title at a word, marked by "…".
test("a finding title too long for the columns is cut at a word with an ellipsis, its word kept whole", () => {
  const findings = [{ word: "left as is", title: "Needless alias sut in regression test", where: { file: "tests/test_discount.py", line: 9 } }];

  const [, line] = endReviewLines({ findings }, 47).map(({ text }) => text);

  assert.equal(line, "  left as is · Needless alias sut in…");
});
