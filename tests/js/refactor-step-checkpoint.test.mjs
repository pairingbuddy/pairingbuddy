import "./isolated-tmpdir.mjs";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";

// Scenario: checkpoint-refactor-step. pb checkpoint --step refactor-step --from <stage>.<role>.<item>.r1.a1. Every test
// drives the real CLI as a subprocess in a temp git repo with an active code-refactor-apply ledger on a refactoring task.
const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const STAGE = "code-refactor-apply";
const ATTEMPT = 1;
const stepKey = (role = "refactor-code", item = "step1") => `${STAGE}.${role}.${item}.r1.a${ATTEMPT}`;
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const CONFIG = { source_directory: ".", runners: { fake: { name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [], selector_template: ["--only", "{test_function}"] } }, default_runner: "fake" };

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

// A repo on the unprotected branch `feature` holding a seed commit and an active code-refactor-apply stage ledger for a
// refactoring task. The fake runner passes unless runnerPasses is false. `changes` maps a path to its new content: those
// files are left uncommitted, as a refactor agent leaves them, and the step artifact lists them in files_changed.
function makeRepo({ changes = { "src.mjs": "refactored code\n" }, ambiguity = "", runnerPasses = true, key = stepKey(), taskType = "refactoring" } = {}) {
  const dir = makeDir("pb-refactor-step-");
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
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType,
    owner: { sessionId: null, lastSeen: null }, task: "Task 89", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "", source: "" },
    stage: { name: STAGE, status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [], gates: {}, tests: { perTest: {} }, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null, checkpoints: [],
  });
  for (const [path, content] of Object.entries(changes)) writeFileSync(join(dir, path), content);
  writeFileSync(join(taskDir, "artifacts", `${key}.json`), JSON.stringify({ pb_key: key, ambiguity, commit_subject: "extract the duplicated helper", files_changed: Object.keys(changes), approach: "pulled the repeated lines into one helper" }));
  return {
    dir, seed, ledgerPath,
    ledger: () => readLedger(ledgerPath),
    head: () => git(dir, "rev-parse", "HEAD"),
    subject: () => git(dir, "log", "-1", "--format=%s"),
    committedFiles: () => git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean),
  };
}

const SCOPE_KEY = "code-refactor-scope.scope-refactoring.-.r1.a1";

// Leaves a done code-refactor-scope stage at stageAttempt, with a scope artifact under SCOPE_KEY listing the given issues.
function withScopeReturn(repo, { stageAttempt = 1, codeIssues = [], testIssues = [] } = {}) {
  writeLedger(repo.ledgerPath, { ...repo.ledger(), stages: [{ name: "code-refactor-scope", status: "done", attempt: stageAttempt }] });
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${SCOPE_KEY}.json`), JSON.stringify({ pb_key: SCOPE_KEY, ambiguity: "", code_issues: codeIssues, test_issues: testIssues }));
}

// Gives the repo what a green checkpoint of test t1 needs before the task-type rule can be reached: a tests artifact with a
// row for t1 and a RED already done, so only the task type is left to refuse it.
function withGreenReadyTest(repo) {
  const testsKey = `${STAGE}.create-test-placeholders.-.r1.a${ATTEMPT}`;
  const row = { test_id: "t1", test_file: "tests/a.mjs", test_function: "t1_works", runner_id: "fake" };
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${testsKey}.json`), JSON.stringify({ pb_key: testsKey, tests: [row] }));
  const red = { stage: STAGE, attempt: ATTEMPT, done: true, sha: repo.seed };
  writeLedger(repo.ledgerPath, { ...repo.ledger(), tests: { perTest: { t1: { red } } } });
}

const hasCheckpointFor = (repo, key) => repo.ledger().checkpoints.some((record) => record.key === key);

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: gitEnv() });
  return { code: status, stdout, stderr };
}

const checkpointStep = (repo, key = stepKey()) => pb(repo, "checkpoint", "--step", "refactor-step", "--from", key);

test("refactor-step-commits-refactor-when-green", () => {
  const repo = makeRepo();

  const result = checkpointStep(repo);

  assert.equal(result.code, 0, `exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).committed, true, "the step is committed");
  assert.notEqual(repo.head(), repo.seed, "a new commit landed");
  assert.match(repo.subject(), /^refactor: /, "the commit type is refactor");
  assert.deepEqual(repo.committedFiles(), ["src.mjs"], "the commit holds exactly the step's changed file src.mjs");
  assert.equal(git(repo.dir, "show", "HEAD:src.mjs"), "refactored code", "the commit holds the refactored content of src.mjs");
});

test("refactor-step-test-only-change-commits-test-type", () => {
  const repo = makeRepo({ changes: { "tests/a.mjs": "refactored test\n" } });

  const result = checkpointStep(repo);

  assert.equal(result.code, 0, `exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.notEqual(repo.head(), repo.seed, "a new commit landed");
  assert.match(repo.subject(), /^test: /, "a change under the test directory only is committed as type test");
  assert.deepEqual(repo.committedFiles(), ["tests/a.mjs"], "the commit holds exactly the changed test file");
});

test("refactor-step-red-suite-refuses-and-commits-nothing", () => {
  const repo = makeRepo({ runnerPasses: false });

  const result = checkpointStep(repo);

  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(repo.head(), repo.seed, "HEAD has not moved");
  assert.equal(git(repo.dir, "status", "--porcelain", "--", "src.mjs"), "M src.mjs", "the change is still uncommitted in the tree");
  assert.equal(repo.ledger().tests.checkpoint.passed, false, "the ledger records the checkpoint run as failed");
  assert.ok(!hasCheckpointFor(repo, stepKey()), "no checkpoint record exists for the step key");
});

test("refactor-step-silent-no-change-stops-commit-plan-unusable", () => {
  const repo = makeRepo({ changes: {}, ambiguity: "" });

  const result = checkpointStep(repo);

  assert.equal(result.code, 1, `a silent no-change exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(repo.head(), repo.seed, "a silent no-change commits nothing");
  const stop = repo.ledger().stop;
  assert.notEqual(stop, null, "the ledger records a stop");
  assert.equal(stop.code, "commit-plan-unusable", "the stop is commit-plan-unusable");
  assert.match(stop.reason, /changed nothing/, "the stop says the step changed nothing");
  assert.match(stop.reason, /ambiguity/, "the stop says no ambiguity was given");
});

test("refactor-step-no-change-with-ambiguity-records-checkpoint-without-commit", () => {
  const repo = makeRepo({ changes: {}, ambiguity: "the helper was already extracted, nothing left to move" });

  const result = checkpointStep(repo);

  assert.equal(result.code, 0, `a no-change with an ambiguity exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).committed, false, "nothing is committed");
  assert.equal(repo.head(), repo.seed, "HEAD has not moved");
  assert.equal(repo.ledger().stop, null, "no stop is recorded");
  assert.ok(hasCheckpointFor(repo, stepKey()), "a checkpoint record exists for the step key");
});

test("refactor-step-key-must-name-a-step", () => {
  const key = stepKey("refactor-code", "-");
  const repo = makeRepo({ key });

  const result = checkpointStep(repo, key);

  assert.equal(result.code, 1, `a key with no step item is refused with exit 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(repo.head(), repo.seed, "nothing is committed");
  assert.match(result.stdout + result.stderr, /names no step/, "the refusal says the key names no step");
  assert.doesNotMatch(result.stdout + result.stderr, /group/, "the refusal does not talk about a group");
});

test("refactor-tests-role-confined-to-test-directories", () => {
  const key = stepKey("refactor-tests");
  const repo = makeRepo({ key, changes: { "src.mjs": "refactored code\n" } });

  const result = checkpointStep(repo, key);

  assert.equal(result.code, 1, `a refactor-tests step touching a production file is refused with exit 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(repo.head(), repo.seed, "nothing is committed");
  assert.match(result.stdout + result.stderr, /src\.mjs/, "the refusal names the production file src.mjs");
  assert.match(result.stdout + result.stderr, /outside the test_directory tests/, "the refusal names the test directory");
});

test("refactor-step-only-for-refactoring-tasks", () => {
  const featureRepo = makeRepo({ taskType: "new_feature" });
  const greenKey = stepKey("implement-code", "t1");
  const refactoringRepo = makeRepo({ key: greenKey });
  withGreenReadyTest(refactoringRepo);

  const featureResult = checkpointStep(featureRepo);
  const greenResult = pb(refactoringRepo, "checkpoint", "--step", "green", "--from", greenKey);

  assert.equal(featureResult.code, 1, `refactor-step on a new_feature task is refused with exit 1, stdout ${featureResult.stdout}, stderr ${featureResult.stderr}`);
  assert.equal(featureRepo.head(), featureRepo.seed, "nothing is committed on the new_feature task");
  assert.match(featureResult.stdout + featureResult.stderr, /step refactor-step runs for refactoring only, and this task is new_feature/, "the refusal says the step runs for refactoring only");
  assert.equal(greenResult.code, 1, `a green checkpoint on a refactoring task is refused with exit 1, stdout ${greenResult.stdout}, stderr ${greenResult.stderr}`);
  assert.match(greenResult.stdout + greenResult.stderr, /no commit type for task type refactoring/, "the refusal says green has no commit type for a refactoring task");
  assert.equal(refactoringRepo.head(), refactoringRepo.seed, "no feat or fix commit lands on the refactoring task");
  assert.ok(!hasCheckpointFor(refactoringRepo, greenKey), "no checkpoint record exists for the green key");
});

test("refactor-state-lists-code-then-test-steps", () => {
  const repo = makeRepo();
  const codeIssues = [{ id: "c1", description: "extract the parser" }, { id: "c2", description: "rename the temp variable" }];
  const testIssues = [{ id: "t1", description: "remove the duplicated setup" }];
  withScopeReturn(repo, { codeIssues, testIssues });

  const result = pb(repo, "refactor", "state");

  assert.equal(result.code, 0, `exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  const state = JSON.parse(result.stdout);
  assert.equal(state.ok, true, "the state is ok");
  assert.equal(state.taskType, "refactoring", "the state names the task type");
  assert.equal(state.scope, `.pairingbuddy/run/task/artifacts/${SCOPE_KEY}.json`, "the scope is the scope return's artifact path");
  assert.deepEqual(
    state.steps,
    [
      { item: "step1", role: "refactor-code", issue: codeIssues[0] },
      { item: "step2", role: "refactor-code", issue: codeIssues[1] },
      { item: "step3", role: "refactor-tests", issue: testIssues[0] },
    ],
    "every code issue then every test issue, numbered step1..stepN",
  );
});

test("refactor-state-refuses-without-standing-scope", () => {
  const noScope = makeRepo();
  const voided = makeRepo();
  withScopeReturn(voided, { stageAttempt: 2, codeIssues: [{ id: "c1", description: "extract the parser" }] });

  const noScopeResult = pb(noScope, "refactor", "state");
  const voidedResult = pb(voided, "refactor", "state");

  assert.equal(noScopeResult.code, 1, `with no scope return a refusal exits 1, stdout ${noScopeResult.stdout}, stderr ${noScopeResult.stderr}`);
  assert.match(noScopeResult.stdout + noScopeResult.stderr, /no scope return stands/, "the refusal says no scope return stands");
  assert.equal(voidedResult.code, 1, `with only a voided scope return a refusal exits 1, stdout ${voidedResult.stdout}, stderr ${voidedResult.stderr}`);
  assert.match(voidedResult.stdout + voidedResult.stderr, /no scope return stands/, "the refusal says no scope return stands");
  assert.doesNotMatch(voidedResult.stdout, /extract the parser/, "the voided scope's issues are not printed");
});

test("refactor-state-refuses-outside-refactoring-task", () => {
  const repo = makeRepo({ taskType: "new_feature" });
  withScopeReturn(repo, { codeIssues: [{ id: "c1", description: "extract the parser" }] });

  const result = pb(repo, "refactor", "state");

  assert.equal(result.code, 1, `a non-refactoring task is refused with exit 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.match(result.stdout + result.stderr, /refactoring tasks only/, "the refusal says refactor state is for refactoring tasks only");
  assert.match(result.stdout + result.stderr, /new_feature/, "the refusal names the task type new_feature");
  assert.doesNotMatch(result.stdout, /step1|extract the parser/, "no steps are printed");
});

test("gate-admits-refactor-state-and-refactor-step-checkpoint", async () => {
  const { checkCall } = await import("../../shared-node/gate-rules.mjs");
  const { baseLedger } = await import("./ledger-fixture.mjs");
  const { pbCommand } = await import("../../shared-node/verbs.mjs");
  const root = makeDir("gate-refactor-calls-");
  mkdirSync(join(root, ".pairingbuddy", "run", "task"), { recursive: true });
  writeLedger(join(root, ".pairingbuddy", "run", "task", "ledger.json"), {
    ...baseLedger(),
    policy: { mode: "", source: "" },
    taskType: "refactoring",
    stage: { name: STAGE, status: "active", runId: "wf_1", attempt: ATTEMPT },
    stages: [{ name: STAGE, status: "active" }],
  });
  const decide = (words) => {
    const payload = { session_id: "s1", cwd: root, tool_name: "Bash", permission_mode: "default", agent_id: "a1", agent_type: "pairingbuddy:runner", tool_input: { command: pbCommand(words) } };
    return checkCall({ runRoots: [root], sessionRoot: null, payload, targets: [], canonicalPath: (path) => path });
  };
  const allowed = "Runner CLI command, auto-allowed by the Pairing Buddy gate.";

  const stateDecision = decide("refactor state");
  const stepDecision = decide(`checkpoint --step refactor-step --from ${stepKey()}`);
  const noItemDecision = decide(`checkpoint --step refactor-step --from ${stepKey("refactor-code", "-")}`);

  assert.equal(stateDecision, allowed, "the runner's 'refactor state' is auto-allowed");
  assert.equal(stepDecision, allowed, "the runner's refactor-step checkpoint with a step item is auto-allowed");
  assert.notEqual(noItemDecision, allowed, "the same checkpoint with no item in the key is not auto-allowed");
});

test("refactor-state-ignores-scope-returns-filed-under-another-stage-or-item", () => {
  const repo = makeRepo();
  writeLedger(repo.ledgerPath, { ...repo.ledger(), stages: [{ name: "code-refactor-scope", status: "done", attempt: 1 }] });
  const issues = [{ id: "c1", description: "extract the parser" }];
  for (const key of ["code-refactor-apply.scope-refactoring.-.r1.a1", "code-refactor-scope.scope-refactoring.x.r1.a1"]) {
    writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${key}.json`), JSON.stringify({ pb_key: key, ambiguity: "", code_issues: issues, test_issues: [] }));
  }

  const result = pb(repo, "refactor", "state");

  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.match(result.stdout + result.stderr, /no scope return stands/, "the refusal says no scope return stands");
  assert.doesNotMatch(result.stdout, /extract the parser/, "those returns' issues are not printed");
});

test("refactor-state-distrusts-a-scope-file-whose-pb-key-names-another-key", () => {
  const repo = makeRepo();
  withScopeReturn(repo, { codeIssues: [{ id: "c1", description: "extract the parser" }] });
  const file = join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${SCOPE_KEY}.json`);
  writeFileSync(file, JSON.stringify({ pb_key: "code-refactor-scope.scope-refactoring.-.r9.a9", ambiguity: "", code_issues: [{ id: "c1", description: "extract the parser" }], test_issues: [] }));

  const result = pb(repo, "refactor", "state");

  assert.equal(result.code, 1, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.match(result.stdout + result.stderr, /no scope return stands/, "the refusal says no scope return stands");
  assert.doesNotMatch(result.stdout, /extract the parser/, "the mismatched file's issues are not printed");
});
