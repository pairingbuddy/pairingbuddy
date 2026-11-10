// Task 83b: pb rollback --from <key> and the "what went wrong" note. Every test drives the real CLI as a subprocess in a
// temp git repo.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { d17Denial } from "../../shared-node/d17.mjs";
import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { publishSteps, pushArgv, unitRefPrefix } from "../../shared-node/publish.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const STAGE = "safety-net";
const ATTEMPT = 1;
const FIX_KEY = `${STAGE}.fix.g1.r2.a${ATTEMPT}`;
const CHECKER_KEY = `${STAGE}.course-checker.g1.r2.a${ATTEMPT}`;
const rollbackRef = (n) => `refs/pairingbuddy/feature/rollback/${STAGE}/${n}`;
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

const NO_HOME = makeDir("pb-no-home-");
const gitEnv = () => ({ ...process.env, ...ISOLATED_GIT, HOME: NO_HOME, XDG_CONFIG_HOME: NO_HOME });
const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] }).trim();

const CONFIG = { source_directory: ".", runners: { fake: { name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [], selector_template: ["{test_file}::{test_function}"] } }, default_runner: "fake" };

function writeArtifact(repo, key, content) {
  writeFileSync(join(repo.taskDir, "artifacts", `${key}.json`), JSON.stringify(content));
}

// A repo on the unprotected branch `feature` holding a seed commit, the .pairingbuddy layout, a ledger and a course
// checker verdict that is not "better". With committedFix (the default) it also holds one fix commit of group g1,
// round 2 (src.mjs) with its checkpoint record, and HEAD is the fix commit. Without it HEAD stays on the seed.
// With seedArtifacts: false the fix and checker artifacts are not written (the artifact case writes its own).
function makeRepo({ committedFix = true, seedArtifacts = true, filesChanged = ["src.mjs"], verdict = "wrong-direction", whatWentWrong = "the fix renamed the helper instead of removing the duplication" } = {}) {
  const dir = makeDir("pb-rollback-");
  git(dir, "init", "-q", "-b", "feature");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, "src.mjs"), "original code\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "seed");
  const seed = git(dir, "rev-parse", "HEAD");
  let fixSha = null;
  if (committedFix) {
    writeFileSync(join(dir, "src.mjs"), "rejected fix\n");
    git(dir, "commit", "-q", "-am", "fix: rename the helper");
    fixSha = git(dir, "rev-parse", "HEAD");
  }

  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  const configText = JSON.stringify(CONFIG);
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), configText);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "new_feature",
    owner: { sessionId: null, lastSeen: null }, task: "Task 83b", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "", source: "" },
    stage: { name: STAGE, status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [], gates: {}, tests: { perTest: {} }, commits: committedFix ? [fixSha] : [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    checkpoints: committedFix ? [{ step: "fix", key: FIX_KEY, committed: true, sha: fixSha, stage: STAGE, attempt: ATTEMPT }] : [],
  });
  const repo = {
    dir, taskDir, seed, fixSha, ledgerPath,
    ledger: () => readLedger(ledgerPath),
    updateLedger: (change) => { const ledger = readLedger(ledgerPath); change(ledger); writeLedger(ledgerPath, ledger); },
    head: () => git(dir, "rev-parse", "HEAD"),
  };
  if (seedArtifacts) {
    writeArtifact(repo, FIX_KEY, { pb_key: FIX_KEY, ambiguity: "", commit_subject: "rename the helper", files_changed: filesChanged });
    writeArtifact(repo, CHECKER_KEY, { pb_key: CHECKER_KEY, finding_id: "duplication-1", verdict, mistake: "missed-finding", what_went_wrong: whatWentWrong });
  }
  return repo;
}

// Lands a further fix group on the current HEAD: a new commit of src.mjs, its checkpoint record (committed, sha in
// ledger.commits) and its course checker artifact. Returns the new commit sha.
function landFixGroup(repo, { group, round, content, verdict = "broke-something", whatWentWrong = `group ${group} went wrong` }) {
  const fixKey = `${STAGE}.fix.g${group}.r${round}.a${ATTEMPT}`;
  const checkerKey = `${STAGE}.course-checker.g${group}.r${round}.a${ATTEMPT}`;
  writeFileSync(join(repo.dir, "src.mjs"), content);
  git(repo.dir, "commit", "-q", "-am", `fix: group ${group}`);
  const sha = git(repo.dir, "rev-parse", "HEAD");
  repo.updateLedger((ledger) => {
    ledger.commits.push(sha);
    ledger.checkpoints.push({ step: "fix", key: fixKey, committed: true, sha, stage: STAGE, attempt: ATTEMPT });
  });
  writeArtifact(repo, fixKey, { pb_key: fixKey, ambiguity: "", commit_subject: `group ${group}`, files_changed: ["src.mjs"] });
  writeArtifact(repo, checkerKey, { pb_key: checkerKey, finding_id: `finding-${group}`, verdict, mistake: "missed-finding", what_went_wrong: whatWentWrong });
  return { sha, fixKey };
}

// The red-tests case: red tests refused the commit, so HEAD is still the seed, src.mjs is edited but uncommitted, and
// there is no checkpoint record for the fix key. The checkpoint test run in the ledger is the failed (red) one.
// With newFile the fix also created an untracked helper.mjs, and the fix artifact lists both files.
function makeRedRepo({ newFile = false, whatWentWrong, filesChanged = newFile ? ["src.mjs", "helper.mjs"] : ["src.mjs"] } = {}) {
  const repo = makeRepo({ committedFix: false, filesChanged, whatWentWrong });
  writeFileSync(join(repo.dir, "src.mjs"), "red fix, uncommitted\n");
  if (newFile) {
    writeFileSync(join(repo.dir, "helper.mjs"), "new helper\n");
  }
  repo.updateLedger((ledger) => {
    ledger.tests.checkpoint = {
      stage: STAGE, attempt: ATTEMPT, passed: false, red: true,
      runs: [{ runner: "fake", argv: [], exitCode: 1, signal: null, timedOut: false, durationMs: 1, excerpt: "FAIL tests/a.mjs: expected 3, got 4", excerptTruncated: false }],
    };
  });
  return repo;
}

// The artifact case: a stage with no commit (here `scenarios`, attempt 1). The fix artifact holds a redrafted return,
// there is no checkpoint record and HEAD stays on the seed.
const ARTIFACT_STAGE = "scenarios";
const ARTIFACT_FIX_KEY = `${ARTIFACT_STAGE}.fix.g1.r2.a${ATTEMPT}`;
const ARTIFACT_CHECKER_KEY = `${ARTIFACT_STAGE}.course-checker.g1.r2.a${ATTEMPT}`;
const REDRAFT = { pb_key: ARTIFACT_FIX_KEY, scenarios: [{ id: "redrafted", title: "a redrafted scenario" }] };
function makeArtifactRepo({ whatWentWrong }) {
  const repo = makeRepo({ committedFix: false, seedArtifacts: false });
  repo.updateLedger((ledger) => { ledger.stage.name = ARTIFACT_STAGE; });
  writeArtifact(repo, ARTIFACT_FIX_KEY, REDRAFT);
  writeArtifact(repo, ARTIFACT_CHECKER_KEY, { pb_key: ARTIFACT_CHECKER_KEY, finding_id: "coverage-1", verdict: "wrong-direction", mistake: "missed-finding", what_went_wrong: whatWentWrong });
  return repo;
}

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: gitEnv() });
  return { code: status, stdout, stderr };
}

const rollback = (repo, ...args) => pb(repo, "rollback", ...args);

const notePath = (repo) => join(repo.taskDir, "notes", `${STAGE}.md`);
const noteHeadings = (text) => text.split("\n").filter((line) => /^## Rollback \d+: /.test(line));

const outsidePairingbuddy = (dir) => git(dir, "status", "--porcelain", "--", ".", ":(exclude).pairingbuddy");

// Everything a refused rollback must leave alone, read before the call. .pairingbuddy/run is gitignored, so the note
// and the artifacts are read directly: git status never sees them.
function snapshot(repo) {
  const artifactsDir = join(repo.taskDir, "artifacts");
  return {
    note: existsSync(notePath(repo)) ? readFileSync(notePath(repo), "utf8") : null,
    artifacts: Object.fromEntries(readdirSync(artifactsDir).sort().map((name) => [name, readFileSync(join(artifactsDir, name), "utf8")])),
    head: repo.head(),
    status: git(repo.dir, "status", "--porcelain"),
    refs: git(repo.dir, "for-each-ref", "refs/pairingbuddy"),
    ledger: readFileSync(repo.ledgerPath, "utf8"),
  };
}

// A refusal prints "pb: ...", exits 1 with nothing on stdout, and touches nothing: same HEAD, same tree, no rollback
// ref, same ledger, note and artifacts. `before` is the snapshot taken just before the rollback call; `label` prefixes
// every message so a looped case names itself.
function assertRefused(repo, before, result, pattern, label = "") {
  const prefix = label ? `${label}: ` : "";
  assert.equal(result.code, 1, `${prefix}exits 1: stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(result.stdout, "", `${prefix}prints no result`);
  assert.match(result.stderr, /^pb: /, `${prefix}it is a refusal`);
  assert.match(result.stderr, pattern, `${prefix}it says why`);
  assert.doesNotMatch(result.stderr, /unexpected failure/, `${prefix}it is not a crash`);
  assert.deepEqual(snapshot(repo), before, `${prefix}HEAD, tree status, refs, ledger, note and artifacts are untouched`);
}

describe("pb rollback", () => {
  // Commit case: a fix group with a committed checkpoint.
  test("a commit rollback resets HEAD to the parent and leaves a clean tree", () => {
    const repo = makeRepo();

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(repo.head(), repo.seed, "HEAD is the commit before the fix group");
    assert.equal(outsidePairingbuddy(repo.dir), "", "the tree is clean outside .pairingbuddy");
  });

  test("a commit rollback keeps the fix commit under a rollback ref", () => {
    const repo = makeRepo();
    const ref = rollbackRef(1);

    const result = rollback(repo, "--from", FIX_KEY);
    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);

    const branchesAndTagsAtFixCommit = git(repo.dir, "for-each-ref", "refs/heads", "refs/tags", "--format=%(refname)", "--points-at", repo.fixSha);
    assert.equal(git(repo.dir, "rev-parse", "--verify", "--quiet", ref), repo.fixSha, "the rollback ref resolves to the fix commit");
    assert.equal(branchesAndTagsAtFixCommit, "", "no branch or tag points at the fix commit");
  });

  test("a commit rollback saves the dirty group paths on top of the fix commit", () => {
    const repo = makeRepo();
    const ref = rollbackRef(1);
    writeFileSync(join(repo.dir, "src.mjs"), "uncommitted edit after the fix\n");

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const saved = git(repo.dir, "rev-parse", "--verify", "--quiet", ref);
    assert.notEqual(saved, repo.fixSha, "the ref points at a new commit, not the fix commit");
    assert.equal(git(repo.dir, "rev-parse", `${ref}^`), repo.fixSha, "the saved commit sits on top of the fix commit");
    assert.equal(git(repo.dir, "show", `${ref}:src.mjs`), "uncommitted edit after the fix", "the saved commit holds the uncommitted edit");
    assert.equal(repo.head(), repo.seed, "HEAD is the commit before the fix group");
    assert.equal(outsidePairingbuddy(repo.dir), "", "the tree is clean outside .pairingbuddy");
  });

  test("rollback ref numbers count up within a stage", () => {
    const repo = makeRepo();
    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `first rollback exits 0, stderr: ${first.stderr}`);
    const second = landFixGroup(repo, { group: 2, round: 3, content: "second rejected fix\n" });

    const result = rollback(repo, "--from", second.fixKey);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(git(repo.dir, "rev-parse", "--verify", "--quiet", rollbackRef(1)), repo.fixSha, "ref 1 keeps the first fix commit");
    assert.equal(git(repo.dir, "rev-parse", "--verify", "--quiet", rollbackRef(2)), second.sha, "ref 2 holds the second fix commit");
    assert.equal(repo.head(), repo.seed, "HEAD is the seed commit");
  });

  test("a rollback never overwrites an existing rollback ref", () => {
    const repo = makeRepo();
    git(repo.dir, "update-ref", rollbackRef(1), repo.seed);

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(git(repo.dir, "rev-parse", "--verify", "--quiet", rollbackRef(1)), repo.seed, "the earlier rollback ref still points at the seed commit");
    assert.equal(git(repo.dir, "rev-parse", "--verify", "--quiet", rollbackRef(2)), repo.fixSha, "the fix commit is kept at the next free ref");
  });

  // Red-tests case: no committed checkpoint, the listed paths are saved under the ref first.
  test("a red rollback saves the listed paths under a ref whose parent is HEAD", () => {
    const repo = makeRedRepo({ newFile: true });
    const ref = rollbackRef(1);

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(git(repo.dir, "rev-parse", `${ref}^`), repo.seed, "the saved commit's parent is the seed (HEAD)");
    assert.equal(git(repo.dir, "show", `${ref}:src.mjs`), "red fix, uncommitted", "the saved commit holds the edited content");
    assert.equal(git(repo.dir, "show", `${ref}:helper.mjs`), "new helper", "the saved commit holds the new untracked file");
  });

  test("a red rollback removes an untracked new file and restores the tracked ones", () => {
    const repo = makeRedRepo({ newFile: true });

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(existsSync(join(repo.dir, "helper.mjs")), false, "the new untracked file is gone from disk");
    assert.equal(readFileSync(join(repo.dir, "src.mjs"), "utf8"), "original code\n", "src.mjs is back to its seed content");
    assert.equal(outsidePairingbuddy(repo.dir), "", "the tree is clean outside .pairingbuddy");
  });

  test("a red rollback leaves HEAD and the index unchanged", () => {
    const repo = makeRedRepo({ newFile: true });
    const branchRef = "refs/heads/feature";

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(repo.head(), repo.seed, "HEAD is still the seed commit");
    assert.equal(git(repo.dir, "rev-parse", branchRef), repo.seed, "the branch still points at the seed commit");
    assert.equal(git(repo.dir, "diff", "--cached", "--name-only"), "", "nothing is left staged");
  });

  // Note and ledger.
  test("the note gains one entry per rollback, carrying the checker's what-went-wrong", () => {
    const wrongA = "the fix renamed the helper instead of removing the duplication";
    const wrongB = "the second fix deleted a guard the callers rely on";
    const repo = makeRepo({ whatWentWrong: wrongA });

    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `first rollback exits 0, stderr: ${first.stderr}`);
    assert.equal(existsSync(notePath(repo)), true, "the note exists after the first rollback");
    const afterFirst = readFileSync(notePath(repo), "utf8");
    const second = landFixGroup(repo, { group: 2, round: 3, content: "second rejected fix\n", whatWentWrong: wrongB });
    const secondResult = rollback(repo, "--from", second.fixKey);
    assert.equal(secondResult.code, 0, `second rollback exits 0, stderr: ${secondResult.stderr}`);
    const afterSecond = readFileSync(notePath(repo), "utf8");

    assert.deepEqual(noteHeadings(afterFirst), [`## Rollback 1: ${FIX_KEY}`], "one entry after the first rollback");
    assert.ok(afterFirst.includes(wrongA) && afterFirst.includes(FIX_KEY), "the first entry holds the checker's what_went_wrong and the key");
    assert.deepEqual(noteHeadings(afterSecond), [`## Rollback 1: ${FIX_KEY}`, `## Rollback 2: ${second.fixKey}`], "two numbered entries, each headed with its key");
    assert.ok(afterSecond.startsWith(afterFirst), "the first entry is kept unchanged as a prefix");
    assert.ok(afterSecond.indexOf(wrongA) < afterSecond.indexOf(wrongB), "entry A comes before entry B");
  });

  test("the note for a red rollback holds the failing test excerpt", () => {
    const checkerText = "the checker's account that the red case must not use";
    const repo = makeRedRepo({ whatWentWrong: checkerText });

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const note = readFileSync(notePath(repo), "utf8");
    assert.deepEqual(noteHeadings(note), [`## Rollback 1: ${FIX_KEY}`], "one entry headed with the rollback number and key");
    assert.ok(note.includes("FAIL tests/a.mjs: expected 3, got 4"), "the entry holds the failed run's excerpt");
    assert.ok(!note.includes(checkerText), "the entry holds no checker what_went_wrong text");
  });

  test("the ledger records the rollback and drops the rolled-back sha from its commits", () => {
    const repo = makeRepo();
    repo.updateLedger((ledger) => { ledger.commits.unshift(repo.seed); });

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const ledger = repo.ledger();
    assert.deepEqual(ledger.fixes.rollbacks, [{ key: FIX_KEY, kind: "commit", ref: rollbackRef(1), sha: repo.fixSha, base: repo.seed }], "the rollback is recorded with its key, kind, ref, sha and base");
    assert.deepEqual(ledger.commits, [repo.seed], "only the rolled-back sha is dropped from ledger.commits; other commits are kept");
  });

  // Artifact case: a stage with no commit.
  test("an artifact rollback moves the artifact to rejected, with a note and a ledger entry", () => {
    const whatWentWrong = "the redraft dropped the refusal scenarios";
    const repo = makeArtifactRepo({ whatWentWrong });
    const artifactPath = join(repo.taskDir, "artifacts", `${ARTIFACT_FIX_KEY}.json`);
    const rejectedPath = join(repo.taskDir, "rejected", `${ARTIFACT_FIX_KEY}.json`);
    const bytesBefore = readFileSync(artifactPath);
    const headBefore = repo.head();

    const result = rollback(repo, "--artifact", "--from", ARTIFACT_FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(existsSync(artifactPath), false, "the artifact is gone from artifacts/");
    assert.deepEqual(readFileSync(rejectedPath), bytesBefore, "rejected/ holds the same bytes");
    const note = readFileSync(join(repo.taskDir, "notes", `${ARTIFACT_STAGE}.md`), "utf8");
    assert.deepEqual(noteHeadings(note), [`## Rollback 1: ${ARTIFACT_FIX_KEY}`], "the note has one entry headed with the key");
    assert.ok(note.includes(whatWentWrong), "the entry holds the checker's what_went_wrong");
    assert.deepEqual(repo.ledger().fixes.rollbacks, [{ key: ARTIFACT_FIX_KEY, kind: "artifact", ref: null, sha: null, base: null }], "the rollback is recorded as an artifact rollback");
    assert.equal(repo.head(), headBefore, "HEAD is unchanged");
    assert.equal(git(repo.dir, "for-each-ref", "refs/pairingbuddy"), "", "no refs under refs/pairingbuddy");
  });

  // Refusals: each prints "pb: ...", exits 1 (usage errors exit 2) and touches nothing.
  test("a key that is not a fix key is refused", () => {
    const keys = [`${STAGE}.implement-tests.t1.r1.a${ATTEMPT}`, `${STAGE}.implement-code.t1.r1.a${ATTEMPT}`, `${STAGE}.refactor-code.t1.r1.a${ATTEMPT}`];

    for (const key of keys) {
      const repo = makeRepo();
      writeFileSync(join(repo.dir, "src.mjs"), "step\n");
      git(repo.dir, "commit", "-q", "-am", "step");
      const sha = repo.head();
      repo.updateLedger((ledger) => {
        ledger.commits.push(sha);
        ledger.checkpoints.push({ step: key.split(".")[1], key, committed: true, sha, stage: STAGE, attempt: ATTEMPT });
      });
      const before = snapshot(repo);

      assertRefused(repo, before, rollback(repo, "--from", key), /only a fix group rolls back/, key);
    }
  });

  test("a rollback is refused while a stop is set", () => {
    const repo = makeRepo();
    repo.updateLedger((ledger) => { ledger.stop = { reason: "halt-xyz", seq: 1, code: "human-stopped" }; });
    const before = snapshot(repo);

    assertRefused(repo, before, rollback(repo, "--from", FIX_KEY), /the run has stopped, so nothing is rolled back/);
  });

  test("a key outside the current stage and attempt is refused", () => {
    const otherStageKey = `scenarios.fix.g1.r2.a${ATTEMPT}`;
    const otherAttemptKey = `${STAGE}.fix.g1.r2.a${ATTEMPT + 1}`;
    const cases = [
      { label: "stage is no longer active", key: FIX_KEY, pattern: /no stage is active/, arrange: (repo) => repo.updateLedger((ledger) => { ledger.stage.status = "done"; }) },
      { label: "key is from another stage", key: otherStageKey, pattern: /is from stage/, arrange: (repo) => repo.updateLedger((ledger) => { ledger.checkpoints.push({ step: "fix", key: otherStageKey, committed: true, sha: repo.fixSha, stage: "scenarios", attempt: ATTEMPT }); }) },
      { label: "key is from another attempt", key: otherAttemptKey, pattern: /is from attempt/, arrange: (repo) => repo.updateLedger((ledger) => { ledger.checkpoints.push({ step: "fix", key: otherAttemptKey, committed: true, sha: repo.fixSha, stage: STAGE, attempt: ATTEMPT + 1 }); }) },
    ];

    for (const { label, key, pattern, arrange } of cases) {
      const repo = makeRepo();
      arrange(repo);
      const before = snapshot(repo);

      assertRefused(repo, before, rollback(repo, "--from", key), pattern, label);
    }
  });

  test("a key that was already rolled back is refused", () => {
    const repo = makeRedRepo();
    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `first rollback exits 0, stderr: ${first.stderr}`);
    writeFileSync(join(repo.dir, "src.mjs"), "dirty again, so only the already-rolled-back rule can refuse\n");
    const before = snapshot(repo);

    const result = rollback(repo, "--from", FIX_KEY);

    assertRefused(repo, before, result, /already rolled back/);
    assert.equal(git(repo.dir, "for-each-ref", "refs/pairingbuddy", "--format=%(refname)"), rollbackRef(1), "no second rollback ref");
    assert.deepEqual(noteHeadings(readFileSync(notePath(repo), "utf8")), [`## Rollback 1: ${FIX_KEY}`], "no second note entry");
  });

  test("a rollback is refused when a newer fix group exists", () => {
    const newerArtifactKey = `${STAGE}.fix.g2.r3.a${ATTEMPT}`;
    const cases = [
      {
        label: "a newer fix artifact exists (no commit)",
        arrange: () => {
          const repo = makeRedRepo();
          writeArtifact(repo, newerArtifactKey, { pb_key: newerArtifactKey, ambiguity: "", commit_subject: "group 2", files_changed: ["src.mjs"] });
          return repo;
        },
      },
      {
        label: "a newer fix group is committed at HEAD",
        arrange: () => {
          const repo = makeRepo();
          const { fixKey } = landFixGroup(repo, { group: 2, round: 3, content: "second fix\n" });
          // Only the committed checkpoint record may trigger the refusal, so drop the newer fix artifact.
          rmSync(join(repo.taskDir, "artifacts", `${fixKey}.json`));
          return repo;
        },
      },
    ];

    for (const { label, arrange } of cases) {
      const repo = arrange();
      const before = snapshot(repo);

      assertRefused(repo, before, rollback(repo, "--from", FIX_KEY), /not the newest fix group/, label);
    }
  });

  test("a commit that is not HEAD is refused", () => {
    const repo = makeRepo();
    writeFileSync(join(repo.dir, "other.mjs"), "an unrelated commit\n");
    git(repo.dir, "add", "other.mjs");
    git(repo.dir, "commit", "-q", "-m", "chore: add another file");
    const otherSha = repo.head();
    repo.updateLedger((ledger) => { ledger.commits.push(otherSha); });
    const before = snapshot(repo);

    assertRefused(repo, before, rollback(repo, "--from", FIX_KEY), /is not HEAD/);
  });

  test("a dirty tree outside the group paths is refused", () => {
    const cases = [
      {
        label: "committed case: an untracked file outside the group's paths",
        stray: "notes.txt",
        strayContent: "my own notes\n",
        arrange: () => {
          const repo = makeRepo();
          writeFileSync(join(repo.dir, "notes.txt"), "my own notes\n");
          return repo;
        },
      },
      {
        label: "red case: a tracked file outside the group's paths is modified",
        stray: "other.mjs",
        strayContent: "modified by hand\n",
        arrange: () => {
          const repo = makeRedRepo();
          writeFileSync(join(repo.dir, "other.mjs"), "tracked content\n");
          git(repo.dir, "add", "other.mjs");
          git(repo.dir, "commit", "-q", "-m", "chore: add another file");
          writeFileSync(join(repo.dir, "other.mjs"), "modified by hand\n");
          return repo;
        },
      },
    ];

    for (const { label, stray, strayContent, arrange } of cases) {
      const repo = arrange();
      const before = snapshot(repo);

      const result = rollback(repo, "--from", FIX_KEY);

      assertRefused(repo, before, result, /dirty outside the fix group/, label);
      assert.match(result.stderr, new RegExp(stray.replace(".", "\\.")), `${label}: it names ${stray}`);
      assert.equal(readFileSync(join(repo.dir, stray), "utf8"), strayContent, `${label}: ${stray} keeps its content`);
    }
  });

  test("a protected branch and a detached HEAD are both refused", () => {
    const cases = [
      {
        label: "protected branch",
        pattern: /protected branch feature/,
        arrange: (repo) => writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ protected_branches: ["feature"] })),
      },
      { label: "detached HEAD", pattern: /detached HEAD/, arrange: (repo) => git(repo.dir, "checkout", "-q", "--detach") },
    ];

    for (const { label, pattern, arrange } of cases) {
      const repo = makeRepo();
      arrange(repo);
      const before = snapshot(repo);

      assertRefused(repo, before, rollback(repo, "--from", FIX_KEY), pattern, label);
    }
  });

  test("a missing checker verdict, or one that says the fix was fine, is refused", () => {
    const betterVerdict = (repo, key) => writeArtifact(repo, key, { pb_key: key, finding_id: "f-1", verdict: "better", mistake: "none", what_went_wrong: "nothing, the fix was better" });
    const cases = [
      { label: "committed, checker missing", make: () => makeRepo({ seedArtifacts: false }), prepare: (repo) => writeArtifact(repo, FIX_KEY, { pb_key: FIX_KEY, ambiguity: "", commit_subject: "rename the helper", files_changed: ["src.mjs"] }), args: ["--from", FIX_KEY], pattern: /no course checker verdict/ },
      { label: "committed, verdict better", make: () => makeRepo(), prepare: (repo) => betterVerdict(repo, CHECKER_KEY), args: ["--from", FIX_KEY], pattern: /a better verdict keeps the commit/ },
      { label: "artifact, checker missing", make: () => makeArtifactRepo({ whatWentWrong: "x" }), prepare: (repo) => rmSync(join(repo.taskDir, "artifacts", `${ARTIFACT_CHECKER_KEY}.json`)), args: ["--artifact", "--from", ARTIFACT_FIX_KEY], pattern: /no course checker verdict/ },
      { label: "artifact, verdict better", make: () => makeArtifactRepo({ whatWentWrong: "x" }), prepare: (repo) => betterVerdict(repo, ARTIFACT_CHECKER_KEY), args: ["--artifact", "--from", ARTIFACT_FIX_KEY], pattern: /a better verdict keeps the commit/ },
    ];

    for (const { label, make, prepare, args, pattern } of cases) {
      const repo = make();
      prepare(repo);
      const before = snapshot(repo);

      assertRefused(repo, before, rollback(repo, ...args), pattern, label);
    }
  });

  test("a red rollback without a failed checkpoint run is refused", () => {
    const passedRun = { runner: "fake", argv: [], exitCode: 0, signal: null, timedOut: false, durationMs: 1, excerpt: "", excerptTruncated: false };
    const cases = [
      { label: "ledger.tests.checkpoint is absent", arrange: (repo) => repo.updateLedger((ledger) => { delete ledger.tests.checkpoint; }) },
      { label: "checkpoint run passed", arrange: (repo) => repo.updateLedger((ledger) => { ledger.tests.checkpoint = { stage: STAGE, attempt: ATTEMPT, passed: true, red: false, runs: [passedRun] }; }) },
    ];

    for (const { label, arrange } of cases) {
      const repo = makeRedRepo();
      arrange(repo);
      const before = snapshot(repo);

      assertRefused(repo, before, rollback(repo, "--from", FIX_KEY), /no red test run/, label);
    }
  });

  test("a rollback with nothing to roll back is refused", () => {
    const repo = makeRedRepo();
    writeFileSync(join(repo.dir, "src.mjs"), git(repo.dir, "show", `${repo.seed}:src.mjs`) + "\n");
    const before = snapshot(repo);

    assertRefused(repo, before, rollback(repo, "--from", FIX_KEY), /nothing to roll back/);
  });

  test("bad arguments give a usage error", () => {
    const argLists = [
      [],
      ["--from"],
      ["--from", "not a key"],
      ["--from", FIX_KEY, "extra"],
      ["--artifact"],
      ["--from", FIX_KEY, "--artifact"],
      ["--force", "--from", FIX_KEY],
      ["--to", FIX_KEY],
    ];

    for (const args of argLists) {
      const repo = makeRepo();
      const before = snapshot(repo);
      const label = JSON.stringify(args);

      const result = rollback(repo, ...args);

      assert.equal(result.code, 2, `${label}: exits 2: stdout ${result.stdout}, stderr ${result.stderr}`);
      assert.match(result.stderr, /^pb: usage: pb rollback/, `${label}: it prints the usage`);
      assert.deepEqual(snapshot(repo), before, `${label}: HEAD, tree status, refs, ledger, note and artifacts are untouched`);
    }
  });

  test("a higher-round checkpoint from an earlier attempt does not block rolling back the newest group", () => {
    const repo = makeRepo({ seedArtifacts: false });
    const key = `${STAGE}.fix.g1.r2.a2`;
    repo.updateLedger((ledger) => {
      ledger.stage.attempt = 2;
      ledger.checkpoints = [
        { step: "fix", key, committed: true, sha: repo.fixSha, stage: STAGE, attempt: 2 },
        { step: "fix", key: `${STAGE}.fix.g3.r4.a1`, committed: true, sha: repo.seed, stage: STAGE, attempt: 1 },
      ];
    });
    writeArtifact(repo, key, { pb_key: key, ambiguity: "", commit_subject: "rename the helper", files_changed: ["src.mjs"] });
    const checkerKey = `${STAGE}.course-checker.g1.r2.a2`;
    writeArtifact(repo, checkerKey, { pb_key: checkerKey, finding_id: "duplication-1", verdict: "wrong-direction", mistake: "missed-finding", what_went_wrong: "wrong direction" });

    const result = rollback(repo, "--from", key);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(repo.head(), repo.seed, "HEAD is the commit before the fix group");
  });

  test("the note's entry number counts only this stage's rollbacks", () => {
    const repo = makeRepo();
    repo.updateLedger((ledger) => {
      ledger.fixes = { rollbacks: [{ key: ARTIFACT_FIX_KEY, kind: "artifact", ref: null, sha: null, base: null }] };
    });

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.deepEqual(noteHeadings(readFileSync(notePath(repo), "utf8")), [`## Rollback 1: ${FIX_KEY}`], "the other stage's rollback is not counted");
  });

  test("a red fix listing a path outside the repo or under .pairingbuddy is refused", () => {
    const cases = [["../outside.mjs", /outside the repo/], [".pairingbuddy/run/task/ledger.json", /inside \.pairingbuddy\/, which a checkpoint never stages/]];
    for (const [listed, why] of cases) {
      const repo = makeRedRepo({ filesChanged: ["src.mjs", listed] });
      const before = snapshot(repo);

      assertRefused(repo, before, rollback(repo, "--from", FIX_KEY), why, listed);
    }
  });

  test("a git failure inside the rollback is a refusal, not a crash", () => {
    const repo = makeRepo();
    git(repo.dir, "config", "--unset", "user.name");
    git(repo.dir, "config", "--unset", "user.email");
    git(repo.dir, "config", "user.useConfigOnly", "true");
    writeFileSync(join(repo.dir, "src.mjs"), "uncommitted edit after the fix\n");
    const before = snapshot(repo);

    assertRefused(repo, before, rollback(repo, "--from", FIX_KEY), /git .* failed/);
  });

  test("the note for a red rollback leaves out the passing runs", () => {
    const repo = makeRedRepo();
    repo.updateLedger((ledger) => {
      ledger.tests.checkpoint.runs.push({ runner: "fake", argv: [], exitCode: 0, signal: null, timedOut: false, durationMs: 1, excerpt: "PASS tests/b.mjs: all good", excerptTruncated: false });
    });

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const note = readFileSync(notePath(repo), "utf8");
    assert.ok(note.includes("FAIL tests/a.mjs: expected 3, got 4"), "the failing run's excerpt is in the note");
    assert.ok(!note.includes("PASS tests/b.mjs"), "the passing run's excerpt is not");
  });

  test("a ref under the rollback prefix that is not a plain counter does not break numbering", () => {
    const repo = makeRepo();
    git(repo.dir, "update-ref", rollbackRef("notes"), repo.seed);

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(git(repo.dir, "rev-parse", "--verify", "--quiet", rollbackRef(1)), repo.fixSha, "the fix commit lands at ref 1");
  });

  test("a red rollback of a fix that only added a new file removes it and leaves the tree clean", () => {
    const repo = makeRedRepo({ filesChanged: ["helper.mjs"] });
    writeFileSync(join(repo.dir, "src.mjs"), "original code\n");
    writeFileSync(join(repo.dir, "helper.mjs"), "new helper\n");

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(git(repo.dir, "show", `${rollbackRef(1)}:helper.mjs`), "new helper", "the file is kept under the ref");
    assert.ok(!existsSync(join(repo.dir, "helper.mjs")), "the file is removed");
    assert.equal(outsidePairingbuddy(repo.dir), "", "the tree is clean outside .pairingbuddy");
  });

  // Late safeguards: expected to pass without new production code once rollback exists.
  test("a push never carries a rollback ref to the remote", () => {
    const repo = makeRepo();
    const rolled = rollback(repo, "--from", FIX_KEY);
    assert.equal(rolled.code, 0, `setup: rollback exits 0, stderr: ${rolled.stderr}`);
    assert.equal(git(repo.dir, "rev-parse", "--verify", "--quiet", rollbackRef(1)), repo.fixSha, "setup: the rollback ref exists");
    const remote = makeDir("pb-rollback-remote-");
    git(remote, "init", "-q", "--bare");

    git(repo.dir, ...pushArgv(remote, repo.head(), "feature"));

    assert.equal(git(remote, "rev-parse", "refs/heads/feature"), repo.head(), "the remote has the unit branch at HEAD");
    assert.equal(git(remote, "for-each-ref", "refs/pairingbuddy"), "", "the remote has no refs under refs/pairingbuddy");
  });

  test("a human abandon keeps the rollback ref", () => {
    const repo = makeRepo();
    const rolled = rollback(repo, "--from", FIX_KEY);
    assert.equal(rolled.code, 0, `setup: rollback exits 0, stderr: ${rolled.stderr}`);
    writeFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), JSON.stringify({ branch: "feature" }));

    const abandoned = pb(repo, "human", "abandon");

    assert.equal(abandoned.code, 0, `pb human abandon exits 0, stderr: ${abandoned.stderr}`);
    assert.equal(existsSync(repo.taskDir), false, "the task state is gone");
    assert.equal(git(repo.dir, "rev-parse", "--verify", "--quiet", rollbackRef(1)), repo.fixSha, "the rollback ref still resolves to the rolled-back commit");
  });

  test("a rollback ref sits under the unit ref prefix that publish deletes", () => {
    const repo = makeRepo();
    const rolled = rollback(repo, "--from", FIX_KEY);
    assert.equal(rolled.code, 0, `setup: rollback exits 0, stderr: ${rolled.stderr}`);
    const prefix = unitRefPrefix("feature");

    const listed = git(repo.dir, "for-each-ref", "--format=%(refname)", prefix).split("\n");

    const plan = publishSteps({
      unit: { branch: "feature", tasks: [{ title: "Task A", stages: ["code-safety-net"], gateSources: {}, blocking: [], fullSuite: { passed: true, head: "a".repeat(40) } }], commits: ["a".repeat(40)] },
      runStop: null, publishMode: undefined, commits: ["a".repeat(40)], taskRunOpen: false, changedConfigs: [], approval: "human", voidReason: null,
      safetyNets: ["code-safety-net"], planBoxes: null, planProblem: null, head: "a".repeat(40), dirty: [],
      branchProblem: null, branchIsProtected: false, currentBranch: "feature", branchTip: "a".repeat(40), remoteSha: null,
    });

    assert.ok(rollbackRef(1).startsWith(prefix), "the rollback ref starts with the unit ref prefix");
    assert.deepEqual(plan.refusals, [], "setup: the publish plan has no refusals");
    assert.ok(plan.steps.some((step) => step.do === "delete-refs" && step.prefix === prefix), "publish deletes the refs under that prefix");
    assert.deepEqual(listed, [rollbackRef(1)], "listing the prefix finds the rollback ref, so the delete-refs step reaches it");
  });

  test("a subagent is still denied git reset --hard and the other reverting commands", () => {
    const cwd = makeDir("pb-rollback-d17-");
    for (const command of ["git reset --hard HEAD~1", "git clean -fd", "git checkout .", "git restore .", "git branch -D feature"]) {
      const denial = d17Denial({ command, cwd, runState: "run", isSubagent: true });

      assert.notEqual(denial, null, `a subagent in a run is denied: ${command}`);
      assert.match(denial, /reset --hard, clean, checkout \., restore \. and branch -D are denied/, `${command}: the deny text lists the reverting commands`);
    }
  });

  // Scenario: pb-rollback-repeated-kind (fix artifacts decide "repeated", not a model flag).
  test("rollback-repeated-restores-tree-and-records: a repeated approach restores the group paths, quotes the approach in the note, records kind 'repeated', and counts toward failedAttempts", () => {
    const repo = makeRepo();
    writeArtifact(repo, FIX_KEY, { pb_key: FIX_KEY, ambiguity: "", commit_subject: "rename the helper", files_changed: ["src.mjs"], approach: "Extract helper" });
    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `setup: the first rollback exits 0, stderr: ${first.stderr}`);
    const secondKey = `${STAGE}.fix.g1.r3.a${ATTEMPT}`;
    writeArtifact(repo, secondKey, { pb_key: secondKey, ambiguity: "", commit_subject: "extract again", files_changed: ["src.mjs"], approach: "extract  HELPER!" });
    writeFileSync(join(repo.dir, "src.mjs"), "second fix, uncommitted\n");

    const result = rollback(repo, "--from", secondKey);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(outsidePairingbuddy(repo.dir), "", "the tree is clean");
    const entries = repo.ledger().fixes.rollbacks;
    assert.equal(entries.length, 2, "the second rollback appended a second ledger entry");
    assert.equal(entries[1].kind, "repeated", "the second ledger entry has kind repeated");
    const note = readFileSync(notePath(repo), "utf8");
    assert.ok(note.includes(`## Rollback 2: ${secondKey}`), "the note gains a second entry");
    assert.ok(note.slice(note.indexOf(`## Rollback 2: ${secondKey}`)).includes("extract  HELPER!"), "the second entry quotes the approach");
    assert.equal(JSON.parse(result.stdout).failedAttempts, 2, "it counts as the second failed attempt");
  });
  test("repeated-check-wins-over-stale-red-run: a stale red test run does not override a repeated approach, so the kind is 'repeated'", () => {
    const repo = makeRedRepo();
    writeArtifact(repo, FIX_KEY, { pb_key: FIX_KEY, ambiguity: "", commit_subject: "rename the helper", files_changed: ["src.mjs"], approach: "Extract helper" });
    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `setup: the red rollback exits 0, stderr: ${first.stderr}`);
    assert.equal(repo.ledger().fixes.rollbacks[0].kind, "red", "setup: the first rollback is a red one");
    assert.equal(repo.ledger().tests.checkpoint.passed, false, "setup: the failed checkpoint test run is still in the ledger");
    const secondKey = `${STAGE}.fix.g1.r3.a${ATTEMPT}`;
    writeArtifact(repo, secondKey, { pb_key: secondKey, ambiguity: "", commit_subject: "extract again", files_changed: ["src.mjs"], approach: "extract helper" });
    writeFileSync(join(repo.dir, "src.mjs"), "second fix, uncommitted\n");

    const result = rollback(repo, "--from", secondKey);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const entries = repo.ledger().fixes.rollbacks;
    assert.equal(entries.length, 2, "the second rollback appended a second ledger entry");
    assert.equal(entries[1].kind, "repeated", "the repeated approach wins over the stale red run");
    const secondEntry = readFileSync(notePath(repo), "utf8");
    const entryText = secondEntry.slice(secondEntry.indexOf(`## Rollback 2: ${secondKey}`));
    assert.ok(entryText.includes("extract helper"), "the second note entry quotes the approach");
    assert.ok(!entryText.includes("expected 3, got 4"), "the second note entry does not quote the stale test excerpt");
  });
  test("repeated-with-nothing-dirty-records-null-ref: a repeated rollback with no dirty group paths runs no git save and records ref null and sha null", () => {
    const repo = makeRepo();
    writeArtifact(repo, FIX_KEY, { pb_key: FIX_KEY, ambiguity: "", commit_subject: "rename the helper", files_changed: ["src.mjs"], approach: "Extract helper" });
    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `setup: the first rollback exits 0, stderr: ${first.stderr}`);
    const secondKey = `${STAGE}.fix.g1.r3.a${ATTEMPT}`;
    writeArtifact(repo, secondKey, { pb_key: secondKey, ambiguity: "", commit_subject: "extract again", files_changed: ["src.mjs"], approach: "extract  HELPER!" });
    const refsBefore = git(repo.dir, "for-each-ref", "refs/pairingbuddy", "--format=%(refname)");

    const result = rollback(repo, "--from", secondKey);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    assert.equal(outsidePairingbuddy(repo.dir), "", "the tree is clean");
    assert.equal(git(repo.dir, "for-each-ref", "refs/pairingbuddy", "--format=%(refname)"), refsBefore, "no new rollback ref was created");
    const entries = repo.ledger().fixes.rollbacks;
    assert.equal(entries.length, 2, "the second rollback appended a ledger entry");
    assert.equal(entries[1].kind, "repeated", "the entry has kind repeated");
    assert.equal(entries[1].ref, null, "the entry has ref null");
    assert.equal(entries[1].sha, null, "the entry has sha null");
    assert.equal(entries[1].base, repo.head(), "the entry has base at HEAD");
    assert.equal(JSON.parse(result.stdout).failedAttempts, 2, "it counts as the second failed attempt");
  });
  test("repeated-needs-same-stage: an earlier rollback with the same approach in a different stage does not make a later uncommitted fix repeated", () => {
    const repo = makeRepo();
    const otherKey = `scenarios.fix.g1.r2.a${ATTEMPT}`;
    writeArtifact(repo, otherKey, { pb_key: otherKey, ambiguity: "", commit_subject: "rename the helper", files_changed: ["src.mjs"], approach: "Extract helper" });
    repo.updateLedger((ledger) => { ledger.fixes = { rollbacks: [{ key: otherKey, kind: "artifact", ref: null, sha: null, base: null }] }; });
    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `setup: the committed rollback exits 0, stderr: ${first.stderr}`);
    const secondKey = `${STAGE}.fix.g1.r3.a${ATTEMPT}`;
    writeArtifact(repo, secondKey, { pb_key: secondKey, ambiguity: "", commit_subject: "extract again", files_changed: ["src.mjs"], approach: "Extract helper" });
    writeFileSync(join(repo.dir, "src.mjs"), "second fix, uncommitted\n");
    const before = snapshot(repo);

    const result = rollback(repo, "--from", secondKey);

    assertRefused(repo, before, result, /no commit and no red test run/);
  });
  test("repeated-needs-same-group: an earlier rollback with the same approach for a different item of the stage does not make a later uncommitted fix repeated", () => {
    const repo = makeRepo();
    const otherKey = `${STAGE}.fix.g2.r2.a${ATTEMPT}`;
    writeArtifact(repo, otherKey, { pb_key: otherKey, ambiguity: "", commit_subject: "rename the helper", files_changed: ["src.mjs"], approach: "Extract helper" });
    repo.updateLedger((ledger) => { ledger.fixes = { rollbacks: [{ key: otherKey, kind: "artifact", ref: null, sha: null, base: null }] }; });
    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `setup: the committed rollback exits 0, stderr: ${first.stderr}`);
    const secondKey = `${STAGE}.fix.g1.r3.a${ATTEMPT}`;
    writeArtifact(repo, secondKey, { pb_key: secondKey, ambiguity: "", commit_subject: "extract again", files_changed: ["src.mjs"], approach: "Extract helper" });
    writeFileSync(join(repo.dir, "src.mjs"), "second fix, uncommitted\n");
    const before = snapshot(repo);

    const result = rollback(repo, "--from", secondKey);

    assertRefused(repo, before, result, /no commit and no red test run/);
  });
  test("no-approach-never-repeats: an earlier rollback without an approach and a later red fix without one roll back as kind 'red'", () => {
    const repo = makeRedRepo();
    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `setup: the first red rollback exits 0, stderr: ${first.stderr}`);
    const secondKey = `${STAGE}.fix.g1.r3.a${ATTEMPT}`;
    writeArtifact(repo, secondKey, { pb_key: secondKey, ambiguity: "", commit_subject: "again", files_changed: ["src.mjs"] });
    writeFileSync(join(repo.dir, "src.mjs"), "second fix, uncommitted\n");

    const result = rollback(repo, "--from", secondKey);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const entries = repo.ledger().fixes.rollbacks;
    assert.equal(entries.length, 2, "the second rollback appended a ledger entry");
    assert.equal(entries[1].kind, "red", "with no approach on either side the second rollback is red, not repeated");
  });
  test("uncommitted-fix-new-approach-no-red-still-refused: an uncommitted fix with a new approach and no failed test run is still refused", () => {
    const repo = makeRepo();
    writeArtifact(repo, FIX_KEY, { pb_key: FIX_KEY, ambiguity: "", commit_subject: "rename the helper", files_changed: ["src.mjs"], approach: "Extract helper" });
    const first = rollback(repo, "--from", FIX_KEY);
    assert.equal(first.code, 0, `setup: the first rollback exits 0, stderr: ${first.stderr}`);
    const secondKey = `${STAGE}.fix.g1.r3.a${ATTEMPT}`;
    writeArtifact(repo, secondKey, { pb_key: secondKey, ambiguity: "", commit_subject: "inline it", files_changed: ["src.mjs"], approach: "Inline the call" });
    writeFileSync(join(repo.dir, "src.mjs"), "second fix, uncommitted\n");
    const before = snapshot(repo);

    const result = rollback(repo, "--from", secondKey);

    assertRefused(repo, before, result, /no commit and no red test run/);
    assert.equal(repo.ledger().fixes.rollbacks.length, 1, "the ledger still holds only the first rollback");
    assert.notEqual(outsidePairingbuddy(repo.dir), "", "the dirty file is still dirty");
  });
});
