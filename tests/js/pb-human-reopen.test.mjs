// Scenario human-reopen: a spike that was one task of a plan unit used to close the whole unit, dropping its task record, so
// `pb plan next` then read its ticked box as hand-ticked. `pb human reopen --plan <plan.md>` rebuilds that unit from the
// spike runs pb kept under reports/runs, on the branch they ran on.
// Never use { skip } here: the JS suite treats skipped tests as failures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { env, makeRepo, pb, writePlan } from "./cli-repo-fixture.mjs";

const SPIKE = "Task 113: Critique the code path";
const NEXT = "Task 114: Apply the findings";
const PLAN = (ticked) => ["## Tasks", "", "### T1: Critique", "", "#### PR: Critique and fixes", "", `- [${ticked ? "x" : " "}] **${SPIKE}**`, "", `- [ ] **${NEXT}**`, ""].join("\n");

const runDirOf = (repo) => join(repo.dir, ".pairingbuddy", "run");

// The state the old close left: the unit branch with the spike's commit, the plan box ticked, the spike's run kept under
// reports/runs with its unit key, and no unit.json or run/task.
function strandedRepo() {
  const repo = makeRepo({ remote: true, ledger: { taskType: "spike", plan: { path: "docs/plan.md", title: SPIKE }, stages: [{ name: "code-spike-unit", status: "done" }, { name: "code-spike-document", status: "done" }], gates: { "G:task-end": { source: "auto" } } } });
  const git = (...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), encoding: "utf8" }).trim();
  appendFileSync(join(repo.dir, ".gitignore"), "docs/\n");
  git("add", ".gitignore");
  git("commit", "-q", "-m", "ignore docs");
  git("push", "-q", "origin", "main");
  writePlan(repo, PLAN(false));
  const opened = pb(repo, "unit", "open", "--type", "chore", "--slug", "critique", "--plan", "docs/plan.md");
  assert.equal(opened.code, 0, `setup: unit open, stderr ${opened.stderr}`);
  const { branch, baseSha } = JSON.parse(opened.stdout);
  writeFileSync(join(repo.dir, "critique.md"), "findings\n");
  git("add", "critique.md");
  git("commit", "-q", "-m", "docs: record the critique");
  const commit = git("rev-parse", "HEAD");
  const ledgerPath = join(runDirOf(repo), "task", "ledger.json");
  const runId = "1c117df7-f388-4d61-a988-19a2a1392763";
  writeLedger(ledgerPath, { ...readLedger(ledgerPath), runId, commits: [commit] });
  const kept = join(repo.dir, ".pairingbuddy", "reports", "runs", runId);
  mkdirSync(kept, { recursive: true });
  cpSync(join(runDirOf(repo), "task"), kept, { recursive: true });
  writeFileSync(join(kept, "kept.json"), JSON.stringify({ unit: `${branch} ${baseSha}`, endedAt: "2026-11-26T14:26:12.459Z" }));
  rmSync(join(runDirOf(repo), "task"), { recursive: true });
  rmSync(join(runDirOf(repo), "unit.json"));
  writePlan(repo, PLAN(true));
  return { repo, git, branch, baseSha, commit };
}

test("reopen-rebuilds-the-unit-a-spike-closed-so-the-plan-goes-on", () => {
  const { repo, branch, baseSha, commit } = strandedRepo();
  assert.equal(pb(repo, "plan", "next", "docs/plan.md").code, 1, "setup: plan next refuses the hand-ticked unit");

  const r = pb(repo, "human", "reopen", "--plan", "docs/plan.md");

  assert.equal(r.code, 0, `reopen succeeds, stdout ${r.stdout}, stderr ${r.stderr}`);
  const unit = JSON.parse(readFileSync(join(runDirOf(repo), "unit.json"), "utf8"));
  assert.equal(unit.unit, "Critique and fixes");
  assert.equal(unit.branch, branch);
  assert.equal(unit.baseSha, baseSha);
  assert.equal(unit.base, "main");
  assert.deepEqual(unit.tasks.map(({ title }) => title), [SPIKE], "the spike's task record is back");
  assert.deepEqual(unit.commits, [commit], "its commits are the unit's");
  const next = pb(repo, "plan", "next", "docs/plan.md");
  assert.equal(next.code, 0, `plan next goes on, stderr ${next.stderr}`);
  assert.equal(JSON.parse(next.stdout).next.title, NEXT);
});

test("reopen-refuses-a-box-ticked-by-hand-with-no-kept-spike-run", () => {
  const { repo } = strandedRepo();
  rmSync(join(repo.dir, ".pairingbuddy", "reports", "runs"), { recursive: true });

  const r = pb(repo, "human", "reopen", "--plan", "docs/plan.md");

  assert.equal(r.code, 1, `reopen refuses, stdout ${r.stdout}`);
  assert.match(r.stderr, /has no spike run kept for branch/);
  assert.equal(existsSync(join(runDirOf(repo), "unit.json")), false, "no unit is written");
});

test("plan-next-names-the-reopen-line-when-kept-spike-runs-cover-the-ticks", () => {
  const { repo } = strandedRepo();

  const r = pb(repo, "plan", "next", "docs/plan.md");

  assert.equal(r.code, 1, `plan next refuses, stdout ${r.stdout}`);
  assert.match(r.stderr, /human reopen --plan docs\/plan\.md/, `the refusal names the line the human types, stderr ${r.stderr}`);
});

test("plan-next-names-no-reopen-line-for-a-box-ticked-by-hand", () => {
  const { repo } = strandedRepo();
  rmSync(join(repo.dir, ".pairingbuddy", "reports", "runs"), { recursive: true });

  const r = pb(repo, "plan", "next", "docs/plan.md");

  assert.doesNotMatch(r.stderr, /human reopen/);
});
