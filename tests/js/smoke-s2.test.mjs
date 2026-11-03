// Smoke S2's own checks, with no model. The real runs are `node tests/smoke/s2.mjs`, which no suite collects.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Budget, SmokeError, SpendCapError, claudeCommand, cleanEnv, refuseRepoInsidePlugin, runClaude } from "../smoke/claude-run.mjs";
import { TASK, assertControlFlow, makeRepo, parseOptions } from "../smoke/s2.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

const POLICY = { mode: "auto", source: "permission_mode" };
const row = (red, green) => ({ red: { done: true, exitCodes: [1], sha: red }, green: { done: true, exitCodes: [0], sha: green } });
const placeholder = { step: "placeholders", committed: true, sha: "p" };

function goodLedger(over = {}) {
  return {
    policy: POLICY,
    stages: ["code-scenarios", "code-tdd", "code-safety-net"].map((name) => ({ name, status: "done" })),
    gates: { "G:scenarios": { source: "auto" }, "G:task-end": { source: "auto" } },
    checkpoints: [placeholder, { step: "red", committed: true, sha: "r1" }, { step: "green", committed: true, sha: "g1" }],
    commits: ["p", "r1", "g1"],
    tests: { perTest: { t1: row("r1", "g1") }, full: { passed: true, runs: [{ exitCode: 0 }] } },
    ...over,
  };
}

const commit = (sha, subject) => ({ sha, subject });
const GOOD_LOG = [commit("p", "test: add placeholder"), commit("r1", "test: pin the discount"), commit("g1", "fix: subtract the discount")];

test("a run with a placeholder, then RED and GREEN per test, passes", () => {
  assertControlFlow(goodLedger(), GOOD_LOG);
});

test("a docs commit after the cycles is allowed", () => {
  assertControlFlow(goodLedger({ commits: ["p", "r1", "g1", "d"] }), [...GOOD_LOG, commit("d", "docs: note it")]);
});

test("several tests each need their own RED and GREEN, in order", () => {
  const tests = { perTest: { t1: row("r1", "g1"), t2: row("r2", "g2") }, full: { passed: true, runs: [{ exitCode: 0 }] } };
  const log = [...GOOD_LOG, commit("r2", "test: second"), commit("g2", "fix: second")];

  assertControlFlow(goodLedger({ tests, commits: log.map(({ sha }) => sha) }), log);
});

for (const [what, ledger, log, pattern] of [
  ["a stage missing", goodLedger({ stages: [{ name: "code-tdd", status: "done" }] }), GOOD_LOG, /stage order/],
  ["stages out of order", goodLedger({ stages: ["code-tdd", "code-scenarios", "code-safety-net"].map((name) => ({ name, status: "done" })) }), GOOD_LOG, /stage order/],
  ["a stage not done", goodLedger({ stages: ["code-scenarios", "code-tdd", "code-safety-net"].map((name) => ({ name, status: name === "code-tdd" ? "failed" : "done" })) }), GOOD_LOG, /stage order/],
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
  ["a gate a human answered", goodLedger({ gates: { "G:scenarios": { source: "human-cli" }, "G:task-end": { source: "auto" } } }), GOOD_LOG, /G:scenarios/],
  ["a gate not recorded", goodLedger({ gates: { "G:scenarios": { source: "auto" } } }), GOOD_LOG, /G:task-end/],
  ["an inherited policy", goodLedger({ policy: { mode: "auto", source: "env" } }), GOOD_LOG, /policy/],
]) {
  test(`S2 fails on ${what}`, () => {
    assert.throws(() => assertControlFlow(ledger, log), (e) => e instanceof SmokeError && pattern.test(e.message));
  });
}

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
  assert.equal(parseOptions(["--task", "other"]).task, "other");
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
