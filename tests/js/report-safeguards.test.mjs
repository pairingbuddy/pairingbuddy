// Safeguards for the wording of shared-node/report.mjs: the next step of a stopped run with no current test or on test 1,
// spawns that are no list, a record with no exit codes, the ordinal past "tenth" and the stop name in "Why it looped",
// and a commit with no sha.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, resultWords } from "../../shared-node/report.mjs";
import { plainName } from "../../shared-node/plain-names.mjs";
import { cardsOf, noteOf, rowsOf, sectionOf } from "./report-fixture.mjs";

const STOP = { reason: "a step kept failing", seq: 3, code: "step-failed" };
const stoppedLedger = (perTest = {}, stop = STOP) => ({ taskType: "bug_fix", task: "T", stage: { name: "code-tdd", status: "active" }, stages: [], tests: { perTest }, stop });
const red = (item) => ({ kind: "workflow_agent", name: `pb1 code-tdd RED implement-tests ${item} r1`, seconds: 10 });
const nextStep = (html) => sectionOf(html, "WHAT YOU CAN DO");

test("stopped-run-with-no-current-test-says-what-it-keeps-is-unknown", () => {
  const html = renderReport({ ledger: stoppedLedger(), spawns: [] });

  assert.match(nextStep(html), /<p>1\. Re-run \/pairingbuddy:code\. The recorded run does not say which test it stopped on, so what it keeps is unknown\.<\/p>/);
});

test("stopped-run-on-test-1-continues-from-test-1", () => {
  const html = renderReport({ ledger: stoppedLedger(), spawns: [red("t1")] });

  assert.match(nextStep(html), /<p>1\. Re-run \/pairingbuddy:code\. It continues from test 1\.<\/p>/);
});

test("spawns-that-are-no-list-still-draw-the-ledger-tries", () => {
  const html = renderReport({ ledger: stoppedLedger({ t1: { green: { passed: true } } }), spawns: undefined });

  assert.deepEqual(rowsOf(cardsOf(html)[0]), [["GREEN", "1", "passed"]]);
});

test("record-with-no-exit-codes-has-no-exit-suffix", () => {
  assert.equal(resultWords("GREEN", { passed: true }), "passed");
  assert.equal(resultWords("RED", { passed: false, exitCodes: "1" }), "passed straight away, refused");
});

test("eleventh-looping-try-reads-11th-and-names-the-stop", () => {
  const html = renderReport({ ledger: stoppedLedger(), spawns: Array.from({ length: 11 }, () => red("t1")) });

  assert.equal(noteOf(cardsOf(html)[0]), `<p><strong>Why it looped</strong> RED must start from a test that fails, so a RED that did not was tried again. It took 11 tries; the 11th refused try was the last and the run stopped: ${plainName("step-failed")}.</p>`);
});

test("tenth-looping-try-reads-tenth", () => {
  const html = renderReport({ ledger: stoppedLedger(), spawns: Array.from({ length: 10 }, () => red("t1")) });

  assert.match(noteOf(cardsOf(html)[0]), /; the tenth refused try was the last/);
});

test("looping-stop-with-no-plain-name-ends-at-stopped", () => {
  const html = renderReport({ ledger: stoppedLedger({}, { reason: "r", seq: 3, code: "no-such-code" }), spawns: Array.from({ length: 3 }, () => red("t1")) });

  assert.match(noteOf(cardsOf(html)[0]), /It took 3 tries; the third refused try was the last and the run stopped\.<\/p>$/);
});

test("looping-run-not-stopped-says-so-far", () => {
  const html = renderReport({ ledger: stoppedLedger({}, null), spawns: Array.from({ length: 3 }, () => red("t1")) });

  assert.match(noteOf(cardsOf(html)[0]), /It took 3 tries so far\.<\/p>$/);
});

test("commit-with-no-sha-shows-its-subject-alone", () => {
  const html = renderReport({ ledger: stoppedLedger(), spawns: [], commits: [{ subject: "fix: a & b" }] });

  assert.match(sectionOf(html, "COMMITS"), /<li> fix: a &amp; b<\/li>/);
});
