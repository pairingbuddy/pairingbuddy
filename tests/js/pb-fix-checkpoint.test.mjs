// Scenario: checkpoint-fix-step. pb checkpoint --step fix --from <stage>.fix.g1.r2.a1. Every test drives the real CLI
// as a subprocess in a temp git repo with an active safety-net stage ledger and a fake test runner.
import "./isolated-tmpdir.mjs";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const STAGE = "code-safety-net";
const ATTEMPT = 1;
const FIX_KEY = `${STAGE}.fix.g1.r2.a${ATTEMPT}`;
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const CONFIG = { source_directory: ".", runners: { fake: { name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [] } }, default_runner: "fake" };

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

// A repo on the unprotected branch `feature` holding a seed commit and an active safety-net stage ledger. The fake
// runner passes. `changes` maps a path to its new content: those files are left uncommitted, as a fix agent leaves them,
// and the fix artifact lists them in files_changed.
function makeRepo({ changes = { "src.mjs": "fixed code\n" }, ambiguity = "", runnerPasses = true } = {}) {
  const dir = makeDir("pb-fix-checkpoint-");
  git(dir, "init", "-q", "-b", "feature");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "src.mjs"), "original code\n");
  writeFileSync(join(dir, "tests", "a.mjs"), "original test\n");
  writeFileSync(join(dir, "fake.mjs"), runnerPasses ? "// a passing runner\n" : "console.log(\"FAIL tests/a.mjs\");\nprocess.exit(1);\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "seed");
  const seed = git(dir, "rev-parse", "HEAD");

  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  const configText = JSON.stringify(CONFIG);
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), configText);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "new_feature",
    owner: { sessionId: null, lastSeen: null }, task: "Task 84", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "", source: "" },
    stage: { name: STAGE, status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [], gates: {}, tests: { perTest: {} }, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null, checkpoints: [],
  });
  for (const [path, content] of Object.entries(changes)) writeFileSync(join(dir, path), content);
  writeFileSync(join(taskDir, "artifacts", `${FIX_KEY}.json`), JSON.stringify({ pb_key: FIX_KEY, ambiguity, commit_subject: "remove the duplicated helper", files_changed: Object.keys(changes) }));
  return {
    dir, seed, ledgerPath,
    ledger: () => readLedger(ledgerPath),
    head: () => git(dir, "rev-parse", "HEAD"),
    message: () => git(dir, "log", "-1", "--format=%B"),
  };
}

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: gitEnv() });
  return { code: status, stdout, stderr };
}

const checkpointFix = (repo, key = FIX_KEY) => pb(repo, "checkpoint", "--step", "fix", "--from", key);

// Test case: fix-commits-production-change-as-refactor
test("With the full suite passing, a production change is committed as refactor and a step-fix checkpoint is recorded", () => {
  const repo = makeRepo();

  const result = checkpointFix(repo);

  assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).committed, true, "the fix is committed");
  assert.match(repo.message(), /^refactor: /, "a production change is committed as refactor");
  const record = repo.ledger().checkpoints.find((c) => c.step === "fix" && c.key === FIX_KEY);
  assert.equal(record?.committed, true, "a committed step-fix checkpoint is recorded for the fix key");
  assert.equal(record?.sha, repo.head(), "the checkpoint holds the new HEAD");
  assert.ok(repo.ledger().commits.includes(record?.sha), "the commit is listed in ledger.commits");
});

// Test case: fix-commits-test-only-change-as-test
test("A change only inside a runner test_directory is committed as type test", () => {
  const repo = makeRepo({ changes: { "tests/a.mjs": "fixed test\n" } });

  const result = checkpointFix(repo);

  assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).committed, true, "the fix is committed");
  assert.match(repo.message(), /^test: /, "a change inside the runner test_directory is committed as test");
});

// Test case: fix-writes-diff-to-run-fix-diff
test("After the commit the commit's diff is written to .pairingbuddy/run/fix.diff, overwriting an earlier one", () => {
  const repo = makeRepo();
  const diffPath = join(repo.dir, ".pairingbuddy", "run", "fix.diff");
  writeFileSync(diffPath, "STALE DIFF FROM AN EARLIER FIX\n");

  const result = checkpointFix(repo);

  assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
  const written = readFileSync(diffPath, "utf8");
  assert.ok(!written.includes("STALE DIFF"), "the earlier diff is overwritten");
  assert.equal(written.trim(), git(repo.dir, "show", "--format=", repo.head()), "fix.diff holds the commit's diff");
  assert.match(written, /\+fixed code/, "the diff holds the added line");
});

// Test case: fix-red-suite-refuses-and-allows-rollback
test("A failing suite refuses with 'the tests failed', records tests.checkpoint passed false, and pb rollback --from the fix key then succeeds as kind red", () => {
  const repo = makeRepo({ runnerPasses: false });
  const headBefore = repo.head();

  const result = checkpointFix(repo);

  assert.equal(result.code, 1, `exits 1, stderr: ${result.stderr}`);
  assert.match(result.stderr, /the tests failed, so nothing was committed/, "the refusal says the tests failed");
  assert.equal(repo.head(), headBefore, "HEAD is unchanged");
  assert.equal(repo.ledger().tests.checkpoint.passed, false, "the ledger records the checkpoint run as failed");

  const rolled = pb(repo, "rollback", "--from", FIX_KEY);

  assert.equal(rolled.code, 0, `rollback exits 0, stderr: ${rolled.stderr}`);
  const entries = repo.ledger().fixes?.rollbacks;
  assert.ok(Array.isArray(entries) && entries.length > 0, "a rollback entry is recorded");
  assert.equal(entries.at(-1).kind, "red", "the rollback is recorded as kind red");
  assert.equal(readFileSync(join(repo.dir, "src.mjs"), "utf8"), "original code\n", "the fix's file is back to its HEAD content");
});

// Test case: fix-with-no-change-stops-run
test("A fix that changed nothing and gave no ambiguity stops the run", () => {
  const repo = makeRepo({ changes: {}, ambiguity: "" });
  const headBefore = repo.head();

  const result = checkpointFix(repo);

  assert.equal(result.code, 1, `exits 1, stderr: ${result.stderr}`);
  assert.equal(repo.head(), headBefore, "no commit is made");
  const stop = repo.ledger().stop;
  assert.notEqual(stop, null, "the ledger records a stop");
  assert.match(JSON.stringify(stop), /changed nothing/, "the stop reason says the fix changed nothing");
});

// Test case: gate-allows-checkpoint-fix-runner-form
test("The gate auto-allows the exact runner form `checkpoint --step fix --from <fix key>`", () => {
  const repo = makeRepo();
  const payloads = join(ROOT, "tests", "probes", "fixtures", "payloads");
  const base = JSON.parse(readFileSync(join(payloads, "pretooluse-workflow-agent-bash.json"), "utf8"));
  const gate = (command) => {
    const payload = { ...base, agent_type: "pairingbuddy:runner", cwd: repo.dir, permission_mode: "default", tool_name: "Bash", tool_input: { command, description: "run it" } };
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(ROOT, "hooks", "gate-boot.mjs")], { cwd: repo.dir, encoding: "utf8", input: JSON.stringify(payload), env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT }, timeout: 30_000 });
    assert.equal(status, 0, `the gate hook exits 0, stderr: ${stderr}`);
    return stdout === "" ? "none" : JSON.parse(stdout).hookSpecificOutput.permissionDecision;
  };

  const fixForm = gate(`node ${CLI} checkpoint --step fix --from ${FIX_KEY}`);
  const nonFixKey = gate(`node ${CLI} checkpoint --step fix --from ${STAGE}.refactor-code.g1.r2.a${ATTEMPT}`);

  assert.equal(fixForm, "allow", "the fix runner form is auto-allowed");
  assert.notEqual(nonFixKey, "allow", "the same step with a non-fix key is not auto-allowed");
});

// Test case: docs-no-change-needs-no-test-config
test("A docs checkpoint that changed nothing succeeds without reading the test config, even when it is missing", () => {
  const repo = makeRepo({ changes: {} });
  const docsKey = `${STAGE}.update-documentation.-.r1.a${ATTEMPT}`;
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${docsKey}.json`), JSON.stringify({ pb_key: docsKey, ambiguity: "", commit_subject: "note a", files_changed: [] }));
  rmSync(join(repo.dir, ".pairingbuddy", "test-config.json"));
  const headBefore = repo.head();

  const result = pb(repo, "checkpoint", "--step", "docs", "--from", docsKey);

  assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).committed, false, "nothing is committed");
  assert.equal(repo.head(), headBefore, "HEAD is unchanged");
  assert.equal(repo.ledger().stop, null, "no stop is recorded");
});
// Test case: docs-no-change-ignores-changed-test-config
test("A docs checkpoint that changed nothing succeeds when the test config no longer matches the ledger's hash", () => {
  const repo = makeRepo({ changes: {} });
  const docsKey = `${STAGE}.update-documentation.-.r1.a${ATTEMPT}`;
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${docsKey}.json`), JSON.stringify({ pb_key: docsKey, ambiguity: "", commit_subject: "note a", files_changed: [] }));
  writeFileSync(join(repo.dir, ".pairingbuddy", "test-config.json"), JSON.stringify({ ...CONFIG, default_runner: "changed" }));

  const result = pb(repo, "checkpoint", "--step", "docs", "--from", docsKey);

  assert.equal(result.code, 0, `exits 0, stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).committed, false, "nothing is committed");
  assert.equal(repo.ledger().stop, null, "no stop is recorded");
});
