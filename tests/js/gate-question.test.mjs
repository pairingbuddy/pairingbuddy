// The question a gate asks the human: plain words, a short header, why it asks, and no gate ids.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { fileURLToPath } from "node:url";

import { gateQuestion } from "../../shared-node/gates.mjs";
import { loadStages } from "../../shared-node/stages.mjs";

const POLICY = "the gate policy is default, not auto";

describe("each gate asks in plain words", () => {
  test("G:scenarios asks whether the scenarios are right and building can start", () => {
    const { header, question } = gateQuestion("G:scenarios", { reason: POLICY });

    assert.equal(header, "Scenarios");
    assert.equal(question, "Are these scenarios right, and should it start building? Auto mode is off, so this asks you.");
  });

  test("G:type names the task type in plain words", () => {
    const { header, question } = gateQuestion("G:type", { reason: POLICY, taskType: "new_feature" });

    assert.equal(header, "Task type");
    assert.equal(question, "Is the task type right? (new feature) Auto mode is off, so this asks you.");
  });

  test("G:publish asks to open the pull request", () => {
    const { header, question } = gateQuestion("G:publish", { reason: POLICY });

    assert.equal(header, "Publish");
    assert.equal(question, "Open the pull request? Auto mode is off, so this asks you.");
  });

  test("G:publish on a pull request refresh asks to update it", () => {
    const { question } = gateQuestion("G:publish", { reason: "a pull request refresh is approved by a human", refresh: true });

    assert.match(question, /^Update the pull request\? /);
  });

  test("G:scope asks whether the tidy-up list is right", () => {
    const { header, question } = gateQuestion("G:scope", { reason: POLICY });

    assert.equal(header, "Tidy-up");
    assert.equal(question, "Is this the right list to tidy up? Auto mode is off, so this asks you.");
  });

  test("G:unit asks whether this experiment is done", () => {
    const { header, question } = gateQuestion("G:unit", { reason: POLICY });

    assert.equal(header, "Experiment");
    assert.equal(question, "Is this experiment done? Auto mode is off, so this asks you.");
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
  ["no gate policy is recorded", "Auto mode is off, so this asks you."],
  ["the gate policy is default, not auto", "Auto mode is off, so this asks you."],
  ["the classifier does not report certain", "The classifier was not sure of the type."],
  ["the classification lens has an open finding", "A reviewer doubts the task type."],
  ["runner unit has no selector_template, so RED and GREEN cannot speak for one test. Ask the human to add it", "A test runner can't run one test on its own."],
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
];

describe("the question says why it asks, in plain words", () => {
  test("each reason gives its plain line after the question", () => {
    for (const [reason, why] of WHYS) {
      assert.equal(gateQuestion("G:task-end", { reason }).question, `Is this task done? ${why}`, reason);
    }
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
