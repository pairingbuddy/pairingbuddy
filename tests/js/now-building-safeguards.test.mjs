// Safeguards for shared-node/now-building.mjs: the legend keeps one entry at any width, the progress row folds waiting then
// finished items at narrow widths, the looping tries line picks its fallbacks, nameOf spaces out an unnamed id, and the
// latest try's result waits for its runner when earlier tries had one. fitLegend at 140 and 55 columns is the mod's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLegend, fitProgress, fitTries, loopingTries, nameOf } from "../../shared-node/now-building.mjs";

const entry = (name, mark) => ({ id: name, name, mark });
const PROGRESS = { entries: [entry("a", "done"), entry("b", "covered"), entry("c", "current"), entry("d", "waiting"), entry("e", "waiting")] };

test("legend-keeps-its-first-entry-at-any-width", () => {
  assert.equal(fitLegend(5, fitProgress(PROGRESS, undefined)), "✓ made to pass");
});

test("legend-explains-only-the-marks-the-progress-row-shows", () => {
  assert.equal(fitLegend(undefined, "✓ a   ▸ c"), "✓ made to pass   ▸ now", "no covered or waiting test is shown, so their marks are not explained");
  assert.equal(fitLegend(undefined, "▸ c   · d   +2 more"), "▸ now   · to do");
  assert.equal(fitLegend(undefined, "✓ 2 done   ◌ 1 covered   ▸ c"), "✓ made to pass   ◌ already passed, nothing to fix   ▸ now", "folded counts carry their marks too");
  assert.equal(fitLegend(undefined, ""), "", "an empty row needs no legend");
});

test("progress-row-is-whole-with-no-width-budget", () => {
  assert.equal(fitProgress(PROGRESS, undefined), "✓ a   ◌ b   ▸ c   · d   · e");
});

test("progress-row-drops-waiting-items-into-more-when-the-total-is-known", () => {
  assert.equal(fitProgress({ ...PROGRESS, known: true }, 25), "✓ a   ◌ b   ▸ c   +2 more");
});

test("progress-row-drops-waiting-items-uncounted-when-the-total-is-unknown", () => {
  assert.equal(fitProgress(PROGRESS, 20), "✓ a   ◌ b   ▸ c");
});

test("progress-row-folds-finished-items-when-dropping-waiting-is-not-enough", () => {
  assert.equal(fitProgress({ ...PROGRESS, known: true }, 12), "✓ 1 done   ◌ 1 covered   ▸ c   +2 more");
});

const TRIES = [1, 2, 3].map((number) => ({ step: "RED", number, result: "passed straight away, refused (exit 0)" }));

test("tries-line-is-whole-with-no-width-budget", () => {
  assert.equal(fitTries(TRIES, undefined), `  ${TRIES.map(({ number, result }) => `try ${number} at RED: ${result}`).join(" · ")}`);
});

test("tries-line-falls-back-to-the-latest-try-without-its-step", () => {
  assert.equal(fitTries(TRIES, 5), "  try 3: passed straight away, refused (exit 0)");
});

test("name-of-an-unnamed-id-is-the-id-spaced-out", () => {
  assert.equal(nameOf({}, "adds-a-button"), "adds a button");
});

test("name-of-a-named-id-is-its-description", () => {
  assert.equal(nameOf({ "adds-a-button": "Adds a button" }, "adds-a-button"), "Adds a button");
});

const red = (item) => ({ kind: "workflow_agent", name: `pb1 code-tdd RED implement-tests ${item} r1` });
const runner = (item) => ({ kind: "workflow_agent", name: `pb1 code-tdd RED runner ${item} r1` });
const PER_TEST = { t1: { red: { passed: false, exitCodes: [0] } } };
const resultsOf = (spawns) => loopingTries({ spawns, perTest: PER_TEST }).map(({ result }) => result);

test("latest-try-waits-for-its-runner-when-earlier-tries-had-one", () => {
  assert.deepEqual(resultsOf([red("t1"), runner("t1"), red("t1"), runner("t1"), red("t1")]), ["unknown", "unknown", "unknown"]);
});

test("latest-try-takes-the-record-once-its-runner-ran", () => {
  assert.deepEqual(resultsOf([red("t1"), runner("t1"), red("t1"), runner("t1"), red("t1"), runner("t1")]), ["unknown", "unknown", "passed straight away, refused (exit 0)"]);
});

test("latest-try-takes-the-record-when-no-runner-is-labelled", () => {
  assert.deepEqual(resultsOf([red("t1"), red("t1"), red("t1")]), ["unknown", "unknown", "passed straight away, refused (exit 0)"]);
});
