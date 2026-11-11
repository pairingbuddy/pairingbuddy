// A repo for the tests of pb pr refresh: a feature branch two commits past main (which origin also has), no unit and no
// run open, and a recording gh whose `gh pr view` reports an open PR from that branch whose head is local HEAD.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { updateLedger } from "../../shared-node/ledger.mjs";
import { env, makeRepo, pb, pbWithEnv } from "./cli-repo-fixture.mjs";
import { CLEAN_BODY, CLEAN_TITLE, approvedThroughTap, draftKey, setPolicyThroughGate } from "./publish-fixture.mjs";
import { FAKE_PR_URL, installGhShim, viewEnv } from "./gh-shim-fixture.mjs";

export const BRANCH = "feature/refresh-me";
export const BASE = "main";
export const OLD_TITLE = "feat: old title";
export const OLD_BODY = "## Summary\n\nOld body.\n";
export const PR_NUMBER = 7;

export const git = (repo, ...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), encoding: "utf8" }).trim();

export function refreshRepo({ view = {} } = {}) {
  const repo = makeRepo({ openTask: false, remote: true });
  git(repo, "checkout", "-q", "-b", BRANCH);
  for (const name of ["one", "two"]) {
    writeFileSync(join(repo.dir, `${name}.txt`), `${name}\n`);
    git(repo, "add", `${name}.txt`);
    git(repo, "commit", "-q", "-m", `feat: ${name}`);
  }
  const headSha = git(repo, "rev-parse", "HEAD");
  const gh = installGhShim();
  const ghEnv = (extra = {}, viewOverrides = {}) => gh.env({ ...viewEnv({ head: BRANCH, base: BASE, number: PR_NUMBER, title: OLD_TITLE, body: OLD_BODY, headRefOid: headSha, state: "OPEN", ...view, ...viewOverrides }), ...extra });
  return { repo, gh, headSha, ghEnv, url: FAKE_PR_URL };
}

export { pbWithEnv };

// A refresh run opened by pb pr refresh, then put on the pr-draft stage with the draft the tap would have filed:
// the draft artifact, run/pr-body.md, and an active pr-draft stage at attempt 1. No unit exists.
export function refreshRunOnDraft({ title = CLEAN_TITLE, body = CLEAN_BODY, view = {} } = {}) {
  const fixture = refreshRepo({ view });
  const opened = pbWithEnv(fixture.repo, fixture.ghEnv(), "pr", "refresh");
  if (opened.code !== 0) throw new Error(`pb pr refresh failed: ${opened.stderr}`);
  const runDir = join(fixture.repo.dir, ".pairingbuddy", "run");
  mkdirSync(join(runDir, "task", "artifacts"), { recursive: true });
  writeFileSync(join(runDir, "pr-body.md"), body);
  writeFileSync(join(runDir, "task", "artifacts", `${draftKey(1)}.json`), JSON.stringify({ pb_key: draftKey(1), title, body, labels: [], base: BASE, coordination: null }));
  updateLedger(join(runDir, "task", "ledger.json"), (ledger) => ({ ...ledger, stage: { name: "pr-draft", status: "active", runId: "r1", attempt: 1 }, stages: [] }));
  return { ...fixture, runDir };
}

// A refresh run whose new draft is done and linted under auto policy, with no approval at G:publish yet.
// gitConfig, when given, is written to .pairingbuddy/git-config.json before the lint.
export function lintedRefresh({ gitConfig, ...options } = {}) {
  const fixture = refreshRunOnDraft(options);
  const { repo, runDir } = fixture;
  updateLedger(join(runDir, "task", "ledger.json"), (ledger) => ({ ...ledger, stage: { name: "pr-draft", status: "done", runId: "r1", attempt: 1 }, stages: [{ name: "pr-draft", status: "done" }] }));
  if (gitConfig) writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify(gitConfig));
  setPolicyThroughGate(repo, "auto");
  const lint = pb(repo, "pr", "lint");
  if (lint.code !== 0) throw new Error(`pb pr lint failed: ${lint.stderr}`);
  return fixture;
}

// A linted refresh run approved at G:publish by the human through the real tap: the state pb pr refresh's apply phase
// starts from.
export function approvedRefresh(options = {}) {
  const fixture = lintedRefresh(options);
  approvedThroughTap(fixture.repo);
  return fixture;
}
