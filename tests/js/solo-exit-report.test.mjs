import { test } from "node:test";
import assert from "node:assert/strict";
import { runSolo } from "./solo-script-fixture.mjs";

// Tests for the Solo exit report. Each runs scripts/solo-buddy.sh in a throwaway repo with a stubbed claude.

test("exit-zero-with-stop-in-ledger-reports-failure", () => {
  const ledger = {
    stage: { name: "implement-tests", status: "running", attempt: 2 },
    stop: { reason: "implement-tests ran out of fix attempts", seq: 7, code: "attempt-cap" },
  };

  const { result, status } = runSolo({
    stubs: () => ({ claude: "exit 0" }),
    files: { ".pairingbuddy/run/task/ledger.json": ledger },
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
    /^✗ .*approve-scenarios/m,
    "the summary must carry a failure line that names the gate waiting on a human",
  );
  assert.doesNotMatch(result.stdout, /✓ Session complete/, "a run waiting on a human must not look complete");
});

test("exit-zero-with-unfinished-stage-reports-failure", () => {
  assert.fail("not implemented: exit-zero-with-unfinished-stage-reports-failure");
});

test("unfinished-exit-zero-script-exits-non-zero", () => {
  assert.fail("not implemented: unfinished-exit-zero-script-exits-non-zero");
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
