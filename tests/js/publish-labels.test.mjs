// pb publish and the draft's labels: a label the repo does not have is refused before anything is pushed, and the run
// stops at once as a wait on the human, since a retry with the same approved draft can only fail the same way.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { REFUSED } from "./publish-fixture.mjs";
import { join } from "node:path";

import { pb, pbWithEnv } from "./cli-repo-fixture.mjs";
import { FAKE_PR_URL, installGhShim, viewEnv } from "./gh-shim-fixture.mjs";
import { endedTaskUnit, ledgerFile, publishableUnit, publishUnit, remoteRef, statusAction } from "./publishable-unit-fixture.mjs";

const readLedger = (repo) => JSON.parse(readFileSync(ledgerFile(repo), "utf8"));
const repoLabels = (names) => ({ GH_SHIM_LABELS: JSON.stringify(names) });

test("missing-label-refused-before-push", () => {
  const unit = publishableUnit({ labels: ["area:cli", "area:api-docs"] });

  const { gh, result } = publishUnit(unit, repoLabels(["area:cli", "area:api", "docs"]));

  assert.equal(result.code, REFUSED, `pb publish refuses, stdout ${result.stdout}`);
  assert.match(result.stderr, /area:api-docs/, `the refusal names the missing label: ${result.stderr}`);
  assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), null, "nothing was pushed");
  assert.deepEqual(gh.prCreates(), [], "no gh pr create");
});

test("missing-label-stops-at-once-without-a-retry", () => {
  const unit = publishableUnit({ labels: ["area:api-docs"] });

  publishUnit(unit, repoLabels(["area:api", "docs"]));
  const ledger = readLedger(unit.repo);

  assert.equal(ledger.stop?.code, "pr-label-missing", `the run stops at once: ${JSON.stringify(ledger.stop)}`);
  assert.equal(ledger.retries?.publish?.used ?? 0, 0, "the refusal uses no publish attempt");
  assert.match(ledger.stop.why, /area:api-docs/, "the why names the label");
});

test("going-on-after-a-missing-label-redrafts-the-pull-request", () => {
  const unit = publishableUnit({ labels: ["area:api-docs"] });
  publishUnit(unit, repoLabels(["area:api", "docs"]));

  const cleared = pb(unit.repo, "stage", "fail");
  const ledger = readLedger(unit.repo);
  const action = statusAction(unit.repo);

  assert.equal(cleared.code, 0, `pb stage fail clears the stop: ${cleared.stderr}`);
  assert.equal("G:publish" in ledger.gates, false, "the approval of the old draft is void");
  assert.match(action, /pr-draft/, `the next action writes the draft again: ${action}`);
});

test("publish-run-gives-the-draft-the-repo-labels", () => {
  const repo = endedTaskUnit();
  const gh = installGhShim();

  const opened = pbWithEnv(repo, gh.env(repoLabels(["area:cli", "docs"])), "run", "open", "--kind", "publish");

  assert.equal(opened.code, 0, opened.stderr);
  const written = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "repo-labels.json"), "utf8"));
  assert.deepEqual(written, { labels: ["area:cli", "docs"] }, "the labels the draft may use");
});

// The repo's labels could not be listed before the push, so gh itself refuses the label: the same stop, pushed branch kept.
test("gh-refusing-a-label-after-the-push-stops-at-once", () => {
  const unit = publishableUnit({ labels: ["area:api-docs"] });

  const { result } = publishUnit(unit, { GH_SHIM_FAIL: "pr create", GH_SHIM_FAIL_MESSAGE: "could not add label: 'area:api-docs' not found" });
  const ledger = readLedger(unit.repo);

  assert.equal(result.code, REFUSED);
  assert.equal(ledger.stop?.code, "pr-label-missing", `the run stops at once: ${JSON.stringify(ledger.stop)}`);
  assert.equal(ledger.retries?.publish?.used ?? 0, 0, "no publish attempt is used");
  assert.match(ledger.stop.detail, new RegExp(`${unit.branch}.*pushed`), `says the branch is pushed: ${ledger.stop.detail}`);
});

// A run stopped at its publish cap, then the human opened the PR by hand: going on adopts that PR, labels and all.
test("a-hand-opened-pr-is-adopted-after-the-publish-cap", () => {
  const unit = publishableUnit({ labels: ["area:api-docs"] });
  publishUnit(unit, { GH_SHIM_FAIL: "pr create" });
  publishUnit(unit, { GH_SHIM_FAIL: "pr create" });
  assert.equal(readLedger(unit.repo).stop?.code, "attempt-cap", "the old cap stop stands");

  const cleared = pb(unit.repo, "stage", "fail");
  const { result } = publishUnit(unit, { ...viewEnv({ head: unit.branch }), ...repoLabels(["area:api"]), GH_SHIM_FAIL: "pr create" });

  assert.equal(cleared.code, 0, cleared.stderr);
  assert.equal(result.code, 0, `pb publish adopts the open PR: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).url, FAKE_PR_URL);
});
