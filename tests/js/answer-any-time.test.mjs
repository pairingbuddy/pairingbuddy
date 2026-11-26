// Answering the unit's questions for you at any time: pb human answer records the answer and hands it to the steps that
// start next as guidance; at the next task boundary pb plan next asks the session to settle each answer, and pb question
// settle adds a rework task to the plan for an answer that changes work already done, at most three per unit.
import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeRepo, pb, writePlan } from "./cli-repo-fixture.mjs";

const QUESTION = (n) => ({ gate: "G:task-end", task: "Task 1: one", step: "a reviewer", ambiguity: `Doubt ${n}?` });
const unitPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "unit.json");
const unitOf = (repo) => JSON.parse(readFileSync(unitPath(repo), "utf8"));
const guidanceOf = (repo) => JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "human-guidance.json"), "utf8")).guidance;

function repoWithQuestions(questions, { openTask = true, extra = {} } = {}) {
  const repo = makeRepo({ openTask });
  writeFileSync(unitPath(repo), JSON.stringify({ unit: "T1a Solo", plan: "docs/plan.md", tasks: [], commits: [], questions, ...extra }));
  return repo;
}

describe("pb human answer", () => {
  test("records the answer on the question and hands it to the next steps as guidance", () => {
    const repo = repoWithQuestions([QUESTION(1), QUESTION(2)]);

    const { code, stdout, stderr } = pb(repo, "human", "answer", "2", "Yes,", "always", "drafts.");

    assert.equal(code, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), { ok: true, n: 2, open: 1 });
    assert.equal(unitOf(repo).questions[1].answer, "Yes, always drafts.");
    assert.equal(unitOf(repo).questions[0].answer, undefined);
    const [entry] = guidanceOf(repo);
    assert.equal(entry.context, "answer to a question for you, raised at G:task-end in Task 1: one");
    assert.equal(entry.feedback, "Question: Doubt 2?\nAnswer: Yes, always drafts.");
    assert.equal(entry.task_scoped, undefined, "the answer holds for the rest of the unit, not one task");
  });
});

const PLAN = ["## Tasks", "### T1: tracer", "#### PR: T1a Solo", "- [ ] **Task 1: one**", "  body one", "- [ ] **Task 2: two**", "  body two", ""].join("\n");

describe("pb plan next at the task boundary", () => {
  test("with an answer to settle it names no next task and asks the session to settle each answer first", () => {
    const repo = repoWithQuestions([QUESTION(1), { ...QUESTION(2), answer: "Change it.", answeredAt: "t" }], { openTask: false });
    writePlan(repo, PLAN);

    const { code, stdout, stderr } = pb(repo, "plan", "next", "docs/plan.md");

    assert.equal(code, 0, stderr);
    const out = JSON.parse(stdout);
    assert.equal(out.next, null);
    assert.deepEqual(out.answered, [{ n: 2, task: "Task 1: one", question: "Doubt 2?", answer: "Change it." }]);
    assert.match(out.settle, /pb question settle <n> --rework/);
    assert.match(out.settle, /--keep/);
  });

  test("with every answer settled it names the next task as before", () => {
    const repo = repoWithQuestions([{ ...QUESTION(1), answer: "Keep it.", answeredAt: "t", settled: "keep" }], { openTask: false });
    writePlan(repo, PLAN);

    const out = JSON.parse(pb(repo, "plan", "next", "docs/plan.md").stdout);

    assert.equal(out.next.title, "Task 1: one");
    assert.equal(out.answered, undefined);
  });
});

describe("pb question settle", () => {
  const answered = (n, extra = {}) => ({ ...QUESTION(n), answer: `Answer ${n}.`, answeredAt: "t", ...extra });

  test("--keep settles the answer and leaves the plan as it is", () => {
    const repo = repoWithQuestions([answered(1)], { openTask: false });
    writePlan(repo, PLAN);

    const { code, stdout, stderr } = pb(repo, "question", "settle", "1", "--keep");

    assert.equal(code, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), { ok: true, n: 1, settled: "keep" });
    assert.equal(unitOf(repo).questions[0].settled, "keep");
    assert.equal(readFileSync(join(repo.dir, "docs", "plan.md"), "utf8"), PLAN);
  });

  test("--rework adds a rework task before the unit's next task, so pb plan next runs it next", () => {
    const repo = repoWithQuestions([answered(1)], { openTask: false });
    writePlan(repo, PLAN);

    const { code, stdout, stderr } = pb(repo, "question", "settle", "1", "--rework");

    assert.equal(code, 0, stderr);
    const title = "Rework 1 in T1a Solo: Doubt 1?";
    assert.deepEqual(JSON.parse(stdout), { ok: true, n: 1, settled: "rework", task: title });
    assert.deepEqual([unitOf(repo).questions[0].settled, unitOf(repo).questions[0].rework], ["rework", title]);
    assert.equal(JSON.parse(pb(repo, "plan", "next", "docs/plan.md").stdout).next.title, title);
  });

  test("a fourth rework in one unit is refused, to ask the human whether it has become a re-plan", () => {
    const done = [1, 2, 3].map((n) => answered(n, { settled: "rework", rework: `Rework ${n} in T1a Solo: Doubt ${n}?` }));
    const repo = repoWithQuestions([...done, answered(4)], { openTask: false });
    writePlan(repo, PLAN);

    const { code, stderr } = pb(repo, "question", "settle", "4", "--rework");

    assert.equal(code, 1);
    assert.match(stderr, /already has 3 rework tasks/);
    assert.match(stderr, /re-plan/);
    assert.equal(unitOf(repo).questions[3].settled, undefined);
    assert.equal(readFileSync(join(repo.dir, "docs", "plan.md"), "utf8"), PLAN);
  });

  test("is refused while a task's run is open: answers are settled between tasks", () => {
    const repo = repoWithQuestions([answered(1)]);
    writePlan(repo, PLAN);

    const { code, stderr } = pb(repo, "question", "settle", "1", "--keep");

    assert.equal(code, 1);
    assert.match(stderr, /between tasks/);
  });
});
