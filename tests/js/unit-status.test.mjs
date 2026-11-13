// pb unit status, CLI side, run in temp repos with a bare origin and the gh shim. The CLI never rebases or pushes.
// Titles are the test case ids from .pairingbuddy/scenarios.json. Each describe is one scenario.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, makeRepo, pb, pbWithEnv, pushFromSecondClone, rebasedUnitRepo } from "./cli-repo-fixture.mjs";
import { FAKE_PR_URL, installGhShim, viewsEnv } from "./gh-shim-fixture.mjs";

const REMOTE_REPO = { openTask: false, remote: true };
const unitPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "unit.json");

const outputOf = (result) => result.stderr + result.stdout;
const gitIn = (dir, ...args) => execFileSync("git", args, { cwd: dir, env: env(), encoding: "utf8" }).trim();
const git = (repo, ...args) => gitIn(repo.dir, ...args);

// The deliberate refusal: exit 1 with the expected message, not the catch-all, and unit.json untouched.
function assertDeliberateRefusal(result, pattern, message, repo, unitBefore) {
  const output = outputOf(result);
  assert.equal(result.code, 1, `pb unit status refuses with the deliberate refusal exit code: ${output}`);
  assert.doesNotMatch(output, /unexpected failure/i, "the refusal is deliberate, not the catch-all");
  assert.match(output, pattern, message);
  assert.equal(readFileSync(unitPath(repo), "utf8"), unitBefore, "unit.json is unchanged");
}

// A repo with a bare origin and an open feat/x unit, plus the origin tip the unit was opened on.
function openUnitRepo() {
  const repo = makeRepo(REMOTE_REPO);
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `unit open: ${outputOf(opened)}`);
  return { repo, originTip: git(repo, "rev-parse", "origin/main") };
}

// A unit stacked on First: its branch sits on origin/first-branch (the old base), whose PR the gh shim reports as MERGED,
// and origin/main has since moved by one commit (the squash of First). Returns the shim, the old base and the new main tip.
function stackedMergedRepo() {
  const { repo } = openUnitRepo();
  const unit = JSON.parse(readFileSync(unitPath(repo), "utf8"));
  git(repo, "checkout", "-q", "-b", "first-branch");
  writeFileSync(join(repo.dir, "first.txt"), "first\n");
  git(repo, "add", "first.txt");
  git(repo, "commit", "-q", "-m", "first");
  git(repo, "push", "-q", "origin", "first-branch");
  const oldBase = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "-B", unit.branch, "origin/first-branch");
  writeFileSync(join(repo.dir, "second.txt"), "second\n");
  git(repo, "add", "second.txt");
  git(repo, "commit", "-q", "-m", "second");
  const stacked = { ...unit, base: "first-branch", baseSha: oldBase, stackedOn: { unit: "First", pr: FAKE_PR_URL, branch: "first-branch" } };
  writeFileSync(unitPath(repo), `${JSON.stringify(stacked, null, 2)}\n`);
  const newMain = pushFromSecondClone(repo, "squash.txt");
  const shim = installGhShim();
  const ghEnv = shim.env(viewsEnv({ [FAKE_PR_URL]: { head: "first-branch", state: "MERGED" } }));
  return { repo, shim, ghEnv, oldBase, newMain, branch: unit.branch };
}
const removeAll = (repo, shim) => {
  for (const dir of [repo.dir, repo.remoteDir, shim.dir]) rmSync(dir, { recursive: true, force: true });
};
const statusWith = (repo, ghEnv) => pbWithEnv(repo, ghEnv, "unit", "status");

describe("pb-unit-status-cli", () => {
  test("cli-refuses-when-no-unit-open", () => {
    const repo = makeRepo(REMOTE_REPO);
    assert.equal(existsSync(unitPath(repo)), false, "no unit.json exists");

    const result = pb(repo, "unit", "status");

    const output = outputOf(result);
    assert.equal(result.code, 1, `pb unit status refuses with the deliberate refusal exit code: ${output}`);
    assert.doesNotMatch(output, /unexpected failure|unknown|usage/i, "the refusal is deliberate, not the catch-all or an unknown command");
    assert.match(output, /no unit is open/i, "the refusal says no unit is open");
  });
  test("cli-current-exits-ok", () => {
    const { repo, originTip } = openUnitRepo();

    const result = pb(repo, "unit", "status");

    assert.equal(result.code, 0, `pb unit status exits 0 when the base has not moved: ${outputOf(result)}`);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, status: "current", base: "main", baseSha: originTip }, "the JSON reports current with the base and its tip");
  });
  test("cli-refuses-when-fetch-fails", () => {
    const { repo } = openUnitRepo();
    const unitBefore = readFileSync(unitPath(repo), "utf8");
    git(repo, "remote", "set-url", "origin", join(repo.dir, "no-such-remote"));

    const result = pb(repo, "unit", "status");

    assertDeliberateRefusal(result, /git fetch failed/i, "the refusal says git fetch failed", repo, unitBefore);
    assert.match(outputOf(result), /Nothing was touched: (?:fatal: )?[^\n]*(does not appear to be a git repository|No such file|not found)/i, "the refusal carries git's own stderr after the nothing-touched line");
  });
  test("cli-refuses-deliberately-when-base-gone", () => {
    const { repo } = openUnitRepo();
    const unitBefore = readFileSync(unitPath(repo), "utf8");
    git(repo, "checkout", "-q", "-b", "other");
    gitIn(repo.remoteDir, "branch", "-q", "-D", "main");
    git(repo, "remote", "prune", "origin");

    const result = pb(repo, "unit", "status");

    assertDeliberateRefusal(result, /gone from the remote/i, "the refusal says the base is gone from the remote", repo, unitBefore);
  });
  test("cli-moved-refuses-with-recipe-and-writes-nothing", () => {
    const { repo, originTip: oldSha } = openUnitRepo();
    const unitBefore = readFileSync(unitPath(repo), "utf8");
    const unitBranch = JSON.parse(unitBefore).branch;
    const newSha = pushFromSecondClone(repo, "newer.txt");

    const result = pb(repo, "unit", "status");

    assertDeliberateRefusal(result, /moved/i, "the refusal says the base moved", repo, unitBefore);
    const output = outputOf(result);
    assert.ok(output.includes(oldSha), `the refusal names the old SHA ${oldSha}: ${output}`);
    assert.ok(output.includes(newSha), `the refusal names the new SHA ${newSha}: ${output}`);
    assert.ok(output.split("\n").some((line) => line.trim() === `git rebase --onto origin/main ${oldSha} ${unitBranch}`), `the output has the rebase recipe line: ${output}`);
  });
  test("cli-makes-no-rebase-or-push", () => {
    const { repo } = openUnitRepo();
    const unitBranch = JSON.parse(readFileSync(unitPath(repo), "utf8")).branch;
    pushFromSecondClone(repo, "newer.txt");
    const originRefs = () => gitIn(repo.remoteDir, "for-each-ref");
    const before = { head: git(repo, "rev-parse", "HEAD"), tip: git(repo, "rev-parse", unitBranch), branches: git(repo, "branch", "--list"), origin: originRefs() };

    const result = pb(repo, "unit", "status");

    assert.equal(result.code, 1, `pb unit status refuses on the moved base: ${outputOf(result)}`);
    assert.match(outputOf(result), /moved/i, "the command took the moved path");
    assert.equal(git(repo, "rev-parse", "HEAD"), before.head, "HEAD is unchanged");
    assert.equal(git(repo, "rev-parse", unitBranch), before.tip, "the unit branch tip is unchanged");
    assert.equal(git(repo, "branch", "--list"), before.branches, "the local branch list is unchanged");
    assert.equal(originRefs(), before.origin, "every ref on the bare origin is unchanged");
  });
  test("cli-reconciled-updates-unit-json", () => {
    const { repo, originTip: oldSha } = openUnitRepo();
    const unitBefore = JSON.parse(readFileSync(unitPath(repo), "utf8"));
    const newSha = pushFromSecondClone(repo, "newer.txt");
    git(repo, "fetch", "-q", "origin");
    git(repo, "rebase", "--onto", "origin/main", oldSha, unitBefore.branch);

    const result = pb(repo, "unit", "status");

    assert.equal(result.code, 0, `pb unit status exits 0 once the unit is rebased: ${outputOf(result)}`);
    const { ok, status, base, baseSha, unstack } = JSON.parse(result.stdout);
    assert.deepEqual({ ok, status, base, baseSha, unstack }, { ok: true, status: "reconciled", base: "main", baseSha: newSha, unstack: false }, "the JSON reports reconciled with the base and its new tip, without unstacking");
    assert.deepEqual(JSON.parse(readFileSync(unitPath(repo), "utf8")), { ...unitBefore, baseSha: newSha }, "unit.json has the new baseSha and nothing else changed");
  });
  test("cli-stacked-dependency-merged-path", (t) => {
    const { repo, shim, ghEnv, oldBase, newMain, branch } = stackedMergedRepo();
    t.after(() => removeAll(repo, shim));
    const unitBefore = readFileSync(unitPath(repo), "utf8");

    const refused = statusWith(repo, ghEnv);

    assertDeliberateRefusal(refused, /First's PR merged/i, "the refusal says First's PR merged", repo, unitBefore);
    assert.ok(outputOf(refused).split("\n").some((line) => line.trim() === `git rebase --onto origin/main ${oldBase} ${branch}`), `the output has the rebase recipe line: ${outputOf(refused)}`);
    const views = shim.prViews();
    assert.equal(views.length, 1, "gh pr view ran exactly once");
    assert.equal(views[0].argv.at(-1), FAKE_PR_URL, "the one view names the dependency PR url");
    assert.equal(views[0].argv.at(-2), "--", "the url follows a -- separator");

    git(repo, "rebase", "--onto", "origin/main", oldBase, branch);
    const reconciled = statusWith(repo, ghEnv);

    assert.equal(reconciled.code, 0, `pb unit status exits 0 once the unit is rebased: ${outputOf(reconciled)}`);
    assert.equal(JSON.parse(reconciled.stdout).status, "reconciled", "the JSON reports reconciled");
    assert.equal(JSON.parse(reconciled.stdout).unstack, true, "the JSON reports the unit was unstacked");
    const { stackedOn, ...unstackedBefore } = JSON.parse(unitBefore);
    assert.deepEqual(JSON.parse(readFileSync(unitPath(repo), "utf8")), { ...unstackedBefore, base: "main", baseSha: newMain }, "unit.json is on main at the new tip, without stackedOn, and nothing else changed");
  });
  test("cli-refuses-when-gh-fails-for-stacked-unit", (t) => {
    const { repo, shim, ghEnv } = stackedMergedRepo();
    t.after(() => removeAll(repo, shim));
    const unitBefore = readFileSync(unitPath(repo), "utf8");

    const result = statusWith(repo, { ...ghEnv, GH_SHIM_FAIL: "pr view" });

    assertDeliberateRefusal(result, /dependency PR could not be checked/i, "the refusal says the dependency PR could not be checked", repo, unitBefore);
    assert.match(outputOf(result), /Nothing was changed but the fetch/, "the refusal says only the fetch ran");
    assert.doesNotMatch(outputOf(result), /cannot open/i, "the unit is already open, so the refusal does not say it cannot open");
    const views = shim.prViews();
    assert.equal(views.length, 1, "gh pr view was tried once");
    assert.equal(views[0].argv.at(-1), FAKE_PR_URL, "the one view names the dependency PR url");
  });
  test("cli-refuses-when-unstacked-base-unknown", (t) => {
    // The merged dependency drops the stack, so the unit falls back to the default base, which is unknown without origin/HEAD.
    const { repo, shim, ghEnv } = stackedMergedRepo();
    t.after(() => removeAll(repo, shim));
    git(repo, "remote", "set-head", "origin", "-d");
    git(repo, "config", "remote.origin.followRemoteHEAD", "never");
    const unitBefore = readFileSync(unitPath(repo), "utf8");

    const result = statusWith(repo, ghEnv);

    assertDeliberateRefusal(result, /base branch cannot be told/i, "the refusal says the base branch cannot be told", repo, unitBefore);
    assert.ok(!outputOf(result).split("\n").some((line) => line.trim().startsWith("git rebase --onto")), "no rebase recipe is printed");
  });
  test("cli-refuses-when-explicit-unstacked-base-gone-from-remote", (t) => {
    const { repo, shim, ghEnv } = stackedMergedRepo();
    t.after(() => removeAll(repo, shim));
    const configPath = join(repo.dir, ".pairingbuddy", "git-config.json");
    writeFileSync(configPath, JSON.stringify({ pr: { base_branch: "no-such-base" } }));
    const unitBefore = readFileSync(unitPath(repo), "utf8");

    const result = statusWith(repo, ghEnv);

    assertDeliberateRefusal(result, /is gone from the remote/i, "the refusal says the configured base is gone from the remote", repo, unitBefore);
    assert.ok(!outputOf(result).split("\n").some((line) => line.trim().startsWith("git rebase --onto")), "no rebase recipe is printed");
  });
  test("cli-open-dependency-reconciles-when-head-already-has-the-moved-tip", (t) => {
    const { repo, shim, ghEnv, branch } = stackedMergedRepo();
    t.after(() => removeAll(repo, shim));
    const openEnv = shim.env(viewsEnv({ [FAKE_PR_URL]: { head: "first-branch", state: "OPEN" } }));
    const unitBefore = JSON.parse(readFileSync(unitPath(repo), "utf8"));
    git(repo, "checkout", "-q", "first-branch");
    writeFileSync(join(repo.dir, "first-more.txt"), "more\n");
    git(repo, "add", "first-more.txt");
    git(repo, "commit", "-q", "-m", "first more");
    git(repo, "push", "-q", "origin", "first-branch");
    const newTip = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "-q", branch);
    git(repo, "rebase", "-q", "--onto", "first-branch", unitBefore.baseSha, branch);

    const result = statusWith(repo, openEnv);

    assert.equal(result.code, 0, `pb unit status exits 0 once the unit is rebased: ${outputOf(result)}`);
    assert.equal(JSON.parse(result.stdout).status, "reconciled", "the JSON reports reconciled");
    const after = JSON.parse(readFileSync(unitPath(repo), "utf8"));
    assert.deepEqual(after.stackedOn, unitBefore.stackedOn, "the unit stays stacked");
    assert.equal(after.baseSha, newTip, "baseSha is the new dependency tip");
  });
});

// The unit.json `pb unit status` is expected to write after reconciling a rebased unit: the new base tip, the rebased commits,
// each task's head sha remapped (the first task now starts at the new main tip, the second ends at the new second commit)
// and the rebase suite; nothing else changes.
function expectedReconciledUnit({ unitBefore, newMain, newFirst, newSecond }, rebaseSuite) {
  const newHeads = [newMain, newSecond];
  return {
    ...unitBefore,
    baseSha: newMain,
    commits: [newFirst, newSecond],
    tasks: unitBefore.tasks.map((task, i) => ({ ...task, headSha: newHeads[i] })),
    rebaseSuite,
  };
}

// Scenario: unit-status-rebase-cli. CLI wiring only, in temp repos from cli-repo-fixture (fake.mjs chooses pass/fail).
describe("unit-status-rebase-cli", () => {
  test("reconciled-remaps-and-records-suite", () => {
    const fixture = rebasedUnitRepo();
    const { repo, unitFile, newSecond } = fixture;

    const result = pb(repo, "unit", "status");

    assert.equal(result.code, 0, `pb unit status exits 0 after a clean rebase: ${outputOf(result)}`);
    const rebaseSuite = { passed: true, head: newSecond };
    assert.deepEqual(JSON.parse(result.stdout).rebaseSuite, rebaseSuite, "the OK JSON includes the rebase suite at the new HEAD");
    const unit = JSON.parse(readFileSync(unitFile, "utf8"));
    assert.deepEqual(unit, expectedReconciledUnit(fixture, rebaseSuite), "unit.json records the new base tip, the rebased commits, remapped task head shas and the rebase suite at the new HEAD, and nothing else changed");
  });

  test("reconciled-failing-suite-recorded-and-refuses", () => {
    const fixture = rebasedUnitRepo({ suiteExitCode: 1 });
    const { repo, unitFile, newSecond } = fixture;

    const result = pb(repo, "unit", "status");

    const output = outputOf(result);
    assert.equal(result.code, 1, `pb unit status refuses with the deliberate refusal exit code: ${output}`);
    assert.doesNotMatch(output, /unexpected failure/i, "the refusal is deliberate, not the catch-all");
    assert.match(output, /full suite/i, "the refusal names the full suite");
    assert.match(output, /exit(ed)?( code)?\D{0,5}1\b/i, "the refusal names the suite's exit code 1");
    assert.match(output, /publish/i, "the refusal says publish refuses until a full suite passes");
    assert.ok(output.includes(newSecond.slice(0, 7)), `the refusal names the new HEAD ${newSecond}: ${output}`);
    assert.deepEqual(JSON.parse(readFileSync(unitFile, "utf8")), expectedReconciledUnit(fixture, { passed: false, head: newSecond }), "unit.json records the new base, the rebased commits and the failed rebase suite at the new HEAD");
  });

  test("reconciled-stale-config-refuses-nothing-written", () => {
    const { repo, unitFile } = rebasedUnitRepo();
    const configPath = join(repo.dir, ".pairingbuddy", "test-config.json");
    writeFileSync(configPath, `${readFileSync(configPath, "utf8")}\n`);
    const unitBefore = readFileSync(unitFile, "utf8");

    const result = pb(repo, "unit", "status");

    assertDeliberateRefusal(result, /config hash changed/i, "the refusal names the config hash change", repo, unitBefore);
  });

  test("reconciled-refusal-leaves-unit-unchanged", () => {
    const { repo, unitFile } = rebasedUnitRepo({ suiteExitCode: 1 });
    writeFileSync(join(repo.dir, "extra.txt"), "extra\n");
    git(repo, "add", "extra.txt");
    git(repo, "commit", "-q", "-m", "extra commit outside the unit record");
    const extra = git(repo, "rev-parse", "HEAD");
    const unitBefore = readFileSync(unitFile, "utf8");

    const result = pb(repo, "unit", "status");

    assertDeliberateRefusal(result, /not in the unit record/i, "the refusal says a commit is not in the unit record", repo, unitBefore);
    assert.ok(outputOf(result).includes(extra.slice(0, 7)), `the refusal names the extra commit ${extra}: ${outputOf(result)}`);
    assert.doesNotMatch(outputOf(result), /full suite/i, "no suite ran: the refusal is the remap one, not the failing-suite one");
  });

  test("reconciled-no-tasks-skips-suite", () => {
    const { repo, unitFile, unitBefore, newMain } = rebasedUnitRepo({ suiteExitCode: 1 });
    const noTasks = { ...unitBefore, tasks: [], commits: [] };
    writeFileSync(unitFile, `${JSON.stringify(noTasks, null, 2)}\n`);

    const result = pb(repo, "unit", "status");

    assert.equal(result.code, 0, `pb unit status exits 0 for a rebased unit with no tasks, so no failing suite ran: ${outputOf(result)}`);
    assert.equal("rebaseSuite" in JSON.parse(result.stdout), false, "the OK JSON has no rebaseSuite");
    assert.deepEqual(JSON.parse(readFileSync(unitFile, "utf8")), { ...noTasks, baseSha: newMain }, "unit.json has only the new baseSha changed, with no rebaseSuite");
  });

  test("reconciled-refuses-merge-instead-of-rebase", () => {
    const { repo, unitFile } = rebasedUnitRepo({ reconcile: "merge" });
    const mergeSha = git(repo, "rev-parse", "HEAD");
    const unitBefore = readFileSync(unitFile, "utf8");

    const result = pb(repo, "unit", "status");

    assertDeliberateRefusal(result, /rebase instead of merging/i, "the refusal says to rebase instead of merging", repo, unitBefore);
    assert.ok(outputOf(result).includes(mergeSha.slice(0, 7)), `the refusal names the merge commit ${mergeSha}: ${outputOf(result)}`);
  });

  test("reconciled-remaps-a-commit-with-a-large-diff", () => {
    const fixture = rebasedUnitRepo({ secondFileContent: "x".repeat(2 * 1024 * 1024) });
    const { repo, unitFile, newFirst, newSecond } = fixture;

    const result = pb(repo, "unit", "status");

    assert.equal(result.code, 0, `pb unit status exits 0 for a recorded commit with a 2 MB diff: ${outputOf(result).slice(0, 500)}`);
    assert.deepEqual(JSON.parse(readFileSync(unitFile, "utf8")).commits, [newFirst, newSecond], "unit.json records the rebased commits");
  });
});
