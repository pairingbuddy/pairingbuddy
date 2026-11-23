// Scenario current-test: pure rendering of the current test's cycle marker and step age (node:test on shared-node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLabel } from "../../shared-node/labels.mjs";
import { cycleMarker, stepAge } from "../../shared-node/now-building.mjs";

test("marker-lights-only-current-step", async (t) => {
  const spawn = (phase) => ({ kind: "workflow_agent", name: buildLabel({ stage: "tdd", phase, role: "implementer", item: "login-works", round: 1 }) });

  const layouts = [
    { current: "RED", lit: ["RED"], marks: ["\u25cf", "\u203a", "\u203a"] },
    { current: "GREEN", lit: ["GREEN"], marks: ["\u2713", "\u25cf", "\u203a"] },
    { current: "REFACTOR", lit: ["REFACTOR"], marks: ["\u2713", "\u2713", "\u25cf"] },
  ];
  for (const { current, lit, marks } of layouts) {
    await t.test(current, () => {
      const marker = cycleMarker({ spawns: [spawn(current)], ledger: { taskType: "new_feature" } });

      assert.deepEqual(Object.keys(marker), ["steps"], `${current}: the marker is data the pane colours, with no stray fields`);
      assert.deepEqual(marker.steps.map((step) => Object.keys(step)), [["name", "lit", "mark"], ["name", "lit", "mark"], ["name", "lit", "mark"]], `${current}: each step has exactly name, lit and mark`);
      assert.deepEqual(marker.steps.map((step) => step.name), ["RED", "GREEN", "REFACTOR"], `${current}: the steps read RED, GREEN, REFACTOR in order`);
      assert.deepEqual(marker.steps.filter((step) => step.lit).map((step) => step.name), lit, `${current}: only the current step is lit`);
      assert.deepEqual(marker.steps.map((step) => step.mark), marks, `${current}: a tick before the steps passed, a bullet before the current step, chevrons before the steps to come`);
    });
  }
});

test("marker-is-empty-when-no-step-names-a-phase", () => {
  const unphased = [{ kind: "workflow_agent", name: buildLabel({ stage: "code-safety-net", phase: null, role: "refuter", item: "code-1", round: 1 }) }];

  for (const [why, spawns] of [["no spawn yet", []], ["the current step has no phase", unphased]]) {
    assert.deepEqual(cycleMarker({ spawns, ledger: { taskType: "new_feature" } }), { steps: [] }, `${why}: no step is drawn, rather than a marker with nothing lit`);
  }
});

test("bug-fix-drops-refactor", () => {
  const spawns = [{ kind: "workflow_agent", name: buildLabel({ stage: "tdd", phase: "GREEN", role: "implementer", item: "login-works", round: 1 }) }];
  const ledger = { taskType: "bug_fix" };

  const marker = cycleMarker({ spawns, ledger });

  assert.deepEqual(marker.steps.map((step) => step.name), ["RED", "GREEN"], "a bug fix has no refactor step, so the marker reads RED, GREEN");
  assert.deepEqual(marker.steps.map((step) => step.lit), [false, true], "the current step is still the only one lit");
  assert.deepEqual(marker.steps.map((step) => step.mark), ["\u2713", "\u25cf"], "a tick before RED, passed, and a bullet before the current step");
});

test("step-age-unknown-without-clock", () => {
  const label = buildLabel({ stage: "tdd", phase: "GREEN", role: "implementer", item: "login-works", round: 1 });
  const stamped = [{ kind: "workflow_agent", name: label, startedAt: "2026-11-05T10:00:00.000Z" }];
  const unstamped = [{ kind: "workflow_agent", name: label }];
  const now = Date.parse("2026-11-05T10:01:05.000Z");

  assert.equal(stepAge({ spawns: stamped, now }), "1:05", "the age is now minus the current step's spawn time, as a run-time clock");
  assert.equal(stepAge({ spawns: stamped, now: undefined }), "time unknown", "no clock reads as unknown, never a made-up age");
  assert.equal(stepAge({ spawns: unstamped, now }), "time unknown", "a spawn with no time reads as unknown, never a made-up age");
});

test("step-age-stops-where-the-run-paused", () => {
  const label = buildLabel({ stage: "tdd", phase: "REFACTOR", role: "refactor-code", item: "login-works", round: 1 });
  const spawns = [{ kind: "workflow_agent", name: label, startedAt: "2026-11-05T10:00:00.000Z" }];
  const pausedAt = Date.parse("2026-11-05T10:02:00.000Z");
  const now = Date.parse("2026-11-05T19:00:00.000Z");

  assert.equal(stepAge({ spawns, now, pausedAt }), "2:00", "a stopped or waiting run's step age freezes where SPENT's does");
  assert.equal(stepAge({ spawns, now: Date.parse("2026-11-05T10:01:00.000Z"), pausedAt }), "1:00", "a pause later than now changes nothing");
});
