// Scenario: a stop says what a test run did in one line, so the raw runner output never fills the WHY.
import { test } from "node:test";
import assert from "node:assert/strict";

import { refusalSummary, runSummary } from "../../shared-node/run-summary.mjs";

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

// A refusal quotes each failed run's output for the next agent's try. The WHY keeps its words and puts one line in place of
// each output: the failing tests by name, or the counts. pytest quoting a node run's output escapes its line breaks.
test("a-refused-suite-names-its-failing-tests-in-place-of-the-raw-output", () => {
  const refusal = "the tests failed, so nothing was committed. runner pytest failed with exit code 1. Its output:\nhe hash was recorded\\n ok 1 - a ledger\\n---\nFAILED tests/test_js_suite.py::test_js[gate] - AssertionError\nFAILED tests/test_js_suite.py::test_js[hooks] - AssertionError\n=========== 2 failed, 2049 passed in 412.10s ===========\n";

  assert.equal(refusalSummary(refusal), "the tests failed, so nothing was committed. runner pytest failed with exit code 1: 2 tests failed: tests/test_js_suite.py::test_js[gate], tests/test_js_suite.py::test_js[hooks]");
});

test("each-of-several-runs-gets-its-own-line-even-when-its-output-has-blank-lines", () => {
  const refusal = "the tests failed, so nothing was committed. runner pytest failed with exit code 1. Its output:\nsession starts\n\nFAILED tests/test_a.py::test_one - boom\n\n== 1 failed in 1.00s ==\n\nrunner node failed with exit code 1. Its output:\n✖ renders a pdf (3.1ms)\n\nℹ tests 4\nℹ pass 3\n";

  assert.equal(refusalSummary(refusal), "the tests failed, so nothing was committed. runner pytest failed with exit code 1: 1 test failed: tests/test_a.py::test_one; runner node failed with exit code 1: 1 test failed: renders a pdf");
});
