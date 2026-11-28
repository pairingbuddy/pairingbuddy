// Scenario human-task-done: a plan task the human finished by hand (or a run did, without being linked to the plan) has no
// task record, so `pb plan next` stops on it as hand-ticked. `pb human task done <n>` records it for the open unit as done
// by the human and ticks its box, so the run goes on. Only a person runs it: the gate refuses pb human from a model.
// Never use { skip } here: the JS suite treats skipped tests as failures.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { env, makeRepo, pb, writePlan } from "./cli-repo-fixture.mjs";

const planText = (firstBox) => [
  "# Plan",
  "",
  "## Tasks",
  "",
  "### Tracer 1: Skeleton",
  "",
  "#### PR: Totals",
  "",
  `- ${firstBox} **Task 1: Add totals**`,
  "- [ ] **Task 2: Add discounts**",
  "",
].join("\n");

function repoWithPlan(firstBox) {
  const repo = makeRepo({ openTask: false, remote: true });
  const git = (...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), encoding: "utf8" }).trim();
  appendFileSync(join(repo.dir, ".gitignore"), "docs/\n");
  git("add", ".gitignore");
  git("commit", "-q", "-m", "ignore docs");
  git("push", "-q", "origin", "main");
  writePlan(repo, planText(firstBox));
  return repo;
}

const openUnit = (repo) => pb(repo, "unit", "open", "--type", "feat", "--slug", "totals", "--plan", "docs/plan.md");

describe("human-task-done", () => {
  // A box the human ticked by hand stops the unit from opening; once they say the task is done, the unit opens and
  // plan next goes on to the next task
  test("task-done-records-a-hand-ticked-task-and-plan-next-goes-on", () => {
    const repo = repoWithPlan("[x]");

    const stopped = openUnit(repo);
    const done = pb(repo, "human", "task", "done", "1", "--plan", "docs/plan.md");
    const opened = openUnit(repo);
    const next = pb(repo, "plan", "next", "docs/plan.md");

    assert.equal(stopped.code, 1, `unit open stops on the hand-ticked task (stderr: ${stopped.stderr})`);
    assert.match(stopped.stderr, /human task done 1 --plan docs\/plan\.md/, "the stop names the command that records it");
    assert.equal(done.code, 0, `task done exit code (stderr: ${done.stderr})`);
    assert.equal(opened.code, 0, `unit open after task done (stderr: ${opened.stderr})`);
    assert.equal(next.code, 0, `plan next exit code after task done (stderr: ${next.stderr})`);
    assert.equal(JSON.parse(next.stdout).next.title, "Task 2: Add discounts", "plan next goes on to the next task");
  });

  // An unticked box is ticked too, and the record line sits indented directly under it; the rest of the plan is untouched
  test("task-done-ticks-an-unticked-box-and-writes-the-record-line", () => {
    const repo = repoWithPlan("[ ]");

    const done = pb(repo, "human", "task", "done", "1", "--plan", "docs/plan.md");
    const again = pb(repo, "human", "task", "done", "1", "--plan", "docs/plan.md");
    const text = readFileSync(join(repo.dir, "docs", "plan.md"), "utf8");

    const expected = planText("[x]").replace("**Task 1: Add totals**\n", "**Task 1: Add totals**\n  Done by hand: accepted\n");
    assert.equal(done.code, 0, `task done exit code (stderr: ${done.stderr})`);
    assert.equal(JSON.parse(done.stdout).done, "recorded", "the first call records the task");
    assert.equal(text, expected, "the box is ticked and the record line is indented under it");
    assert.equal(JSON.parse(again.stdout).done, "already recorded", "a second call changes nothing");
  });

  // Each bad target exits 1 with the reason on stderr and leaves the plan byte-identical
  test("task-done-refuses-bad-targets", () => {
    const humanPlan = planText("[ ]").replace("**Task 2: Add discounts**", "**Task 2: [HUMAN] Check discounts**");
    const cases = [
      { name: "unknown", args: ["7", "--plan", "docs/plan.md"], plan: planText("[ ]"), reason: /has no task "7"/ },
      { name: "human task", args: ["2", "--plan", "docs/plan.md"], plan: humanPlan, reason: /\[HUMAN\] task/ },
      { name: "no plan and no unit", args: ["1"], plan: planText("[ ]"), reason: /no unit with a plan is open/ },
    ];

    for (const { name, args, plan, reason } of cases) {
      const repo = repoWithPlan("[ ]");
      writePlan(repo, plan);

      const refused = pb(repo, "human", "task", "done", ...args);
      const text = readFileSync(join(repo.dir, "docs", "plan.md"), "utf8");

      assert.equal(refused.code, 1, `${name}: exit code (stderr: ${refused.stderr})`);
      assert.match(refused.stderr, reason, `${name}: stderr says why`);
      assert.equal(text, plan, `${name}: the plan file is untouched`);
    }
  });

  // Each malformed form exits 2 with the usage line on stderr
  test("task-done-usage-errors", () => {
    const forms = [[], ["done"], ["finish", "1"], ["done", "1", "--plan"], ["done", "--plan", "docs/plan.md"]];

    for (const form of forms) {
      const repo = repoWithPlan("[ ]");

      const refused = pb(repo, "human", "task", ...form);

      assert.equal(refused.code, 2, `${JSON.stringify(form)}: exit code (stderr: ${refused.stderr})`);
      assert.match(refused.stderr, /usage: pb human task done/, `${JSON.stringify(form)}: usage line`);
    }
  });
});

