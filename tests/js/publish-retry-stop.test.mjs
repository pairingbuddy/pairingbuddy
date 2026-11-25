import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pbCommand } from "../../shared-node/verbs.mjs";
import { REFUSED } from "./publish-fixture.mjs";
import { ledgerFile, publishRun, publishUnit, statusAction } from "./publishable-unit-fixture.mjs";

// Task 111: a failed publish retries once, then stops. A stop pushes nothing,
// and units published before the stop keep their PRs and recorded state.
// Placeholders: each body fails until implement-tests writes the real assertion.

test("first-publish-failure-retries-once", () => {
  const unit = publishRun();
  const { result } = publishUnit(unit, { GH_SHIM_FAIL: "pr create" });
  assert.equal(result.code, REFUSED, `the first pb publish fails, stdout ${result.stdout}`);

  const action = statusAction(unit.repo);

  const ledger = JSON.parse(readFileSync(ledgerFile(unit.repo), "utf8"));
  assert.equal(ledger.stop, null, "one failed publish does not stop the run");
  assert.ok(action.includes(pbCommand("publish")), `the action names pb publish for the retry: ${action}`);
  assert.match(action, /retry/i, `the action says this is the retry: ${action}`);
});

test("second-publish-failure-stops", () => {
  assert.fail("placeholder: not implemented");
});

test("retry-success-continues", () => {
  assert.fail("placeholder: not implemented");
});

test("stop-makes-no-push", () => {
  assert.fail("placeholder: not implemented");
});

test("published-units-stand-after-stop", () => {
  assert.fail("placeholder: not implemented");
});
