import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadStages } from "../../shared-node/stages.mjs";
import { classOf, matchVerb } from "../../shared-node/verbs.mjs";
import { updateLedger, validateLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { baseLedger } from "./ledger-fixture.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLEAN_BODY, CLEAN_TITLE, COORDINATION, approvedThroughTap, draftKey, keepLocalThroughTap, setPolicyThroughGate } from "./publish-fixture.mjs";
import { PrLintRunRefused, readPrSubject } from "../../shared-node/pr-lint-run.mjs";
import { violations } from "./schema-check.mjs";
import { pb } from "./cli-repo-fixture.mjs";
import { sha256 } from "./tap-fixture.mjs";
import { BASE, BRANCH, OLD_BODY, OLD_TITLE, PR_NUMBER, approvedRefresh, git, lintedRefresh, pbWithEnv, refreshRepo, refreshRunOnDraft } from "./refresh-fixture.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

// Contracts: stages.json, verbs.mjs, ledger.mjs

test("stages-refresh-task-type", () => {
  const refresh = loadStages(ROOT).taskTypes.refresh;

  assert.deepEqual(refresh?.nodes, [{ name: "pr-draft", gate: "G:publish", evidence: ["artifact:draft-pull-request"] }], "refresh has the single pr-draft node");
  assert.deepEqual(refresh?.gates, { "G:publish": { class: "continue" } }, "refresh has only the G:publish continue gate");
});

test("verb-pr-refresh-main-class", () => {
  assert.equal(matchVerb(["pr", "refresh"]), "pr refresh", "pr refresh is a known two-word verb");
  assert.equal(classOf("pr refresh"), "main", "pr refresh runs in the main session");
});

test("ledger-refresh-kind-task-type", () => {
  const refreshRun = { ...baseLedger(), kind: "refresh", taskType: "refresh" };
  const refreshWithPublishType = { ...baseLedger(), kind: "refresh", taskType: "publish" };
  const codeWithRefreshType = { ...baseLedger(), kind: "code", taskType: "refresh" };

  assert.deepEqual(validateLedger(refreshRun), { valid: true, errors: [] }, "kind refresh with taskType refresh is valid");
  assert.deepEqual(validateLedger(refreshWithPublishType).errors.map((e) => e.path), ["taskType"], "kind refresh with taskType publish is invalid on taskType");
  assert.deepEqual(validateLedger(codeWithRefreshType).errors.map((e) => e.path), ["taskType"], "kind code with taskType refresh is invalid on taskType");
});

// pb pr refresh, phase 1 (open)

test("open-writes-record-and-run", () => {
  const { repo, gh, headSha, ghEnv, url } = refreshRepo();
  const baseSha = git(repo, "merge-base", "HEAD", "refs/remotes/origin/main");

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  const runDir = join(repo.dir, ".pairingbuddy", "run");
  assert.equal(result.code, 0, `pb pr refresh exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.deepEqual({ ok: out?.ok, result: out?.result, kind: out?.kind }, { ok: true, result: "opened", kind: "refresh" }, "it reports a refresh run opened");
  assert.deepEqual(JSON.parse(readFileSync(join(runDir, "refresh.json"), "utf8")), { url, number: PR_NUMBER, branch: BRANCH, base: BASE, baseSha, headSha, title: OLD_TITLE }, "refresh.json records the PR");
  assert.equal(readFileSync(join(runDir, "refresh-body.md"), "utf8"), OLD_BODY, "refresh-body.md holds the old body");
  const ledger = JSON.parse(readFileSync(join(runDir, "task", "ledger.json"), "utf8"));
  assert.deepEqual({ kind: ledger.kind, taskType: ledger.taskType }, { kind: "refresh", taskType: "refresh" }, "the ledger is a refresh run");
  assert.equal(existsSync(join(runDir, "unit.json")), false, "no unit.json is created");
  assert.equal(gh.prViews().length, 1, "gh pr view is called once");
  assert.ok(ledger.task.includes(url), `the ledger task names the PR url: ${ledger.task}`);
  const views = gh.calls().filter(({ argv }) => argv[0] === "pr" && argv[1] === "view");
  assert.deepEqual(views.map(({ argv }) => argv), [["pr", "view", "--json", "url,number,title,body,headRefName,baseRefName,headRefOid,state", "--", BRANCH]], "the one gh pr view asks for the fields the refresh needs, for the branch");
});

test("open-base-ref-prefers-remote", () => {
  const { repo, ghEnv } = refreshRepo();
  git(repo, "branch", "-f", BASE, "HEAD~1");
  const remoteBaseSha = git(repo, "merge-base", "HEAD", `refs/remotes/origin/${BASE}`);
  const localBaseSha = git(repo, "merge-base", "HEAD", `refs/heads/${BASE}`);
  assert.notEqual(remoteBaseSha, localBaseSha, "the setup makes the local and the remote base differ");

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assert.equal(result.code, 0, `pb pr refresh exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  const record = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "refresh.json"), "utf8"));
  assert.equal(record.baseSha, remoteBaseSha, "baseSha is the merge-base with the remote-tracking base, not the local branch");
});

// A refused phase 1: exit 1, stderr names what refused, no refresh.json was written. By default gh was not asked;
// viewed: true says the refusal came after exactly one gh call, and that call was pr view.
function assertRefused({ repo, gh, result, names, viewed = false }) {
  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "the refusal is deliberate, not the catch-all branch");
  assert.match(result.stderr, names, "stderr names what refused");
  assert.equal(existsSync(join(repo.dir, ".pairingbuddy", "run", "refresh.json")), false, "no refresh.json was written");
  if (viewed) {
    assert.equal(gh.calls().length, 1, "gh was called exactly once");
    assert.equal(gh.prViews().length, 1, "the one gh call was pr view");
  } else {
    assert.deepEqual(gh.calls(), [], "gh was not called");
  }
}

// A refusal that also left no run behind.
function assertRefusedUntouched(args) {
  assertRefused(args);
  assert.equal(existsSync(join(args.repo.dir, ".pairingbuddy", "run", "task")), false, "no run/task dir was created");
}

// A refusal that came after the PR view and also left no run behind.
function assertRefusedAfterView(args) {
  assertRefusedUntouched({ ...args, viewed: true });
}

// A repo already holding a code run; ledgerExtra adjusts its ledger.
function openRunRepo(ledgerExtra = {}) {
  const fixture = refreshRepo();
  const ledgerPath = join(fixture.repo.dir, ".pairingbuddy", "run", "task", "ledger.json");
  mkdirSync(join(fixture.repo.dir, ".pairingbuddy", "run", "task", "artifacts"), { recursive: true });
  writeLedger(ledgerPath, { ...baseLedger(), kind: "code", taskType: "feature", ...ledgerExtra });
  return { ...fixture, ledgerPath, before: readFileSync(ledgerPath) };
}

// A refusal that left the existing run's ledger byte-identical.
function assertRefusedKeepingRun({ ledgerPath, before, ...args }) {
  assertRefused(args);
  assert.deepEqual(readFileSync(ledgerPath), before, "the existing run's ledger is byte-identical");
}

test("open-refuses-when-a-unit-is-open", () => {
  const { repo, gh, ghEnv } = refreshRepo();
  mkdirSync(join(repo.dir, ".pairingbuddy", "run"), { recursive: true });
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), JSON.stringify({ branch: BRANCH, tasks: [] }));

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assertRefusedUntouched({ repo, gh, result, names: /run\/unit\.json/ });
});

test("open-refuses-when-a-run-is-open", () => {
  const { repo, gh, ghEnv, ledgerPath, before } = openRunRepo();

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assertRefusedKeepingRun({ repo, gh, result, names: /run is already active at .*run\/task/, ledgerPath, before });
});

test("open-refuses-when-the-run-is-stopped", () => {
  const { repo, gh, ghEnv, ledgerPath, before } = openRunRepo({ stop: { reason: "hook refused the commit", seq: 1, code: "commit-failed" } });

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assertRefusedKeepingRun({ repo, gh, result, names: /run is already active at .*run\/task/, ledgerPath, before });
});

test("open-refuses-when-the-branch-is-protected", () => {
  const { repo, gh, ghEnv } = refreshRepo();
  writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ protected_branches: [BRANCH] }));

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assertRefusedUntouched({ repo, gh, result, names: new RegExp(`protected.*${BRANCH}|${BRANCH}.*protected`) });
});

test("open-refuses-when-the-branch-is-detached", () => {
  const { repo, gh, ghEnv } = refreshRepo();
  git(repo, "checkout", "-q", "--detach");

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assertRefusedUntouched({ repo, gh, result, names: /detached HEAD/ });
});

test("open-refuses-when-the-tree-is-dirty", () => {
  const { repo, gh, ghEnv } = refreshRepo();
  writeFileSync(join(repo.dir, "one.txt"), "one, edited and not committed\n");

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assertRefusedUntouched({ repo, gh, result, names: /one\.txt/ });
});

test("open-refuses-when-gh-pr-view-fails", () => {
  const { repo, gh, ghEnv } = refreshRepo();

  const result = pbWithEnv(repo, ghEnv({ GH_SHIM_FAIL: "pr view" }), "pr", "refresh");

  assertRefusedAfterView({ repo, gh, result, names: /gh pr view/ });
});

test("open-refuses-when-gh-pr-view-is-not-json", () => {
  const { repo, gh, ghEnv } = refreshRepo();

  const result = pbWithEnv(repo, ghEnv({ GH_SHIM_VIEW: "not json" }), "pr", "refresh");

  assertRefusedAfterView({ repo, gh, result, names: /not JSON/ });
});

test("open-refuses-when-there-is-no-pr", () => {
  const { repo, gh } = refreshRepo();

  // gh.env() sets no GH_SHIM_VIEW, so the shim answers pr view with "no pull requests found".
  const result = pbWithEnv(repo, gh.env(), "pr", "refresh");

  assertRefusedAfterView({ repo, gh, result, names: /no pull requests found/ });
});

test("open-refuses-when-the-pr-head-ref-is-not-the-current-branch", () => {
  const { repo, gh, ghEnv } = refreshRepo({ view: { head: "someone/else" } });

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assertRefusedAfterView({ repo, gh, result, names: /someone\/else/ });
  assert.match(result.stderr, new RegExp(BRANCH), "stderr names the current branch");
});

test("open-refuses-when-the-pr-is-not-open", () => {
  const { repo, gh, ghEnv } = refreshRepo({ view: { state: "MERGED" } });

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assertRefusedAfterView({ repo, gh, result, names: /MERGED/ });
});

test("open-refuses-when-pr-head-is-not-head", () => {
  const { repo, gh, ghEnv } = refreshRepo();
  const prHeadSha = git(repo, "rev-parse", "HEAD~1");
  const remoteRefsBefore = git(repo, "ls-remote", "origin");

  const result = pbWithEnv(repo, ghEnv({}, { headRefOid: prHeadSha }), "pr", "refresh");

  assertRefusedAfterView({ repo, gh, result, names: /differs from HEAD/ });
  assert.match(result.stderr, /push/, "stderr says to push the review fixes first");
  assert.equal(git(repo, "ls-remote", "origin"), remoteRefsBefore, "nothing was pushed: the remote refs are unchanged");
});

test("open-refuses-when-neither-base-ref-exists", () => {
  const { repo, gh, ghEnv } = refreshRepo({ view: { base: "no-such-base" } });

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assertRefusedAfterView({ repo, gh, result, names: /no-such-base/ });
  assert.equal(existsSync(join(repo.dir, ".pairingbuddy", "run", "refresh-body.md")), false, "no refresh-body.md was written");
});

// Readers that work from the refresh record in a refresh run (no unit.json)

test("pr-lint-without-unit", () => {
  const { repo, runDir } = refreshRunOnDraft();

  const result = pb(repo, "pr", "lint");

  assert.equal(result.code, 0, `pb pr lint exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).ok, true, "the clean draft lints ok");
  assert.equal(JSON.parse(readFileSync(join(runDir, "pr-lint.json"), "utf8")).bodyHash, sha256(CLEAN_BODY), "pr-lint.json binds the body by its sha256");
  assert.equal(existsSync(join(runDir, "unit.json")), false, "lint creates no unit.json");
});

test("snapshot-without-unit", () => {
  const { repo, runDir } = refreshRunOnDraft();
  const expectedBaseSha = git(repo, "merge-base", "HEAD", `refs/remotes/origin/${BASE}`);
  const expectedDiff = git(repo, "diff", `${expectedBaseSha}..HEAD`);

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  const subjectDiff = readFileSync(join(runDir, "subject.diff"), "utf8");
  assert.notEqual(subjectDiff.trim(), "", "subject.diff is non-empty");
  assert.ok(subjectDiff.includes("one.txt"), "subject.diff names the PR's first committed file");
  assert.ok(subjectDiff.includes("two.txt"), "subject.diff names the PR's second committed file");
  assert.equal(subjectDiff.trim(), expectedDiff.trim(), "subject.diff is git diff from the merge-base with the remote base to HEAD");
  assert.equal(existsSync(join(runDir, "unit.json")), false, "snapshot creates no unit.json");
});

test("rollback-artifact-in-refresh", () => {
  const { repo, runDir } = refreshRunOnDraft();
  const fixKey = "pr-draft.fix.g1.r2.a1";
  const badBody = "A seamless upgrade of the export.\n";
  const artifactsDir = join(runDir, "task", "artifacts");
  writeFileSync(join(artifactsDir, `${fixKey}.json`), JSON.stringify({ pb_key: fixKey, title: "feat: export", body: badBody, labels: [], base: BASE, coordination: null }));
  writeFileSync(join(runDir, "pr-body.md"), badBody);
  const lint = pb(repo, "pr", "lint");
  assert.equal(JSON.parse(lint.stdout).ok, false, `the hype body fails the lint, stdout ${lint.stdout}, stderr ${lint.stderr}`);

  const result = pb(repo, "rollback", "--artifact", "--from", fixKey);

  assert.equal(result.code, 0, `pb rollback exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(existsSync(join(artifactsDir, `${fixKey}.json`)), false, "the redraft is gone from artifacts/");
  assert.equal(existsSync(join(runDir, "task", "rejected", `${fixKey}.json`)), true, "the redraft is in rejected/");
  assert.equal(readFileSync(join(runDir, "pr-body.md"), "utf8"), CLEAN_BODY, "the first draft's body is back in pr-body.md");
  const ledger = JSON.parse(readFileSync(join(runDir, "task", "ledger.json"), "utf8"));
  assert.deepEqual(ledger.fixes.rollbacks, [{ key: fixKey, kind: "artifact", ref: null, sha: null, base: null }], "the rollback is recorded in the ledger");
  const out = JSON.parse(result.stdout);
  assert.deepEqual({ failedAttempts: out.failedAttempts, maxAttempts: out.maxAttempts }, { failedAttempts: 1, maxAttempts: 5 }, "it counts one failed attempt toward the cap of 5");
  assert.equal(existsSync(join(runDir, "unit.json")), false, "no unit.json is created");
});

test("pr-lint-refuses-without-subject", () => {
  const { repo } = refreshRepo();
  const lintPath = join(repo.dir, ".pairingbuddy", "run", "pr-lint.json");

  const result = pb(repo, "pr", "lint");

  assert.equal(result.code, 1, `pb pr lint refuses, stdout ${result.stdout}`);
  assert.match(result.stderr, /no unit is open/, "stderr says no unit is open");
  assert.equal(existsSync(lintPath), false, "no pr-lint.json is written");
});

// G:publish gate on a refresh run

test("gate-eval-asks-under-auto", () => {
  const { repo, runDir } = lintedRefresh();

  const result = pb(repo, "gate", "eval");

  assert.equal(result.code, 0, `pb gate eval exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.deepEqual({ result: out.result, gate: out.gate }, { result: "needs-human", gate: "G:publish" }, "under auto the refresh gate asks the human");
  assert.match(out.reason, /pull request refresh is approved by a human/, "the reason says a refresh needs a human");
  assert.deepEqual({ title: out.shown?.title, body: out.shown?.body, target: out.shown?.target }, { title: CLEAN_TITLE, body: CLEAN_BODY, target: BASE }, "it shows the draft title, body and the PR's base");
  const ledger = JSON.parse(readFileSync(join(runDir, "task", "ledger.json"), "utf8"));
  assert.equal(ledger.needsHuman?.gate, "G:publish", "the ledger records needsHuman for G:publish");
  assert.equal(Object.hasOwn(ledger.gates ?? {}, "G:publish"), false, "no auto pass is recorded");
});

test("gate-eval-target-is-the-pr-base", () => {
  const { repo, runDir } = lintedRefresh({ gitConfig: { pr: { base_branch: "develop" } } });
  const recordedBase = JSON.parse(readFileSync(join(runDir, "refresh.json"), "utf8")).base;
  assert.equal(recordedBase, BASE, "the refresh record holds the PR's base");

  const result = pb(repo, "gate", "eval");

  assert.equal(result.code, 0, `pb gate eval exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.shown?.target, recordedBase, "shown.target is the PR's base, not the configured pr.base_branch");
  assert.equal(out.shown?.base, recordedBase, "shown.base is the PR's base");
});

// pb pr refresh, phase 2 (apply)

test("apply-edits-title-and-body-no-push", () => {
  const { repo, gh, ghEnv, url, runDir } = approvedRefresh();
  const body = readFileSync(join(runDir, "pr-body.md"), "utf8");
  const remoteBefore = git(repo, "ls-remote", "origin");

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assert.equal(result.code, 0, `pb pr refresh exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.deepEqual({ result: out.result, url: out.url }, { result: "refreshed", url }, "it reports the PR refreshed, with its url");
  const edits = gh.calls().filter(({ argv }) => argv[0] === "pr" && argv[1] === "edit");
  assert.equal(edits.length, 1, "gh pr edit is called exactly once");
  const [edit] = edits;
  assert.equal(edit.argv.length, 7, `the edit has only the title and body flags, got ${edit.argv.join(" ")}`);
  assert.deepEqual([edit.argv.slice(0, 5), edit.argv[5]], [["pr", "edit", url, "--title", CLEAN_TITLE], "--body-file"], "the edit names the PR and sets the new title and body file");
  assert.equal(edit.bodyFile, body, "the body file holds run/pr-body.md");
  assert.equal(gh.calls().some(({ argv }) => argv[0] === "pr" && ["create", "ready"].includes(argv[1])), false, "no pr create or pr ready");
  assert.equal(git(repo, "ls-remote", "origin"), remoteBefore, "nothing was pushed: the remote refs are unchanged");
  for (const gone of ["task", "refresh.json", "refresh-body.md"]) assert.equal(existsSync(join(runDir, gone)), false, `run/${gone} is gone`);
});

test("apply-coordination-in-comment", () => {
  const { repo, gh, ghEnv, url, runDir } = refreshRunOnDraft();
  writeFileSync(join(runDir, "task", "artifacts", `${draftKey(1)}.json`), JSON.stringify({ pb_key: draftKey(1), title: CLEAN_TITLE, body: CLEAN_BODY, labels: [], base: BASE, coordination: COORDINATION }));
  updateLedger(join(runDir, "task", "ledger.json"), (ledger) => ({ ...ledger, stage: { name: "pr-draft", status: "done", runId: "r1", attempt: 1 }, stages: [{ name: "pr-draft", status: "done" }] }));
  setPolicyThroughGate(repo, "auto");
  assert.equal(pb(repo, "pr", "lint").code, 0, "the draft lints");
  approvedThroughTap(repo);

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assert.equal(result.code, 0, `pb pr refresh exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).result, "refreshed", "it reports the PR refreshed");
  const writes = gh.calls().filter(({ argv }) => argv[0] === "pr" && ["edit", "comment"].includes(argv[1]));
  assert.deepEqual(writes.map(({ argv }) => argv[1]), ["edit", "comment"], "one pr edit, then one pr comment");
  const [edit, comment] = writes;
  assert.equal(edit.bodyFile.includes(COORDINATION), false, "the PR body does not carry the coordination text");
  assert.deepEqual(comment.argv.slice(0, 4), ["pr", "comment", url, "--body-file"], "the comment names the PR and takes a body file");
  assert.equal(comment.bodyFile, COORDINATION, "the comment body is the coordination text");
});

test("apply-refuses-stale-approval", () => {
  const { repo, gh, ghEnv, runDir } = approvedRefresh();
  const ledgerPath = join(runDir, "task", "ledger.json");
  const approval = JSON.parse(readFileSync(ledgerPath, "utf8")).gates["G:publish"];
  writeFileSync(join(runDir, "pr-body.md"), `${CLEAN_BODY}\nEdited after the approval.\n`);

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.match(result.stderr, /no longer holds/, "stderr says the approval no longer holds");
  assert.match(result.stderr, /pr-body\.md changed/, "stderr names the changed body");
  assert.equal(gh.calls().some(({ argv }) => argv[0] === "pr" && argv[1] === "edit"), false, "gh pr edit was not called");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  assert.equal(Object.hasOwn(ledger.gates ?? {}, "G:publish"), false, "the G:publish approval is no longer live");
  assert.deepEqual((ledger.voidedGates ?? []).map(({ record }) => record), [approval], "the approval moved to voidedGates");
  for (const kept of ["task", "refresh.json", "refresh-body.md"]) assert.equal(existsSync(join(runDir, kept)), true, `run/${kept} is still there`);
});

test("apply-refuses-when-the-run-is-stopped", () => {
  const { repo, gh, ghEnv, runDir } = approvedRefresh();
  const ledgerPath = join(runDir, "task", "ledger.json");
  updateLedger(ledgerPath, (ledger) => ({ ...ledger, stop: { reason: "hook refused the commit", seq: 1, code: "commit-failed" } }));

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.match(result.stderr, /not refreshed: the run stopped: hook refused the commit/, "stderr says the refresh refused because the run stopped, with the stop reason");
  assert.doesNotMatch(result.stderr, /unexpected failure/, "the refusal is deliberate, not the catch-all branch");
  assert.equal(gh.calls().some(({ argv }) => argv[0] === "pr" && argv[1] === "edit"), false, "gh pr edit was not called");
  for (const kept of ["task", "refresh.json", "refresh-body.md"]) assert.equal(existsSync(join(runDir, kept)), true, `run/${kept} is still there`);
});

test("apply-refuses-without-approval", () => {
  const { repo, gh, ghEnv, runDir } = lintedRefresh();

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.match(result.stderr, /G:publish/, "stderr names G:publish");
  assert.match(result.stderr, /no approval/, "stderr says G:publish has no approval");
  assert.equal(gh.calls().some(({ argv }) => argv[0] === "pr" && argv[1] === "edit"), false, "gh pr edit was not called");
  for (const kept of ["task", "refresh.json", "refresh-body.md"]) assert.equal(existsSync(join(runDir, kept)), true, `run/${kept} is still there`);
});

test("apply-refuses-a-bound-auto-pass", () => {
  const { repo, gh, ghEnv, runDir } = approvedRefresh();
  const ledgerPath = join(runDir, "task", "ledger.json");
  updateLedger(ledgerPath, (ledger) => ({ ...ledger, gates: { ...ledger.gates, "G:publish": { ...ledger.gates["G:publish"], source: "auto" } } }));

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.match(result.stderr, /no approval/, "stderr says G:publish has no approval");
  assert.equal(gh.calls().some(({ argv }) => argv[0] === "pr" && argv[1] === "edit"), false, "gh pr edit was not called");
});

test("open-cleans-up-when-a-record-write-fails", () => {
  const { repo, ghEnv } = refreshRepo();
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  mkdirSync(join(runDir, "refresh-body.md"), { recursive: true });

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assert.notEqual(result.code, 0, `the open fails, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(existsSync(join(runDir, "task")), false, "no run/task is left");
  assert.equal(existsSync(join(runDir, "refresh.json")), false, "no refresh.json is left");
});

test("pr-subject-prefers-the-unit", () => {
  const { repo } = refreshRepo();
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "unit.json"), JSON.stringify({ from: "unit" }));
  writeFileSync(join(runDir, "refresh.json"), JSON.stringify({ from: "refresh" }));

  const subject = readPrSubject(repo.dir);

  assert.deepEqual(subject, { from: "unit" }, "the unit wins over the refresh record");
});

test("pr-subject-refuses-with-neither", () => {
  const { repo } = refreshRepo();

  assert.throws(() => readPrSubject(repo.dir), (e) => e instanceof PrLintRunRefused && /no unit is open/.test(e.message), "no unit and no refresh record is refused as no unit open");
});

test("refresh-ledger-validates-against-the-schema", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "contracts", "schemas", "ledger.schema.json"), "utf8"));
  const ledger = { ...baseLedger(), kind: "refresh", taskType: "refresh" };

  assert.deepEqual(violations(schema, ledger), [], "the JSON schema accepts a refresh ledger");
});

test("apply-refuses-when-gh-pr-edit-fails", () => {
  const { repo, gh, ghEnv, runDir } = approvedRefresh();
  const ledgerPath = join(runDir, "task", "ledger.json");
  const approval = JSON.parse(readFileSync(ledgerPath, "utf8")).gates["G:publish"];

  const result = pbWithEnv(repo, ghEnv({ GH_SHIM_FAIL: "pr edit" }), "pr", "refresh");

  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "the refusal is deliberate, not the catch-all branch");
  assert.match(result.stderr, /gh pr edit/, "stderr names gh pr edit");
  assert.equal(gh.calls().some(({ argv }) => argv[0] === "pr" && argv[1] === "comment"), false, "no gh pr comment was called");
  for (const kept of ["task", "refresh.json", "refresh-body.md"]) assert.equal(existsSync(join(runDir, kept)), true, `run/${kept} is still there`);
  assert.deepEqual(JSON.parse(readFileSync(ledgerPath, "utf8")).gates["G:publish"], approval, "the G:publish approval is kept, so a retry works");
  const strays = readdirSync(runDir).filter((name) => /^pr-body\..*snapshot/.test(name));
  assert.deepEqual(strays, [], "no pr-body snapshot is left under run/");
});

test("apply-keep-local-ends-without-edit", () => {
  const { repo, gh, ghEnv, runDir } = lintedRefresh();
  keepLocalThroughTap(repo, gh);

  const result = pbWithEnv(repo, ghEnv(), "pr", "refresh");

  assert.equal(result.code, 0, `pb pr refresh exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.result, "kept-local", "it reports the refresh kept local");
  assert.match(out.reason, /left unchanged/, "the reason says the PR was left unchanged");
  const writes = gh.calls().filter(({ argv }) => argv[0] === "pr" && ["edit", "comment"].includes(argv[1]));
  assert.deepEqual(writes, [], "no pr edit and no pr comment");
  for (const gone of ["task", "refresh.json", "refresh-body.md"]) assert.equal(existsSync(join(runDir, gone)), false, `run/${gone} is gone`);
});

// Routing and guards

test("task-end-refused-in-a-refresh-run", () => {
  const { repo, runDir } = refreshRunOnDraft();
  const ledgerPath = join(runDir, "task", "ledger.json");
  const kept = ["refresh.json", "refresh-body.md"].map((name) => join(runDir, name));
  const before = [ledgerPath, ...kept].map((path) => readFileSync(path));

  const result = pb(repo, "task", "end");

  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "the refusal is deliberate, not the catch-all branch");
  assert.match(result.stderr, /refresh run has no task to end/, "stderr says a refresh run has no task to end");
  assert.match(result.stderr, /pr refresh/, "stderr names pr refresh");
  assert.deepEqual([ledgerPath, ...kept].map((path) => readFileSync(path)), before, "run/task ledger, refresh.json and refresh-body.md are untouched");
  assert.equal(existsSync(join(runDir, "unit.json")), false, "no unit.json was created");
});
