import { test } from "node:test";
import assert from "node:assert/strict";

// Placeholders for the Solo exit report. Each runs scripts/solo-buddy.sh in a throwaway repo with a stubbed claude.
// Each body fails until the real test is written.

test("exit-zero-with-stop-in-ledger-reports-failure", () => {
  assert.fail("not implemented: exit-zero-with-stop-in-ledger-reports-failure");
});

test("exit-zero-with-needs-human-in-ledger-reports-failure", () => {
  assert.fail("not implemented: exit-zero-with-needs-human-in-ledger-reports-failure");
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
