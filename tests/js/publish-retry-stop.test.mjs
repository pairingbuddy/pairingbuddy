import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FAKE_PR_URL } from "./gh-shim-fixture.mjs";
import { pbCommand } from "../../shared-node/verbs.mjs";
import { REFUSED, git, unitFile } from "./publish-fixture.mjs";
import { installPrePushHook, ledgerFile, PLAN, planFile, publishRun, publishUnit, remoteRef, statusAction, withPlan } from "./publishable-unit-fixture.mjs";

// Task 111: a failed publish retries once, then stops. A stop pushes nothing,
// and units published before the stop keep their PRs and recorded state.
// Tests not yet implemented are placeholders that fail until their real assertion is written.

const readLedger = (repo) => JSON.parse(readFileSync(ledgerFile(repo), "utf8"));

test("first-publish-failure-retries-once", () => {
  const unit = publishRun();
  const { result } = publishUnit(unit, { GH_SHIM_FAIL: "pr create" });
  assert.equal(result.code, REFUSED, `the first pb publish fails, stdout ${result.stdout}`);

  const action = statusAction(unit.repo);
  const ledger = readLedger(unit.repo);

  assert.equal(ledger.retries.publish.used, 1, "the failed publish is recorded as one retry used");
  assert.equal(ledger.stop, null, "one failed publish does not stop the run");
  assert.ok(action.includes(pbCommand("publish")), `the action names pb publish for the retry: ${action}`);
  assert.match(action, /once more as the retry/, `the action says this is the retry: ${action}`);
});

test("second-publish-failure-stops", () => {
  const unit = publishRun();
  publishUnit(unit, { GH_SHIM_FAIL: "pr create" });

  const { result: second } = publishUnit(unit, { GH_SHIM_FAIL: "pr create" });
  const ledger = readLedger(unit.repo);
  const action = statusAction(unit.repo);
  const { gh, result: third } = publishUnit(unit);

  assert.equal(second.code, REFUSED, `the retry fails too, stdout ${second.stdout}`);
  assert.equal(ledger.retries.publish.used, 2, "both attempts are recorded as used");
  assert.notEqual(ledger.stop, null, "the second failed publish stops the run");
  assert.match(action, /The run has stopped/, `the action reports the stop: ${action}`);
  assert.equal(third.code, REFUSED, `a third pb publish is refused, stdout ${third.stdout}`);
  assert.deepEqual(gh.prCreates(), [], "no third attempt reaches gh pr create");
});

test("retry-success-continues", () => {
  const unit = publishRun();
  publishUnit(unit, { GH_SHIM_FAIL: "pr create" });

  const { gh, result: retry } = publishUnit(unit);

  assert.equal(retry.code, 0, `the retry succeeds, stderr ${retry.stderr}`);
  assert.equal(gh.prCreates().length, 1, "the retry opens the PR");
  assert.equal(existsSync(unitFile(unit.repo)), false, "the unit is published and closed");
});

test("stop-makes-no-push", () => {
  const unit = publishRun();
  publishUnit(unit, { GH_SHIM_FAIL: "pr create" });
  publishUnit(unit, { GH_SHIM_FAIL: "pr create" });
  const pushLog = join(unit.repo.dir, "pushes.log");
  installPrePushHook(unit.repo, `echo pushed >> "${pushLog}"`);
  const remoteBefore = remoteRef(unit.repo, `refs/heads/${unit.branch}`);

  const { result: third } = publishUnit(unit);
  statusAction(unit.repo);

  assert.equal(third.code, REFUSED, `the stopped run refuses a third pb publish, stdout ${third.stdout}`);
  assert.equal(existsSync(pushLog), false, "no git push runs once the run has stopped");
  assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), remoteBefore, "the remote branch is where the stop left it");
});

test("published-units-stand-after-stop", () => {
  const unit = publishRun();
  const earlierBranch = "feat/earlier-unit";
  const earlierLine = `PR: ${FAKE_PR_URL} branch: ${earlierBranch}`;
  withPlan(unit.repo, `${PLAN}\n#### PR: Earlier\n\n${earlierLine}\n\n- [x] Task Z\n`);
  git(unit.repo, "push", "-q", "origin", `main:refs/heads/${earlierBranch}`);
  const earlierRemote = remoteRef(unit.repo, `refs/heads/${earlierBranch}`);
  publishUnit(unit, { GH_SHIM_FAIL: "pr create" });

  publishUnit(unit, { GH_SHIM_FAIL: "pr create" });
  const action = statusAction(unit.repo);

  assert.match(action, /The run has stopped/, `the second failure stops the run: ${action}`);
  assert.match(readFileSync(planFile(unit.repo), "utf8"), new RegExp(`^${earlierLine.replace(/[.]/g, "\\.")}$`, "m"), "the earlier unit keeps its PR: line in the plan");
  assert.equal(remoteRef(unit.repo, `refs/heads/${earlierBranch}`), earlierRemote, "the earlier unit's branch is untouched on the remote");
});
