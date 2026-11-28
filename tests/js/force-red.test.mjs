import { test } from "node:test";
import assert from "node:assert/strict";
import { forcesRed } from "../smoke/force-red.mjs";

// Tests for the smoke fixture that turns a test run red (tests/smoke/force-red.mjs).

const onStage = (name, attempt = 1) => ({ stage: { name, attempt } });

test("force-red-green-mode-fails-every-green-check-of-the-current-attempt", () => {
  const artifacts = ["code-tdd.implement-tests.t1.r1.a1.json", "code-tdd.implement-code.t1.r1.a1.json"];

  const forced = forcesRed({ mode: "green", ledger: onStage("code-tdd"), artifacts, markerExists: true });

  assert.equal(forced, true, "a GREEN return on file for this attempt turns every test run red, marker or not");
});

test("force-red-green-mode-leaves-a-new-attempts-red-step-alone", () => {
  const artifacts = ["code-tdd.implement-code.t1.r3.a1.json"];

  const forced = forcesRed({ mode: "green", ledger: onStage("code-tdd", 2), artifacts, markerExists: true });

  assert.equal(forced, false, "a GREEN return from attempt 1 does not turn attempt 2's RED run red, so RED still fails for its own reason");
});

test("force-red-green-mode-leaves-other-stages-alone", () => {
  const artifacts = ["code-tdd.implement-code.t1.r1.a1.json"];

  const forced = forcesRed({ mode: "green", ledger: onStage("code-safety-net"), artifacts, markerExists: false });

  assert.equal(forced, false, "the full suite of later stages runs for real");
});

test("force-red-once-mode-fails-the-first-safety-net-fix-only", () => {
  const artifacts = ["code-safety-net.fix.g1.r2.a1.json"];
  const ledger = onStage("code-safety-net");

  const first = forcesRed({ mode: "once", ledger, artifacts, markerExists: false });
  const later = forcesRed({ mode: "once", ledger, artifacts, markerExists: true });

  assert.deepEqual([first, later], [true, false], "S4's fixture fires once, until the marker is written");
});

test("force-red-always-mode-fails-every-safety-net-fix", () => {
  const artifacts = ["code-safety-net.fix.g1.r2.a1.json"];

  const forced = forcesRed({ mode: "always", ledger: onStage("code-safety-net"), artifacts, markerExists: true });

  assert.equal(forced, true, "--always ignores the marker");
});
