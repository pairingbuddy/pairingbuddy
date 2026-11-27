// Scenario: a stop says what a test run did in one line, so the raw runner output never fills the WHY.
import { test } from "node:test";
import assert from "node:assert/strict";

import { runSummary } from "../../shared-node/run-summary.mjs";

const NODE_TEST_OUTPUT = "✔ gate-denies-lens-read-outside-repo (81.776667ms)\nℹ tests 1\nℹ suites 0\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 169.112458\n";

test("node-test-output-reads-as-its-counts", () => {
  assert.equal(runSummary(NODE_TEST_OUTPUT, 0), "1 test, 1 passed");
});

test("pytest-output-reads-as-its-counts", () => {
  assert.equal(runSummary("tests/test_a.py ..                [100%]\n\n============ 2 passed in 0.12s ============\n", 0), "2 passed");
});

test("output-with-no-known-counts-reads-as-its-exit-code", () => {
  assert.equal(runSummary("PASS src/a.test.ts\n  ✓ works (3 ms)\n", 0), "it exited 0");
});
