// The unit's "questions for you" list: doubts an auto-mode gate deferred, kept in run/unit.json until G:publish asks them.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { QUESTIONS_KEPT, addQuestions, openQuestions, questionsLine } from "../../shared-node/questions.mjs";

const doubt = (n) => ({ step: "a reviewer", ambiguity: `Doubt ${n}?` });
const unit = (over = {}) => ({ unit: "T1a", tasks: [], commits: [], ...over });

describe("the unit's questions list", () => {
  test("deferred doubts land on the unit with the gate and task that raised them", () => {
    const next = addQuestions(unit(), { gate: "G:task-end", task: "Task 1: one", doubts: [doubt(1)] });

    assert.deepEqual(next.questions, [{ gate: "G:task-end", task: "Task 1: one", step: "a reviewer", ambiguity: "Doubt 1?" }]);
    assert.deepEqual(openQuestions(next), { kept: next.questions, more: 0, count: 1 });
  });

  test("a doubt's suggested answers ride on its question: at most three, each a short line, none when it has none", () => {
    const long = "word ".repeat(30).trim();
    const doubts = [{ ...doubt(1), options: ["Always draft", " Draft on main only ", "", 7, long, "Never"] }, doubt(2)];

    const next = addQuestions(unit(), { gate: "G:task-end", task: "Task 1: one", doubts });

    assert.deepEqual(next.questions[0].options, ["Always draft", "Draft on main only", `${long.slice(0, 59).trimEnd()}…`]);
    assert.equal("options" in next.questions[1], false, "no options key when the doubt has none");
  });

  test("a question keeps only its task's title, never the task's whole plan text", () => {
    const task = "Task 113: Critique the code path\n\n**Goal:** A full critique.\n\n**Acceptance criteria:**\n- Findings cite captures.";

    const next = addQuestions(unit(), { gate: "G:unit", task, doubts: [doubt(1)] });

    assert.equal(next.questions[0].task, "Task 113: Critique the code path");
  });

  test("past the bound the list keeps the first in full and only counts the rest", () => {
    const many = Array.from({ length: QUESTIONS_KEPT + 3 }, (_, i) => doubt(i + 1));
    const once = addQuestions(unit(), { gate: "G:task-end", task: "Task 1: one", doubts: many });
    const twice = addQuestions(once, { gate: "G:task-end", task: "Task 2: two", doubts: [doubt(99)] });

    assert.equal(QUESTIONS_KEPT, 20);
    assert.equal(twice.questions.length, 20);
    assert.equal(twice.questions.at(-1).ambiguity, "Doubt 20?");
    assert.deepEqual(openQuestions(twice), { kept: twice.questions, more: 4, count: 24 });
  });

  test("the line the pane and band show counts them, in the singular for one", () => {
    assert.equal(questionsLine(0), null);
    assert.equal(questionsLine(1), "1 question for you");
    assert.equal(questionsLine(4), "4 questions for you");
  });
});

describe("answering a question for you", () => {
  test("an answered question leaves the open count but stays on the list with its answer", async () => {
    const { answerQuestion } = await import("../../shared-node/questions.mjs");
    const asked = addQuestions(unit(), { gate: "G:task-end", task: "Task 1: one", doubts: [doubt(1), doubt(2)] });

    const next = answerQuestion(asked, 2, "  Yes, drafts always.  ", "2026-11-26T10:00:00.000Z");

    assert.deepEqual(next.questions[1], { gate: "G:task-end", task: "Task 1: one", step: "a reviewer", ambiguity: "Doubt 2?", answer: "Yes, drafts always.", answeredAt: "2026-11-26T10:00:00.000Z" });
    assert.deepEqual(openQuestions(next), { kept: [next.questions[0]], more: 0, count: 1 });
  });
});

describe("settling an answered question at the task boundary", () => {
  test("an answer waits to be settled, and settling records whether it means rework", async () => {
    const { answerQuestion, answeredQuestions, settleQuestion } = await import("../../shared-node/questions.mjs");
    const asked = addQuestions(unit(), { gate: "G:task-end", task: "Task 1: one", doubts: [doubt(1), doubt(2), doubt(3)] });
    const answered = answerQuestion(answerQuestion(asked, 1, "Keep it.", "t1"), 3, "Change it.", "t2");

    assert.deepEqual(answeredQuestions(answered).map(({ n, answer }) => ({ n, answer })), [{ n: 1, answer: "Keep it." }, { n: 3, answer: "Change it." }]);

    const settled = settleQuestion(settleQuestion(answered, 1, "keep"), 3, "rework", "Rework 1 in T1a: Doubt 3?");

    assert.deepEqual(answeredQuestions(settled), []);
    assert.equal(settled.questions[0].settled, "keep");
    assert.deepEqual([settled.questions[2].settled, settled.questions[2].rework], ["rework", "Rework 1 in T1a: Doubt 3?"]);
  });
});

describe("the rework task an answer adds", () => {
  test("its plan text names the unit, the question and the answer, on one bounded title line", async () => {
    const { REWORKS_PER_UNIT, reworkTask } = await import("../../shared-node/questions.mjs");
    const question = { task: "Task 1: one", ambiguity: `Should **every** PR\nbe a draft ${"x".repeat(200)}?`, answer: "Yes,\n  always." };

    const { title, text } = reworkTask("T1a Solo", 2, question);

    assert.equal(REWORKS_PER_UNIT, 3);
    assert.ok(title.startsWith("Rework 2 in T1a Solo: Should every PR be a draft x"));
    assert.ok(title.length <= 100 && title.endsWith("…"), title);
    assert.equal(text.split("\n")[0], `- [ ] **${title}**`);
    assert.match(text, /\*\*The question \(from Task 1: one\):\*\* Should every PR be a draft x+\?/);
    assert.match(text, /\*\*The human's answer:\*\* Yes, always\./);
    assert.match(text, /\*\*Acceptance criteria:\*\*\n  - The work already done follows the answer\.\n  - The full suite passes\./);
  });
});

describe("placing the rework task in the plan", () => {
  const plan = [
    "## Tasks",
    "### T1: tracer",
    "#### PR: T1a Solo",
    "- [x] **Task 1: one**",
    "  body one",
    "- [ ] **Task 2: two**",
    "  body two",
    "#### PR: T1b Next",
    "- [ ] **Task 3: three**",
    "",
  ].join("\n");

  test("it goes before the unit's first unticked task, so it runs next", async () => {
    const { insertTaskInUnit } = await import("../../shared-node/plan-text.mjs");
    const { parsePlan } = await import("../../shared-node/plan.mjs");

    const next = insertTaskInUnit(plan, "T1a Solo", "- [ ] **Rework 1 in T1a Solo: why?**\n\n  body\n");

    assert.deepEqual(parsePlan(next).units[0].tasks.map(({ title }) => title), ["Task 1: one", "Rework 1 in T1a Solo: why?", "Task 2: two"]);
    assert.equal(parsePlan(next).next.title, "Rework 1 in T1a Solo: why?");
    assert.deepEqual(parsePlan(next).problems, []);
  });

  test("in a unit with every task ticked it goes after the last one, before the next unit", async () => {
    const { insertTaskInUnit } = await import("../../shared-node/plan-text.mjs");
    const { parsePlan } = await import("../../shared-node/plan.mjs");
    const done = plan.replace("- [ ] **Task 2: two**", "- [x] **Task 2: two**");

    const next = insertTaskInUnit(done, "T1a Solo", "- [ ] **Rework 1 in T1a Solo: why?**\n\n  body\n");

    assert.deepEqual(parsePlan(next).units.map(({ unit, tasks }) => [unit, tasks.map(({ title }) => title)]), [["T1a Solo", ["Task 1: one", "Task 2: two", "Rework 1 in T1a Solo: why?"]], ["T1b Next", ["Task 3: three"]]]);
  });

  test("a plan with no such unit is refused", async () => {
    const { insertTaskInUnit } = await import("../../shared-node/plan-text.mjs");

    assert.throws(() => insertTaskInUnit(plan, "T9z Gone", "- [ ] **x**\n"), /no unit T9z Gone/);
  });
});

test("a rework task names the question's task by title even when an old record kept the task's whole plan text", async () => {
  const { reworkTask } = await import("../../shared-node/questions.mjs");

  const { text } = reworkTask("T1a", 1, { task: "Task 4: four\n\n**Goal:** Lots of text.", ambiguity: "Why?", answer: "Because." });

  assert.ok(text.includes("**The question (from Task 4: four):** Why?"), text);
});
