import { test } from "node:test";
import assert from "node:assert/strict";
import { readsMissingFromTrace } from "../smoke/s4.mjs";

// These tests run pure helpers of tests/smoke/s4.mjs. The live S4 run is by hand (`node tests/smoke/s4.mjs`).

// Claude Code writes a PreToolUse attachment to the transcript only when the hook prints something, and the gate's allow
// is silent, so the lens reads are matched against the gate's own trace instead.
test("s4-lens-reads-are-matched-against-the-gate-trace", () => {
  const reads = ["toolu_a", "toolu_b"];
  const trace = [{ tool_use_id: "toolu_a", tool_name: "Read", agent_type: "pairingbuddy:lens", decision: "none" }];

  assert.deepEqual(readsMissingFromTrace(reads, trace), ["toolu_b"]);
});
