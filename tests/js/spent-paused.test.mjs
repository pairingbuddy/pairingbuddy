// Scenario spent-paused: SPENT's time counts only time when work runs. While a live run is stopped or waits on the human its
// clock stops and says "paused", in the pane's row and the band alike (shared-node/glance.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";

import { glance, pausedAtOf } from "../../shared-node/glance.mjs";

const START = "2026-11-22T10:00:00.000Z";
const at = (minutes) => Date.parse(START) + minutes * 60_000;
const RUNNING = { seq: 3, stage: { name: "code-tdd", status: "active", startedAt: START, attempt: 1 }, stages: [], spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null };
const spentOf = (ledger, now) => {
  const shown = glance({ ledger, spawns: [], tests: [], now, pausedAt: pausedAtOf(ledger), leaveOutUnknown: true });
  return [shown.rows.spent, shown.band.find((segment) => segment.id === "spent").text];
};

test("spent-paused: a question asked stops the clock at its askedAt", () => {
  const ledger = { ...RUNNING, needsHuman: { gate: "G:task-end", seq: 4, askedAt: new Date(at(3)).toISOString() } };

  assert.deepEqual(spentOf(ledger, at(40)), ["0 agents · 3:00 paused", "3:00 paused · 0 agents"]);
});

test("spent-paused: a stop stops the clock where the mod says it was raised", () => {
  const ledger = { ...RUNNING, stop: { code: "step-failed", reason: "r", seq: 4 }, pausedAt: at(5) };

  assert.deepEqual(spentOf(ledger, at(40)), ["0 agents · 5:00 paused", "5:00 paused · 0 agents"]);
});

test("spent-paused: a run at work keeps counting and says nothing of a pause", () => {
  assert.deepEqual(spentOf({ ...RUNNING, pausedAt: at(5) }, at(40)), ["0 agents · 40:00", "40:00 · 0 agents"]);
});
