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
