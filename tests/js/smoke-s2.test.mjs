// Smoke S2's own checks, with no model. The real runs are `node tests/smoke/s2.mjs`, which no suite collects.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Budget, SmokeError, SpendCapError, claudeCommand, cleanEnv, refuseRepoInsidePlugin, runClaude } from "../smoke/claude-run.mjs";
import { FEATURE_TASK, TASK, assertControlFlow, assertTaskEnded, codeLedger, makeRepo, makeS2Repo, parseOptions } from "../smoke/s2.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

const POLICY = { mode: "auto", source: "permission_mode" };
const row = (red, green) => ({ red: { done: true, exitCodes: [1], sha: red }, green: { done: true, exitCodes: [0], sha: green } });
const placeholder = { step: "placeholders", committed: true, sha: "p" };

function goodLedger(over = {}) {
  return {
    taskType: "bug_fix",
    policy: POLICY,
    stages: ["intake", "code-scenarios", "code-tdd", "code-safety-net"].map((name) => ({ name, status: "done" })),
    gates: { "G:type": { source: "auto" }, "G:scenarios": { source: "auto" }, "G:task-end": { source: "auto" } },
    checkpoints: [placeholder, { step: "red", committed: true, sha: "r1" }, { step: "green", committed: true, sha: "g1" }],
    commits: ["p", "r1", "g1"],
    tests: { perTest: { t1: row("r1", "g1") }, full: { passed: true, runs: [{ exitCode: 0 }] } },
    ...over,
  };
}

const commit = (sha, subject) => ({ sha, subject });

// The workflow agents the recorder read: the coverage check comes after the last GREEN and the last refactor.
const agent = (t, role) => ({ t, kind: "workflow_agent", name: `pb1 code-tdd ${role}`, agentType: `pairingbuddy:${role}` });
const AGENTS = [agent(1, "implement-tests"), agent(2, "implement-code"), agent(3, "verify-test-coverage")];
const check = (ledger, log, options = {}) => assertControlFlow(ledger, log, { agents: AGENTS, ...options });
const GOOD_LOG = [commit("p", "test: add placeholder"), commit("r1", "test: pin the discount"), commit("g1", "fix: subtract the discount")];

test("a run with a placeholder, then RED and GREEN per test, passes", () => {
  check(goodLedger(), GOOD_LOG);
});

test("a docs commit after the cycles is allowed", () => {
  check(goodLedger({ commits: ["p", "r1", "g1", "d"] }), [...GOOD_LOG, commit("d", "docs: note it")]);
});

test("several tests each need their own RED and GREEN, in order", () => {
  const tests = { perTest: { t1: row("r1", "g1"), t2: row("r2", "g2") }, full: { passed: true, runs: [{ exitCode: 0 }] } };
  const log = [...GOOD_LOG, commit("r2", "test: second"), commit("g2", "fix: second")];

  check(goodLedger({ tests, commits: log.map(({ sha }) => sha) }), log);
});

const coveredRow = (sha) => ({ red: { done: false, exitCodes: [0], sha: null }, covered: { done: true, exitCodes: [0], sha, after: { test_id: "t1", sha: "g1" } } });
const COVERED_LOG = [...GOOD_LOG, commit("c2", "test: zero percent")];
const coveredLedger = (t2 = coveredRow("c2")) => goodLedger({ tests: { perTest: { t1: row("r1", "g1"), t2 }, full: { passed: true, runs: [{ exitCode: 0 }] } }, commits: ["p", "r1", "g1", "c2"] });

test("a test an earlier GREEN covered has one test commit and no GREEN", () => {
  check(coveredLedger(), COVERED_LOG);
});

test("a docs commit may follow a covered test", () => {
  check(goodLedger({ ...coveredLedger(), commits: ["p", "r1", "g1", "c2", "d"] }), [...COVERED_LOG, commit("d", "docs: note it")]);
});

for (const [what, t2, log, pattern] of [
  ["a covered test with a fix commit after it", coveredRow("c2"), [...COVERED_LOG, commit("x", "fix: more")], /commit types/],
  ["a covered test that did not pass", { ...coveredRow("c2"), covered: { ...coveredRow("c2").covered, exitCodes: [1] } }, COVERED_LOG, /t2.*covered/],
  ["a covered test with no commit", coveredRow(null), COVERED_LOG, /t2.*covered/],
  ["a covered test whose commit is out of place", coveredRow("g1"), COVERED_LOG, /t2/],
]) {
  test(`S2 fails on ${what}`, () => {
    assert.throws(() => check(coveredLedger(t2), log), (e) => e instanceof SmokeError && pattern.test(e.message));
  });
}

test("a covered test before any GREEN fails S2", () => {
  const ledger = goodLedger({ tests: { perTest: { t1: coveredRow("c1") }, full: { passed: true, runs: [{ exitCode: 0 }] } }, commits: ["p", "c1"] });

  assert.throws(() => check(ledger, [GOOD_LOG[0], commit("c1", "test: x")]), (e) => e instanceof SmokeError && /t1.*GREEN/.test(e.message));
});

for (const [what, ledger, log, pattern] of [
  ["a stage missing", goodLedger({ stages: [{ name: "code-tdd", status: "done" }] }), GOOD_LOG, /stage order/],
  ["stages out of order", goodLedger({ stages: ["code-tdd", "code-scenarios", "code-safety-net"].map((name) => ({ name, status: "done" })) }), GOOD_LOG, /stage order/],
  ["a stage not done", goodLedger({ stages: ["intake", "code-scenarios", "code-tdd", "code-safety-net"].map((name) => ({ name, status: name === "code-tdd" ? "failed" : "done" })) }), GOOD_LOG, /stage order/],
  ["no placeholder commit", goodLedger({ checkpoints: [] }), GOOD_LOG, /placeholder/],
  ["two placeholder commits", goodLedger({ checkpoints: [placeholder, { ...placeholder, sha: "p2" }] }), GOOD_LOG, /placeholder/],
  ["a commit with the wrong type at GREEN", goodLedger(), [GOOD_LOG[0], GOOD_LOG[1], commit("g1", "chore: whatever")], /commit types/],
  ["an extra commit", goodLedger(), [...GOOD_LOG, commit("x", "fix: extra")], /commit types/],
  ["a commit the ledger never listed", goodLedger({ commits: ["p", "r1"] }), GOOD_LOG, /not in the ledger/],
  ["no tests", goodLedger({ tests: { perTest: {}, full: { passed: true, runs: [{ exitCode: 0 }] } } }), GOOD_LOG, /no test/],
  ["RED with the wrong exit code", goodLedger({ tests: { perTest: { t1: { ...row("r1", "g1"), red: { done: true, exitCodes: [5], sha: "r1" } } }, full: { passed: true, runs: [{ exitCode: 0 }] } } }), GOOD_LOG, /t1.*RED/],
  ["GREEN with the wrong exit code", goodLedger({ tests: { perTest: { t1: { ...row("r1", "g1"), green: { done: true, exitCodes: [1], sha: "g1" } } }, full: { passed: true, runs: [{ exitCode: 0 }] } } }), GOOD_LOG, /t1.*GREEN/],
  ["a RED with no commit", goodLedger({ tests: { perTest: { t1: row(null, "g1") }, full: { passed: true, runs: [{ exitCode: 0 }] } } }), GOOD_LOG, /t1.*RED/],
  ["commits that do not line up with the test", goodLedger({ tests: { perTest: { t1: row("g1", "r1") }, full: { passed: true, runs: [{ exitCode: 0 }] } } }), GOOD_LOG, /t1/],
  ["a full suite that failed", goodLedger({ tests: { perTest: { t1: row("r1", "g1") }, full: { passed: false, runs: [{ exitCode: 1 }] } } }), GOOD_LOG, /full suite/],
  ["no full suite run", goodLedger({ tests: { perTest: { t1: row("r1", "g1") } } }), GOOD_LOG, /full suite/],
  ["a gate a human answered", goodLedger({ gates: { "G:type": { source: "auto" }, "G:scenarios": { source: "human-cli" }, "G:task-end": { source: "auto" } } }), GOOD_LOG, /G:scenarios/],
  ["a gate not recorded", goodLedger({ gates: { "G:type": { source: "auto" }, "G:scenarios": { source: "auto" } } }), GOOD_LOG, /G:task-end/],
  ["an inherited policy", goodLedger({ policy: { mode: "auto", source: "env" } }), GOOD_LOG, /policy/],
]) {
  test(`S2 fails on ${what}`, () => {
    assert.throws(() => check(ledger, log), (e) => e instanceof SmokeError && pattern.test(e.message));
  });
}

// ---------- new_feature: a feat GREEN, then the cycle's refactor, each fix group kept green by the CLI ----------

const refactorKey = (role, id = "t1") => `code-tdd.${role}.${id}.r1.a1`;
const refactorCheckpoint = (role, sha, id = "t1") => ({ step: "refactor", key: refactorKey(role, id), committed: true, sha });
// The closed tests' run the CLI makes before a fix group's commit, at the HEAD that commit goes on.
const closedRun = (head, exitCodes = [0]) => ({ head, passed: exitCodes.every((code) => code === 0), runs: exitCodes.map((exitCode) => ({ exitCode })) });
const FEATURE_LOG = [commit("p", "test: add placeholder"), commit("r1", "test: pin the order total"), commit("g1", "feat: add order_total"), commit("x1", "test: name the example"), commit("x2", "refactor: name the VAT rate")];
const FEATURE_AGENTS = [agent(1, "implement-tests"), agent(2, "implement-code"), agent(3, "refactor-tests"), agent(4, "refactor-code"), agent(5, "verify-test-coverage")];

function featureLedger(over = {}) {
  return goodLedger({
    taskType: "new_feature",
    checkpoints: [placeholder, { step: "red", committed: true, sha: "r1" }, { step: "green", committed: true, sha: "g1" }, refactorCheckpoint("refactor-tests", "x1"), refactorCheckpoint("refactor-code", "x2"), { step: "refactor", key: refactorKey("refactor-code"), committed: false, sha: null }],
    commits: FEATURE_LOG.map(({ sha }) => sha),
    ...over,
  });
}

// What the recorder saw: the final ledger, and one snapshot for each closed-tests run on the way.
const FEATURE_SNAPSHOTS = [closedRun("g1"), closedRun("x1")].map((refactor) => featureLedger({ tests: { ...featureLedger().tests, refactor } }));
const checkFeature = (ledger = featureLedger(), log = FEATURE_LOG, options = {}) => assertControlFlow(ledger, log, { type: "new_feature", agents: FEATURE_AGENTS, snapshots: [...FEATURE_SNAPSHOTS, ledger], ...options });

test("new_feature: a feat GREEN, then refactor fix groups that each kept the closed tests green, passes", () => {
  checkFeature();
});

test("new_feature: a docs commit may follow the refactor", () => {
  checkFeature(featureLedger({ commits: [...FEATURE_LOG.map(({ sha }) => sha), "d"] }), [...FEATURE_LOG, commit("d", "docs: note it")]);
});

const featureFails = (what, pattern, ledger, log = FEATURE_LOG, options = {}) => [what, pattern, ledger, log, options];
const onlyCodeFix = { checkpoints: [placeholder, { step: "red", committed: true, sha: "r1" }, { step: "green", committed: true, sha: "g1" }, refactorCheckpoint("refactor-code", "x1")], commits: ["p", "r1", "g1", "x1"] };

for (const [what, pattern, ledger, log, options] of [
  featureFails("a fix commit at GREEN", /commit types/, featureLedger(), [FEATURE_LOG[0], FEATURE_LOG[1], commit("g1", "fix: add order_total"), ...FEATURE_LOG.slice(3)]),
  featureFails("no refactor commit, so the refactor step had nothing to do", /refactor/, featureLedger({ checkpoints: featureLedger().checkpoints.slice(0, 3), commits: ["p", "r1", "g1"] }), FEATURE_LOG.slice(0, 3)),
  featureFails("a refactor commit with a feat type", /commit types/, featureLedger(), [...FEATURE_LOG.slice(0, 4), commit("x2", "feat: more")]),
  featureFails("a refactor-tests commit typed refactor", /commit types/, featureLedger(), [...FEATURE_LOG.slice(0, 3), commit("x1", "refactor: tests"), FEATURE_LOG[4]]),
  featureFails("a refactor commit out of place", /t1/, featureLedger({ checkpoints: [placeholder, { step: "red", committed: true, sha: "r1" }, { step: "green", committed: true, sha: "g1" }, refactorCheckpoint("refactor-tests", "x2"), refactorCheckpoint("refactor-code", "x1")] })),
  featureFails("a refactor commit with no closed-tests run at its parent", /x2.*closed tests/, featureLedger(), FEATURE_LOG, { snapshots: [FEATURE_SNAPSHOTS[0]] }),
  featureFails("a refactor commit whose closed-tests run failed", /x2.*closed tests/, featureLedger(), FEATURE_LOG, { snapshots: [FEATURE_SNAPSHOTS[0], featureLedger({ tests: { ...featureLedger().tests, refactor: closedRun("x1", [0, 1]) } })] }),
  featureFails("a refactor commit whose closed-tests run ran nothing", /x2.*closed tests/, featureLedger(), FEATURE_LOG, { snapshots: [FEATURE_SNAPSHOTS[0], featureLedger({ tests: { ...featureLedger().tests, refactor: closedRun("x1", []) } })] }),
  featureFails("a task the classifier took for a bug fix", /task type/, featureLedger({ taskType: "bug_fix" })),
  featureFails("no coverage check", /coverage/, featureLedger(), FEATURE_LOG, { agents: FEATURE_AGENTS.slice(0, -1) }),
  featureFails("a coverage check before the last refactor", /coverage/, featureLedger(), FEATURE_LOG, { agents: [...FEATURE_AGENTS.slice(0, 2), agent(2.5, "verify-test-coverage"), ...FEATURE_AGENTS.slice(2, 4)] }),
]) {
  test(`S2 new_feature fails on ${what}`, () => {
    assert.throws(() => checkFeature(ledger, log, options), (e) => e instanceof SmokeError && pattern.test(e.message));
  });
}

test("a refactor-code fix group that touched tests alone may be a test commit", () => {
  const ledger = featureLedger(onlyCodeFix);

  checkFeature(ledger, [...FEATURE_LOG.slice(0, 3), commit("x1", "test: rename")], { snapshots: [FEATURE_SNAPSHOTS[0], ledger] });
});

test("bug_fix fails S2 on any refactor commit, since only new_feature refactors", () => {
  const ledger = goodLedger({ ...onlyCodeFix });
  const log = [...GOOD_LOG, commit("x1", "refactor: tidy")];

  assert.throws(() => check(ledger, log, { snapshots: [featureLedger({ tests: { ...featureLedger().tests, refactor: closedRun("g1") } }), ledger] }), (e) => e instanceof SmokeError && /refactor/.test(e.message));
});

test("bug_fix fails S2 with no coverage check after its GREEN", () => {
  assert.throws(() => check(goodLedger(), GOOD_LOG, { agents: AGENTS.slice(0, 2) }), (e) => e instanceof SmokeError && /coverage/.test(e.message));
});

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-s2-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("the sample repo is on a human-made branch, with a selectable pytest runner and a clean tree", (t) => {
  const repo = makeRepo(tempDir(t));

  const config = JSON.parse(readFileSync(join(repo, ".pairingbuddy", "test-config.json"), "utf8"));
  const { runners, default_runner: id } = config;
  assert.ok(runners[id].selector_template.includes("{test_file}::{test_function}"));
  assert.match(readFileSync(join(repo, ".gitignore"), "utf8"), /\.pairingbuddy\/[\s\S]*__pycache__/);
});

test("no inherited policy env reaches the run, and the cheap model is forced", () => {
  const env = cleanEnv({ PATH: "/bin", PAIRINGBUDDY_SOLO: "true", PB_POLICY: "x", CLAUDE_CODE_ENTRYPOINT: "x", CLAUDECODE: "1", ANTHROPIC_API_KEY: "k", GIT_DIR: "/x" });

  assert.equal(env.PATH, "/bin");
  for (const name of ["PAIRINGBUDDY_SOLO", "PB_POLICY", "CLAUDE_CODE_ENTRYPOINT", "CLAUDECODE", "ANTHROPIC_API_KEY", "GIT_DIR"]) assert.equal(env[name], undefined, name);
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  assert.match(env.ANTHROPIC_DEFAULT_SONNET_MODEL, /haiku/);
});

test("the run is capped and loads the plugin by --plugin-dir", () => {
  const command = claudeCommand("/pairingbuddy:code x", 1.25);

  assert.equal(command[command.indexOf("--max-budget-usd") + 1], "1.25");
  assert.equal(command[command.indexOf("--plugin-dir") + 1], ROOT);
  assert.equal(command[command.indexOf("--permission-mode") + 1], "auto");
});

test("a repo inside the plugin is refused, so the plugin loads from outside the cwd", () => {
  assert.throws(() => refuseRepoInsidePlugin(join(ROOT, "tests", "x")), SmokeError);
  refuseRepoInsidePlugin(tmpdir());
});

test("the task defaults to the scoped sample bug, and a probe can name its own", () => {
  assert.equal(parseOptions([]).task, TASK);
  assert.equal(parseOptions([]).type, "bug_fix");
  assert.equal(parseOptions(["--task", "other"]).task, "other");
});

test("--type new_feature takes the scoped sample feature, and an unknown type is refused", () => {
  assert.deepEqual(parseOptions(["--type", "new_feature"]).task, FEATURE_TASK);
  assert.equal(parseOptions(["--type", "new_feature"]).type, "new_feature");
  assert.equal(parseOptions(["--type", "new_feature", "--task", "other"]).task, "other");
  assert.throws(() => parseOptions(["--type", "refactoring"]), /type/);
});

test("the new_feature sample has code worth refactoring next to the feature, a test of it, and a selectable runner", (t) => {
  const repo = makeRepo(tempDir(t), "new_feature");

  const cart = readFileSync(join(repo, "cart.py"), "utf8");
  assert.match(cart, /def line_total/);
  assert.doesNotMatch(cart, /order_total/, "the feature is not there yet");
  assert.match(readFileSync(join(repo, "tests", "test_cart.py"), "utf8"), /line_total/);
  assert.match(FEATURE_TASK, /order_total/);
  // A run whose main context read "line totals" as price * quantity wrote that into task.json, and every agent after
  // it then saw 30.0 as a contradiction. The task names the function and the sum, so no arithmetic is left to guess.
  assert.match(FEATURE_TASK, /line_total\(price, quantity\)/);
  assert.match(FEATURE_TASK, /25\.0 plus 5\.0/);
  const { runners, default_runner: id } = JSON.parse(readFileSync(join(repo, ".pairingbuddy", "test-config.json"), "utf8"));
  assert.ok(runners[id].selector_template.includes("{test_file}::{test_function}"));
});

test("the run's cap cannot pass a run's or a session's budget", () => {
  assert.deepEqual(parseOptions(["--budget-usd", "9"]).budgetUsd, 3);
  assert.deepEqual(parseOptions(["--budget-usd", "0.5"]).budgetUsd, 0.5);
  assert.deepEqual(parseOptions([]).budgetUsd, 3);
});

function fakeClaude(t, lines, exit = 0) {
  const dir = tempDir(t);
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${lines.map((line) => JSON.stringify(line)).join("\n")}\nEOF\nexit ${exit}\n`);
  chmodSync(bin, 0o755);
  return { dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } };
}

test("a run is charged what it reports, and each line reaches the listener", async (t) => {
  const { dir, env } = fakeClaude(t, [{ type: "system" }, { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.5 }]);
  const budget = new Budget(3);
  const seen = [];

  await runClaude(dir, "go", budget, { env, onLine: (line) => seen.push(line) });

  assert.equal(budget.spent, 0.5);
  assert.equal(seen.length, 2);
});

test("the cap ending a run fails it as a cap, with spend known", async (t) => {
  const { dir, env } = fakeClaude(t, [{ type: "result", subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 3.1 }], 1);
  const budget = new Budget(3);

  await assert.rejects(runClaude(dir, "go", budget, { env }), SpendCapError);

  assert.equal(budget.spent, 3.1);
});

test("a run with no result is a failure, and leaves the cost unknown", async (t) => {
  const { dir, env } = fakeClaude(t, [{ type: "system" }]);
  const budget = new Budget(3);

  await assert.rejects(runClaude(dir, "go", budget, { env }), /no result/);

  assert.equal(budget.costKnown, false);
});

test("a used-up budget spawns nothing", async () => {
  const budget = new Budget(1);
  budget.charge(1);

  await assert.rejects(runClaude(tmpdir(), "go", budget), SpendCapError);
});

test("unit open succeeds in an S2 repo", (t) => {
  const { repo } = makeS2Repo(tempDir(t));

  const run = spawnSync(process.execPath, [join(ROOT, "cli", "pb.mjs"), "unit", "open", "--type", "fix", "--slug", "x"], { cwd: repo, env: cleanEnv(), encoding: "utf8" });

  assert.equal(run.status, 0, `pb unit open exited ${run.status}: ${run.stderr}${run.stdout}`);
  assert.equal(JSON.parse(run.stdout).ok, true, run.stdout);
});

test("ledger choice picks last code snapshot before publish", () => {
  const [codeA, codeB, publishC] = [{ kind: "code", id: "A" }, { kind: "code", id: "B" }, { kind: "publish", id: "C" }];

  assert.equal(codeLedger([codeA, codeB, publishC]), codeB, "the last code snapshot, not the publish one");
  assert.equal(codeLedger([]), null, "no snapshots means no ledger");
});

test("task ended check passes on pb task end output and fails without it", () => {
  const ended = { t: 1, command: "pb task end", output: '{"ok":true,"removed":"/x/.pairingbuddy/run/task"}', isError: false };
  const refused = { t: 2, command: "pb task end", output: "pb: stage code-tdd is not finished, so the task cannot end", isError: true };

  assert.doesNotThrow(() => assertTaskEnded([refused, ended]), "a successful pb task end output passes");
  assert.throws(() => assertTaskEnded([]), SmokeError, "no pb task end call fails");
  assert.throws(() => assertTaskEnded([refused]), SmokeError, "only refused pb task end calls fail");
  assert.throws(
    () => assertTaskEnded([{ t: 3, command: "pb task end", output: '{"ok":false}', isError: false }]),
    SmokeError,
    "a non-error call whose JSON output lacks ok:true fails",
  );
});
