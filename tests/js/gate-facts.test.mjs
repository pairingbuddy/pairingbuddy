// What a gate question shows, read from where the run already keeps it: the classifier's return, the scenarios return,
// task.json, run/changed.json, the ledger's tests and the safety-net lens round. A fact that cannot be read is absent.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gateFacts } from "../../shared-node/gate-facts.mjs";
import { baseLedger } from "./ledger-fixture.mjs";

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function makeRoot() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gate-facts-")));
  dirs.push(root);
  mkdirSync(join(root, ".pairingbuddy", "run", "task", "artifacts"), { recursive: true });
  return root;
}

const artifactsOf = (root) => join(root, ".pairingbuddy", "run", "task", "artifacts");

function writeReturn(root, pbKey, body) {
  writeFileSync(join(artifactsOf(root), `${pbKey}.json`), JSON.stringify({ pb_key: pbKey, ambiguity: "", ...body }));
}

const atStage = (name, over = {}) => ({ ...baseLedger(), taskType: "new_feature", stage: { name, status: "done", runId: "r1", attempt: 1 }, ...over });

describe("G:type", () => {
  test("gives the rationale of the classifier's kept return", () => {
    const root = makeRoot();
    writeReturn(root, "intake.classify-task.-.r1.a1", { task_type: "new_feature", confidence: "likely", rationale: "Adds order_total to cart.py." });

    assert.deepEqual(gateFacts("G:type", root, atStage("intake")), { rationale: "Adds order_total to cart.py." });
  });
});

const scenario = (description, ...cases) => ({ scenario_id: description, description, test_cases: cases.map((c) => ({ test_case_id: c, description: c })) });

describe("G:scenarios", () => {
  test("gives the scenarios that stand: a kept fix's revision over the first list", () => {
    const root = makeRoot();
    writeReturn(root, "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1", { scenarios: [scenario("first draft", "a")] });
    writeReturn(root, "code-scenarios.fix.g1.r2.a1", { scenarios: [scenario("order total sums the lines", "two lines add up")] });

    assert.deepEqual(gateFacts("G:scenarios", root, atStage("code-scenarios")), {
      scenarios: [{ description: "order total sums the lines", tests: ["two lines add up"] }],
    });
  });

  test("keeps each scenario and test case on one line", () => {
    const root = makeRoot();
    writeReturn(root, "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1", { scenarios: [scenario("sums\n  the lines", "two\nlines")] });

    assert.deepEqual(gateFacts("G:scenarios", root, atStage("code-scenarios")).scenarios, [{ description: "sums the lines", tests: ["two lines"] }]);
  });

  test("a malformed list shows no scenarios rather than part of them", () => {
    const root = makeRoot();
    writeReturn(root, "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1", { scenarios: [scenario("fine", "a"), { description: "no cases" }] });

    assert.deepEqual(gateFacts("G:scenarios", root, atStage("code-scenarios")), {});
  });
});

const writeState = (root, name, body) => writeFileSync(join(root, ".pairingbuddy", name), typeof body === "string" ? body : JSON.stringify(body));
const SAFETY_NET = "code-safety-net";

describe("G:task-end", () => {
  test("gives the task as the goal, the changed files, the tests and whether the full suite passed", () => {
    const root = makeRoot();
    writeState(root, "task.json", { description: "Add order_total(lines) to cart.py." });
    writeState(root, "run/changed.json", [{ path: "cart.py", status: "M" }, { path: "tests/test_cart.py", status: "A" }]);
    const tests = { full: { stage: SAFETY_NET, attempt: 1, passed: true, head: "abc" }, perTest: { t1: { red: { done: true }, green: { done: true } }, t2: { red: { done: true } } } };

    const facts = gateFacts("G:task-end", root, atStage(SAFETY_NET, { tests }));

    assert.deepEqual(facts, { goal: "Add order_total(lines) to cart.py.", files: ["cart.py", "tests/test_cart.py"], tests: 1, passing: true });
  });

  const finding = (claim, extra = {}) => ({ rule: "R", severity: "medium", kind: "fix-here", claim, where: "cart.py:3", ...extra });

  // The safety-net round of a new feature: the code lens found one issue, its refuter upheld it, and the check kept the fix;
  // the docs-and-plan lens (the goal check) found one more that no refuter answered.
  function reviewedRound(root, corpusFinding) {
    writeReturn(root, `${SAFETY_NET}.lens.code.r1.a1`, { findings: [finding("order_total ignores quantity. It sums prices only.")] });
    writeReturn(root, `${SAFETY_NET}.lens.tests.r1.a1`, { findings: [] });
    writeReturn(root, `${SAFETY_NET}.lens.corpus-misalignment.r1.a1`, { findings: corpusFinding === undefined ? [] : [corpusFinding] });
    writeReturn(root, `${SAFETY_NET}.refuter.code-1.r1.a1`, { finding_id: "code-1", verdict: "survives" });
    writeReturn(root, `${SAFETY_NET}.fix.g1.r2.a1`, {});
    writeReturn(root, `${SAFETY_NET}.course-checker.g1.r2.a1`, { finding_id: "code-1", verdict: "better", mistake: "none", what_went_wrong: "" });
  }

  test("gives each review finding's outcome, by the rule the stage return uses", () => {
    const root = makeRoot();
    reviewedRound(root);

    assert.deepEqual(gateFacts("G:task-end", root, atStage(SAFETY_NET)).review, ["fixed"]);
  });

  test("gives the goal check's findings by their gist and outcome", () => {
    const root = makeRoot();
    reviewedRound(root, finding("The README does not name order_total. The plan asks for it in the API list.", { kind: "drift" }));

    const facts = gateFacts("G:task-end", root, atStage(SAFETY_NET));

    assert.deepEqual(facts.review, ["fixed", "left as is"]);
    assert.deepEqual(facts.goalCheck, [{ gist: "The README does not name order_total.", outcome: "left as is" }]);
  });

  test("a goal-check finding with a title is told by its title", () => {
    const root = makeRoot();
    reviewedRound(root, finding("The README does not name order_total.", { title: "README misses order_total" }));

    assert.deepEqual(gateFacts("G:task-end", root, atStage(SAFETY_NET)).goalCheck, [{ gist: "README misses order_total", outcome: "left as is" }]);
  });

  test("no review line when no lens of the round was recorded", () => {
    const root = makeRoot();

    assert.equal(Object.hasOwn(gateFacts("G:task-end", root, atStage(SAFETY_NET)), "review"), false);
  });
});
