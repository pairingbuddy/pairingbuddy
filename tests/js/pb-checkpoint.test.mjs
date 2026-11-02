// Task 29: pb checkpoint. Every test drives the real CLI as a subprocess, in a temp git repo with a real ledger, real
// hooks and, for signing, a real failing signing program. The developer's own git setup is shut out, so their signing
// or ignore rules cannot change a result.
//
// Output contract: a commit prints {ok, step, key, committed: true, sha, message, paths, hookRetried}, and no change
// prints {ok, step, key, committed: false}. Both exit 0. A refusal exits 1 and commits nothing, except that an attempt
// ending during the commit itself leaves that commit listed in ledger.commits and no evidence. A stop exits 1 and sets
// ledger.stop. Bad arguments exit 2.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CheckpointStopped, commitPaths } from "../../shared-node/checkpoint.mjs";
import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const CONFIG_STAGE = "code-config";
const DOCS_STAGE = "code-safety-net";
const ATTEMPT = 2;
const CONFIG_KEY = `${CONFIG_STAGE}.apply-config-change.-.r1.a${ATTEMPT}`;
const DOCS_KEY = `${DOCS_STAGE}.update-documentation.-.r1.a${ATTEMPT}`;
const IN_PARALLEL = { concurrency: 8 };
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const TEST_RUNS = "test-runs.log";

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

// HOME and XDG_CONFIG_HOME too: git reads ~/.config/git/ignore with no global config file, and a developer's ignore
// list there can hide .pairingbuddy/ from the status these tests depend on.
const NO_HOME = makeDir("pb-no-home-");
const gitEnv = (extra = {}) => ({ ...process.env, ...ISOLATED_GIT, HOME: NO_HOME, XDG_CONFIG_HOME: NO_HOME, ...extra });

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const FAKE_TESTS = (body) => `
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(join(".git", TEST_RUNS))}, JSON.stringify(process.argv.slice(2)) + "\\n");
${body}
`;

const CONFIG = { source_directory: ".", runners: { fake: { name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [] } }, default_runner: "fake" };

function makeRepo({ branch = "feature", tests = "", stage = CONFIG_STAGE, ledger = {} } = {}) {
  const dir = makeDir("pb-checkpoint-");
  git(dir, "init", "-q", "-b", branch);
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, "a.txt"), "a\n");
  writeFileSync(join(dir, "b.txt"), "b\n");
  writeFileSync(join(dir, "fake.mjs"), FAKE_TESTS(tests));
  git(dir, "add", "a.txt", "b.txt", "fake.mjs");
  git(dir, "commit", "-q", "-m", "seed");
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  const configText = JSON.stringify(CONFIG);
  const configPath = join(dir, ".pairingbuddy", "test-config.json");
  writeFileSync(configPath, configText);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "Task 29", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "", source: "" },
    stage: { name: stage, status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [], gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    ...ledger,
  });
  return {
    dir, taskDir, ledgerPath, configPath,
    ledger: () => readLedger(ledgerPath),
    head: () => git(dir, "rev-parse", "HEAD"),
    message: () => execFileSync("git", ["log", "-1", "--format=%B"], { cwd: dir, encoding: "utf8", env: gitEnv() }).replace(/\n+$/, ""),
    committed: () => git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort(),
    staged: () => git(dir, "diff", "--cached", "--name-only"),
    testRuns: () => (existsSync(join(dir, ".git", TEST_RUNS)) ? readFileSync(join(dir, ".git", TEST_RUNS), "utf8").trim().split("\n").length : 0),
    write: (name, text) => writeFileSync(join(dir, name), text),
    read: (name) => readFileSync(join(dir, name), "utf8"),
  };
}

function writeArtifact(repo, key, content) {
  writeFileSync(join(repo.taskDir, "artifacts", `${key}.json`), typeof content === "string" ? content : JSON.stringify(content));
}

const configArtifact = (over = {}, key = CONFIG_KEY) => ({ pb_key: key, ambiguity: "", commit_subject: "set a", files_changed: ["a.txt"], ...over });

function pb(repo, args, env = {}) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, "checkpoint", ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: gitEnv(env) });
  return { code: status, stdout, stderr };
}

const configArgs = (key = CONFIG_KEY) => ["--step", "config", "--from", key];

function checkpoint(repo, args = configArgs(), env = {}) {
  const result = pb(repo, args, env);
  assert.equal(result.code, 0, `the checkpoint succeeds, stderr: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assertNoCommit(repo, seed, result, pattern) {
  assert.equal(result.code, 1, `exits 1: stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(result.stdout, "", "prints no result");
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "it is not a crash");
  assert.equal(repo.head(), seed, "no commit was made");
  assert.deepEqual(repo.ledger().commits, [], "no commit was recorded");
}

function assertRefuses(repo, pattern, args = configArgs()) {
  const seed = repo.head();
  const before = readFileSync(repo.ledgerPath, "utf8");
  const result = pb(repo, args);
  assertNoCommit(repo, seed, result, pattern);
  assert.equal(readFileSync(repo.ledgerPath, "utf8"), before, "a refusal leaves the ledger alone");
  assert.equal(repo.testRuns(), 0, "a refusal runs no tests");
  assert.equal(repo.staged(), "", "a refusal stages nothing");
}

function assertStops(repo, pattern, run = () => pb(repo, configArgs())) {
  const seed = repo.head();
  const result = run();
  assertNoCommit(repo, seed, result, pattern);
  assert.match(repo.ledger().stop?.reason ?? "", pattern, "the stop lands in the ledger");
}

function hook(repo, name, body) {
  const path = join(repo.dir, ".git", "hooks", name);
  writeFileSync(path, `#!/bin/sh\necho call >> .git/hook-calls\n${body}\n`);
  chmodSync(path, 0o755);
}

const hookCalls = (repo) => (existsSync(join(repo.dir, ".git", "hook-calls")) ? repo.read(".git/hook-calls").trim().split("\n").length : 0);

function changedRepo(options) {
  const repo = makeRepo(options);
  repo.write("a.txt", "changed\n");
  writeArtifact(repo, CONFIG_KEY, configArtifact());
  return repo;
}

describe("a commit comes from the step and the artifact", IN_PARALLEL, () => {
  test("the config step commits the listed path as chore and records the sha", () => {
    const repo = changedRepo();

    const result = checkpoint(repo);

    assert.equal(repo.message(), "chore: set a");
    assert.deepEqual(repo.committed(), ["a.txt"]);
    assert.equal(result.committed, true);
    assert.equal(result.sha, repo.head());
    assert.equal(result.message, "chore: set a");
    assert.deepEqual(repo.ledger().commits, [repo.head()]);
  });

  test("the docs step commits as docs", () => {
    const repo = makeRepo({ stage: DOCS_STAGE });
    repo.write("a.txt", "changed\n");
    writeArtifact(repo, DOCS_KEY, configArtifact({ commit_subject: "describe a" }, DOCS_KEY));

    checkpoint(repo, ["--step", "docs", "--from", DOCS_KEY]);

    assert.equal(repo.message(), "docs: describe a");
  });

  for (const [subject, expected] of [
    ["feat: set a", "chore: set a"],
    ["chore: set a", "chore: set a"],
    ["fix(core)!: set a", "chore: set a"],
    ["FEAT: set a", "chore: set a"],
  ]) {
    test(`the model's prefix in "${subject}" gives way to the step's type`, () => {
      const repo = changedRepo();
      writeArtifact(repo, CONFIG_KEY, configArtifact({ commit_subject: subject }));

      checkpoint(repo);

      assert.equal(repo.message(), expected);
    });
  }

  test("a subject that merely has a colon keeps it", () => {
    const repo = changedRepo();
    writeArtifact(repo, CONFIG_KEY, configArtifact({ commit_subject: "timeout: raise to 30" }));

    checkpoint(repo);

    assert.equal(repo.message(), "chore: timeout: raise to 30");
  });

  test("the message carries no trailer, so it is the subject line and nothing more", () => {
    const repo = changedRepo();

    checkpoint(repo);

    assert.equal(repo.message(), "chore: set a");
    assert.equal(git(repo.dir, "log", "-1", "--format=%(trailers)"), "");
  });

  test("shell syntax in the subject stays literal text", () => {
    const repo = changedRepo();
    const subject = "x $(touch pwned) `touch pwned2`; touch pwned3 | cat";
    writeArtifact(repo, CONFIG_KEY, configArtifact({ commit_subject: subject }));

    checkpoint(repo);

    assert.equal(repo.message(), `chore: ${subject}`);
    for (const file of ["pwned", "pwned2", "pwned3"]) assert.equal(existsSync(join(repo.dir, file)), false);
  });

  test("the tests ran before the commit", () => {
    const repo = changedRepo();

    checkpoint(repo);

    assert.equal(repo.testRuns(), 1);
    assert.equal(repo.ledger().tests.checkpoint.passed, true);
    assert.equal(repo.ledger().tests.checkpoint.stage, CONFIG_STAGE);
  });

  test("successive steps append to the commit record", () => {
    const repo = changedRepo();
    checkpoint(repo);
    const first = repo.head();
    repo.write("b.txt", "changed\n");
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["b.txt"] }));

    checkpoint(repo);

    assert.deepEqual(repo.ledger().commits, [first, repo.head()]);
  });
});

describe("only listed paths are staged", IN_PARALLEL, () => {
  test("other changes and untracked files stay out of the commit and out of the index", () => {
    const repo = changedRepo();
    repo.write("b.txt", "unlisted\n");
    repo.write("new.txt", "untracked\n");

    checkpoint(repo);

    assert.deepEqual(repo.committed(), ["a.txt"]);
    assert.equal(repo.read("b.txt"), "unlisted\n");
    assert.equal(git(repo.dir, "status", "--porcelain", "--", "b.txt"), "M b.txt");
    assert.equal(git(repo.dir, "status", "--porcelain", "--", "new.txt"), "?? new.txt");
  });

  test("a new file and a deleted file are both committed", () => {
    const repo = makeRepo();
    repo.write("new.txt", "new\n");
    unlinkSync(join(repo.dir, "b.txt"));
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["new.txt", "b.txt"] }));

    checkpoint(repo);

    assert.deepEqual(repo.committed(), ["b.txt", "new.txt"]);
    assert.equal(existsSync(join(repo.dir, "b.txt")), false);
  });

  test("a listed path is a literal name, never a pathspec", () => {
    const repo = makeRepo();
    repo.write("*.txt", "star\n");
    repo.write("a.txt", "must stay out\n");
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["*.txt"] }));

    checkpoint(repo);

    assert.deepEqual(repo.committed(), ["*.txt"]);
  });

  test("a path that reads as a flag is a file name", () => {
    const repo = makeRepo();
    repo.write("--all", "dashes\n");
    repo.write("a.txt", "must stay out\n");
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["--all"] }));

    checkpoint(repo);

    assert.deepEqual(repo.committed(), ["--all"]);
  });

  test("a listed path that did not change is skipped beside one that did", () => {
    const repo = changedRepo();
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["a.txt", "b.txt", "never-existed.txt"] }));

    const result = checkpoint(repo);

    assert.deepEqual(repo.committed(), ["a.txt"]);
    assert.deepEqual(result.paths, ["a.txt"]);
  });

  test("a change someone else staged is refused, since the commit would carry it", () => {
    const repo = changedRepo();
    repo.write("b.txt", "staged by hand\n");
    git(repo.dir, "add", "b.txt");
    const seed = repo.head();

    const result = pb(repo, configArgs());

    assertNoCommit(repo, seed, result, /b\.txt/);
    assert.equal(repo.testRuns(), 0);
  });

  test("a path written through a subdirectory cwd still resolves from the repo root", () => {
    const repo = changedRepo();
    mkdirSync(join(repo.dir, "sub"));

    const { status, stderr } = spawnSync(process.execPath, [CLI, "checkpoint", ...configArgs()], { cwd: join(repo.dir, "sub"), encoding: "utf8", env: gitEnv() });

    assert.equal(status, 0, stderr);
    assert.deepEqual(repo.committed(), ["a.txt"]);
  });
});

describe("no change makes no commit", IN_PARALLEL, () => {
  test("listed paths that did not change commit nothing and run no tests", () => {
    const repo = makeRepo();
    writeArtifact(repo, CONFIG_KEY, configArtifact());
    const seed = repo.head();

    const result = checkpoint(repo);

    assert.equal(result.committed, false);
    assert.equal(repo.head(), seed);
    assert.deepEqual(repo.ledger().commits, []);
    assert.equal(repo.testRuns(), 0);
  });

  test("an empty list commits nothing", () => {
    const repo = changedRepo();
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: [] }));
    const seed = repo.head();

    assert.equal(checkpoint(repo).committed, false);
    assert.equal(repo.head(), seed);
  });

  test("a redo of a committed step is a no-change", () => {
    const repo = changedRepo();
    checkpoint(repo);
    const committed = repo.head();

    assert.equal(checkpoint(repo).committed, false);
    assert.equal(repo.head(), committed);
    assert.deepEqual(repo.ledger().commits, [committed]);
  });

  test("the unchanged artifact need not have a usable subject when it asks for nothing", () => {
    const repo = makeRepo();
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: [], commit_subject: "" }));

    assert.equal(checkpoint(repo).committed, false);
  });
});

describe("the tests must pass", IN_PARALLEL, () => {
  test("a failing run commits nothing, stages nothing and is recorded", () => {
    const repo = changedRepo({ tests: "process.exit(1);" });
    const seed = repo.head();

    const result = pb(repo, configArgs());

    assertNoCommit(repo, seed, result, /tests/);
    assert.equal(repo.staged(), "");
    assert.equal(repo.ledger().tests.checkpoint.passed, false);
    assert.equal(repo.ledger().tests.checkpoint.runs[0].exitCode, 1);
    assert.equal(repo.ledger().stop, null, "a failed test is a refusal, not a stop");
  });

  test("a changed test-config refuses", () => {
    const repo = changedRepo();
    writeFileSync(repo.configPath, JSON.stringify({ ...CONFIG, source_directory: "src" }));

    assertRefuses(repo, /config hash changed/);
  });
});

describe("refused paths", IN_PARALLEL, () => {
  const OUTSIDE = "/etc/hosts";
  const CASES = [
    ["a run state file", ".pairingbuddy/run/task/ledger.json", /\.pairingbuddy/],
    ["a config file", ".pairingbuddy/test-config.json", /\.pairingbuddy/],
    ["the state directory", ".pairingbuddy", /\.pairingbuddy/],
    ["state reached through ..", "sub/../.pairingbuddy/test-config.json", /\.pairingbuddy/],
    ["state in another case", ".PairingBuddy/test-config.json", /\.pairingbuddy/],
    ["the git directory", ".git/config", /\.git/],
    ["a parent path", "../outside.txt", /outside the repo/],
    ["a parent path in disguise", "sub/../../outside.txt", /outside the repo/],
    ["an absolute path", OUTSIDE, /absolute/],
    ["the repo root", ".", /directory|root/],
    ["an empty path", "", /path/],
    ["a number", 7, /path/],
  ];

  for (const [name, path, pattern] of CASES) {
    test(`${name} is refused, even beside a good path`, () => {
      const repo = changedRepo();
      writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["a.txt", path] }));

      assertRefuses(repo, pattern);
    });
  }

  test("an absolute path inside the repo is refused", () => {
    const repo = changedRepo();
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: [join(repo.dir, "a.txt")] }));

    assertRefuses(repo, /absolute/);
  });

  test("a directory is refused, since it could sweep up what it holds", () => {
    const repo = changedRepo();
    mkdirSync(join(repo.dir, "sub"));
    repo.write("sub/x.txt", "x\n");
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["sub"] }));

    assertRefuses(repo, /directory/);
  });

  test("a deleted directory is refused, since it would sweep up the files it held", () => {
    const repo = makeRepo();
    mkdirSync(join(repo.dir, "dd"));
    repo.write("dd/x", "x\n");
    repo.write("dd/y", "y\n");
    git(repo.dir, "add", "dd");
    git(repo.dir, "commit", "-q", "-m", "add dd");
    rmSync(join(repo.dir, "dd"), { recursive: true });
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["dd"] }));

    assertRefuses(repo, /dd.*directory/);
  });

  test("a symlink out of the repo is refused", () => {
    const repo = changedRepo();
    symlinkSync(makeDir("pb-outside-"), join(repo.dir, "link"));
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["link"] }));

    assertRefuses(repo, /symlink|outside the repo/);
  });

  test("a path through a symlinked directory out of the repo is refused", () => {
    const repo = changedRepo();
    const outside = makeDir("pb-outside-");
    writeFileSync(join(outside, "x.txt"), "x\n");
    symlinkSync(outside, join(repo.dir, "link"));
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["link/x.txt"] }));

    assertRefuses(repo, /symlink|outside the repo/);
  });

  test("a dangling symlink out of the repo is refused", () => {
    const repo = changedRepo();
    symlinkSync(join(makeDir("pb-outside-"), "gone"), join(repo.dir, "link"));
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["link"] }));

    assertRefuses(repo, /symlink|outside the repo/);
  });

  test("a symlink into the state directory is refused", () => {
    const repo = changedRepo();
    symlinkSync(".pairingbuddy", join(repo.dir, "link"));
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["link/test-config.json"] }));

    assertRefuses(repo, /\.pairingbuddy/);
  });

  test("a symlink that stays in the repo is committed as a link", () => {
    const repo = makeRepo();
    symlinkSync("a.txt", join(repo.dir, "link"));
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["link"] }));

    checkpoint(repo);

    assert.deepEqual(repo.committed(), ["link"]);
    assert.equal(git(repo.dir, "ls-tree", "HEAD", "link").split(" ")[0], "120000");
  });
});

describe("refused subjects", IN_PARALLEL, () => {
  const SUBJECTS = [
    ["two lines", "first\nsecond"],
    ["a trailer after a blank line", "first\n\nCo-Authored-By: Someone <a@b.c>"],
    ["a trailing newline", "first\n"],
    ["a carriage return", "first\rsecond"],
    ["a line separator", "first second"],
    ["a control character", "first\u0007second"],
    ["nothing", ""],
    ["only spaces", "   "],
    ["only a type prefix", "feat: "],
    ["no string", 7],
    ["null", null],
  ];

  for (const [name, subject] of SUBJECTS) {
    test(`${name} is refused`, () => {
      const repo = changedRepo();
      writeArtifact(repo, CONFIG_KEY, configArtifact({ commit_subject: subject }));

      assertRefuses(repo, /commit_subject/);
    });
  }
});

describe("refused keys", IN_PARALLEL, () => {
  test("a key from another attempt is refused", () => {
    const repo = changedRepo();
    const stale = `${CONFIG_STAGE}.apply-config-change.-.r1.a1`;
    writeArtifact(repo, stale, configArtifact({}, stale));

    assertRefuses(repo, /attempt/, configArgs(stale));
  });

  test("a key from a later attempt is refused", () => {
    const repo = changedRepo();
    const later = `${CONFIG_STAGE}.apply-config-change.-.r1.a3`;
    writeArtifact(repo, later, configArtifact({}, later));

    assertRefuses(repo, /attempt/, configArgs(later));
  });

  test("a key from another stage is refused", () => {
    const repo = changedRepo();
    const other = `other-stage.apply-config-change.-.r1.a${ATTEMPT}`;
    writeArtifact(repo, other, configArtifact({}, other));

    assertRefuses(repo, /stage/, configArgs(other));
  });

  test("a key from another step's role is refused", () => {
    const repo = changedRepo();
    const other = `${CONFIG_STAGE}.update-documentation.-.r1.a${ATTEMPT}`;
    writeArtifact(repo, other, configArtifact({}, other));

    assertRefuses(repo, /role|step/, configArgs(other));
  });

  test("a key with no artifact is refused", () => {
    assertRefuses(makeRepo(), /artifact/);
  });

  test("an artifact that is not JSON is refused", () => {
    const repo = changedRepo();
    writeArtifact(repo, CONFIG_KEY, "{nope");

    assertRefuses(repo, /artifact/);
  });

  test("an artifact that names another key is refused", () => {
    const repo = changedRepo();
    writeArtifact(repo, CONFIG_KEY, configArtifact({ pb_key: "other" }));

    assertRefuses(repo, /pb_key/);
  });

  test("an artifact whose list is not a list is refused", () => {
    const repo = changedRepo();
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: "a.txt" }));

    assertRefuses(repo, /files_changed/);
  });

  test("a stage that is not active is refused", () => {
    const repo = changedRepo({ ledger: { stage: { name: CONFIG_STAGE, status: "done", runId: "wf_1", attempt: ATTEMPT, startedAt: null } } });

    assertRefuses(repo, /active/);
  });

  test("a stopped run is refused", () => {
    const repo = changedRepo({ ledger: { stop: { reason: "earlier", seq: 1 } } });

    assertRefuses(repo, /stopped/);
  });
});

describe("protected branches", IN_PARALLEL, () => {
  for (const branch of ["main", "master", "MAIN", "Master"]) {
    test(`${branch} is refused`, () => {
      assertRefuses(changedRepo({ branch }), /protected branch/);
    });
  }

  function nestedRepo(rootBranch, nestedBranch) {
    const repo = changedRepo({ branch: rootBranch });
    const sub = join(repo.dir, "sub");
    mkdirSync(sub);
    git(sub, "init", "-q", "-b", nestedBranch);
    return { repo, sub };
  }

  const fromDir = (cwd) => spawnSync(process.execPath, [CLI, "checkpoint", ...configArgs()], { cwd, encoding: "utf8", env: gitEnv() });

  test("the branch is the run root's, so a nested repo on another branch cannot hide main", () => {
    const { repo, sub } = nestedRepo("main", "x");
    const seed = repo.head();

    const { status, stderr } = fromDir(sub);

    assert.equal(status, 1, stderr);
    assert.match(stderr, /protected branch main/);
    assert.equal(repo.head(), seed);
  });

  test("a nested repo on main does not stop a commit on the run root's own branch", () => {
    const { repo, sub } = nestedRepo("feature", "main");

    const { status, stderr } = fromDir(sub);

    assert.equal(status, 0, stderr);
    assert.deepEqual(repo.committed(), ["a.txt"]);
  });

  test("a detached HEAD is refused", () => {
    const repo = changedRepo();
    git(repo.dir, "checkout", "-q", "--detach");

    assertRefuses(repo, /detached/);
  });
});

// Test code runs in the repo, so what it did is only known once it has finished.
describe("nothing moves between the tests and the commit", IN_PARALLEL, () => {
  const inTests = (...args) => `
import { execFileSync } from "node:child_process";
execFileSync("git", ${JSON.stringify(args)});
`;

  function runMoved(tests, arrange = () => {}) {
    const repo = changedRepo({ tests });
    git(repo.dir, "branch", "main");
    arrange(repo);
    return repo;
  }

  const CASES = [
    ["a test staging an unlisted file", inTests("add", "b.txt"), (repo) => repo.write("b.txt", "changed\n"), /b\.txt/],
    ["a test staging a protected path", inTests("add", "-f", ".pairingbuddy/test-config.json"), () => {}, /test-config\.json/],
    ["a test checking out main", inTests("checkout", "-q", "main"), () => {}, /branch.*main/],
    ["a test checking out another branch", inTests("checkout", "-q", "-b", "other"), () => {}, /branch.*other/],
    ["a test detaching HEAD", inTests("checkout", "-q", "--detach"), () => {}, /branch/],
    ["a test reverting the listed file", inTests("checkout", "--", "a.txt"), () => {}, /a\.txt/],
  ];

  for (const [name, tests, arrange, pattern] of CASES) {
    test(`${name} stops the run with nothing committed`, () => {
      const repo = runMoved(tests, arrange);

      assertStops(repo, pattern);
    });
  }

  test("a test removing a new listed file stops the run with nothing committed", () => {
    const repo = makeRepo({ tests: `import { rmSync } from "node:fs";\nrmSync("new.txt");` });
    repo.write("new.txt", "new\n");
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: ["new.txt"] }));

    assertStops(repo, /new\.txt/);
  });

  test("a test committing moves HEAD, which stops the run with nothing of ours committed", () => {
    const repo = changedRepo({ tests: inTests("commit", "-q", "--allow-empty", "-m", "from a test") });

    const result = pb(repo, configArgs());

    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /HEAD/);
    assert.match(repo.ledger().stop?.reason ?? "", /HEAD/);
    assert.deepEqual(repo.ledger().commits, []);
    assert.equal(repo.message(), "from a test");
    assert.deepEqual(repo.ledger().checkpoints ?? [], []);
  });

  test("a stop a checkpoint raises for this is cleared by stage fail, like any other", () => {
    const repo = runMoved(inTests("add", "b.txt"), (moved) => moved.write("b.txt", "changed\n"));
    assertStops(repo, /b\.txt/);

    const { status, stderr } = spawnSync(process.execPath, [CLI, "stage", "fail"], { cwd: repo.dir, encoding: "utf8", env: gitEnv() });

    assert.equal(status, 0, stderr);
    assert.equal(repo.ledger().stop, null);
  });

  test("a run stopped while its tests ran commits nothing", () => {
    const repo = changedRepo({ tests: `
import { readFileSync, writeFileSync } from "node:fs";
import { updateLedger } from ${JSON.stringify(join(ROOT, "shared-node", "ledger.mjs"))};
updateLedger(".pairingbuddy/run/task/ledger.json", (ledger) => ({ ...ledger, stop: { reason: "raised meanwhile", seq: 1 } }));
` });
    const seed = repo.head();

    assertNoCommit(repo, seed, pb(repo, configArgs()), /raised meanwhile/);
    assert.equal(repo.staged(), "");
  });
});

describe("the checkpoint record", IN_PARALLEL, () => {
  test("carries the attempt of its key", () => {
    const repo = changedRepo();

    checkpoint(repo);

    const [record] = repo.ledger().checkpoints;
    assert.deepEqual([record.stage, record.attempt, record.key], [CONFIG_STAGE, ATTEMPT, CONFIG_KEY]);
  });

  test("a no-change checkpoint is refused too once its attempt is over", () => {
    const repo = makeRepo({ ledger: { stage: { name: CONFIG_STAGE, status: "failed", runId: "wf_1", attempt: ATTEMPT, startedAt: null } } });
    writeArtifact(repo, CONFIG_KEY, configArtifact({ files_changed: [] }));

    assertRefuses(repo, /active/);
  });
});

describe("arguments", IN_PARALLEL, () => {
  const BAD = [
    ["no arguments", []],
    ["no key", ["--step", "config"]],
    ["no step", ["--from", CONFIG_KEY]],
    ["an unknown step", ["--step", "red", "--from", CONFIG_KEY]],
    ["a name every object has", ["--step", "constructor", "--from", CONFIG_KEY]],
    ["a malformed key", ["--step", "config", "--from", "../../etc/passwd"]],
    ["a key with no attempt", ["--step", "config", "--from", "code-config.apply-config-change.-.r1"]],
    ["an extra flag", [...configArgs(), "--no-verify"]],
    ["the flags swapped", ["--from", CONFIG_KEY, "--step", "config"]],
  ];

  for (const [name, args] of BAD) {
    test(`${name} is a usage error`, () => {
      const repo = changedRepo();
      const seed = repo.head();

      const result = pb(repo, args);

      assert.equal(result.code, 2, result.stderr);
      assert.match(result.stderr, /usage: pb checkpoint/);
      assert.equal(repo.head(), seed);
    });
  }
});

describe("git runs with nothing that skips a check", IN_PARALLEL, () => {
  test("a recording git on PATH sees no skipping flag, and the hook really ran", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", "exit 0");
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const bin = makeDir("pb-git-shim-");
    const log = join(bin, "argv.log");
    writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realGit)} "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);

    checkpoint(repo, configArgs(), { PATH: `${bin}${delimiter}${process.env.PATH}` });

    const calls = readFileSync(log, "utf8");
    assert.match(calls, /commit/);
    assert.doesNotMatch(calls, /--no-verify|--no-gpg-sign|gpgsign|hooksPath|--trailer|--signoff|--amend/);
    assert.doesNotMatch(calls, /(^|\s)-n(\s|$)/m);
    assert.equal(hookCalls(repo), 1);
  });
});

describe("a commit hook", IN_PARALLEL, () => {
  // A formatter's shape: the first pass rewrites and fails, the next finds nothing to do.
  const FORMAT_ONCE = (file) => `grep -q formatted ${file} && exit 0\necho formatted >> ${file}\nexit 1`;

  test("that changes a listed file gets one retry, and the commit carries the change", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", FORMAT_ONCE("a.txt"));

    const result = checkpoint(repo);

    assert.equal(hookCalls(repo), 2);
    assert.equal(result.hookRetried, true);
    assert.equal(git(repo.dir, "show", "HEAD:a.txt"), "changed\nformatted");
    assert.equal(repo.ledger().stop, null);
    assert.deepEqual(repo.ledger().commits, [repo.head()]);
  });

  test("that changes a clean unlisted file gets that file staged for the retry", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", FORMAT_ONCE("b.txt"));

    checkpoint(repo);

    assert.deepEqual(repo.committed(), ["a.txt", "b.txt"]);
  });

  test("never sweeps up a file that was already dirty", () => {
    const repo = changedRepo();
    repo.write("b.txt", "work in progress\n");
    hook(repo, "pre-commit", FORMAT_ONCE("a.txt"));

    checkpoint(repo);

    assert.deepEqual(repo.committed(), ["a.txt"]);
    assert.equal(repo.read("b.txt"), "work in progress\n");
  });

  test("that passes first time leaves hookRetried false", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", "exit 0");

    assert.equal(checkpoint(repo).hookRetried, false);
  });

  test("that fails twice stops the run", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", "echo more >> a.txt\nexit 1");

    assertStops(repo, /commit failed/);

    assert.equal(hookCalls(repo), 2, "one retry and no more");
  });

  test("that fails and changes nothing stops at once, since a retry would fail alike", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", "echo lint failed >&2\nexit 1");

    assertStops(repo, /lint failed/);

    assert.equal(hookCalls(repo), 1);
  });

  test("that writes into the state directory stops, and the file is not staged", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", "echo x > .pairingbuddy/hook.txt\nexit 1");

    assertStops(repo, /\.pairingbuddy/);

    assert.equal(hookCalls(repo), 1);
    assert.doesNotMatch(repo.staged(), /pairingbuddy/);
  });

  test("that hangs is killed at the commit timeout and stops the run", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", "sleep 8");
    const before = Date.now();

    assert.throws(() => commitPaths(repo.dir, { paths: ["a.txt"], message: "chore: set a", branch: "feature", head: repo.head() }, 500), (e) => e instanceof CheckpointStopped && /ETIMEDOUT/.test(e.message));

    assert.ok(Date.now() - before < 6000, "the hook's own 8 seconds were not waited for");
  });

  test("a stopped run takes no further checkpoint", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", "exit 1");
    assertStops(repo, /commit failed/);

    const seed = repo.head();
    assertNoCommit(repo, seed, pb(repo, configArgs()), /stopped/);
    assert.equal(hookCalls(repo), 1);
  });
});

describe("a signing failure stops at once", IN_PARALLEL, () => {
  function failingProgram(repo) {
    const path = join(makeDir("pb-sign-"), "sign");
    const log = join(repo.dir, ".git", "sign-calls");
    writeFileSync(path, `#!/bin/sh\necho call >> ${JSON.stringify(log)}\necho no key >&2\nexit 1\n`);
    chmodSync(path, 0o755);
    return { path, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0) };
  }

  const SETUPS = [
    ["an openpgp program", (repo, program) => {
      git(repo.dir, "config", "gpg.program", program);
      git(repo.dir, "config", "user.signingkey", "ABCDEF");
    }],
    ["an ssh program", (repo, program) => {
      const key = join(repo.dir, ".git", "key.pub");
      writeFileSync(key, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ0000000000000000000000000000000000000000000000 test\n");
      git(repo.dir, "config", "gpg.format", "ssh");
      git(repo.dir, "config", "gpg.ssh.program", program);
      git(repo.dir, "config", "user.signingkey", key);
    }],
  ];

  for (const [name, configure] of SETUPS) {
    test(`with ${name}, with no retry and a stop in the ledger`, () => {
      const repo = changedRepo();
      const program = failingProgram(repo);
      configure(repo, program.path);
      git(repo.dir, "config", "commit.gpgsign", "true");
      hook(repo, "pre-commit", "exit 0");

      assertStops(repo, /sign/);

      assert.equal(hookCalls(repo), 1, "the hook is not run again");
      assert.equal(program.calls(), 1, "signing is not tried again");
    });
  }

  test("a signing failure on the retry stops too", () => {
    const repo = changedRepo();
    const program = failingProgram(repo);
    SETUPS[0][1](repo, program.path);
    git(repo.dir, "config", "commit.gpgsign", "true");
    hook(repo, "pre-commit", "grep -q formatted a.txt && exit 0\necho formatted >> a.txt\nexit 1");

    assertStops(repo, /sign/);

    assert.equal(hookCalls(repo), 2);
    assert.equal(program.calls(), 1);
  });

  // Stands in for a git with translations, so the test holds on a git built without them. It speaks the human's
  // language unless LANGUAGE says otherwise, as the real one does.
  function translatingGit() {
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const bin = makeDir("pb-git-de-");
    writeFileSync(join(bin, "git"), `#!/bin/sh
case "$1" in commit) ;; *) exec ${JSON.stringify(realGit)} "$@" ;; esac
if [ "$LANGUAGE" = C ]; then echo "fatal: failed to write commit object" >&2; else echo "Fehler: Commit-Objekt konnte nicht geschrieben werden" >&2; fi
exit 128
`);
    chmodSync(join(bin, "git"), 0o755);
    return { PATH: `${bin}${delimiter}${process.env.PATH}`, LANGUAGE: "de", LANG: "de_DE.UTF-8" };
  }

  test("under another locale is still read as a signing failure", () => {
    const repo = changedRepo();
    const env = translatingGit();

    assertStops(repo, /could not be signed/, () => pb(repo, configArgs(), env));
  });

  test("a hook that merely prints the signing words still gets its retry", () => {
    const repo = changedRepo();
    hook(repo, "pre-commit", "grep -q formatted a.txt && exit 0\necho 'gpg failed to sign the data' >&2\necho formatted >> a.txt\nexit 1");

    assert.equal(checkpoint(repo).hookRetried, true);
  });
});
