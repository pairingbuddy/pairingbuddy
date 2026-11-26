import { test } from "node:test";
import assert from "node:assert/strict";
import { runSolo } from "./solo-script-fixture.mjs";

// Tests for the Solo exit report. Each runs scripts/solo-buddy.sh in a throwaway repo with a stubbed claude.

// A ledger whose run stopped at the attempt cap
const stoppedLedger = () => ({
  stage: { name: "implement-tests", status: "running", attempt: 2 },
  stop: { reason: "implement-tests ran out of fix attempts", seq: 7, code: "attempt-cap" },
});

// A ledger whose stage code-scenarios stopped at the attempt cap after the given rollbacks
const attemptCapLedger = (stopReason, rollbackKeys) => ({
  stage: { name: "code-scenarios", status: "running", attempt: 1 },
  stop: { reason: stopReason, seq: 9, code: "attempt-cap" },
  fixes: { rollbacks: rollbackKeys.map((key) => ({ key })) },
});

test("exit-zero-with-stop-in-ledger-reports-failure", () => {
  const { result, status } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: { ".pairingbuddy/run/task/ledger.json": stoppedLedger() },
  });

  assert.match(
    result.stdout,
    /^✗ Session stopped: implement-tests ran out of fix attempts$/m,
    "the summary must carry the failure line with the stop reason",
  );
  assert.match(status, /^Session stopped$/m, "the status footer must say the session stopped");
});

test("exit-zero-with-needs-human-in-ledger-reports-failure", () => {
  const ledger = {
    stage: { name: "code-scenarios", status: "running", attempt: 1 },
    stop: null,
    needsHuman: { gate: "approve-scenarios", seq: 4 },
  };

  const { result } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: { ".pairingbuddy/run/task/ledger.json": ledger },
  });

  assert.match(
    result.stdout,
    /^✗ Session unfinished: waiting on a human at approve-scenarios$/m,
    "the summary must carry the failure line that names the gate waiting on a human",
  );
  assert.doesNotMatch(result.stdout, /✓ Session complete/, "a run waiting on a human must not look complete");
});

test("exit-zero-with-unfinished-stage-reports-failure", () => {
  const ledger = {
    stage: { name: "implement-tests", status: "active", attempt: 1 },
    stop: null,
  };

  const { result } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: { ".pairingbuddy/run/task/ledger.json": ledger },
  });

  assert.match(
    result.stdout,
    /^✗ Session unfinished: stage implement-tests is active$/m,
    "the summary must carry the failure line that names the unfinished stage and the ledger status it is stuck in",
  );
  assert.doesNotMatch(result.stdout, /✓ Session complete/, "a run with an unfinished stage must not look complete");
});

test("unfinished-exit-zero-script-exits-non-zero", () => {
  const { result } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: { ".pairingbuddy/run/task/ledger.json": stoppedLedger() },
  });

  assert.equal(result.status, 1, "an unfinished run must exit 1, or a caller reads it as success");
  assert.match(
    result.stdout,
    /^✗ Session stopped: implement-tests ran out of fix attempts$/m,
    "the exit must come from the unfinished-run branch, shown by the stop summary",
  );
});

test("exit-zero-with-finished-ledger-still-complete", () => {
  const ledger = {
    stage: { name: "implement-tests", status: "done", attempt: 1 },
    stop: null,
    needsHuman: null,
  };

  const { result } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: { ".pairingbuddy/run/task/ledger.json": ledger },
  });

  assert.match(result.stdout, /^✓ Session complete$/m, "a finished run must still report completion");
  assert.doesNotMatch(result.stdout, /✗ Session/, "a finished run must carry no failure line");
  assert.equal(result.status, 0, "a finished run must exit 0");
});

test("attempt-cap-stop-shows-attempt-count", () => {
  const ledger = attemptCapLedger("attempt-cap: stage code-scenarios rolled back 3 fix attempts, its cap of 5", [
    "code-scenarios.fix.g1.r1.a1",
    "code-scenarios.fix.g1.r1.a2",
    "code-scenarios.fix.g1.r1.a3",
  ]);

  const { result } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: { ".pairingbuddy/run/task/ledger.json": ledger },
  });

  assert.match(
    result.stdout,
    /^✗ Session stopped: attempt-cap: stage code-scenarios rolled back 3 fix attempts, its cap of 5\nfixes undone: 3 of 5 allowed$/m,
    "the summary must show the stop line, then the attempts made (3, from the rollbacks) against the cap (5, from the stop reason)",
  );
});

test("attempt-cap-stop-shows-each-lesson", () => {
  const ledger = attemptCapLedger("attempt-cap: stage code-scenarios rolled back 2 fix attempts, its cap of 5", [
    "code-scenarios.fix.g1.r1.a1",
    "code-scenarios.fix.g1.r1.a2",
  ]);
  const notes = [
    "## Rollback 1: code-scenarios.fix.g1.r1.a1",
    "",
    "The fix merged two scenarios and lost a test case.",
    "",
    "## Rollback 2: code-scenarios.fix.g1.r1.a2",
    "",
    "The fix renamed an id that other files point to.",
    "",
  ].join("\n");

  const { result } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: {
      ".pairingbuddy/run/task/ledger.json": ledger,
      ".pairingbuddy/run/task/notes/code-scenarios.md": notes,
    },
  });

  assert.match(
    result.stdout,
    /^✗ Session stopped: attempt-cap: stage code-scenarios rolled back 2 fix attempts, its cap of 5\nfixes undone: 2 of 5 allowed\nlessons:\n- The fix merged two scenarios and lost a test case\.\n- The fix renamed an id that other files point to\.$/m,
    "the summary must show the stop line, the attempts line, then each lesson of the stage that hit the cap, one per line, in rollback order",
  );
});

// A ledger whose run finished with nothing stopped or waiting
const finishedLedger = () => ({
  stage: { name: "implement-tests", status: "done", attempt: 1 },
  stop: null,
  needsHuman: null,
});

// A plan with one published unit per url, in the given order
const publishedPlan = (urls) =>
  [
    "# Plan",
    "",
    ...urls.flatMap((url, index) => [
      `#### PR: Unit ${index + 1}`,
      "",
      `PR: ${url} branch: unit-${index + 1}`,
      "",
      `- [x] Task ${index + 1}: Unit ${index + 1}`,
      "",
    ]),
  ].join("\n");

test("summary-lists-every-pr-link", () => {
  const plan = publishedPlan(["https://github.com/o/r/pull/11", "https://github.com/o/r/pull/12"]);

  const { result } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: { "plan.md": plan, ".pairingbuddy/run/task/ledger.json": finishedLedger() },
  });

  assert.match(
    result.stdout,
    /^✓ Session complete\npull requests:\n- https:\/\/github\.com\/o\/r\/pull\/11\n- https:\/\/github\.com\/o\/r\/pull\/12$/m,
    "the summary must list both PR urls from the plan right under its result line, one per line, in plan order",
  );
});

test("summary-lists-pr-links-on-failure-too", () => {
  assert.fail("not implemented: summary-lists-pr-links-on-failure-too");
});

test("summary-with-pr-links-makes-no-gh-or-push-call", () => {
  assert.fail("not implemented: summary-with-pr-links-makes-no-gh-or-push-call");
});
