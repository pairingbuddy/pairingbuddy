import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseBranch, protectedBranches } from "../../shared-node/gitconf.mjs";
import { ATTEMPT, env, makeRepo, pb } from "./cli-repo-fixture.mjs";

// Scenario: configured-branch-rules (unit level for the pure rule, CLI level for the two call sites).

test("default-branch-joins-protected-at-run-time", () => {
  const config = { protected_branches: ["release"] };

  const protectedSet = protectedBranches(config, "trunk");

  assert.deepEqual([...protectedSet].sort(), ["release", "trunk"], "effective set is the configured branches plus the run-time default branch, and not main");
});

test("pb-run-open-refuses-configured-protected-branch", () => {
  const repo = makeRepo({ openTask: false });
  const FIXTURE_DEFAULT_BRANCH = "feature"; // makeRepo initialises the repo on this branch, so main is neither default nor configured-protected
  const git = (...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" });
  writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ protected_branches: ["release"] }));
  git("checkout", "-q", "-b", "release");

  const onRelease = pb(repo, "run", "open", "--kind", "code");

  assert.equal(onRelease.code, 1, "open on the configured protected branch release is refused with exit 1");
  assert.match(onRelease.stderr, /protected branch release/, "the refusal names the branch release");

  git("checkout", "-q", "-b", "main");

  const onMain = pb(repo, "run", "open", "--kind", "code");

  assert.equal(onMain.code, 0, `open on main succeeds, as main is not protected when protected_branches is [release] and the default branch is ${FIXTURE_DEFAULT_BRANCH}: ${onMain.stderr}`);
  assert.doesNotMatch(onMain.stderr, /protected branch/, "open on main is not refused for the branch");
});

test("pb-checkpoint-refuses-configured-protected-branch", () => {
  const repo = makeRepo({ ledger: { taskType: "config_change" } });
  const FIXTURE_DEFAULT_BRANCH = "feature"; // makeRepo initialises the repo on this branch, so release is protected only through the config
  const git = (...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" });
  const key = `code-config.apply-config-change.-.r1.a${ATTEMPT}`;
  writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ protected_branches: ["release"] }));
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${key}.json`), JSON.stringify({ pb_key: key, ambiguity: "", commit_subject: "set a", files_changed: ["a.txt"] }));
  writeFileSync(join(repo.dir, "a.txt"), "changed\n");
  git("checkout", "-q", "-b", "release");
  const seed = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo.dir, env: env(), encoding: "utf8" }).trim();

  const result = pb(repo, "checkpoint", "--step", "config", "--from", key);

  assert.equal(result.code, 1, `checkpoint on the configured protected branch release is refused with exit 1 (default branch ${FIXTURE_DEFAULT_BRANCH}): ${result.stderr}`);
  assert.match(result.stderr, /protected branch release/, "the refusal names the branch release");
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo.dir, env: env(), encoding: "utf8" }).trim(), seed, "no commit was made");
});

test("pr-base-branch-null-falls-back-to-default-branch", () => {
  const configured = { pr: { base_branch: "develop" } };
  const unset = { pr: { base_branch: null } };

  const whenSet = baseBranch(configured, "trunk");
  const whenNull = baseBranch(unset, "trunk");
  const whenBothMissing = baseBranch(unset, null);

  assert.equal(whenSet, "develop", "pr.base_branch develop wins over the default branch trunk");
  assert.equal(whenNull, "trunk", "a null pr.base_branch falls back to the default branch trunk");
  assert.equal(whenBothMissing, null, "with no pr.base_branch and no default branch the base is unknown (null), never main");
});
