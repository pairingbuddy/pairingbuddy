// Scenario: three states. A run that waits on the human is told apart from one a failure stopped (shared-node/glance.mjs),
// so the band, the pane and the status line draw waiting in amber and keep red for failures only.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ALERT_WHAT_MAX, alertBar, alertKind, alertLine, FAILED, WAITING } from "../../shared-node/glance.mjs";
import { plainName } from "../../shared-node/plain-names.mjs";

test("a-gate-question-waits-on-the-human", () => {
  assert.equal(alertKind({ needsHuman: { gate: "G:task-end", seq: 3 } }), WAITING);
});

test("a-stop-from-a-failure-is-a-failure-even-while-a-question-stands", () => {
  for (const code of ["attempt-cap", "step-failed", "commit-failed", "gate-off", undefined]) {
    assert.equal(alertKind({ stop: { code, seq: 4 }, needsHuman: { gate: "G:task-end", seq: 3 } }), FAILED, String(code));
  }
});

test("the-humans-own-stop-waits-on-them-and-is-no-failure", () => {
  assert.equal(alertKind({ stop: { code: "human-stopped", seq: 4 } }), WAITING);
});

test("a-stranded-stage-is-a-failure-its-session-or-workflow-is-gone", () => {
  assert.equal(alertKind({ needsHuman: { gate: "stranded", seq: 4 } }), FAILED);
  assert.equal(alertKind({ needsHuman: { gate: "workflow-ended", seq: 4 } }), FAILED);
});

test("nothing-standing-is-no-alert", () => {
  assert.equal(alertKind({ stop: null, needsHuman: null }), undefined);
  assert.equal(alertKind(undefined), undefined);
});

test("the-alert-line-says-what-it-waits-for-or-why-it-stopped-in-plain-words", () => {
  assert.equal(alertLine({ needsHuman: { gate: "G:task-end", seq: 3 } }), `waiting for you: ${plainName("G:task-end")}`);
  assert.equal(alertLine({ stop: { code: "attempt-cap", seq: 3 } }), `stopped: ${plainName("attempt-cap")}`);
  assert.equal(alertLine({ stop: null, needsHuman: null }), null);
});

test("the-bar-leads-with-its-state-and-says-what-about", () => {
  assert.deepEqual(alertBar({ needsHuman: { gate: "G:task-end", seq: 3 } }), { kind: WAITING, text: `⏸ WAITING FOR YOU · ${plainName("G:task-end")}` });
  assert.deepEqual(alertBar({ stop: { code: "attempt-cap", seq: 3 } }), { kind: FAILED, text: `✗ STOPPED · ${plainName("attempt-cap")}` });
  assert.equal(alertBar({}), null);
});

test("a-long-what-is-cut-at-a-fixed-limit-with-an-ellipsis", () => {
  const gate = "x".repeat(200);
  const { text } = alertBar({ needsHuman: { gate, seq: 3 } });
  const what = text.slice("⏸ WAITING FOR YOU · ".length);
  assert.equal(what.length, ALERT_WHAT_MAX);
  assert.ok(what.endsWith("…"), what);
  assert.ok(alertLine({ needsHuman: { gate, seq: 3 } }).endsWith("…"), "the status line is bounded too");
});
