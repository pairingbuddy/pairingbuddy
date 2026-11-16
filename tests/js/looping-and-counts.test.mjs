// Scenario looping-and-counts: drifted (unparseable) agent labels counted as unknown (node:test on shared-node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { glance } from "../../shared-node/glance.mjs";
import { buildLabel } from "../../shared-node/labels.mjs";

test("drifted-label-counted-unknown", () => {
  const good = { kind: "workflow_agent", name: buildLabel({ stage: "tdd", phase: "RED", role: "implement-tests", item: "discount-applies", round: 1 }) };
  const drifted = { kind: "workflow_agent", name: "implement tests for discount (round one)" };

  const withDrift = glance({ spawns: [good, drifted], tests: ["discount-applies"] });
  const withoutDrift = glance({ spawns: [good], tests: ["discount-applies"] });

  assert.deepEqual(withDrift.unknownLabels, ["implement tests for discount (round one)"], "exactly one drifted name is counted and shown raw, not dropped");
  assert.deepEqual(withoutDrift.unknownLabels, [], "a label that parses adds nothing to the unknown count");
  assert.equal(withDrift.rows.now, withoutDrift.rows.now, "the drifted spawn is not counted as a test step");
});
