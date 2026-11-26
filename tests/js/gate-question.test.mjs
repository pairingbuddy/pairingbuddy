// The question a gate asks the human: plain words, a short header, why it asks, and no gate ids.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { fileURLToPath } from "node:url";

import { REVIEWER, fullQuestion, gateQuestion } from "../../shared-node/gates.mjs";
import { loadStages } from "../../shared-node/stages.mjs";

const POLICY = "the gate policy is default, not auto";
const FULL_AT = "/repo/.pairingbuddy/run/question.md";

describe("each gate asks in plain words", () => {
  test("a gate asked only because auto mode is off adds no why line: the publish question ends with its facts and its ask", () => {
    const { question } = gateQuestion("G:publish", { reason: POLICY, facts: { title: "Add order_total to the cart", body: "Adds order_total.\n" }, fullAt: FULL_AT });

    assert.equal(question, ["Pull request: Add order_total to the cart", "Adds order_total.", `Full description: ${FULL_AT}`, "Open it?"].join("\n"));
  });

  test("G:scenarios shows the scenarios with their tests indented, then asks", () => {
    const scenarios = [
      { description: "order total sums the lines", tests: ["two lines add up", "no lines give zero"] },
      { description: "a bad line is refused", tests: ["a negative quantity raises"] },
    ];
    const { header, question } = gateQuestion("G:scenarios", { reason: POLICY, facts: { scenarios } });

    assert.equal(header, "Scenarios");
    assert.equal(question, [
      "Scenarios (2 scenarios, 3 tests):",
      "- order total sums the lines",
      "    - two lines add up",
      "    - no lines give zero",
      "- a bad line is refused",
      "    - a negative quantity raises",
      "Start building these?",
    ].join("\n"));
  });

  test("G:scenarios that do not fit 12 lines with their tests show one line per scenario with its test count", () => {
    const scenarios = Array.from({ length: 5 }, (_, i) => ({ description: `scenario ${i + 1}`, tests: i === 0 ? ["test 1a"] : [`test ${i + 1}a`, `test ${i + 1}b`] }));
    const { question } = gateQuestion("G:scenarios", { reason: POLICY, facts: { scenarios } });
    const lines = question.split("\n");

    assert.deepEqual(lines, [
      "Scenarios (5 scenarios, 9 tests):",
      "- scenario 1 (1 test)",
      "- scenario 2 (2 tests)",
      "- scenario 3 (2 tests)",
      "- scenario 4 (2 tests)",
      "- scenario 5 (2 tests)",
      "Start building these?",
    ]);
  });

  test("G:scenarios past 15 scenarios folds the rest, saying how many more scenarios the full question file holds", () => {
    const scenarios = Array.from({ length: 18 }, (_, i) => ({ description: `scenario ${i + 1}`, tests: [`test ${i + 1}a`] }));
    const { question } = gateQuestion("G:scenarios", { reason: POLICY, facts: { scenarios }, fullAt: FULL_AT });
    const lines = question.split("\n");

    assert.equal(lines[0], "Scenarios (18 scenarios, 18 tests):");
    assert.deepEqual(lines.slice(15, 18), ["- scenario 15 (1 test)", `+ 3 more scenarios: ${FULL_AT}`, "Start building these?"]);
  });

  test("G:scenarios one past 15 says one more scenario", () => {
    const scenarios = Array.from({ length: 16 }, (_, i) => ({ description: `scenario ${i + 1}`, tests: [`test ${i + 1}a`] }));
    const { question } = gateQuestion("G:scenarios", { reason: POLICY, facts: { scenarios }, fullAt: FULL_AT });

    assert.equal(question.split("\n")[16], `+ 1 more scenario: ${FULL_AT}`);
  });

  test("G:type opens with the task type and the classifier's gist, then asks", () => {
    const { header, question } = gateQuestion("G:type", { reason: POLICY, taskType: "new_feature", facts: { rationale: "Adds order_total to cart.py. Nothing existing changes." } });

    assert.equal(header, "Task type");
    assert.equal(question, "Task type: new feature. Adds order_total to cart.py.\nIs that the right type?");
  });

  test("G:type says what the classifier was unsure of when it was not certain and named its doubt", () => {
    const facts = { rationale: "Adds order_total to cart.py.", ambiguity: "The example says 30.0, but\n  2 times 10 plus 4 is 24." };

    const { question } = gateQuestion("G:type", { reason: "the classifier does not report certain", taskType: "new_feature", facts });

    assert.equal(question, "Task type: new feature. Adds order_total to cart.py.\nThe classifier was not sure: The example says 30.0, but 2 times 10 plus 4 is 24.\nIs that the right type?");
  });

  test("G:task-end gives the goal, what was built and what the review did, then asks", () => {
    const facts = {
      goal: "Add order_total(lines) to cart.py. It returns the sum of price times quantity.",
      files: ["cart.py", "tests/test_cart.py"],
      tests: 1,
      passing: true,
      review: ["fixed"],
    };
    const { header, question } = gateQuestion("G:task-end", { reason: POLICY, facts });

    assert.equal(header, "Task done");
    assert.equal(question, [
      "Goal: Add order_total(lines) to cart.py.",
      "Built: cart.py, tests/test_cart.py; 1 test, all passing.",
      "Review: 1 issue, 1 fixed, 0 left as is.",
      "Is the task done?",
    ].join("\n"));
  });

  test("G:task-end says when the full suite checked no lint", () => {
    const facts = { goal: "Add order_total.", files: ["cart.py"], tests: 1, passing: true, lint: "no lint configured" };

    const { question } = gateQuestion("G:task-end", { reason: POLICY, facts });

    assert.equal(question, [
      "Goal: Add order_total.",
      "Built: cart.py; 1 test, all passing.",
      "Lint: no lint configured.",
      "Is the task done?",
    ].join("\n"));
  });

  test("G:task-end gives the goal check's gist when it had something to say", () => {
    const goalCheck = [{ gist: "The README does not name order_total", outcome: "fixed" }, { gist: "Plan says cents", outcome: "left as is" }];
    const { question } = gateQuestion("G:task-end", { reason: POLICY, facts: { review: ["fixed", "left as is"], goalCheck }, fullAt: FULL_AT });

    assert.equal(question, [
      "Review: 2 issues, 1 fixed, 1 left as is.",
      `Goal check: The README does not name order_total (fixed); + 1 more: ${FULL_AT}`,
      "Is the task done?",
    ].join("\n"));
  });

  test("G:task-end gives a long goal's first sentence whole: the question box wraps it", () => {
    const goal = "Add order_total(lines) to cart.py so that it returns the sum of price times quantity over every line in the cart, so the checkout page can show one total, rounded to cents. Then document it.";
    const [line] = gateQuestion("G:task-end", { reason: POLICY, facts: { goal } }).question.split("\n");

    assert.equal(line, "Goal: Add order_total(lines) to cart.py so that it returns the sum of price times quantity over every line in the cart, so the checkout page can show one total, rounded to cents.");
  });

  test("G:task-end leaves out every line whose fact could not be read", () => {
    const { question } = gateQuestion("G:task-end", { reason: POLICY, facts: { tests: 2 } });

    assert.equal(question, "Built: 2 tests.\nIs the task done?");
  });

  test("G:publish gives the title, the Summary's first paragraph and the body file, not the whole body", () => {
    const changes = Array.from({ length: 40 }, (_, i) => `- cart.py: change ${i + 1}`).join("\n");
    const body = `## Summary\n\nAdds order_total(lines) to cart.py,\nso checkout shows one total.\n\nA second paragraph of summary.\n\n## Impact\n\nCheckout only.\n\n## Changes\n\n${changes}\n\n## Verification\n\nuv run pytest\n`;
    const bodyAt = "/repo/.pairingbuddy/run/pr-body.md";
    const { question } = gateQuestion("G:publish", { reason: POLICY, facts: { title: "Add order_total to the cart", body, bodyAt }, fullAt: FULL_AT });

    assert.equal(question, [
      "Pull request: Add order_total to the cart",
      "Adds order_total(lines) to cart.py, so checkout shows one total.",
      `Full description: ${bodyAt}`,
      "Open it?",
    ].join("\n"));
  });

  test("G:publish with no Summary section gives the body's first paragraph, and names the full question file without a body file", () => {
    const body = "\nAdds order_total(lines) to cart.py.\n\nWhy: the checkout needs a total.\n";
    const { header, question } = gateQuestion("G:publish", { reason: POLICY, facts: { title: "Add order_total to the cart", body }, fullAt: FULL_AT });

    assert.equal(header, "Publish");
    assert.equal(question, [
      "Pull request: Add order_total to the cart",
      "Adds order_total(lines) to cart.py.",
      `Full description: ${FULL_AT}`,
      "Open it?",
    ].join("\n"));
  });

  test("the full question file of G:publish holds the whole body", () => {
    const body = "## Summary\n\nAdds order_total.\n\n## Changes\n\n- cart.py\n";

    const full = fullQuestion("G:publish", { reason: POLICY, facts: { title: "T", body, bodyAt: "/repo/.pairingbuddy/run/pr-body.md" } });

    assert.ok(full.includes(body.trim()), full);
  });

  test("G:publish on a pull request refresh asks to update it", () => {
    const { question } = gateQuestion("G:publish", { reason: "a pull request refresh is approved by a human", refresh: true, facts: { title: "T" } });

    assert.match(question, /^Pull request: T\n/);
    assert.match(question, /\nUpdate it\?$/);
  });

  test("G:scope asks whether the tidy-up list is right", () => {
    const { header, question } = gateQuestion("G:scope", { reason: POLICY });

    assert.equal(header, "Tidy-up");
    assert.equal(question, "Is this the right list to tidy up?");
  });

  test("G:unit asks whether this experiment is done", () => {
    const { header, question } = gateQuestion("G:unit", { reason: POLICY });

    assert.equal(header, "Experiment");
    assert.equal(question, "Is this experiment done?");
  });

  test("every gate of the real contract has its own short header and names no gate id", () => {
    const contract = loadStages(fileURLToPath(new URL("../..", import.meta.url)));
    const gates = [...new Set(Object.values(contract.taskTypes).flatMap((graph) => Object.keys(graph.gates)))];

    for (const gate of gates) {
      const { header, question } = gateQuestion(gate, { reason: POLICY, taskType: "bug_fix" });
      assert.ok(header.length <= 12, `${gate}: header ${JSON.stringify(header)} is at most 12 characters`);
      assert.notEqual(header, gateQuestion("G:no-such-gate").header, `${gate} has its own header`);
      assert.doesNotMatch(question, /G:/, `${gate}: the question names no gate id`);
    }
  });
});

// Each reason askReason can give, and the plain line the question carries for it.
const WHYS = [
  ["it is a decide gate, which always asks", "This step always asks you."],
  ["no classifier reports certain", "The check was not sure, so it asks you."],
  ["the classifier does not report certain", "The classifier was not sure of the type."],
  ["the classification lens has an open finding", "A reviewer doubts the task type."],
  ["runner unit has no selector_template, so RED and GREEN cannot speak for one test. Ask the human to add it", "Runner unit can't run one test on its own: add a selector_template to it in .pairingbuddy/test-config.json, and the run asks you to accept the change."],
  ["runners unit, e2e have no selector_template, so pb cannot run one test on its own", "Runners unit, e2e can't run one test on their own: add a selector_template to each in .pairingbuddy/test-config.json, and the run asks you to accept the change."],
  ["the scope lens found the scope may not serve the stated intent", "A reviewer doubts the tidy-up fits the goal."],
  ["the run stopped: the human answered stop at G:type", "The run stopped and needs you."],
  ["retries are exhausted for code-tdd", "A step ran out of retries."],
  ["the config hash changed during the run", "A config file changed during the run."],
  ["the git-config hash changed during the run", "A config file changed during the run."],
  ["the return pb1-x.json carries an open ambiguity", "A step was unsure about something."],
  ["these returns carry an open ambiguity: a.json, b.json", "A step was unsure about something."],
  ["coverage gaps remain: 2", "Some scenarios have no test yet."],
  ["coverage gaps remain: 2, in pb1-y.json", "Some scenarios have no test yet."],
  ["a decide finding survived", "A review found something only you can decide."],
  ["a lens is uncovered: necessity", "One review did not get done."],
  ["an unrefuted high-severity finding is past the cap", "A serious review finding is still open."],
  ["the return pb1-z.json cannot be read", "A step's result could not be read."],
  ["the G:publish approval no longer holds: HEAD moved from abc1234 to def5678", "Something changed since your last OK."],
  ["the PR lint has not run", "The pull request text has not passed its checks."],
  ["the PR lint is stale: it was run for another body than run/pr-body.md", "The pull request text has not passed its checks."],
  ["the PR lint failed: title-length", "The pull request text has not passed its checks."],
  ["a pull request refresh is approved by a human", "Updating a pull request always asks you."],
  ["no lens record yet for the safety net", "Not every task has had its safety-net review."],
  ["questions for you are open: 3", "Doubts were set aside for you while the run went on."],
];

describe("the question says why it asks, in plain words", () => {
  test("each reason gives its plain line before the ask", () => {
    for (const [reason, why] of WHYS) {
      assert.equal(gateQuestion("G:task-end", { reason }).question, `${why}\nIs the task done?`, reason);
    }
  });

  test("auto mode being off is no reason worth a line", () => {
    for (const reason of ["no gate policy is recorded", "the gate policy is default, not auto"]) {
      assert.equal(gateQuestion("G:task-end", { reason }).question, "Is the task done?", reason);
    }
  });
});

const AMBIGUITY = "the return code-tdd.implement-code.t1.r1.a1.json carries an open ambiguity";

describe("a gate that asks over an open doubt says what the doubt is", () => {
  test("G:task-end names the step and its doubt, then asks whether the task is done despite it", () => {
    const doubts = [{ step: "making the test pass", ambiguity: "Should an empty cart total 0 or None?" }];
    const { question } = gateQuestion("G:task-end", { reason: AMBIGUITY, facts: { tests: 1, doubts } });

    assert.equal(question, ["Built: 1 test.", "Unsure (making the test pass): Should an empty cart total 0 or None?", "Is the task done despite this?"].join("\n"));
  });

  test("a reviewer's doubt says a reviewer was unsure, in plain words", () => {
    const doubts = [{ step: REVIEWER, ambiguity: "Should an empty cart total 0 or None?" }];
    const { question } = gateQuestion("G:task-end", { reason: AMBIGUITY, facts: { doubts } });

    assert.equal(question, ["A reviewer was unsure: Should an empty cart total 0 or None?", "Is the task done despite this?"].join("\n"));
  });

  test("a kept question whose record has its task's whole plan text names the task by title only", () => {
    const doubts = [{ step: REVIEWER, ambiguity: "Drafts?", task: "Task 111: Many PRs\n\n**Goal:** Many PRs open." }];
    const lines = gateQuestion("G:task-end", { reason: "questions for you are open: 1", facts: { doubts } }).question.split("\n");

    assert.equal(lines[0], "A reviewer was unsure (Task 111: Many PRs): Drafts?");
  });

  test("a question the unit kept for G:publish names the task that raised it", () => {
    const doubts = [{ step: REVIEWER, ambiguity: "Should drafts open outside auto?", task: "Task 111: Many PRs" }, { step: "listing scenarios", ambiguity: "Is retry in scope?", task: "Task 112: Exit" }];
    const lines = gateQuestion("G:task-end", { reason: "questions for you are open: 2", facts: { doubts } }).question.split("\n");

    assert.deepEqual(lines.slice(0, 2), ["A reviewer was unsure (Task 111: Many PRs): Should drafts open outside auto?", "Unsure (listing scenarios, Task 112: Exit): Is retry in scope?"]);
  });

  test("a long doubt is shown whole on one line, its whitespace collapsed: the question box wraps it", () => {
    const ambiguity = `The task says\n  totals are rounded, ${"but it does not say whether ".repeat(6)}half cents round up.`;
    const { question } = gateQuestion("G:task-end", { reason: AMBIGUITY, facts: { doubts: [{ step: "making the test pass", ambiguity }] } });

    assert.equal(question, [`Unsure (making the test pass): ${ambiguity.replace(/\s+/g, " ")}`, "Is the task done despite this?"].join("\n"));
  });

  test("past three doubts the rest are counted, naming the file that holds the full question", () => {
    const doubts = ["a?", "b?", "c?", "d?", "e?"].map((ambiguity) => ({ step: "writing a failing test", ambiguity }));
    const { question } = gateQuestion("G:task-end", { reason: AMBIGUITY, facts: { doubts }, fullAt: FULL_AT });

    assert.equal(question, [
      "Unsure (writing a failing test): a?",
      "Unsure (writing a failing test): b?",
      "Unsure (writing a failing test): c?",
      `+ 2 more: ${FULL_AT}`,
      "Is the task done despite these?",
    ].join("\n"));
  });

  test("the task type and scenarios questions keep their facts and ask despite the doubt", () => {
    const doubts = [{ step: "listing scenarios", ambiguity: "Is a refund a separate case?" }];
    const scenarios = [{ description: "order total sums the lines", tests: ["two lines add up"] }];

    assert.equal(gateQuestion("G:type", { reason: AMBIGUITY, taskType: "new_feature", facts: { rationale: "Adds order_total.", doubts } }).question, "Task type: new feature. Adds order_total.\nUnsure (listing scenarios): Is a refund a separate case?\nIs that the right type despite this?");
    assert.equal(gateQuestion("G:scenarios", { reason: AMBIGUITY, facts: { scenarios, doubts } }).question, [
      "Scenarios (1 scenario, 1 test):",
      "- order total sums the lines",
      "    - two lines add up",
      "Unsure (listing scenarios): Is a refund a separate case?",
      "Start building these despite this?",
    ].join("\n"));
  });

  test("with doubts that could not be read the question still says a step was unsure", () => {
    assert.equal(gateQuestion("G:task-end", { reason: AMBIGUITY, facts: {} }).question, "A step was unsure about something.\nIs the task done?");
  });
});

describe("the full question file holds what the question folds", () => {
  test("it is Markdown with the whole goal, every changed file, every goal-check finding and every doubt in full", () => {
    const facts = {
      goal: "Add order_total(lines) to cart.py. It returns the sum of price times quantity.",
      files: ["a.py", "b.py", "c.py", "d.py", "e.py", "f.py"],
      tests: 2,
      passing: true,
      review: ["fixed", "left as is"],
      goalCheck: [{ gist: "README misses order_total", outcome: "fixed" }, { gist: "Plan says cents", outcome: "left as is" }],
      doubts: ["a?", "b?", "c?", "d?"].map((ambiguity) => ({ step: "writing a failing test", ambiguity })),
    };

    assert.equal(fullQuestion("G:task-end", { reason: AMBIGUITY, facts }), [
      "# Task done",
      "",
      "Goal: Add order_total(lines) to cart.py. It returns the sum of price times quantity.",
      "",
      "Built: a.py, b.py, c.py, d.py, e.py, f.py; 2 tests, all passing.",
      "",
      "Review: 2 issues, 1 fixed, 1 left as is.",
      "",
      "Goal check:",
      "- README misses order_total (fixed)",
      "- Plan says cents (left as is)",
      "",
      "Unsure (writing a failing test): a?",
      "",
      "Unsure (writing a failing test): b?",
      "",
      "Unsure (writing a failing test): c?",
      "",
      "Unsure (writing a failing test): d?",
      "",
      "Is the task done despite these?",
      "",
    ].join("\n"));
  });
});

describe("the answers are plain too", () => {
  test("a gate's three answers say what each does in plain words", () => {
    const { options } = gateQuestion("G:scenarios");

    assert.deepEqual(options, [
      { label: "approve", description: "Yes, carry on." },
      { label: "redo", description: "No, do that step again." },
      { label: "stop", description: "Stop the run here." },
    ]);
  });

  test("the publish answers say what each does in plain words", () => {
    const { options } = gateQuestion("G:publish");

    assert.deepEqual(options, [
      { label: "publish", description: "Yes, push the branch and send the pull request." },
      { label: "keep local", description: "No, keep the commits here and publish nothing." },
      { label: "redo", description: "No, rewrite the pull request first." },
    ]);
  });
});

describe("G:publish and the questions the human already answered", () => {
  const handled = [{ task: "Task 1: one", ambiguity: "Drafts outside auto?", answer: "Yes, always." }];

  test("asks only the open ones and lists the answered ones as handled, with their answers", () => {
    const facts = { doubts: [{ step: REVIEWER, task: "Task 2: two", ambiguity: "Keep the old test?" }], handled };

    const { question } = gateQuestion("G:publish", { reason: "questions for you are open: 1", facts, fullAt: FULL_AT });

    assert.match(question, /A reviewer was unsure \(Task 2: two\): Keep the old test\?/);
    assert.match(question, /Answered by you \(Task 1: one\): Drafts outside auto\? → Yes, always\./);
    assert.doesNotMatch(question, /unsure \(Task 1: one\)/);
  });

  test("with every question answered it still lists them as handled", () => {
    const { question } = gateQuestion("G:publish", { reason: POLICY, facts: { handled }, fullAt: FULL_AT });

    assert.match(question, /Answered by you \(Task 1: one\): Drafts outside auto\? → Yes, always\./);
  });
});
