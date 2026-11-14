// Scenario: review-outcomes. What became of each finding of a settled lens round, by the one rule the gate and the stage return share.
import { test } from "node:test";
import assert from "node:assert/strict";

import { findingOutcomes } from "../../shared-node/lens-merge.mjs";

const finding = (id, claim = `claim ${id}`) => ({ id, claim, where: "a.mjs:1", rule: "R", severity: "high", kind: "fix-here", blocking: true });

test("a survivor whose lens a kept fix answered is fixed, a refuted finding is not a real problem, every other finding is left as is", () => {
  const round = {
    survivors: [finding("permanence-1"), finding("claims-1")],
    refuted: [finding("claims-2")],
    unrefuted: [{ ...finding("permanence-3"), blocking: false }],
  };

  const outcomes = findingOutcomes(round, ["permanence"]);

  assert.deepEqual(outcomes, [
    { id: "permanence-1", claim: "claim permanence-1", where: "a.mjs:1", outcome: "fixed" },
    { id: "claims-1", claim: "claim claims-1", where: "a.mjs:1", outcome: "left as is" },
    { id: "claims-2", claim: "claim claims-2", where: "a.mjs:1", outcome: "not a real problem" },
    { id: "permanence-3", claim: "claim permanence-3", where: "a.mjs:1", outcome: "left as is" },
  ]);
});
