// pb human cut-test <id>... --reason '<why>': the human takes tests with recorded evidence off a code run's list, which the
// placeholders guard otherwise never allows. Each cut is recorded in ledger.tests.cut, with its reason and evidence, and
// becomes a final check the person runs. Every test drives the real CLI in a temp git repo with a real ledger.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const STAGE = "code-tdd";
const ATTEMPT = 2;
const TESTS_KEY = `${STAGE}.create-test-placeholders.-.r2.a${ATTEMPT}`;
const IN_PARALLEL = { concurrency: 8 };
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
const selector = (file, fn) => ({ runner_id: "fake", test_file: file, test_function: fn });
const row = (id, file = "tests/a.mjs") => ({ test_id: id, test_case_id: "c", scenario_id: "s", runner_id: "fake", test_file: file, test_function: id });
const RED = (sha) => ({ stage: STAGE, attempt: 1, done: true, passed: true, sha });

function makeRepo({ perTest, kind = "code" } = {}) {
  const dir = makeDir("pb-cut-test-");
  git(dir, "init", "-q", "-b", "feature");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "tests", "a.mjs"), "a test file\n");
  writeFileSync(join(dir, "tests", "live.mjs"), "needs a live run\n");
  writeFileSync(join(dir, "fake.mjs"), "process.exit(0)\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "seed");
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  const configText = JSON.stringify(CONFIG);
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), configText);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind, taskType: "new_feature",
    owner: { sessionId: null, lastSeen: null }, task: "Task 9", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "", source: "" },
    stage: { name: STAGE, status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [], gates: {}, tests: { perTest: perTest ?? {
      kept: { selector: selector("tests/a.mjs", "kept"), red: RED("1".repeat(40)) },
      live: { selector: selector("tests/live.mjs", "live"), red: RED("2".repeat(40)) },
    } }, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
  });
  return { dir, taskDir, ledger: () => readLedger(ledgerPath), head: () => git(dir, "rev-parse", "HEAD") };
}

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: gitEnv() });
  return { code: status, stdout, stderr };
}

const placeholders = (repo, tests, filesChanged) => writeFileSync(join(repo.taskDir, "artifacts", `${TESTS_KEY}.json`), JSON.stringify({ pb_key: TESTS_KEY, ambiguity: "", commit_subject: "drop the live-run test", files_changed: filesChanged, tests }));

describe("pb human cut-test", IN_PARALLEL, () => {
  test("takes the test off the list with its reason, and the placeholders step then commits the deleted file", () => {
    const repo = makeRepo();

    const cut = pb(repo, "human", "cut-test", "live", "--reason", "needs a live smoke run");

    assert.equal(cut.code, 0, cut.stderr);
    const ledger = repo.ledger();
    assert.equal(ledger.tests.perTest.live, undefined, "off the evidence list");
    assert.ok(ledger.tests.perTest.kept, "the other test stays");
    assert.deepEqual(ledger.tests.cut.map(({ id, reason, red }) => ({ id, reason, red })), [{ id: "live", reason: "needs a live smoke run", red: "2".repeat(40) }]);
    unlinkSync(join(repo.dir, "tests", "live.mjs"));
    placeholders(repo, [row("kept")], ["tests/live.mjs"]);
    const done = pb(repo, "checkpoint", "--step", "placeholders", "--from", TESTS_KEY);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(git(repo.dir, "show", "--name-status", "--format=", "HEAD"), "D\ttests/live.mjs");
  });
});
