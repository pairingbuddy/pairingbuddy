import { test } from "node:test";
import assert from "node:assert/strict";
import { runSolo } from "./solo-script-fixture.mjs";

// Tests for the Solo exit report. Each runs scripts/solo-buddy.sh in a throwaway repo with a stubbed claude.

// A ledger whose run stopped at the attempt cap
const stoppedLedger = () => ({
  stage: { name: "implement-tests", status: "running", attempt: 2 },
  stop: { reason: "implement-tests ran out of fix attempts", seq: 7, code: "attempt-cap" },
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
  const unfinishedStatus = "active"; // the ledger status under test: a stage that never finished (the sibling tests use "running")
  const ledger = {
    stage: { name: "implement-tests", status: unfinishedStatus, attempt: 1 },
    stop: null,
  };

  const { result } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: { ".pairingbuddy/run/task/ledger.json": ledger },
  });

  assert.match(
    result.stdout,
    new RegExp(`^✗ Session unfinished: stage implement-tests is ${unfinishedStatus}$`, "m"),
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
  assert.fail("not implemented: exit-zero-with-finished-ledger-still-complete");
});

test("attempt-cap-stop-shows-attempt-count", () => {
  assert.fail("not implemented: attempt-cap-stop-shows-attempt-count");
});

test("attempt-cap-stop-shows-each-lesson", () => {
  assert.fail("not implemented: attempt-cap-stop-shows-each-lesson");
});

test("summary-lists-every-pr-link", () => {
  assert.fail("not implemented: summary-lists-every-pr-link");
});

test("summary-lists-pr-links-on-failure-too", () => {
  assert.fail("not implemented: summary-lists-pr-links-on-failure-too");
});

test("summary-with-pr-links-makes-no-gh-or-push-call", () => {
  assert.fail("not implemented: summary-with-pr-links-makes-no-gh-or-push-call");
});
