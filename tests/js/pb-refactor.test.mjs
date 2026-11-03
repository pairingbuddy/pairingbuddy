// Task 48: pb checkpoint --step refactor, the per-cycle refactor of new_feature. Every test drives the real CLI as a
// subprocess in a temp git repo. The test command is a small node script that logs its argv and exits with the code
// .git/outcomes.json holds for its first argument, or 5 when that names nothing, as pytest does for "no tests".
//
// Output contract: a refactor-code or refactor-tests key, naming the test of its cycle. The step commits the listed
// paths as one fix group, typed refactor, or test when every path is in a test_directory. Before the commit it runs
// every test of the task that is closed (RED and GREEN done, or covered), each by its own selector, and all must pass.
// A change that breaks one is refused with nothing committed, and the run lands in ledger.tests.refactor. A step with
// no change runs no test and makes no commit. Only new_feature refactors per cycle.
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

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const STAGE = "code-tdd";
const ATTEMPT = 1;
const TESTS_KEY = `${STAGE}.create-test-placeholders.-.r1.a${ATTEMPT}`;
const codeKey = (id = "t1", round = 1) => `${STAGE}.refactor-code.${id}.r${round}.a${ATTEMPT}`;
const testsKey = (id = "t1", round = 1) => `${STAGE}.refactor-tests.${id}.r${round}.a${ATTEMPT}`;
const RUNS = join(".git", "test-runs.log");
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

const FAKE_TESTS = `
import { appendFileSync, readFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(RUNS)}, JSON.stringify(argv) + "\\n");
const outcomes = JSON.parse(readFileSync(".git/outcomes.json", "utf8"));
const [selected] = argv;
console.log("ran " + selected);
process.exit(Object.hasOwn(outcomes, selected) ? outcomes[selected] : 5);
`;

const CONFIG = { source_directory: ".", runners: { fake: { name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [], selector_template: ["{test_file}::{test_function}"] } }, default_runner: "fake" };
const row = (test_id) => ({ test_id, test_case_id: "c", scenario_id: "s", runner_id: "fake", test_file: "tests/a.mjs", test_function: test_id });
const closed = { selector: {}, red: { done: true }, green: { done: true } };
const coveredRow = { selector: {}, red: { done: false }, covered: { done: true } };

function makeRepo({ taskType = "new_feature", rows = [row("t1")], perTest = { t1: closed }, outcomes = { "tests/a.mjs::t1": 0 } } = {}) {
  const dir = makeDir("pb-refactor-");
  git(dir, "init", "-q", "-b", "feature");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "tests", "a.mjs"), "real test\n");
  writeFileSync(join(dir, "src.mjs"), "code\n");
  writeFileSync(join(dir, "fake.mjs"), FAKE_TESTS);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "seed");
  writeFileSync(join(dir, ".git", "outcomes.json"), JSON.stringify(outcomes));
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  const configText = JSON.stringify(CONFIG);
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), configText);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType,
    owner: { sessionId: null, lastSeen: null }, task: "Task 48", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "", source: "" },
    stage: { name: STAGE, status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [], gates: {}, tests: { perTest }, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
  });
  writeArtifact({ taskDir }, TESTS_KEY, { pb_key: TESTS_KEY, ambiguity: "", commit_subject: "add placeholders", files_changed: [], tests: rows });
  return {
    dir, taskDir,
    ledger: () => readLedger(ledgerPath),
    head: () => git(dir, "rev-parse", "HEAD"),
    message: () => git(dir, "log", "-1", "--format=%s"),
    committed: () => git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort(),
    runs: () => (existsSync(join(dir, RUNS)) ? readFileSync(join(dir, RUNS), "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
    write: (name, text) => writeFileSync(join(dir, name), text),
  };
}

function writeArtifact({ taskDir }, key, content) {
  writeFileSync(join(taskDir, "artifacts", `${key}.json`), JSON.stringify(content));
}

const fixed = (repo, key, files, subject = "name the discount rule") => writeArtifact(repo, key, { pb_key: key, ambiguity: "", commit_subject: subject, files_changed: files });

function refactor(repo, key) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, "checkpoint", "--step", "refactor", "--from", key], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: gitEnv() });
  return { code: status, stdout, stderr };
}

function assertPasses(result) {
  assert.equal(result.code, 0, `succeeds, stderr: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assertRefused(repo, seed, result, pattern) {
  assert.equal(result.code, 1, `exits 1: stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(result.stdout, "", "prints no result");
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "it is not a crash");
  assert.equal(repo.head(), seed, "no commit was made");
}

describe("pb checkpoint --step refactor", IN_PARALLEL, () => {
  test("a code fix group commits as refactor once the task's tests still pass", () => {
    const repo = makeRepo();
    repo.write("src.mjs", "cleaner code\n");
    fixed(repo, codeKey(), ["src.mjs"]);

    const done = assertPasses(refactor(repo, codeKey()));

    assert.equal(done.committed, true);
    assert.equal(repo.message(), "refactor: name the discount rule");
    assert.deepEqual(repo.committed(), ["src.mjs"]);
    assert.deepEqual(repo.runs(), [["tests/a.mjs::t1"]], "the task's test ran, by its selector");
    assert.deepEqual(repo.ledger().commits, [repo.head()]);
    assert.equal(repo.ledger().tests.refactor.passed, true);
    assert.equal(repo.ledger().tests.refactor.head, git(repo.dir, "rev-parse", "HEAD~1"), "the run is bound to the commit it ran on");
    assert.deepEqual(repo.ledger().checkpoints.map(({ step, key, committed }) => ({ step, key, committed })), [{ step: "refactor", key: codeKey(), committed: true }]);
  });

  test("a fix group that changes only tests commits as test", () => {
    const repo = makeRepo();
    repo.write("tests/a.mjs", "clearer test\n");
    fixed(repo, testsKey(), ["tests/a.mjs"], "test: name the arrange step");

    assertPasses(refactor(repo, testsKey()));

    assert.equal(repo.message(), "test: name the arrange step");
  });

  test("the type comes from the paths, so a code agent's test-only change is test too", () => {
    const repo = makeRepo();
    repo.write("tests/a.mjs", "clearer test\n");
    fixed(repo, codeKey(), ["tests/a.mjs"], "refactor: share the fixture");

    assertPasses(refactor(repo, codeKey()));

    assert.equal(repo.message(), "test: share the fixture");
  });

  test("a group that touches code and tests commits as refactor", () => {
    const repo = makeRepo();
    repo.write("tests/a.mjs", "clearer test\n");
    repo.write("src.mjs", "cleaner code\n");
    fixed(repo, codeKey(), ["src.mjs", "tests/a.mjs"]);

    assertPasses(refactor(repo, codeKey()));

    assert.equal(repo.message(), "refactor: name the discount rule");
    assert.deepEqual(repo.committed(), ["src.mjs", "tests/a.mjs"]);
  });

  test("a fix that breaks a test of the task is refused, with the failed run in the ledger", () => {
    const repo = makeRepo({ rows: [row("t1"), row("t2")], perTest: { t1: closed, t2: closed }, outcomes: { "tests/a.mjs::t1": 0, "tests/a.mjs::t2": 1 } });
    const seed = repo.head();
    repo.write("src.mjs", "broken code\n");
    fixed(repo, codeKey("t2"), ["src.mjs"]);

    assertRefused(repo, seed, refactor(repo, codeKey("t2")), /tests failed/);

    assert.deepEqual(repo.runs(), [["tests/a.mjs::t1"], ["tests/a.mjs::t2"]]);
    assert.equal(repo.ledger().tests.refactor.passed, false);
    assert.deepEqual(repo.ledger().tests.refactor.runs.map(({ exitCode }) => exitCode), [0, 1]);
    assert.equal(repo.ledger().checkpoints, undefined, "a refused step is no evidence");
  });

  test("a covered test of the task runs too, and a test still at its placeholder does not", () => {
    const repo = makeRepo({ rows: [row("t1"), row("t2"), row("t3")], perTest: { t1: closed, t2: coveredRow, t3: { selector: {}, red: { done: true } } }, outcomes: { "tests/a.mjs::t1": 0, "tests/a.mjs::t2": 0, "tests/a.mjs::t3": 1 } });
    repo.write("src.mjs", "cleaner code\n");
    fixed(repo, codeKey(), ["src.mjs"]);

    assertPasses(refactor(repo, codeKey()));

    assert.deepEqual(repo.runs(), [["tests/a.mjs::t1"], ["tests/a.mjs::t2"]]);
  });

  test("a group with no change makes no commit and runs no test", () => {
    const repo = makeRepo();
    const seed = repo.head();
    fixed(repo, codeKey(), []);

    const done = assertPasses(refactor(repo, codeKey()));

    assert.equal(done.committed, false);
    assert.equal(repo.head(), seed);
    assert.deepEqual(repo.runs(), []);
    assert.deepEqual(repo.ledger().checkpoints.map(({ committed }) => committed), [false]);
  });

  test("a listed file that did not change is a group with no change", () => {
    const repo = makeRepo();
    const seed = repo.head();
    fixed(repo, codeKey(), ["src.mjs"]);

    assert.equal(assertPasses(refactor(repo, codeKey())).committed, false);
    assert.equal(repo.head(), seed);
  });

  test("bug_fix has no per-cycle refactor, so the step is refused", () => {
    const repo = makeRepo({ taskType: "bug_fix" });
    const seed = repo.head();
    repo.write("src.mjs", "cleaner code\n");
    fixed(repo, codeKey(), ["src.mjs"]);

    assertRefused(repo, seed, refactor(repo, codeKey()), /new_feature/);
    assert.deepEqual(repo.runs(), []);
  });

  test("a cycle whose GREEN is not done has nothing to refactor yet", () => {
    const repo = makeRepo({ perTest: { t1: { selector: {}, red: { done: true } } } });
    const seed = repo.head();
    repo.write("src.mjs", "cleaner code\n");
    fixed(repo, codeKey(), ["src.mjs"]);

    assertRefused(repo, seed, refactor(repo, codeKey()), /t1 has no GREEN/);
  });

  test("refactor-tests changes tests alone", () => {
    const repo = makeRepo();
    const seed = repo.head();
    repo.write("src.mjs", "cleaner code\n");
    fixed(repo, testsKey(), ["src.mjs"]);

    assertRefused(repo, seed, refactor(repo, testsKey()), /outside the test_directory/);
  });

  for (const [name, key] of [["a finder's key", `${STAGE}.identify-code-issues.t1.r1.a1`], ["a GREEN key", `${STAGE}.implement-code.t1.r1.a1`]]) {
    test(`${name} is refused`, () => {
      const repo = makeRepo();
      const seed = repo.head();
      repo.write("src.mjs", "cleaner code\n");
      fixed(repo, key, ["src.mjs"]);

      assertRefused(repo, seed, refactor(repo, key), /takes role refactor-code or refactor-tests/);
    });
  }

  test("a key that names no test is refused", () => {
    const repo = makeRepo();
    const key = `${STAGE}.refactor-code.-.r1.a1`;
    fixed(repo, key, ["src.mjs"]);

    assertRefused(repo, repo.head(), refactor(repo, key), /names no test/);
  });
});
