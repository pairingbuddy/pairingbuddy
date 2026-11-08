// Scenario: human-abandon. pb human abandon lets a human leave a unit: it removes unit and task state and loses no commit.
// Never use { skip } here: the JS suite treats skipped tests as failures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT, env, makeRepo, pb } from "./cli-repo-fixture.mjs";
import { fixture, runGate } from "./gate-harness.mjs";

const CLI = join(ROOT, "cli", "pb.mjs");
const gitIn = (repo, ...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), encoding: "utf8" }).trim();
const unitPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "unit.json");
const taskPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "task");

// A repo with a unit open (on its own branch, with one commit past the base) and a task in flight.
function openUnitWithTask() {
  const repo = makeRepo({ remote: true });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x", "--yes");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);
  writeFileSync(join(repo.dir, "b.txt"), "b\n");
  gitIn(repo, "add", "b.txt");
  gitIn(repo, "commit", "-q", "-m", "work on the unit");
  assert.ok(existsSync(unitPath(repo)), "setup: the unit is open");
  assert.ok(existsSync(taskPath(repo)), "setup: a task is in flight");
  return repo;
}

test("abandon-removes-unit-and-task-state", () => {
  const repo = openUnitWithTask();

  const result = pb(repo, "human", "abandon");

  assert.equal(result.code, 0, `pb human abandon exits 0: ${result.stderr}`);
  assert.equal(existsSync(unitPath(repo)), false, "run/unit.json is gone");
  assert.equal(existsSync(taskPath(repo)), false, "run/task/ is gone");
});

test("abandon-keeps-commits-and-branch", () => {
  const repo = openUnitWithTask();
  const head = gitIn(repo, "rev-parse", "HEAD");
  const log = gitIn(repo, "log", "--format=%H", "feat/x");
  writeFileSync(join(repo.dir, "dirty.txt"), "uncommitted\n");

  const result = pb(repo, "human", "abandon");

  assert.equal(result.code, 0, `pb human abandon exits 0: ${result.stderr}`);
  assert.match(gitIn(repo, "branch", "--list", "feat/x"), /feat\/x/, "the unit branch still exists");
  assert.equal(gitIn(repo, "rev-parse", "--abbrev-ref", "HEAD"), "feat/x", "the working tree stays on the unit branch");
  assert.equal(gitIn(repo, "rev-parse", "HEAD"), head, "HEAD did not move");
  assert.equal(gitIn(repo, "log", "--format=%H", "feat/x"), log, "every commit on the branch is unchanged");
  assert.ok(existsSync(join(repo.dir, "dirty.txt")), "the working tree is untouched");
});

test("abandon-works-after-a-stop", () => {
  const repo = openUnitWithTask();
  const stopped = pb(repo, "stage", "stop", "agent-budget");
  assert.equal(stopped.code, 0, `setup: pb stage stop, stderr: ${stopped.stderr}`);
  assert.notEqual(repo.ledger().stop, null, "setup: the ledger records a stop");

  const result = pb(repo, "human", "abandon");

  assert.equal(result.code, 0, `pb human abandon exits 0 on a stopped run: ${result.stderr}`);
  assert.equal(existsSync(unitPath(repo)), false, "run/unit.json is gone");
  assert.equal(existsSync(taskPath(repo)), false, "run/task/ is gone");
});

test("abandon-denied-from-every-tool-call", async () => {
  const repo = openUnitWithTask();
  const callers = { "the main context": fixture("pretooluse-workflow.json"), "a subagent": fixture("pretooluse-workflow-agent-bash.json") };

  for (const [caller, base] of Object.entries(callers)) {
    const payload = { ...base, cwd: repo.dir, permission_mode: "default", tool_name: "Bash", tool_input: { command: `node ${CLI} human abandon`, description: "leave the unit" } };

    const result = await runGate(payload);

    assert.equal(result.code, 0, `${caller}: the JSON deny form needs exit 0; stderr: ${result.stderr}`);
    const decision = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(decision.permissionDecision, "deny", `${caller}: denied`);
    assert.match(decision.permissionDecisionReason, /\btype\b/i, `${caller}: the deny tells the human to type it`);
    assert.match(decision.permissionDecisionReason, /!/, `${caller}: the deny names the !`);
    assert.ok(existsSync(unitPath(repo)) && existsSync(taskPath(repo)), `${caller}: nothing was removed`);
  }
});
