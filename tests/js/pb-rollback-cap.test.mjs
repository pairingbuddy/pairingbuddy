// Scenario: rollback-attempt-cap. pb rollback reports the failed attempts and the cap, and the fifth rollback of a
// stage stops the run. Every test drives the real CLI as a subprocess in a temp git repo.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { ATTEMPT_CAP } from "../../shared-node/verbs.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const STAGE = "code-safety-net";
const ATTEMPT = 1;
const FIX_KEY = `${STAGE}.fix.g1.r2.a${ATTEMPT}`;
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const MAX_ATTEMPTS = JSON.parse(readFileSync(join(ROOT, "contracts", "lenses.json"), "utf8")).maxAttempts;
const WHAT_WENT_WRONG = "the fix renamed the helper instead of removing the duplication";

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

// A repo on the unprotected branch `feature` with a seed commit, the .pairingbuddy layout and an active
// code-safety-net stage ledger (attempt 1). HEAD stays on the seed until landFixGroup adds a fix commit.
function makeRepo({ attempt = ATTEMPT } = {}) {
  const dir = makeDir("pb-rollback-cap-");
  git(dir, "init", "-q", "-b", "feature");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, "src.mjs"), "original code\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "seed");

  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  const configText = JSON.stringify(CONFIG);
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), configText);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "new_feature",
    owner: { sessionId: null, lastSeen: null }, task: "Task 83c", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "", source: "" },
    stage: { name: STAGE, status: "active", runId: "wf_1", attempt, startedAt: null },
    stages: [], gates: {}, tests: { perTest: {} }, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    checkpoints: [],
  });
  return {
    dir, taskDir, ledgerPath,
    ledger: () => readLedger(ledgerPath),
    updateLedger: (change) => { const ledger = readLedger(ledgerPath); change(ledger); writeLedger(ledgerPath, ledger); },
    head: () => git(dir, "rev-parse", "HEAD"),
  };
}

// Lands one committed fix group on the current HEAD: a new commit of src.mjs, its checkpoint record (committed, sha in
// ledger.commits), its fix artifact and a course checker artifact with a bad verdict and a what_went_wrong text.
function landFixGroup(repo, { group = 1, round = 2, attempt = ATTEMPT, content = `rejected fix ${group}.${round}\n`, verdict = "wrong-direction", whatWentWrong = WHAT_WENT_WRONG } = {}) {
  const fixKey = `${STAGE}.fix.g${group}.r${round}.a${attempt}`;
  const checkerKey = `${STAGE}.course-checker.g${group}.r${round}.a${attempt}`;
  writeFileSync(join(repo.dir, "src.mjs"), content);
  git(repo.dir, "commit", "-q", "-am", `fix: group ${group} round ${round}`);
  const sha = git(repo.dir, "rev-parse", "HEAD");
  repo.updateLedger((ledger) => {
    ledger.commits.push(sha);
    ledger.checkpoints.push({ step: "fix", key: fixKey, committed: true, sha, stage: STAGE, attempt });
  });
  writeArtifact(repo, fixKey, { pb_key: fixKey, ambiguity: "", commit_subject: `group ${group}`, files_changed: ["src.mjs"] });
  writeArtifact(repo, checkerKey, { pb_key: checkerKey, finding_id: `finding-${group}`, verdict, mistake: "missed-finding", what_went_wrong: whatWentWrong });
  return { sha, fixKey, checkerKey };
}

// Pre-seeds earlier rollbacks of this stage into the ledger's fixes.rollbacks, so a test can reach the fourth or fifth
// rollback without performing the earlier ones. Keys default to g1, rounds 3.., attempt 1; pass `attempt` to put them
// on another stage attempt. Returns the seeded keys.
function seedRollbacks(repo, count, { attempt = ATTEMPT, firstRound = 3, group = 1 } = {}) {
  const keys = Array.from({ length: count }, (_, i) => `${STAGE}.fix.g${group}.r${firstRound + i}.a${attempt}`);
  repo.updateLedger((ledger) => {
    ledger.fixes = { ...ledger.fixes, rollbacks: [...(ledger.fixes?.rollbacks ?? []), ...keys.map((key) => ({ key, kind: "commit", ref: null, sha: null, base: null }))] };
  });
  return keys;
}

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: gitEnv() });
  return { code: status, stdout, stderr };
}

const rollback = (repo, ...args) => pb(repo, "rollback", ...args);
const notePath = (repo) => join(repo.taskDir, "notes", `${STAGE}.md`);

describe("pb rollback attempt cap", () => {
  // Test case: rollback-output-includes-note-and-attempt-counts
  test("Rollback output includes note, failedAttempts and maxAttempts", () => {
    const repo = makeRepo();
    landFixGroup(repo, { whatWentWrong: WHAT_WENT_WRONG });

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const printed = JSON.parse(result.stdout);
    assert.equal(printed.note, WHAT_WENT_WRONG, "note is the checker's what_went_wrong");
    assert.equal(printed.failedAttempts, 1, "one rollback is held for the stage");
    assert.equal(printed.maxAttempts, MAX_ATTEMPTS, "maxAttempts is the cap from the lens contract");
    assert.equal(existsSync(notePath(repo)), true, "the note file exists");
    assert.ok(readFileSync(notePath(repo), "utf8").includes(printed.note), "the printed note is the body appended to the notes file");
  });

  // Test case: fourth-rollback-does-not-stop
  test("The fourth rollback of a stage prints stopped false and records no stop", () => {
    const repo = makeRepo();
    seedRollbacks(repo, MAX_ATTEMPTS - 2);
    landFixGroup(repo);

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const printed = JSON.parse(result.stdout);
    assert.equal(printed.failedAttempts, MAX_ATTEMPTS - 1, "the fourth rollback is held for the stage");
    assert.strictEqual(printed.stopped, false, "the fourth rollback does not stop the run");
    assert.equal(repo.ledger().stop, null, "no stop is recorded in the ledger");
  });

  // Test case: fifth-rollback-records-attempt-cap-stop
  test("The fifth rollback, counted across fix groups and stage attempts, records stop code attempt-cap with a reason naming the stage and count and prints stopped true", () => {
    const repo = makeRepo({ attempt: 2 });
    seedRollbacks(repo, MAX_ATTEMPTS - 3, { attempt: 1, group: 1 });
    seedRollbacks(repo, 1, { attempt: 1, group: 2, firstRound: 5 });
    seedRollbacks(repo, 1, { attempt: 2, group: 1 });
    landFixGroup(repo, { attempt: 2 });

    const result = rollback(repo, "--from", `${STAGE}.fix.g1.r2.a2`);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const printed = JSON.parse(result.stdout);
    assert.equal(printed.failedAttempts, MAX_ATTEMPTS, "the fifth rollback is held for the stage");
    assert.strictEqual(printed.stopped, true, "the fifth rollback stops the run");
    const stop = repo.ledger().stop;
    assert.equal(stop?.code, ATTEMPT_CAP, "the stop code is the attempt cap");
    assert.ok(stop?.reason?.includes(STAGE), `the reason names the stage: ${stop?.reason}`);
    assert.match(stop?.reason, new RegExp(`\\b${printed.failedAttempts}\\b`), `the reason names the count: ${stop?.reason}`);
  });

  // Test case: capping-rollback-writes-report
  test("The capping rollback writes run/task/report.json with fixes attempts and lessons", () => {
    const repo = makeRepo();
    const seededKeys = seedRollbacks(repo, MAX_ATTEMPTS - 1);
    landFixGroup(repo, { whatWentWrong: WHAT_WENT_WRONG });

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const reportPath = join(repo.taskDir, "report.json");
    assert.equal(existsSync(reportPath), true, "the capping rollback writes report.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.stage, STAGE, "the report is for the stage");
    assert.equal(report.attempt, ATTEMPT, "the report carries the ledger stage attempt");
    assert.equal(report.fixes?.attempts, seededKeys.length + 1, "attempts are the distinct fix keys of the stage across checkpoints and rollbacks");
    const lessons = report.fixes?.lessons ?? [];
    assert.equal(lessons.at(-1)?.key, FIX_KEY, "the last lesson is for the rolled-back fix key");
    assert.equal(lessons.at(-1)?.text, WHAT_WENT_WRONG, "the last lesson text is the checker's what_went_wrong");
  });

  // Test case: capping-rollback-stop-seq-is-ledger-seq
  test("The attempt-cap stop carries the seq of the ledger write that recorded it", () => {
    const repo = makeRepo();
    seedRollbacks(repo, MAX_ATTEMPTS - 1);
    landFixGroup(repo);

    const result = rollback(repo, "--from", FIX_KEY);

    assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
    const ledger = repo.ledger();
    assert.equal(ledger.stop?.code, ATTEMPT_CAP, "the run is stopped by the cap");
    assert.equal(ledger.stop.seq, ledger.seq, "the stop's seq equals the ledger's seq after the update");
  });
});
