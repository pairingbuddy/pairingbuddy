// Task 28: pb test and pb test --full. Every test drives the real CLI as a subprocess, in a temp git repo with a real
// ledger, and the test command is a small node script that logs the argv it was given.
//
// Output contract: a run that happened prints {ok, key, passed, red, runs, head} and exits 0 whatever the tests did, and
// the same record lands in ledger.tests[key], stamped with the stage and attempt. head is the commit the run started
// from, or null in a repo with none. Each run is
// {runner, argv, exitCode, signal, timedOut, durationMs, excerpt, excerptTruncated}.
// A refusal exits 1, bad arguments exit 2, and neither runs anything or changes a byte of the ledger.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const CALLS = "calls.jsonl";
const STAGE = "code-tdd";
const ATTEMPT = 2;
const ROLE = "create-test-placeholders";
const MAX_EXCERPT_BYTES = 8192;
const FAST_TIMEOUT = 0.4;
const SETTLE_MS = 3000;

const IN_PARALLEL = { concurrency: true };

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// Logs its argv, then does whatever the test asked.
const script = (body = "") => `
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify(process.argv.slice(2)) + "\\n");
${body}
`;

const runner = (over) => ({ name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [], ...over });
const singleRunner = (over) => ({ source_directory: ".", runners: { fake: runner(over) }, default_runner: "fake" });

function makeRepo({ config = singleRunner(), configText = JSON.stringify(config), body = "", ledger = {} } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-test-")));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  const configPath = join(dir, ".pairingbuddy", "test-config.json");
  writeFileSync(configPath, configText);
  writeFileSync(join(dir, "fake.mjs"), script(body));
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: null,
    owner: { sessionId: null, lastSeen: null }, task: "Task 28", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "", source: "" },
    stage: { name: STAGE, status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [], gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    ...ledger,
  });
  return {
    dir, configPath, taskDir, ledgerPath,
    ledger: () => readLedger(ledgerPath),
    bytes: () => readFileSync(ledgerPath, "utf8"),
    calls: () => (existsSync(join(dir, CALLS)) ? readFileSync(join(dir, CALLS), "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
  };
}

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, "test", ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000 });
  return { code: status, stdout, stderr };
}

function recorded(repo, ...args) {
  const result = pb(repo, ...args);
  assert.equal(result.code, 0, `the run is recorded, stderr: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assertRefuses(repo, pattern, { args = ["--full"], code = 1 } = {}) {
  const before = repo.bytes();
  const result = pb(repo, ...args);
  assert.equal(result.code, code, `refuses with exit ${code}: stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(result.stdout, "", "a refusal prints no result");
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "a refusal is not a crash");
  assert.equal(repo.bytes(), before, "a refusal leaves the ledger alone");
  assert.deepEqual(repo.calls(), [], "a refusal runs nothing");
}

function writeTests(repo, tests, { stage = STAGE, attempt = ATTEMPT, round = 1, role = ROLE } = {}) {
  const key = `${stage}.${role}.-.r${round}.a${attempt}`;
  writeFileSync(join(repo.taskDir, "artifacts", `${key}.json`), JSON.stringify({ pb_key: key, tests }));
}

const row = (test_file, over) => ({ test_id: `t-${test_file}`, test_case_id: "c", scenario_id: "s", runner_id: "fake", test_file, test_function: "f", ...over });

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === "ESRCH") return false;
    throw e;
  }
}

async function assertDies(pid) {
  const deadline = Date.now() + SETTLE_MS;
  while (isAlive(pid) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
  assert.equal(isAlive(pid), false, `process ${pid} is gone`);
}

// Starts a grandchild that ignores SIGTERM, logs both pids, then the parent waits for ever.
const STUBBORN = `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "inherit" });
writeFileSync("pids.json", JSON.stringify([process.pid, child.pid]));
console.log("started");
setInterval(() => {}, 1000);
`;

const readPids = (repo) => JSON.parse(readFileSync(join(repo.dir, "pids.json"), "utf8"));

describe("the command runs with no shell", IN_PARALLEL, () => {
  test("metacharacters in the command and run_args reach the process as literal words", () => {
    const words = ["a;b", "$(touch", "pwned)", "`touch", "pwned2`", "|", "cat", ">", "out", "&&", "touch", "pwned3", "${HOME}", "*"];
    const repo = makeRepo({ config: singleRunner({ command: `node fake.mjs ${words.join(" ")}`, run_args: ["-k", "x;touch pwned4", "$HOME"] }) });

    recorded(repo, "--full");

    assert.deepEqual(repo.calls(), [[...words, "tests", "-k", "x;touch pwned4", "$HOME"]]);
    for (const file of ["pwned", "pwned2", "pwned3", "pwned4", "out"]) assert.equal(existsSync(join(repo.dir, file)), false, `${file} was not created`);
  });

  test("quotes group a word and do not reach the process", () => {
    const repo = makeRepo({ config: singleRunner({ command: `node fake.mjs "two words" 'a "b" c' mid"dle"` }) });

    recorded(repo, "--full");

    assert.deepEqual(repo.calls(), [["two words", 'a "b" c', "middle", "tests"]]);
  });

  test("the recorded argv is what ran", () => {
    const repo = makeRepo({ config: singleRunner({ run_args: ["-v"] }) });

    assert.deepEqual(recorded(repo, "--full").runs[0].argv, ["node", "fake.mjs", "tests", "-v"]);
  });
});

describe("the exit code recorded matches the process", IN_PARALLEL, () => {
  for (const exitCode of [0, 1, 3, 5, 42]) {
    test(`exit ${exitCode}`, () => {
      const repo = makeRepo({ body: `process.exit(${exitCode});` });

      const printed = recorded(repo, "--full");

      assert.equal(printed.runs[0].exitCode, exitCode);
      assert.equal(printed.passed, exitCode === 0);
      assert.equal(repo.ledger().tests.full.runs[0].exitCode, exitCode);
    });
  }

  test("a process killed by a signal has no exit code, and records the signal", () => {
    const repo = makeRepo({ body: `process.kill(process.pid, "SIGSEGV");setInterval(() => {}, 1000);` });

    const [run] = recorded(repo, "--full").runs;

    assert.equal(run.exitCode, null);
    assert.equal(run.signal, "SIGSEGV");
    assert.equal(run.timedOut, false);
  });

  test("the record names its stage and attempt and matches what was printed", () => {
    const repo = makeRepo();

    const { ok, ...printed } = recorded(repo, "--full");

    assert.equal(ok, true);
    assert.equal(printed.key, "full");
    const { full } = repo.ledger().tests;
    assert.equal(full.stage, STAGE);
    assert.equal(full.attempt, ATTEMPT);
    assert.deepEqual(full.runs, printed.runs);
  });

  test("a later run replaces the record under its key", () => {
    const repo = makeRepo({ body: `process.exit(existsSync("again") ? 0 : 1);`.replace(/^/, `import { existsSync } from "node:fs";\n`) });
    recorded(repo, "--full");
    assert.equal(repo.ledger().tests.full.passed, false);

    writeFileSync(join(repo.dir, "again"), "");
    recorded(repo, "--full");

    assert.equal(repo.ledger().tests.full.passed, true);
  });
});

describe("the head a run saw", IN_PARALLEL, () => {
  const committedRepo = (body) => {
    const repo = makeRepo({ body });
    const identity = ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"];
    execFileSync("git", [...identity, "commit", "-q", "--allow-empty", "-m", "seed"], { cwd: repo.dir });
    return { repo, head: () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo.dir, encoding: "utf8" }).trim(), identity };
  };

  test("is recorded", () => {
    const { repo, head } = committedRepo("");

    assert.equal(recorded(repo, "--full").head, head());
    assert.equal(repo.ledger().tests.full.head, head());
  });

  test("is the one the run started from, when a test moves it", () => {
    const { repo, head } = committedRepo(`
import { execFileSync } from "node:child_process";
execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "moved"]);
`);
    const before = head();

    recorded(repo, "--full");

    assert.notEqual(head(), before);
    assert.equal(repo.ledger().tests.full.head, before);
  });

  test("is null in a repo with no commit yet, and the run is still recorded", () => {
    assert.equal(recorded(makeRepo(), "--full").head, null);
  });
});

describe("the output excerpt", IN_PARALLEL, () => {
  test("holds stdout and stderr", () => {
    const repo = makeRepo({ body: `console.log("from stdout");console.error("from stderr");` });

    const { excerpt, excerptTruncated } = recorded(repo, "--full").runs[0];

    assert.match(excerpt, /from stdout/);
    assert.match(excerpt, /from stderr/);
    assert.equal(excerptTruncated, false);
    assert.equal(repo.ledger().tests.full.runs[0].excerpt, excerpt);
  });

  test("is bounded and keeps the end of the output", () => {
    const repo = makeRepo({ body: `process.stdout.write("HEAD" + "x".repeat(1_000_000) + "TAIL", () => process.exit(1));` });

    const { excerpt, excerptTruncated } = recorded(repo, "--full").runs[0];

    assert.ok(Buffer.byteLength(excerpt) <= MAX_EXCERPT_BYTES, `excerpt is ${Buffer.byteLength(excerpt)} bytes`);
    assert.match(excerpt, /TAIL$/);
    assert.doesNotMatch(excerpt, /HEAD/);
    assert.equal(excerptTruncated, true);
    assert.ok(repo.bytes().length < MAX_EXCERPT_BYTES * 2, "the ledger stays small");
  });

  test("stays bounded and readable when the output is multi-byte or not text", () => {
    const repo = makeRepo({ body: `process.stdout.write(Buffer.concat([Buffer.from("é".repeat(50_000)), Buffer.alloc(20_000, 0xff)]));` });

    const { excerpt } = recorded(repo, "--full").runs[0];

    assert.ok(Buffer.byteLength(excerpt) <= MAX_EXCERPT_BYTES, `excerpt is ${Buffer.byteLength(excerpt)} bytes`);
    assert.equal(repo.ledger().tests.full.runs[0].excerpt, excerpt);
  });
});

describe("a config hash change refuses", IN_PARALLEL, () => {
  test("an edited test-config stops pb test before anything runs", () => {
    const repo = makeRepo();
    writeFileSync(repo.configPath, JSON.stringify(singleRunner({ command: "node fake.mjs --edited" })));

    assertRefuses(repo, /config hash changed.*stop/i);
  });

  test("the refusal names what the human types to accept the file", () => {
    const repo = makeRepo();
    writeFileSync(repo.configPath, JSON.stringify(singleRunner({ command: "node fake.mjs --edited" })));

    assertRefuses(repo, /human accept/);
  });

  test("the plain verb refuses too", () => {
    const repo = makeRepo();
    writeTests(repo, [row("tests/a.mjs")]);
    writeFileSync(repo.configPath, `${JSON.stringify(singleRunner())}\n`);

    assertRefuses(repo, /config hash changed/i, { args: [] });
  });

  test("restoring the file lets the run go on", () => {
    const repo = makeRepo();
    const original = readFileSync(repo.configPath);
    writeFileSync(repo.configPath, "{}");
    assertRefuses(repo, /config hash changed/i);

    writeFileSync(repo.configPath, original);

    assert.equal(recorded(repo, "--full").passed, true);
  });
});

describe("a missing runner or command refuses cleanly", IN_PARALLEL, () => {
  const BROKEN = [
    ["a default runner that is not configured", { config: { ...singleRunner(), default_runner: "nope" } }, /runner nope/],
    ["no runners", { config: { source_directory: ".", runners: {}, default_runner: "fake" } }, /runner fake/],
    ["no runners key", { config: { source_directory: ".", default_runner: "fake" } }, /runner fake/],
    ["an inherited name as the runner", { config: { ...singleRunner(), default_runner: "constructor" } }, /runner constructor/],
    ["an empty command", { config: singleRunner({ command: "" }) }, /no command/],
    ["a blank command", { config: singleRunner({ command: "   " }) }, /no command/],
    ["a command that is not a string", { config: singleRunner({ command: ["node"] }) }, /no command/],
    ["a command with an open quote", { config: singleRunner({ command: `node "fake.mjs` }) }, /unterminated quote/],
    ["run_args that are not strings", { config: singleRunner({ run_args: [1] }) }, /run_args/],
    ["a test_directory that is not a string", { config: singleRunner({ test_directory: 1 }) }, /test_directory/],
    ["a program that does not exist", { config: singleRunner({ command: "no-such-program-pb-test" }) }, /no-such-program-pb-test/],
    ["config that is not JSON", { configText: "{not json" }, /not valid JSON/],
  ];
  for (const [name, setup, pattern] of BROKEN) {
    test(name, () => assertRefuses(makeRepo(setup), pattern));
  }

  test("a missing test-config", () => {
    const repo = makeRepo();
    rmSync(repo.configPath);

    assertRefuses(repo, /test-config/);
  });

  test("no run", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-test-norun-")));
    tempDirs.push(dir);

    const { status, stderr } = spawnSync(process.execPath, [CLI, "test", "--full"], { cwd: dir, encoding: "utf8" });

    assert.equal(status, 1);
    assert.match(stderr, /no run here/);
  });

  test("a hand-edited ledger points to the human accept", () => {
    const repo = makeRepo();
    writeFileSync(repo.ledgerPath, repo.bytes().replace('"task": "Task 28"', '"task": "Edited"'));

    assertRefuses(repo, /human accept/);
  });

  test("a stray argument is a usage error", () => {
    const repo = makeRepo();

    assertRefuses(repo, /usage: pb test/, { args: ["tests/other.py"], code: 2 });
    assertRefuses(repo, /usage: pb test/, { args: ["--full", "-k", "x"], code: 2 });
  });
});

describe("the timeout", IN_PARALLEL, () => {
  test("kills the whole process group and records it", async () => {
    const repo = makeRepo({ config: singleRunner({ timeout_seconds: FAST_TIMEOUT }), body: STUBBORN });

    const printed = recorded(repo, "--full");

    const [run] = printed.runs;
    assert.equal(run.timedOut, true);
    assert.equal(run.exitCode, null);
    assert.equal(run.signal, "SIGKILL");
    assert.equal(printed.passed, false);
    assert.match(run.excerpt, /started/);
    assert.equal(repo.ledger().tests.full.runs[0].timedOut, true);
    for (const pid of readPids(repo)) await assertDies(pid);
  });

  test("is not reported for a run that finished in time", () => {
    const repo = makeRepo({ config: singleRunner({ timeout_seconds: 20 }) });

    assert.equal(recorded(repo, "--full").runs[0].timedOut, false);
  });

  for (const [name, timeout_seconds] of [["zero", 0], ["negative", -1], ["text", "5"]]) {
    test(`a ${name} timeout_seconds refuses`, () => assertRefuses(makeRepo({ config: singleRunner({ timeout_seconds }) }), /timeout_seconds/));
  }

  test("a timeout_seconds too large for a timer refuses, since the timer would fire at once", () => {
    assertRefuses(makeRepo({ config: singleRunner({ timeout_seconds: 2 ** 31 }) }), /timeout_seconds/);
  });

  test("a process that leaves a child holding the pipes still records its own exit code", async () => {
    const body = `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "inherit" });
writeFileSync("pids.json", JSON.stringify([child.pid]));
child.unref();
process.exit(3);
`;
    const repo = makeRepo({ config: singleRunner({ timeout_seconds: 25 }), body });

    const [run] = recorded(repo, "--full").runs;

    assert.equal(run.exitCode, 3);
    assert.equal(run.timedOut, false);
    await assertDies(readPids(repo)[0]);
  });

  test("a killed pb takes the process group with it", async () => {
    const repo = makeRepo({ body: STUBBORN });
    const proc = spawn(process.execPath, [CLI, "test", "--full"], { cwd: repo.dir, stdio: "ignore" });
    const closed = new Promise((done) => proc.once("close", done));
    const deadline = Date.now() + SETTLE_MS;
    while (!existsSync(join(repo.dir, "pids.json")) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
    assert.equal(existsSync(join(repo.dir, "pids.json")), true, "the test process started");
    await new Promise((done) => setTimeout(done, 100));

    proc.kill("SIGTERM");

    await closed;
    for (const pid of readPids(repo)) await assertDies(pid);
  });
});

describe("RED counts only for configured failure exit codes", IN_PARALLEL, () => {
  const CASES = [
    ["exit 1 under the default", 1, undefined, true],
    ["pytest's 5 under the default", 5, undefined, false],
    ["a pass", 0, undefined, false],
    ["another failure code under the default", 2, undefined, false],
    ["a configured code", 3, [2, 3], true],
    ["1 when it is not configured", 1, [2, 3], false],
  ];
  for (const [name, exitCode, failure_exit_codes, red] of CASES) {
    test(name, () => {
      const repo = makeRepo({ config: singleRunner(failure_exit_codes === undefined ? {} : { failure_exit_codes }), body: `process.exit(${exitCode});` });

      assert.equal(recorded(repo, "--full").red, red);
      assert.equal(repo.ledger().tests.full.red, red);
    });
  }

  test("a timeout is not RED, even with a failure code configured", () => {
    const repo = makeRepo({ config: singleRunner({ timeout_seconds: FAST_TIMEOUT, failure_exit_codes: [1] }), body: STUBBORN });

    assert.equal(recorded(repo, "--full").red, false);
  });

  test("a signal is not RED", () => {
    const repo = makeRepo({ body: `process.kill(process.pid, "SIGSEGV");setInterval(() => {}, 1000);` });

    assert.equal(recorded(repo, "--full").red, false);
  });

  for (const [name, failure_exit_codes] of [["text", "1"], ["an empty list", []], ["zero, which is a pass", [0]], ["a fraction", [1.5]]]) {
    test(`failure_exit_codes of ${name} refuses`, () => assertRefuses(makeRepo({ config: singleRunner({ failure_exit_codes }) }), /failure_exit_codes/));
  }
});

describe("--full runs the whole suite", IN_PARALLEL, () => {
  test("every configured runner runs on its test directory", () => {
    const config = {
      source_directory: ".",
      runners: { one: runner({ test_directory: "tests/a", run_args: ["-v"] }), two: runner({ test_directory: "tests/b" }) },
      default_runner: "one",
    };
    const repo = makeRepo({ config });

    const printed = recorded(repo, "--full");

    assert.deepEqual(repo.calls(), [["tests/a", "-v"], ["tests/b"]]);
    assert.deepEqual(printed.runs.map((run) => run.runner), ["one", "two"]);
  });

  test("one failing runner fails the suite, and the other still runs", () => {
    const failing = runner({ command: "node fail.mjs" });
    const repo = makeRepo({ config: { source_directory: ".", runners: { bad: failing, good: runner() }, default_runner: "bad" } });
    writeFileSync(join(repo.dir, "fail.mjs"), script("process.exit(1);"));

    const printed = recorded(repo, "--full");

    assert.equal(printed.passed, false);
    assert.equal(printed.red, false, "one runner passing means the suite is not RED");
    assert.deepEqual(printed.runs.map((run) => run.exitCode), [1, 0]);
  });

  test("the selected tests play no part", () => {
    const repo = makeRepo();
    writeTests(repo, [row("tests/a.mjs")]);

    recorded(repo, "--full");

    assert.deepEqual(repo.calls(), [["tests"]]);
  });
});

describe("plain pb test takes its selectors from the tests artifact", IN_PARALLEL, () => {
  test("runs the artifact's test files, each once, before run_args", () => {
    const repo = makeRepo({ config: singleRunner({ run_args: ["-v"] }) });
    writeTests(repo, [row("tests/a.mjs"), row("tests/b.mjs"), row("tests/a.mjs", { test_id: "t-other" })]);

    const printed = recorded(repo);

    assert.deepEqual(repo.calls(), [["tests/a.mjs", "tests/b.mjs", "-v"]]);
    assert.equal(printed.key, "selected");
    assert.deepEqual(repo.ledger().tests.selected.tests, ["t-tests/a.mjs", "t-tests/b.mjs", "t-other"]);
    assert.deepEqual(repo.ledger().tests.full, undefined);
  });

  test("each test runs under the runner it names", () => {
    const config = { source_directory: ".", runners: { one: runner(), two: runner({ run_args: ["-x"] }) }, default_runner: "one" };
    const repo = makeRepo({ config });
    writeTests(repo, [row("tests/a.mjs", { runner_id: "one" }), row("tests/b.mjs", { runner_id: "two" }), row("tests/c.mjs", { runner_id: "one" })]);

    const { runs } = recorded(repo);

    assert.deepEqual(repo.calls(), [["tests/a.mjs", "tests/c.mjs"], ["tests/b.mjs", "-x"]]);
    assert.deepEqual(runs.map((run) => run.runner), ["one", "two"]);
  });

  test("the latest round wins", () => {
    const repo = makeRepo();
    writeTests(repo, [row("tests/old.mjs")], { round: 2 });
    writeTests(repo, [row("tests/new.mjs")], { round: 10 });

    recorded(repo);

    assert.deepEqual(repo.calls(), [["tests/new.mjs"]]);
  });

  test("the latest round wins whatever order the directory lists them in", () => {
    const repo = makeRepo();
    for (let round = 1; round < 12; round += 1) writeTests(repo, [row(`tests/old${round}.mjs`)], { round });
    writeTests(repo, [row("tests/new.mjs")], { round: 12 });

    recorded(repo);

    assert.deepEqual(repo.calls(), [["tests/new.mjs"]]);
  });

  test("another role's return is no tests artifact, even at a later round", () => {
    const repo = makeRepo();
    writeTests(repo, [row("tests/new.mjs")]);
    for (const role of ["runner", "implement-tests"]) writeTests(repo, [row("tests/other.mjs")], { role, round: 9 });

    recorded(repo);

    assert.deepEqual(repo.calls(), [["tests/new.mjs"]]);
  });

  test("another role's return alone selects nothing", () => {
    const repo = makeRepo();
    writeTests(repo, [row("tests/other.mjs")], { role: "runner" });

    assertRefuses(repo, /no tests artifact/, { args: [] });
  });

  test("a test file may sit deep under test_directory, and the directory may be spelled with a dot", () => {
    const repo = makeRepo({ config: singleRunner({ test_directory: "./tests/" }) });
    writeTests(repo, [row("tests/deep/er/a.mjs"), row("./tests/b.mjs")]);

    recorded(repo);

    assert.deepEqual(repo.calls(), [["tests/deep/er/a.mjs", "./tests/b.mjs"]]);
  });

  test("a test_directory of . takes any file in the repo", () => {
    const repo = makeRepo({ config: singleRunner({ test_directory: "." }) });
    writeTests(repo, [row("anywhere/a.mjs")]);

    recorded(repo);

    assert.deepEqual(repo.calls(), [["anywhere/a.mjs"]]);
  });

  const NO_SELECTION = [
    ["no artifact", () => {}, /no tests artifact/],
    ["an artifact from another attempt", (repo) => writeTests(repo, [row("tests/a.mjs")], { attempt: ATTEMPT - 1 }), /no tests artifact/],
    ["an artifact from another stage", (repo) => writeTests(repo, [row("tests/a.mjs")], { stage: "other" }), /no tests artifact/],
    ["an empty test list", (repo) => writeTests(repo, []), /selects no tests/],
    ["a list of the wrong shape", (repo) => writeTests(repo, "a.mjs"), /selects no tests/],
    ["a row with no test file", (repo) => writeTests(repo, [row("")]), /test_file/],
    ["a row with no test id", (repo) => writeTests(repo, [row("tests/a.mjs", { test_id: 7 })]), /test_id/],
    ["a test file that reads as a flag", (repo) => writeTests(repo, [row("--rootdir=/etc")]), /--rootdir/],
    ["a test file that reads as an args file", (repo) => writeTests(repo, [row("@args.txt")]), /@args\.txt/],
    ["a test file outside test_directory", (repo) => writeTests(repo, [row("other/test_y.py")]), /other\/test_y\.py.*test_directory/],
    ["a test file beside test_directory with the same start", (repo) => writeTests(repo, [row("tests-other/a.mjs")]), /test_directory/],
    ["a test file that climbs out of test_directory", (repo) => writeTests(repo, [row("tests/../other/a.mjs")]), /test_directory/],
    ["an absolute test file", (repo) => writeTests(repo, [row("/etc/passwd")]), /test_directory/],
    ["the repo root as a test file", (repo) => writeTests(repo, [row(".")]), /test_directory/],
    ["a test under an unknown runner", (repo) => writeTests(repo, [row("tests/a.mjs", { runner_id: "nope" })]), /runner nope/],
    ["an artifact that is not JSON", (repo) => writeFileSync(join(repo.taskDir, "artifacts", `${STAGE}.${ROLE}.-.r1.a${ATTEMPT}.json`), "{"), /cannot be read/],
  ];
  for (const [name, setup, pattern] of NO_SELECTION) {
    test(`${name} refuses`, () => {
      const repo = makeRepo();
      setup(repo);

      assertRefuses(repo, pattern, { args: [] });
    });
  }

  test("a test_directory of . still refuses a leading @ and a parent path", () => {
    for (const file of ["@args.txt", "../outside.mjs"]) {
      const repo = makeRepo({ config: singleRunner({ test_directory: "." }) });
      writeTests(repo, [row(file)]);

      assertRefuses(repo, /test_directory|reads as/, { args: [] });
    }
  });

  test("RED is judged the same way as for the full suite", () => {
    const repo = makeRepo({ body: "process.exit(5);" });
    writeTests(repo, [row("tests/a.mjs")]);

    assert.equal(recorded(repo).red, false);
    assert.equal(repo.ledger().tests.selected.red, false);
  });
});
