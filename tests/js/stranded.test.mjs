// Scenario stranded: a stage whose session is gone reads as the human's to take over (shared-node/stranded.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";

import { STRANDED_GATE, STRANDED_MS, TAKE_OVER_LINE, isStranded, withStranded } from "../../shared-node/stranded.mjs";

const STARTED = Date.parse("2026-11-22T10:00:00.000Z");
const LEDGER = { seq: 4, owner: { sessionId: "s1", lastSeen: "2026-11-22T10:00:00.000Z" }, stage: { name: "code-tdd", status: "active", startedAt: "2026-11-22T10:00:00.000Z" }, stop: null, needsHuman: null };
const LATER = STARTED + STRANDED_MS + 1;

test("stranded: nothing moved for longer than the span", () => {
  assert.equal(isStranded(LEDGER, { now: LATER }), true);
});

test("stranded: a ledger write within the span is the stage moving, though its owner is silent in a long Workflow call", () => {
  assert.equal(isStranded(LEDGER, { now: LATER, ledgerWrittenMs: LATER - 60_000 }), false);
});

test("stranded: an agent this session spawned still running keeps it working", () => {
  assert.equal(isStranded(LEDGER, { now: LATER, spawnRunning: true }), false);
});

test("stranded: a stop, a question or no active stage is not stranded", () => {
  for (const ledger of [{ ...LEDGER, stop: { code: "step-failed", seq: 3 } }, { ...LEDGER, needsHuman: { gate: "G:task-end", seq: 3 } }, { ...LEDGER, stage: { ...LEDGER.stage, status: "done" } }]) {
    assert.equal(isStranded(ledger, { now: LATER }), false);
  }
});

test("stranded: with no clock nothing is stranded", () => {
  assert.equal(isStranded(LEDGER, { now: undefined }), false);
});

test("stranded: the views read it as the question waiting on the human, once per ledger seq", () => {
  assert.deepEqual(withStranded(LEDGER, { now: LATER }).needsHuman, { gate: STRANDED_GATE, reason: "take over the run: its session is gone", seq: 4 });
  assert.equal(withStranded(LEDGER, { now: STARTED }), LEDGER);
});

test("stranded: the span is pb human adopt's own, so a plain adopt takes a stranded run", async () => {
  const { ADOPT_RECENT_MS } = await import("../../shared-node/ledger.mjs");

  assert.equal(STRANDED_MS, ADOPT_RECENT_MS);
});

test("stranded: the take-over line names the shim pb writes, and only when it is there", async () => {
  const { SHIM } = await import("../../shared-node/verbs.mjs");

  assert.equal(TAKE_OVER_LINE, `type: !${SHIM} human adopt`);
  assert.equal(withStranded(LEDGER, { now: LATER, shim: true }).needsHuman.fix, TAKE_OVER_LINE);
  assert.equal(withStranded(LEDGER, { now: LATER, shim: false }).needsHuman.fix, undefined);
});
