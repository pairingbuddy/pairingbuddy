import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLedger, validateLedger } from "../../shared-node/ledger.mjs";

const PB = new URL("../../cli/pb.mjs", import.meta.url).pathname;
const LEDGER_MODULE = new URL("../../shared-node/ledger.mjs", import.meta.url).href;
const CONFIG = '{"default_runner": "pytest"}\n';

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// Every temp directory is removed when the test that asked for it ends.
function tempDir(t, prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeRepo(t, { branch = "feature/x", initialBranch = "main", config = CONFIG } = {}) {
  const dir = tempDir(t, "pb-open-");
  git(dir, "init", "-q", "-b", initialBranch);
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  if (branch !== initialBranch) git(dir, "checkout", "-q", "-b", branch);
  if (config !== null) {
    mkdirSync(join(dir, ".pairingbuddy"));
    writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), config);
  }
  return dir;
}

function pb(cwd, ...args) {
  return spawnSync("node", [PB, ...args], { cwd, encoding: "utf8" });
}

const open = (cwd, ...extra) => pb(cwd, "run", "open", "--kind", "code", ...extra);
const runDir = (root) => join(root, ".pairingbuddy", "run", "task");
const ledgerPath = (root) => join(runDir(root), "ledger.json");

function assertCleanRefusal(r, pattern) {
  assert.notEqual(r.status, 0, "exit code must be non-zero");
  assert.match(r.stderr, pattern, "stderr must name the cause");
  assert.equal(r.status, 1, "a refusal exits 1");
  assert.doesNotMatch(r.stderr, /unexpected failure/, "the refusal is deliberate, not the catch-all branch");
  assert.doesNotMatch(r.stderr, /\n\s+at\s|node:internal|Error:/, "stderr must not contain a stack trace");
}

// run-open

test("open-creates-run-task-layout", (t) => {
  const root = makeRepo(t);

  const r = open(root);

  assert.equal(r.status, 0, r.stderr);
  assert.ok(statSync(join(runDir(root), "artifacts")).isDirectory(), "artifacts/ exists");
  const ledger = readLedger(ledgerPath(root));
  assert.equal(validateLedger(ledger).valid, true, "ledger validates");
  assert.equal(ledger.kind, "code", "ledger records the kind");
});

test("open-hashes-test-config", (t) => {
  const first = makeRepo(t);
  const second = makeRepo(t, { config: '{"default_runner": "other"}\n' });

  assert.equal(open(first).status, 0);
  assert.equal(open(second).status, 0);

  const expected = createHash("sha256").update(readFileSync(join(first, ".pairingbuddy", "test-config.json"))).digest("hex");
  assert.equal(readLedger(ledgerPath(first)).configHash, expected, "configHash is sha256 of the file bytes");
  assert.notEqual(readLedger(ledgerPath(second)).configHash, expected, "different config gives a different hash");
});

test("open-prints-one-line-json", (t) => {
  const root = makeRepo(t);

  const r = open(root);

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^[^\n]+\n?$/, "stdout is exactly one line");
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, kind: "code", branch: "feature/x", runDir: runDir(root) }, "the output contract");
});

test("open-from-subdirectory-uses-toplevel", (t) => {
  const root = makeRepo(t);
  const sub = join(root, "packages", "app");
  mkdirSync(sub, { recursive: true });

  const r = open(sub);

  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(ledgerPath(root)), "run dir is at the toplevel");
  assert.equal(existsSync(join(sub, ".pairingbuddy")), false, "no run dir in the subdirectory");
});

test("open-in-worktree-opens-its-own-run-dir", (t) => {
  const root = makeRepo(t);
  const wt = join(tempDir(t, "pb-wt-"), "wt");
  git(root, "worktree", "add", "-q", "-b", "feature/wt", wt);
  mkdirSync(join(wt, ".pairingbuddy"), { recursive: true });
  writeFileSync(join(wt, ".pairingbuddy", "test-config.json"), CONFIG);

  const r = open(wt);

  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(ledgerPath(wt)), "worktree has its own run dir");
  assert.equal(existsSync(runDir(root)), false, "main checkout has no run dir");
});

test("open-keeps-a-gitignore-that-is-already-there", (t) => {
  const root = makeRepo(t);
  mkdirSync(join(root, ".pairingbuddy", "run"), { recursive: true });
  writeFileSync(join(root, ".pairingbuddy", "run", ".gitignore"), "custom\n");

  const r = open(root);

  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(root, ".pairingbuddy", "run", ".gitignore"), "utf8"), "custom\n", "an existing run/.gitignore is not overwritten");
});

test("runs-when-invoked-through-a-symlink", (t) => {
  const root = makeRepo(t);
  const link = join(tempDir(t, "pb-link-"), "pb-link.mjs");
  symlinkSync(PB, link);

  const r = spawnSync("node", [link, "run", "open", "--kind", "code"], { cwd: root, encoding: "utf8" });

  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true, "the symlinked entry point still runs main");
});

test("an-unexpected-failure-exits-1-and-says-so", (t) => {
  const root = makeRepo(t);
  writeFileSync(join(root, ".pairingbuddy", "run"), "a file where the run directory should be");

  const r = open(root);

  assert.equal(r.status, 1, "exit 1");
  assert.match(r.stderr, /^pb: unexpected failure: /, "an error that is not a refusal is labelled unexpected");
});

// run-open-refusals

for (const branch of ["main", "master"]) {
  test(`refuses-${branch}`, (t) => {
    const root = makeRepo(t, { branch });

    const r = open(root);

    assertCleanRefusal(r, new RegExp(branch));
    assert.equal(existsSync(runDir(root)), false, "no run directory created");
  });
}

test("refuses-detached-head", (t) => {
  const root = makeRepo(t);
  git(root, "checkout", "-q", "--detach");

  const r = open(root);

  assertCleanRefusal(r, /no branch/i);
  assert.equal(existsSync(runDir(root)), false, "no run directory created");
});

test("refuses-second-open", (t) => {
  const root = makeRepo(t);
  assert.equal(open(root).status, 0);
  const before = readFileSync(ledgerPath(root));

  const r = open(root);

  assertCleanRefusal(r, /active|already/i);
  assert.deepEqual(readFileSync(ledgerPath(root)), before, "existing ledger unchanged");
});

test("refuses-missing-test-config", (t) => {
  const root = makeRepo(t, { config: null });

  const r = open(root);

  assertCleanRefusal(r, /test-config\.json/);
  assert.equal(existsSync(runDir(root)), false, "no run directory created");
});

test("refuses-outside-git-repo", (t) => {
  const dir = tempDir(t, "pb-nogit-");

  const r = open(dir);

  assertCleanRefusal(r, /no git repository/i);
  assert.deepEqual(readdirSync(dir), [], "nothing created");
});

test("refuses-missing-or-unknown-kind", (t) => {
  const root = makeRepo(t);

  const missing = pb(root, "run", "open");
  const unknown = pb(root, "run", "open", "--kind", "bogus");

  for (const r of [missing, unknown]) {
    assert.equal(r.status, 2, "usage errors exit 2");
    assert.match(r.stderr, /usage/i, "stderr shows the usage");
    assert.doesNotMatch(r.stderr, /unexpected failure/);
  }
  assert.equal(existsSync(runDir(root)), false, "no run directory created");
});

test("open-accepts-kind-plan", (t) => {
  const root = makeRepo(t);

  const r = pb(root, "run", "open", "--kind", "plan");

  assert.equal(r.status, 0, r.stderr);
  assert.equal(readLedger(ledgerPath(root)).kind, "plan", "the ledger records the plan kind");
});

test("unknown-verb-is-a-usage-error", (t) => {
  const root = makeRepo(t);

  const r = pb(root, "bogus", "verb");

  assert.equal(r.status, 2, "usage errors exit 2");
  assert.match(r.stderr, /unknown verb/i);
  assert.equal(existsSync(runDir(root)), false, "no run directory created");
});

for (const verb of [["toString"], ["constructor"], ["__proto__"], ["hasOwnProperty"]]) {
  test(`inherited-property-${verb.join("-")}-is-not-a-verb`, (t) => {
    const root = makeRepo(t);

    const r = pb(root, ...verb);

    assert.equal(r.status, 2, "only own VERBS entries are verbs");
    assert.match(r.stderr, /unknown verb/i);
    assert.equal(r.stdout, "", "nothing is printed to stdout");
  });
}

// run-open-structure
test("importing-pb-does-not-run-main-and-the-kinds-are-shared", (t) => {
  const root = makeRepo(t);
  const script = `
    const pbModule = await import(${JSON.stringify(PB)});
    const ledgerModule = await import(${JSON.stringify(LEDGER_MODULE)});
    console.log(JSON.stringify({ same: pbModule.KINDS === ledgerModule.KINDS, kinds: ledgerModule.KINDS }));
  `;

  const r = spawnSync("node", ["--input-type=module", "-e", script], { cwd: root, encoding: "utf8" });

  assert.equal(r.status, 0, `importing must not run main or exit: ${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout), { same: true, kinds: ["code", "plan"] }, "pb.mjs and ledger.mjs export one KINDS constant");
});

test("open-writes-a-gitignore-that-hides-run-state", (t) => {
  const root = makeRepo(t);

  const r = open(root);

  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(root, ".pairingbuddy", "run", ".gitignore"), "utf8"), /^\*$/m, "run/.gitignore ignores everything");
  assert.doesNotMatch(git(root, "status", "--porcelain", "-uall"), /run/, "git does not see run state");
});

// run-open-refusals
test("refuses-when-run-task-exists-even-without-a-ledger", (t) => {
  const root = makeRepo(t);
  mkdirSync(join(runDir(root), "artifacts"), { recursive: true });
  writeFileSync(join(runDir(root), "leftover.txt"), "from an earlier run");

  const r = open(root);

  assertCleanRefusal(r, /active|already/i);
  assert.deepEqual(readdirSync(runDir(root)).sort(), ["artifacts", "leftover.txt"], "the existing directory is untouched and nothing leaks in");
});

for (const branch of ["MAIN", "Master"]) {
  test(`refuses-${branch}-case-insensitively`, (t) => {
    const root = makeRepo(t, { branch, initialBranch: branch });

    const r = open(root);

    assertCleanRefusal(r, new RegExp(branch));
    assert.equal(existsSync(runDir(root)), false, "no run directory created");
  });
}

test("refuses-main-when-a-tag-is-also-named-main", (t) => {
  const root = makeRepo(t, { branch: "main" });
  git(root, "tag", "main");

  const r = open(root);

  assertCleanRefusal(r, /main/);
  assert.equal(existsSync(runDir(root)), false, "no run directory created");
});

test("allows-a-branch-that-merely-contains-main", (t) => {
  const root = makeRepo(t, { branch: "feature/main-menu" });

  const r = open(root);

  assert.equal(r.status, 0, r.stderr);
});

// run-open-concurrency
function spawnOpen(cwd) {
  return new Promise((resolve) => {
    const child = spawn("node", [PB, "run", "open", "--kind", "code"], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("eight-concurrent-opens-give-exactly-one-winner", async (t) => {
  for (let round = 0; round < 4; round++) {
    const root = makeRepo(t);

    const results = await Promise.all(Array.from({ length: 8 }, () => spawnOpen(root)));

    const winners = results.filter((r) => r.status === 0);
    const losers = results.filter((r) => r.status !== 0);
    assert.equal(winners.length, 1, `round ${round}: exactly one open succeeds`);
    for (const r of losers) {
      assertCleanRefusal(r, /active|already/i);
    }
    const ledger = readLedger(ledgerPath(root));
    assert.equal(ledger.seq, 1, `round ${round}: the winner's ledger was written once and never overwritten`);
    assert.deepEqual(readdirSync(runDir(root)).sort(), ["artifacts", "ledger.json"], `round ${round}: losers left nothing behind`);
  }
});
