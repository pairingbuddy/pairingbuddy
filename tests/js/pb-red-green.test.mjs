// Task 44: pb checkpoint --step placeholders|red|green, and what stage finish and the report make of it. Every test drives
// the real CLI as a subprocess in a temp git repo. The test command is a small node script that logs its argv and exits
// with the code .git/outcomes.json holds for its first argument, or 5 when that names nothing, as pytest does for "no
// tests". Given a bare file it exits 1 when any test in that file fails, which is what a per-file selection would see.
//
// Output contract: a step prints {ok, step, key, committed, ...} and exits 0. A test that does not meet its step is a
// refusal: exit 1, no commit, and the run lands in ledger.tests.perTest[id][step] with done: false.
// ledger.tests.perTest[id] = { selector: {runner_id, test_file, test_function}, red, green }, where red and green are
// { stage, attempt, passed, done, exitCodes, timedOut, excerpt, head, sha }. done is true once the step's commit landed, or
// there was nothing to commit. A test that passes at RED after an earlier GREEN of this task gets covered in place of a
// GREEN: { stage, attempt, done, exitCodes, timedOut, excerpt, head, sha, after: { test_id, sha } }.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, updateLedger, writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const STAGE = "code-tdd";
const ATTEMPT = 2;
const TESTS_KEY = `${STAGE}.create-test-placeholders.-.r1.a${ATTEMPT}`;
const redKey = (id = "t1", round = 1, attempt = ATTEMPT) => `${STAGE}.implement-tests.${id}.r${round}.a${attempt}`;
const greenKey = (id = "t1", round = 1, attempt = ATTEMPT) => `${STAGE}.implement-code.${id}.r${round}.a${attempt}`;
const RUNS = join(".git", "test-runs.log");
const IN_PARALLEL = { concurrency: 8 };
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const PYTEST_TEMPLATE = ["{test_file}::{test_function}"];

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
const inFile = Object.entries(outcomes).filter(([name]) => name.startsWith(selected + "::")).map(([, code]) => code);
if (inFile.length > 0) process.exit(inFile.some((code) => code !== 0) ? 1 : 0);
process.exit(Object.hasOwn(outcomes, selected) ? outcomes[selected] : 5);
`;

const runner = (over) => ({ name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [], selector_template: PYTEST_TEMPLATE, ...over });
const config = (over) => ({ source_directory: ".", runners: { fake: runner(over) }, default_runner: "fake" });
const row = (test_id = "t1", over) => ({ test_id, test_case_id: "c", scenario_id: "s", runner_id: "fake", test_file: "tests/a.mjs", test_function: test_id, ...over });

function makeRepo({ runnerConfig, outcomes = { "tests/a.mjs::t1": 1 }, rows = [row()], taskType = "bug_fix", ledger = {} } = {}) {
  const dir = makeDir("pb-red-green-");
  git(dir, "init", "-q", "-b", "feature");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "tests", "a.mjs"), "placeholder\n");
  writeFileSync(join(dir, "src.mjs"), "seed\n");
  writeFileSync(join(dir, "fake.mjs"), FAKE_TESTS);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "seed");
  writeFileSync(join(dir, ".git", "outcomes.json"), JSON.stringify(outcomes));
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  const configText = JSON.stringify(config(runnerConfig));
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), configText);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType,
    owner: { sessionId: null, lastSeen: null }, task: "Task 44", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "", source: "" },
    stage: { name: STAGE, status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [], gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    ...ledger,
  });
  const repo = {
    dir, taskDir, ledgerPath,
    ledger: () => readLedger(ledgerPath),
    head: () => git(dir, "rev-parse", "HEAD"),
    message: () => git(dir, "log", "-1", "--format=%s"),
    committed: () => git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort(),
    runs: () => (existsSync(join(dir, RUNS)) ? readFileSync(join(dir, RUNS), "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
    write: (name, text) => writeFileSync(join(dir, name), text),
    outcomes: (next) => writeFileSync(join(dir, ".git", "outcomes.json"), JSON.stringify(next)),
  };
  if (rows !== null) writeTests(repo, rows);
  return repo;
}

function writeArtifact(repo, key, content) {
  writeFileSync(join(repo.taskDir, "artifacts", `${key}.json`), JSON.stringify(content));
}

const writeTests = (repo, tests, key = TESTS_KEY) => writeArtifact(repo, key, { pb_key: key, ambiguity: "", commit_subject: "add placeholders", files_changed: [], tests });

// The coverage check's return, which code-tdd needs at its attempt to finish (Task 49).
const coverageKey = (attempt = ATTEMPT) => `${STAGE}.verify-test-coverage.-.r1.a${attempt}`;
const coverageDone = (repo, attempt = ATTEMPT) => writeArtifact(repo, coverageKey(attempt), { pb_key: coverageKey(attempt), ambiguity: "", status: "complete", scenarios_covered: 1, scenarios_total: 1, test_cases_covered: 1, test_cases_total: 1, gaps: [] });

const fileReturn = (key, over) => ({ pb_key: key, ambiguity: "", commit_subject: "cover the crash", files_changed: [], ...over });

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: gitEnv() });
  return { code: status, stdout, stderr };
}

const step = (repo, name, key) => pb(repo, "checkpoint", "--step", name, "--from", key);

function assertPasses(result) {
  assert.equal(result.code, 0, `succeeds, stderr: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assertRefused(repo, seed, result, pattern, code = 1) {
  assert.equal(result.code, code, `exits ${code}: stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(result.stdout, "", "prints no result");
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "it is not a crash");
  assert.equal(repo.head(), seed, "no commit was made");
}

// A failing test written and a failing run, ready for GREEN.
function redDone(repo, key = redKey()) {
  repo.write("tests/a.mjs", "real test\n");
  writeArtifact(repo, key, fileReturn(key, { commit_subject: "cover the crash", files_changed: ["tests/a.mjs"] }));
  return assertPasses(step(repo, "red", key));
}

function greenReady(repo, { outcomes = { "tests/a.mjs::t1": 0 }, over = {} } = {}) {
  redDone(repo);
  repo.outcomes(outcomes);
  repo.write("src.mjs", "fixed\n");
  writeArtifact(repo, greenKey(), fileReturn(greenKey(), { commit_subject: "stop the crash", files_changed: ["src.mjs"], ...over }));
}

describe("RED", IN_PARALLEL, () => {
  test("a failing test commits as test, with its evidence per test", () => {
    const repo = makeRepo();
    const seed = repo.head();

    const done = redDone(repo);

    assert.equal(done.committed, true);
    assert.equal(repo.message(), "test: cover the crash");
    assert.deepEqual(repo.committed(), ["tests/a.mjs"]);
    assert.deepEqual(repo.runs(), [["tests/a.mjs::t1"]], "exactly this test ran");
    const record = repo.ledger().tests.perTest.t1;
    assert.deepEqual(record.selector, { runner_id: "fake", test_file: "tests/a.mjs", test_function: "t1" });
    assert.deepEqual(
      { ...record.red, excerpt: undefined },
      { stage: STAGE, attempt: ATTEMPT, passed: true, done: true, exitCodes: [1], timedOut: false, excerpt: undefined, head: seed, sha: repo.head() },
    );
    assert.match(record.red.excerpt, /ran tests\/a\.mjs::t1/);
    assert.deepEqual(repo.ledger().commits, [repo.head()]);
  });

  test("a test that passes is refused, even though another test in its file fails", () => {
    const repo = makeRepo({ rows: [row("t1"), row("t2")], outcomes: { "tests/a.mjs::t1": 0, "tests/a.mjs::t2": 1 } });
    const seed = repo.head();
    repo.write("tests/a.mjs", "real test\n");
    writeArtifact(repo, redKey(), fileReturn(redKey(), { files_changed: ["tests/a.mjs"] }));

    const result = step(repo, "red", redKey());

    assertRefused(repo, seed, result, /t1.*not RED|not RED.*t1/s);
    assert.deepEqual(repo.runs(), [["tests/a.mjs::t1"]], "the selection named the test, not its file");
    const { red } = repo.ledger().tests.perTest.t1;
    assert.deepEqual([red.passed, red.done, red.exitCodes], [false, false, [0]], "a refused run is still evidence");
    assert.deepEqual(repo.ledger().commits, []);
  });

  for (const [name, code] of [["pytest's 5 for no tests", 5], ["pytest's 4 for a selection that names nothing", 4], ["pytest's 2 for a collection error", 2]]) {
    test(`${name} is not RED`, () => {
      const repo = makeRepo({ outcomes: { "tests/a.mjs::t1": code } });
      const seed = repo.head();
      writeArtifact(repo, redKey(), fileReturn(redKey()));

      assertRefused(repo, seed, step(repo, "red", redKey()), /not RED/);
    });
  }

  test("a selection that matches nothing is not RED", () => {
    const repo = makeRepo({ outcomes: { "tests/a.mjs::other": 1 } });
    const seed = repo.head();
    writeArtifact(repo, redKey(), fileReturn(redKey()));

    assertRefused(repo, seed, step(repo, "red", redKey()), /not RED/);
  });

  test("a code the runner configures counts as RED, and the default code then does not", () => {
    const repo = makeRepo({ runnerConfig: { failure_exit_codes: [2] }, outcomes: { "tests/a.mjs::t1": 2 } });
    redDone(repo);
    assert.deepEqual(repo.ledger().tests.perTest.t1.red.exitCodes, [2]);

    const other = makeRepo({ runnerConfig: { failure_exit_codes: [2] }, outcomes: { "tests/a.mjs::t1": 1 } });
    writeArtifact(other, redKey(), fileReturn(redKey()));
    assertRefused(other, other.head(), step(other, "red", redKey()), /not RED/);
  });

  test("the commit type is test whatever the subject claims", () => {
    const repo = makeRepo();
    repo.write("tests/a.mjs", "real test\n");
    writeArtifact(repo, redKey(), fileReturn(redKey(), { commit_subject: "feat(core)!: cover the crash", files_changed: ["tests/a.mjs"] }));

    assertPasses(step(repo, "red", redKey()));

    assert.equal(repo.message(), "test: cover the crash");
  });

  test("a change outside the test directory is refused before any test runs", () => {
    const repo = makeRepo();
    const seed = repo.head();
    repo.write("src.mjs", "sneaked in\n");
    writeArtifact(repo, redKey(), fileReturn(redKey(), { files_changed: ["src.mjs"] }));

    assertRefused(repo, seed, step(repo, "red", redKey()), /src\.mjs.*test_directory/);
    assert.deepEqual(repo.runs(), []);
  });

  test("a changed test file the return left out is refused, so the commit cannot miss the test", () => {
    const repo = makeRepo();
    const seed = repo.head();
    repo.write("tests/a.mjs", "real test\n");
    writeArtifact(repo, redKey(), fileReturn(redKey()));

    assertRefused(repo, seed, step(repo, "red", redKey()), /tests\/a\.mjs.*not listed|not listed.*tests\/a\.mjs/s);
  });

  test("a test with nothing to commit still needs its failing run, and then makes no commit", () => {
    const repo = makeRepo();
    const seed = repo.head();
    writeArtifact(repo, redKey(), fileReturn(redKey()));

    const done = assertPasses(step(repo, "red", redKey()));

    assert.equal(done.committed, false);
    assert.equal(repo.head(), seed);
    assert.equal(repo.ledger().tests.perTest.t1.red.done, true);
    assert.equal(repo.runs().length, 1);
  });

  test("a test whose GREEN is done cannot go back to RED", () => {
    const repo = makeRepo();
    greenReady(repo);
    assertPasses(step(repo, "green", greenKey()));
    const seed = repo.head();
    writeArtifact(repo, redKey("t1", 2), fileReturn(redKey("t1", 2)));

    assertRefused(repo, seed, step(repo, "red", redKey("t1", 2)), /t1 is finished/);
  });
});

describe("GREEN", IN_PARALLEL, () => {
  for (const [taskType, type] of [["bug_fix", "fix"], ["new_feature", "feat"]]) {
    test(`exit 0 on the selected test commits as ${type} for ${taskType}`, () => {
      const repo = makeRepo({ taskType });
      greenReady(repo, { over: { commit_subject: "test: stop the crash" } });

      assertPasses(step(repo, "green", greenKey()));

      assert.equal(repo.message(), `${type}: stop the crash`);
      assert.deepEqual(repo.committed(), ["src.mjs"]);
      const { green } = repo.ledger().tests.perTest.t1;
      assert.deepEqual([green.passed, green.done, green.exitCodes, green.sha], [true, true, [0], repo.head()]);
    });
  }

  test("a test that still fails is refused, and nothing is committed", () => {
    const repo = makeRepo();
    greenReady(repo, { outcomes: { "tests/a.mjs::t1": 1 } });
    const seed = repo.head();

    assertRefused(repo, seed, step(repo, "green", greenKey()), /not GREEN/);
    assert.deepEqual([repo.ledger().tests.perTest.t1.green.done, repo.ledger().tests.perTest.t1.green.exitCodes], [false, [1]]);
  });

  test("only the selected test decides: another failing test in the file does not hold it back", () => {
    const repo = makeRepo({ rows: [row("t1"), row("t2")], outcomes: { "tests/a.mjs::t1": 1, "tests/a.mjs::t2": 1 } });
    greenReady(repo, { outcomes: { "tests/a.mjs::t1": 0, "tests/a.mjs::t2": 1 } });

    assertPasses(step(repo, "green", greenKey()));

    assert.deepEqual(repo.runs().at(-1), ["tests/a.mjs::t1"]);
  });

  test("a timeout is neither RED nor GREEN", () => {
    const repo = makeRepo({ runnerConfig: { timeout_seconds: 0.2, command: "node hang.mjs" }, outcomes: {} });
    repo.write("hang.mjs", "setInterval(() => {}, 1000);\n");
    const seed = repo.head();
    writeArtifact(repo, redKey(), fileReturn(redKey()));

    assertRefused(repo, seed, step(repo, "red", redKey()), /not RED/);
    assert.equal(repo.ledger().tests.perTest.t1.red.timedOut, true);
  });

  test("GREEN before a RED is refused, with no test run", () => {
    const repo = makeRepo();
    const seed = repo.head();
    writeArtifact(repo, greenKey(), fileReturn(greenKey()));

    assertRefused(repo, seed, step(repo, "green", greenKey()), /no RED/);
    assert.deepEqual(repo.runs(), []);
  });

  test("a change to the test itself is refused, listed or not", () => {
    const listed = makeRepo();
    greenReady(listed, { over: { files_changed: ["src.mjs", "tests/a.mjs"] } });
    listed.write("tests/a.mjs", "weakened\n");
    assertRefused(listed, listed.head(), step(listed, "green", greenKey()), /tests\/a\.mjs/);

    const unlisted = makeRepo();
    greenReady(unlisted);
    unlisted.write("tests/a.mjs", "weakened\n");
    assertRefused(unlisted, unlisted.head(), step(unlisted, "green", greenKey()), /tests\/a\.mjs/);
  });

  for (const [taskType, name] of [["config_change", "a task type with no GREEN"], [null, "no task type"]]) {
    test(`${name} is refused`, () => {
      const repo = makeRepo({ taskType });
      greenReady(repo);

      assertRefused(repo, repo.head(), step(repo, "green", greenKey()), /commit type/);
    });
  }
});

describe("selectors come from the artifact alone", IN_PARALLEL, () => {
  const near = [
    ["a positional selector", ["checkpoint", "--step", "red", "--from", redKey(), "tests/a.mjs::other"]],
    ["a selector flag", ["checkpoint", "--step", "red", "--from", redKey(), "--select", "tests/a.mjs::other"]],
    ["a selector before the step", ["checkpoint", "tests/a.mjs::other", "--step", "red", "--from", redKey()]],
    ["a selector on pb test", ["test", "tests/a.mjs::other"]],
  ];
  for (const [name, args] of near) {
    test(`${name} is a usage error, and runs nothing`, () => {
      const repo = makeRepo();
      writeArtifact(repo, redKey(), fileReturn(redKey()));

      assertRefused(repo, repo.head(), pb(repo, ...args), /usage/, 2);
      assert.deepEqual(repo.runs(), []);
    });
  }

  test("a key naming a test the artifact does not hold is refused", () => {
    const repo = makeRepo();
    writeArtifact(repo, redKey("t9"), fileReturn(redKey("t9")));

    assertRefused(repo, repo.head(), step(repo, "red", redKey("t9")), /t9.*tests artifact/);
    assert.deepEqual(repo.runs(), []);
  });

  test("a selector in the agent's own return is ignored", () => {
    const repo = makeRepo();
    writeArtifact(repo, redKey(), fileReturn(redKey(), { test_file: "tests/other.mjs", test_function: "other", selector: "tests/other.mjs::other", tests: [row("t1", { test_function: "other" })] }));

    assertPasses(step(repo, "red", redKey()));

    assert.deepEqual(repo.runs(), [["tests/a.mjs::t1"]]);
  });

  test("a tests artifact from another attempt is no selection", () => {
    const repo = makeRepo({ rows: null });
    writeTests(repo, [row()], `${STAGE}.create-test-placeholders.-.r1.a1`);
    writeArtifact(repo, redKey(), fileReturn(redKey()));

    assertRefused(repo, repo.head(), step(repo, "red", redKey()), /no tests artifact/);
  });

  test("a file filed under the tests key that names another key is no selection", () => {
    const repo = makeRepo({ rows: null });
    writeArtifact(repo, TESTS_KEY, { pb_key: "code-tdd.create-test-placeholders.-.r1.a9", tests: [row()] });
    writeArtifact(repo, redKey(), fileReturn(redKey()));

    assertRefused(repo, repo.head(), step(repo, "red", redKey()), /pb_key/);
  });

  test("a key from another role is refused", () => {
    const repo = makeRepo();
    const key = `${STAGE}.implement-code.t1.r1.a${ATTEMPT}`;
    writeArtifact(repo, key, fileReturn(key));

    assertRefused(repo, repo.head(), step(repo, "red", key), /takes role implement-tests/);
  });

  test("a step that needs a test refuses a key with no item", () => {
    const repo = makeRepo();
    const key = `${STAGE}.implement-tests.-.r1.a${ATTEMPT}`;
    writeArtifact(repo, key, fileReturn(key));

    assertRefused(repo, repo.head(), step(repo, "red", key), /names no test/);
  });

  for (const [name, over, pattern] of [
    ["a file::name test_function", { test_function: "tests/b.mjs::other" }, /test_function/],
    ["a flag for a test_function", { test_function: "--co" }, /test_function/],
    ["an args file for a test_function", { test_function: "@evil" }, /test_function/],
    ["no test_function", { test_function: "" }, /test_function/],
    ["a selector inside test_file", { test_file: "tests/a.mjs::other" }, /test_file/],
  ]) {
    test(`${name} in the artifact is refused`, () => {
      const repo = makeRepo({ rows: [row("t1", over)] });
      writeArtifact(repo, redKey(), fileReturn(redKey()));

      assertRefused(repo, repo.head(), step(repo, "red", redKey()), pattern);
      assert.deepEqual(repo.runs(), []);
    });
  }
});

describe("class-nested tests", IN_PARALLEL, () => {
  for (const name of ["TestLogin::test_valid", "TestOuter::TestInner::test_valid"]) {
    test(`${name} reaches the runner as one selector`, () => {
      const repo = makeRepo({ rows: [row("t1", { test_function: name })], outcomes: { [`tests/a.mjs::${name}`]: 1 } });

      redDone(repo);

      assert.deepEqual(repo.runs(), [[`tests/a.mjs::${name}`]]);
    });
  }

  for (const name of ["::test_valid", "TestLogin::", "Test Login::test_valid", "TestLogin:::test_valid", "TestLogin::test valid", "tests/a.py::TestLogin::test_valid", "a.b::test_valid", "TestLogin::-x"]) {
    test(`${JSON.stringify(name)} is more than a class path, so it stays refused`, () => {
      const repo = makeRepo({ rows: [row("t1", { test_function: name })] });
      writeArtifact(repo, redKey(), fileReturn(redKey()));

      assertRefused(repo, repo.head(), step(repo, "red", redKey()), /test_function/);
      assert.deepEqual(repo.runs(), []);
    });
  }
});

describe("the selector template", IN_PARALLEL, () => {
  test("a runner with no template cannot attribute a test, so RED refuses", () => {
    const repo = makeRepo({ runnerConfig: { selector_template: undefined } });
    writeArtifact(repo, redKey(), fileReturn(redKey()));

    assertRefused(repo, repo.head(), step(repo, "red", redKey()), /selector_template/);
    assert.deepEqual(repo.runs(), []);
  });

  test("the template may use several words, each filled with no shell", () => {
    const repo = makeRepo({ runnerConfig: { selector_template: ["{test_file}", "--name=^{test_function}$"] }, outcomes: { "tests/a.mjs": 1 }, rows: [row("t1", { test_function: "a $(whoami) `b` {test_file}" })] });

    redDone(repo);

    assert.deepEqual(repo.runs(), [["tests/a.mjs", "--name=^a $(whoami) `b` {test_file}$"]]);
  });

  test("run_args still come after the selection", () => {
    const repo = makeRepo({ runnerConfig: { run_args: ["-v"] } });

    redDone(repo);

    assert.deepEqual(repo.runs(), [["tests/a.mjs::t1", "-v"]]);
  });

  for (const [name, template] of [
    ["a template that is not a list", "{test_file}::{test_function}"],
    ["an empty template", []],
    ["a template that does not name the test", ["{test_file}"]],
    ["an unknown field", ["{test_file}::{test_name}"]],
    ["a word that is not text", [1]],
  ]) {
    test(`${name} is refused for every test run`, () => {
      const repo = makeRepo({ runnerConfig: { selector_template: template } });

      assertRefused(repo, repo.head(), pb(repo, "test", "--full"), /selector_template/);
    });
  }

  test("pb test runs each test on its own too, and says what the record covers", () => {
    const repo = makeRepo({ rows: [row("t1"), row("t2")], outcomes: { "tests/a.mjs::t1": 1 } });

    const { tests, attribution, runs } = assertPasses(pb(repo, "test"));

    assert.deepEqual(tests, ["t1", "t2"]);
    assert.equal(attribution, "test");
    assert.deepEqual(runs[0].argv.slice(2), ["tests/a.mjs::t1", "tests/a.mjs::t2"]);
  });

  test("with no template, pb test says its record is per file", () => {
    const repo = makeRepo({ runnerConfig: { selector_template: undefined }, outcomes: { "tests/a.mjs::t1": 1 } });

    const { attribution, runs } = assertPasses(pb(repo, "test"));

    assert.equal(attribution, "file");
    assert.deepEqual(runs[0].argv.slice(2), ["tests/a.mjs"]);
  });
});

describe("the placeholders step", IN_PARALLEL, () => {
  const placeholders = (repo, over) => writeArtifact(repo, TESTS_KEY, { pb_key: TESTS_KEY, ambiguity: "", commit_subject: "feat: add placeholders", files_changed: ["tests/a.mjs"], tests: [row()], ...over });

  test("commits one test commit and runs no test", () => {
    const repo = makeRepo();
    repo.write("tests/a.mjs", "placeholder two\n");
    placeholders(repo);

    const done = assertPasses(step(repo, "placeholders", TESTS_KEY));

    assert.equal(done.committed, true);
    assert.equal(repo.message(), "test: add placeholders");
    assert.deepEqual(repo.runs(), []);
  });

  test("with nothing changed it makes no commit, and counts as done", () => {
    const repo = makeRepo();
    const seed = repo.head();
    placeholders(repo);

    assert.equal(assertPasses(step(repo, "placeholders", TESTS_KEY)).committed, false);
    assert.equal(repo.head(), seed);
  });

  test("a change outside the test directory is refused", () => {
    const repo = makeRepo();
    repo.write("src.mjs", "sneaked in\n");
    placeholders(repo, { files_changed: ["src.mjs"] });

    assertRefused(repo, repo.head(), step(repo, "placeholders", TESTS_KEY), /src\.mjs.*test_directory/);
  });

  test("a runner with no selector template stops the run before any test is written", () => {
    const repo = makeRepo({ runnerConfig: { selector_template: undefined } });
    placeholders(repo);

    assertRefused(repo, repo.head(), step(repo, "placeholders", TESTS_KEY), /selector_template/);
    assert.match(repo.ledger().stop.reason, /selector_template/);
  });

  for (const [name, tests, pattern] of [
    ["a repeated test_id", [row("t1"), row("t1", { test_function: "t2" })], /t1.*twice/],
    ["a runner that is not configured", [row("t1", { runner_id: "other" })], /runner other/],
    ["a test_id no key can hold", [row("T 1")], /test_id/],
    ["no tests", [], /selects no tests/],
  ]) {
    test(`${name} is refused`, () => {
      const repo = makeRepo();
      placeholders(repo, { tests });

      assertRefused(repo, repo.head(), step(repo, "placeholders", TESTS_KEY), pattern);
    });
  }

  test("a row with evidence cannot change or go on a re-run", () => {
    for (const tests of [[row("t2")], [row("t1", { test_function: "renamed" })], [row("t1", { test_file: "tests/b.mjs" })]]) {
      const repo = makeRepo({ ledger: { tests: { perTest: { t1: { selector: { runner_id: "fake", test_file: "tests/a.mjs", test_function: "t1" }, red: { done: true } } } } } });
      placeholders(repo, { tests });

      assertRefused(repo, repo.head(), step(repo, "placeholders", TESTS_KEY), /t1/);
    }
  });

  test("a row whose only run failed can still be corrected on a re-run", () => {
    const repo = makeRepo({ ledger: { tests: { perTest: { t1: { selector: { runner_id: "fake", test_file: "tests/a.mjs", test_function: "typo" }, red: { done: false } } } } } });
    placeholders(repo);

    assertPasses(step(repo, "placeholders", TESTS_KEY));
  });

  // A test already in the file before the placeholders passes at its first RED, so RED could only refuse it later.
  const seedWith = (repo, text) => {
    repo.write("tests/a.mjs", text);
    git(repo.dir, "commit", "-q", "-am", "an existing test");
  };

  test("a row whose test_function is already in its test_file is refused, naming it", () => {
    const repo = makeRepo();
    seedWith(repo, "def t_old():\n    pass\n");
    repo.write("tests/a.mjs", "def t_old():\n    pass\n\ndef t1():\n    pass\n");
    placeholders(repo, { tests: [row("t1"), row("t2", { test_function: "t_old" })] });

    assertRefused(repo, repo.head(), step(repo, "placeholders", TESTS_KEY), /t_old.*already in tests\/a\.mjs/);
    assert.equal(repo.ledger().stop, null, "a new placeholders agent can fix it");
  });

  test("a pytest class path is matched by its last name", () => {
    const repo = makeRepo();
    seedWith(repo, "class TestA:\n    def test_old(self):\n        pass\n");
    placeholders(repo, { tests: [row("t1", { test_function: "TestA::test_old" })] });

    assertRefused(repo, repo.head(), step(repo, "placeholders", TESTS_KEY), /TestA::test_old/);
  });

  test("a name that only contains an existing one, or is in another file, is new", () => {
    const repo = makeRepo();
    seedWith(repo, "def t_old():\n    pass\n");
    repo.write("tests/b.mjs", "t_new\n");
    placeholders(repo, { files_changed: ["tests/b.mjs"], tests: [row("t1", { test_function: "t_old_two" }), row("t2", { test_file: "tests/b.mjs", test_function: "t_old" })] });

    assertPasses(step(repo, "placeholders", TESTS_KEY));
  });

  test("a re-run judges its rows at the commit before the first placeholders", () => {
    const repo = makeRepo();
    repo.write("tests/a.mjs", "placeholder t1\n");
    placeholders(repo);
    assertPasses(step(repo, "placeholders", TESTS_KEY));
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, attempt: 3 } }));
    const key = `${STAGE}.create-test-placeholders.-.r1.a3`;
    writeArtifact(repo, key, { pb_key: key, ambiguity: "", commit_subject: "add placeholders", files_changed: [], tests: [row()] });

    assert.equal(assertPasses(step(repo, "placeholders", key)).committed, false);
  });

  test("a test id that names a method every object has starts with no evidence", () => {
    const repo = makeRepo({ rows: [row("constructor")], outcomes: { "tests/a.mjs::constructor": 1 } });

    assert.equal(redDone(repo, redKey("constructor")).committed, true);
  });
});

describe("a re-run carries the evidence across attempts", IN_PARALLEL, () => {
  test("GREEN at the next attempt stands on RED from the last one", () => {
    const repo = makeRepo();
    redDone(repo);
    repo.outcomes({ "tests/a.mjs::t1": 0 });
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, attempt: 3 } }));
    writeTests(repo, [row()], `${STAGE}.create-test-placeholders.-.r1.a3`);
    repo.write("src.mjs", "fixed\n");
    const key = greenKey("t1", 1, 3);
    writeArtifact(repo, key, fileReturn(key, { files_changed: ["src.mjs"] }));

    assertPasses(step(repo, "green", key));

    assert.equal(repo.ledger().tests.perTest.t1.green.attempt, 3);
  });

  test("a key from a finished attempt records nothing", () => {
    const repo = makeRepo();
    const seed = repo.head();
    writeArtifact(repo, redKey(), fileReturn(redKey()));
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, attempt: 3 } }));

    assertRefused(repo, seed, step(repo, "red", redKey()), /attempt/);
    assert.equal(repo.ledger().tests.perTest, undefined);
  });
});

// A test that passes at RED because an earlier GREEN in this task made it pass is kept: it commits as test, records as
// covered with its exit-0 run and the earliest GREEN before it, and skips its GREEN. Before any GREEN it proves nothing.
describe("a test an earlier GREEN covered", IN_PARALLEL, () => {
  const TWO = [row("t1"), row("t2")];

  // t1 through RED and GREEN, then t2 written and passing, ready for its RED.
  function coveredReady(repo, outcomes = { "tests/a.mjs::t1": 0, "tests/a.mjs::t2": 0 }) {
    greenReady(repo, { outcomes });
    assertPasses(step(repo, "green", greenKey()));
    repo.write("tests/a.mjs", "real test\nsecond test\n");
    writeArtifact(repo, redKey("t2"), fileReturn(redKey("t2"), { commit_subject: "pin zero percent", files_changed: ["tests/a.mjs"] }));
  }

  test("commits as test, records covered with its exit-0 run and the GREEN before it, and says so", () => {
    const repo = makeRepo({ rows: TWO });
    coveredReady(repo);
    const greenSha = repo.head();

    const done = assertPasses(step(repo, "red", redKey("t2")));

    assert.equal(done.committed, true);
    assert.equal(done.outcome, "covered");
    assert.deepEqual(done.after, { test_id: "t1", sha: greenSha });
    assert.equal(repo.message(), "test: pin zero percent");
    assert.deepEqual(repo.committed(), ["tests/a.mjs"]);
    const record = repo.ledger().tests.perTest.t2;
    assert.deepEqual(
      { ...record.covered, excerpt: undefined },
      { stage: STAGE, attempt: ATTEMPT, done: true, exitCodes: [0], timedOut: false, excerpt: undefined, head: greenSha, sha: repo.head(), after: { test_id: "t1", sha: greenSha } },
    );
    assert.match(record.covered.excerpt, /ran tests\/a\.mjs::t2/);
    assert.equal(record.red.done, false, "it never failed, so it has no RED");
    assert.equal(record.green, undefined, "its GREEN is skipped");
    assert.ok(repo.ledger().commits.includes(repo.head()));
  });

  test("names the earliest GREEN before it when several came first", () => {
    const repo = makeRepo({ rows: [row("t1"), row("t2"), row("t3")] });
    greenReady(repo, { outcomes: { "tests/a.mjs::t1": 0, "tests/a.mjs::t2": 1 } });
    assertPasses(step(repo, "green", greenKey()));
    const firstGreen = repo.head();
    repo.write("tests/a.mjs", "t2 test\n");
    writeArtifact(repo, redKey("t2"), fileReturn(redKey("t2"), { files_changed: ["tests/a.mjs"] }));
    assertPasses(step(repo, "red", redKey("t2")));
    repo.outcomes({ "tests/a.mjs::t1": 0, "tests/a.mjs::t2": 0, "tests/a.mjs::t3": 0 });
    repo.write("src.mjs", "fixed again\n");
    writeArtifact(repo, greenKey("t2"), fileReturn(greenKey("t2"), { files_changed: ["src.mjs"] }));
    assertPasses(step(repo, "green", greenKey("t2")));
    repo.write("tests/a.mjs", "t3 test\n");
    writeArtifact(repo, redKey("t3"), fileReturn(redKey("t3"), { files_changed: ["tests/a.mjs"] }));

    const done = assertPasses(step(repo, "red", redKey("t3")));

    assert.deepEqual(done.after, { test_id: "t1", sha: firstGreen });
  });

  test("a test that passes before any GREEN is still refused, as one that proves nothing", () => {
    const repo = makeRepo({ outcomes: { "tests/a.mjs::t1": 0 } });
    const seed = repo.head();
    repo.write("tests/a.mjs", "real test\n");
    writeArtifact(repo, redKey(), fileReturn(redKey(), { files_changed: ["tests/a.mjs"] }));

    assertRefused(repo, seed, step(repo, "red", redKey()), /not RED.*no GREEN/s);
    assert.equal(repo.ledger().tests.perTest.t1.covered, undefined);
  });

  test("only exit 0 is covered: a code that is neither RED nor a pass is refused after a GREEN too", () => {
    const repo = makeRepo({ rows: TWO });
    coveredReady(repo, { "tests/a.mjs::t1": 0, "tests/a.mjs::t2": 5 });
    const seed = repo.head();

    assertRefused(repo, seed, step(repo, "red", redKey("t2")), /not RED/);
    assert.equal(repo.ledger().tests.perTest.t2.covered, undefined);
  });

  test("its GREEN is refused with no test run", () => {
    const repo = makeRepo({ rows: TWO });
    coveredReady(repo);
    assertPasses(step(repo, "red", redKey("t2")));
    const seed = repo.head();
    const runs = repo.runs().length;
    repo.write("src.mjs", "more\n");
    writeArtifact(repo, greenKey("t2"), fileReturn(greenKey("t2"), { files_changed: ["src.mjs"] }));

    assertRefused(repo, seed, step(repo, "green", greenKey("t2")), /t2 is covered/);
    assert.equal(repo.runs().length, runs);
  });

  test("pb tdd state lists it as covered, and not as RED", () => {
    const repo = makeRepo({ rows: TWO, ledger: { stages: [{ name: "code-scenarios", status: "done", attempt: 1 }] } });
    writeArtifact(repo, "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1", { pb_key: "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1", ambiguity: "", scenarios: [] });
    coveredReady(repo);
    assertPasses(step(repo, "red", redKey("t2")));

    const state = assertPasses(pb(repo, "tdd", "state"));

    assert.deepEqual([state.red, state.green, state.covered], [["t1"], ["t1"], ["t2"]]);
  });

  test("the stage finishes on it, and the report and pb status list it", () => {
    const repo = makeRepo({ rows: TWO, ledger: { stages: [{ name: "code-scenarios", status: "done", attempt: 1 }], gates: { "G:scenarios": { source: "auto" } } } });
    assertPasses(step(repo, "placeholders", TESTS_KEY));
    coveredReady(repo);
    const greenSha = repo.head();
    assertPasses(step(repo, "red", redKey("t2")));
    coverageDone(repo);

    assertPasses(pb(repo, "stage", "finish"));

    const { report } = assertPasses(pb(repo, "stage", "report"));
    assert.deepEqual(report.covered.map(({ test_id, exitCodes, after }) => ({ test_id, exitCodes, after })), [{ test_id: "t2", exitCodes: [0], after: { test_id: "t1", sha: greenSha } }]);
    assert.match(report.covered[0].excerpt, /ran tests\/a\.mjs::t2/);
    assert.deepEqual(report.redEvidence.map(({ test_id }) => test_id), ["t1"]);
    const status = assertPasses(pb(repo, "status"));
    assert.deepEqual(status.covered, [{ test_id: "t2", after: { test_id: "t1", sha: greenSha }, sha: repo.head() }]);
  });

  test("pb status lists none when no test was covered", () => {
    const repo = makeRepo();

    assert.deepEqual(assertPasses(pb(repo, "status")).covered, []);
  });
});

describe("pb tdd state", IN_PARALLEL, () => {
  const SCENARIOS_KEY = (attempt) => `code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a${attempt}`;
  const path = (key) => `.pairingbuddy/run/task/artifacts/${key}.json`;
  const scenarios = (repo, attempt) => writeArtifact(repo, SCENARIOS_KEY(attempt), { pb_key: SCENARIOS_KEY(attempt), ambiguity: "", scenarios: [] });
  const stagesWith = (attempt) => ({ stages: [{ name: "code-scenarios", status: "done", attempt }] });

  test("names the scenarios of the attempt that stands, and no tests on a first run", () => {
    const repo = makeRepo({ rows: null, ledger: stagesWith(2) });
    scenarios(repo, 1);
    scenarios(repo, 2);

    const state = assertPasses(pb(repo, "tdd", "state"));

    const { testRunners, ...rest } = state;
    assert.deepEqual(rest, { ok: true, taskType: "bug_fix", scenarios: path(SCENARIOS_KEY(2)), tests: null, red: [], green: [], covered: [] });
  });

  test("tdd-state-includes-test-runners", () => {
    const repo = makeRepo({ rows: null, ledger: stagesWith(1) });
    scenarios(repo, 1);
    const { test_directory, file_pattern } = runner();

    const state = assertPasses(pb(repo, "tdd", "state"));

    assert.deepEqual(state.testRunners, { fake: { test_directory, file_pattern } });
  });

  test("tdd-state-refuses-without-test-config", () => {
    const repo = makeRepo({ rows: null, ledger: stagesWith(1) });
    scenarios(repo, 1);
    rmSync(join(repo.dir, ".pairingbuddy", "test-config.json"));

    assertRefused(repo, repo.head(), pb(repo, "tdd", "state"), /missing .*test-config\.json/);
  });

  test("names the task type from the ledger, since the stage refactors per cycle for new_feature only", () => {
    const repo = makeRepo({ rows: null, taskType: "new_feature", ledger: stagesWith(1) });
    scenarios(repo, 1);

    assert.equal(assertPasses(pb(repo, "tdd", "state")).taskType, "new_feature");
  });

  test("names the newest rows and what tests{} holds as done", () => {
    const repo = makeRepo({
      rows: null,
      ledger: {
        ...stagesWith(1),
        tests: { perTest: { t1: { selector: {}, red: { done: true }, green: { done: true } }, t2: { selector: {}, red: { done: true }, green: { done: false } }, t3: { selector: {}, red: { done: false } } } },
      },
    });
    scenarios(repo, 1);
    writeTests(repo, [row()], `${STAGE}.create-test-placeholders.-.r1.a1`);

    const state = assertPasses(pb(repo, "tdd", "state"));

    assert.equal(state.tests, path(`${STAGE}.create-test-placeholders.-.r1.a1`));
    assert.deepEqual(state.red, ["t1", "t2"]);
    assert.deepEqual(state.green, ["t1"]);
  });

  test("no scenarios refuses", () => {
    const repo = makeRepo({ rows: null, ledger: stagesWith(1) });

    assertRefused(repo, repo.head(), pb(repo, "tdd", "state"), /scenarios/);
  });

  test("takes no selector", () => {
    const repo = makeRepo({ rows: null });

    assertRefused(repo, repo.head(), pb(repo, "tdd", "state", "t1"), /usage/, 2);
  });
});

describe("pb stage stop", IN_PARALLEL, () => {
  for (const reason of ["agent-budget", "step-failed"]) {
    test(`${reason} stops the run, and stage fail clears it`, () => {
      const repo = makeRepo();

      assertPasses(pb(repo, "stage", "stop", reason));

      assert.match(repo.ledger().stop.reason, new RegExp(reason));
      assertPasses(pb(repo, "stage", "fail"));
      assert.equal(repo.ledger().stop, null);
    });
  }

  test("a stop already there stands", () => {
    // Guards that a second pb stage stop does not replace an existing stop (checked by its reason).
    const repo = makeRepo({ ledger: { stop: { reason: "the first one", seq: 1, code: "step-failed" } } });

    assertPasses(pb(repo, "stage", "stop", "agent-budget"));

    assert.equal(repo.ledger().stop.reason, "the first one");
  });

  for (const args of [[], ["why not"], ["agent-budget", "extra"], ["constructor"]]) {
    test(`stage stop ${JSON.stringify(args)} is a usage error`, () => {
      const repo = makeRepo();

      assertRefused(repo, repo.head(), pb(repo, "stage", "stop", ...args), /usage/, 2);
      assert.equal(repo.ledger().stop, null);
    });
  }

  test("with no active stage it changes nothing", () => {
    const repo = makeRepo({ ledger: { stage: { name: STAGE, status: "done", runId: "wf_1", attempt: 1, startedAt: null } } });

    assertRefused(repo, repo.head(), pb(repo, "stage", "stop", "agent-budget"), /no stage is active/);
    assert.equal(repo.ledger().stop, null);
  });
});

describe("stage finish and the report", IN_PARALLEL, () => {
  const finishable = (rows = [row()]) => makeRepo({ rows, ledger: { stages: [{ name: "code-scenarios", status: "done", attempt: 1 }], gates: { "G:scenarios": { source: "auto" } } } });
  const placeholdersDone = (repo) => {
    writeArtifact(repo, TESTS_KEY, { pb_key: TESTS_KEY, ambiguity: "", commit_subject: "x", files_changed: [], tests: JSON.parse(readFileSync(join(repo.taskDir, "artifacts", `${TESTS_KEY}.json`), "utf8")).tests });
    assertPasses(step(repo, "placeholders", TESTS_KEY));
  };

  test("a test with no GREEN keeps the stage from finishing", () => {
    const repo = finishable();
    placeholdersDone(repo);
    redDone(repo);

    const result = pb(repo, "stage", "finish");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /tests:cycle.*t1/);
    assert.notEqual(repo.ledger().stop, null);
  });

  test("every test through RED and GREEN finishes it, and the report carries the RED excerpt per test", () => {
    const repo = finishable();
    placeholdersDone(repo);
    greenReady(repo);
    assertPasses(step(repo, "green", greenKey()));
    coverageDone(repo);

    assertPasses(pb(repo, "stage", "finish"));

    const { report } = assertPasses(pb(repo, "stage", "report"));
    assert.deepEqual(report.redEvidence.map(({ test_id, exitCodes }) => ({ test_id, exitCodes })), [{ test_id: "t1", exitCodes: [1] }]);
    assert.match(report.redEvidence[0].excerpt, /ran tests\/a\.mjs::t1/);
    assert.ok(report.notCovered.some((line) => /read the excerpts/.test(line)), "exit codes still prove no reason");
  });

  test("a later stage's report does not repeat the excerpts", () => {
    const repo = finishable();
    placeholdersDone(repo);
    greenReady(repo);
    assertPasses(step(repo, "green", greenKey()));
    coverageDone(repo);
    assertPasses(pb(repo, "stage", "finish"));
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, name: "code-safety-net", status: "active", attempt: 1 }, tests: { ...ledger.tests, full: { stage: "code-safety-net", attempt: 1, passed: true, red: false, runs: [], head: repo.head() } } }));
    const key = "code-safety-net.update-documentation.-.r1.a1";
    writeArtifact(repo, key, { pb_key: key, ambiguity: "", commit_subject: "x", files_changed: [] });
    assertPasses(step(repo, "docs", key));

    assertPasses(pb(repo, "stage", "finish"));

    assert.deepEqual(assertPasses(pb(repo, "stage", "report")).report.redEvidence, []);
  });

  test("a re-run that had nothing left to do finishes on evidence from earlier attempts", () => {
    const repo = finishable();
    placeholdersDone(repo);
    greenReady(repo);
    assertPasses(step(repo, "green", greenKey()));
    updateLedger(repo.ledgerPath, (ledger) => ({ ...ledger, stage: { ...ledger.stage, attempt: 3 } }));
    const key = `${STAGE}.create-test-placeholders.-.r1.a3`;
    writeTests(repo, [row()], key);
    assertPasses(step(repo, "placeholders", key));
    coverageDone(repo, 3);

    assertPasses(pb(repo, "stage", "finish"));
  });

  test("every test through RED and GREEN is not enough with no coverage check at this attempt", () => {
    const repo = finishable();
    placeholdersDone(repo);
    greenReady(repo);
    assertPasses(step(repo, "green", greenKey()));
    coverageDone(repo, ATTEMPT - 1);

    const result = pb(repo, "stage", "finish");

    assert.equal(result.code, 1);
    assert.match(result.stderr, /artifact:verify-test-coverage has no return at attempt 2/);
  });

  test("the report's excerpt is bounded, because the main context reads it", () => {
    const repo = finishable();
    repo.write("fake.mjs", `${FAKE_TESTS.replace('console.log("ran " + selected);', 'console.log("x".repeat(6000));')}\n`);
    git(repo.dir, "add", "fake.mjs");
    git(repo.dir, "commit", "-q", "-m", "noisy");
    placeholdersDone(repo);
    greenReady(repo);
    assertPasses(step(repo, "green", greenKey()));
    coverageDone(repo);
    assertPasses(pb(repo, "stage", "finish"));

    const { report } = assertPasses(pb(repo, "stage", "report"));

    assert.ok(report.redEvidence[0].excerpt.length <= 1024, `kept ${report.redEvidence[0].excerpt.length}`);
  });
});
