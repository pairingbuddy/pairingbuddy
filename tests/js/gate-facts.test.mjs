// What a gate question shows, read from where the run already keeps it: the classifier's return, the scenarios return,
// task.json, run/changed.json, the ledger's tests and the safety-net lens round. A fact that cannot be read is absent.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { gateFacts } from "../../shared-node/gate-facts.mjs";
import { loadStages } from "../../shared-node/stages.mjs";
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

  test("gives the ambiguity of the classifier's kept return when it has one", () => {
    const root = makeRoot();
    writeReturn(root, "intake.classify-task.-.r1.a1", { task_type: "new_feature", confidence: "likely", rationale: "Adds order_total.", ambiguity: "Does 30.0 include VAT?" });

    assert.deepEqual(gateFacts("G:type", root, atStage("intake")), { rationale: "Adds order_total.", ambiguity: "Does 30.0 include VAT?" });
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

  test("carries the full run's lint note, so the human sees the suite checked no lint", () => {
    const root = makeRoot();
    const tests = { full: { stage: SAFETY_NET, attempt: 1, passed: true, head: "abc", lint: "no lint configured" } };

    assert.equal(gateFacts("G:task-end", root, atStage(SAFETY_NET, { tests })).lint, "no lint configured");
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
    reviewedRound(root, finding("The README does not name order_total. The plan asks for it in the API list.", { kind: "drift", where: "README.md" }));

    const facts = gateFacts("G:task-end", root, atStage(SAFETY_NET));

    assert.deepEqual(facts.review, ["fixed", "left as is"]);
    assert.deepEqual(facts.goalCheck, [{ gist: "The README does not name order_total.", outcome: "left as is" }]);
  });

  test("an untitled goal-check finding with a long first sentence is told by that sentence whole, never cut", () => {
    const root = makeRoot();
    const sentence = "The README's API list does not name order_total, though the plan's first slice says the API list must name every public function.";
    reviewedRound(root, finding(`${sentence} It should.`));

    assert.deepEqual(gateFacts("G:task-end", root, atStage(SAFETY_NET)).goalCheck, [{ gist: sentence, outcome: "left as is" }]);
  });

  test("a goal-check finding with a title is told by its title", () => {
    const root = makeRoot();
    reviewedRound(root, finding("The README does not name order_total.", { title: "README misses order_total" }));

    assert.deepEqual(gateFacts("G:task-end", root, atStage(SAFETY_NET)).goalCheck, [{ gist: "README misses order_total", outcome: "left as is" }]);
  });

  test("counts the findings the pane shows: two lenses that point at the same lines are one, one lens's two gists for them are two", () => {
    const root = makeRoot();
    const at = { where: "cart.py:10", rule: "", severity: "low", kind: "risk" };
    writeReturn(root, `${SAFETY_NET}.lens.code.r1.a1`, { findings: [{ ...at, title: "order_total does not round the sum to cents", claim: "a" }, { ...at, title: "Empty order returns int 0, not float", claim: "b" }] });
    writeReturn(root, `${SAFETY_NET}.lens.tests.r1.a1`, { findings: [{ ...at, title: "The sum is not rounded", claim: "c" }] });
    writeReturn(root, `${SAFETY_NET}.lens.corpus-misalignment.r1.a1`, { findings: [] });

    assert.deepEqual(gateFacts("G:task-end", root, atStage(SAFETY_NET)).review, ["left as is", "left as is"]);
  });

  test("no review line when no lens of the round was recorded", () => {
    const root = makeRoot();

    assert.equal(Object.hasOwn(gateFacts("G:task-end", root, atStage(SAFETY_NET)), "review"), false);
  });
});

const CONTRACT = loadStages(fileURLToPath(new URL("../..", import.meta.url)));

describe("open doubts", () => {
  const DOUBT = "Should an empty cart total 0 or None? The task does not say, and the tests pass either way.";
  const tddDone = () => atStage(SAFETY_NET, { stages: [{ name: "code-tdd", status: "done", attempt: 1 }, { name: SAFETY_NET, status: "done", attempt: 1 }] });

  test("each gate gives every open doubt in full, with the plain name of the step that had it", () => {
    const root = makeRoot();
    writeReturn(root, "code-tdd.implement-code.t1.r1.a1", { ambiguity: DOUBT, commit_subject: "x", files_changed: [] });

    for (const gate of ["G:type", "G:scenarios", "G:task-end"]) {
      assert.deepEqual(gateFacts(gate, root, tddDone(), CONTRACT).doubts, [{ step: "making the test pass", ambiguity: DOUBT }], gate);
    }
  });

  test("a lens's or a refuter's doubt is told as a reviewer's, with the stage it reviewed", () => {
    const root = makeRoot();
    writeReturn(root, `${SAFETY_NET}.lens.code.r1.a1`, { ambiguity: DOUBT, findings: [] });
    writeReturn(root, `${SAFETY_NET}.refuter.code-1.r1.a1`, { ambiguity: "Is 0 a valid quantity?", finding_id: "code-1", verdict: "survives" });

    assert.deepEqual(gateFacts("G:task-end", root, tddDone(), CONTRACT).doubts, [{ step: "a reviewer", stage: SAFETY_NET, ambiguity: DOUBT }, { step: "a reviewer", stage: SAFETY_NET, ambiguity: "Is 0 a valid quantity?" }]);
  });

  test("a doubt carries the suggested answers its return offers, as ambiguity_options; none when it offers none", () => {
    const root = makeRoot();
    writeReturn(root, `${SAFETY_NET}.lens.code.r1.a1`, { ambiguity: DOUBT, ambiguity_options: ["0", "None"], findings: [] });
    writeReturn(root, `${SAFETY_NET}.lens.tests.r1.a1`, { ambiguity: "Is 0 a valid quantity?", findings: [] });

    assert.deepEqual(gateFacts("G:task-end", root, tddDone(), CONTRACT).doubts, [
      { step: "a reviewer", stage: SAFETY_NET, ambiguity: DOUBT, options: ["0", "None"] },
      { step: "a reviewer", stage: SAFETY_NET, ambiguity: "Is 0 a valid quantity?" },
    ]);
  });

  test("what a reviewer could not check is no doubt: the gate shows only its ambiguity", () => {
    const root = makeRoot();
    writeReturn(root, `${SAFETY_NET}.lens.code.r1.a1`, { ambiguity: null, not_checked: "I did not read the full cart.py.", findings: [] });
    writeReturn(root, `${SAFETY_NET}.lens.tests.r1.a1`, { ambiguity: DOUBT, not_checked: "The corpus is none.", findings: [] });

    assert.deepEqual(gateFacts("G:task-end", root, tddDone(), CONTRACT).doubts, [{ step: "a reviewer", stage: SAFETY_NET, ambiguity: DOUBT }]);
  });

  test("a doubt a human already approved past is not shown again", () => {
    const root = makeRoot();
    writeReturn(root, "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1", { ambiguity: DOUBT, scenarios: [] });
    const ledger = { ...tddDone(), gates: { "G:scenarios": { source: "human", answer: "approve" } } };

    assert.equal(Object.hasOwn(gateFacts("G:task-end", root, ledger, CONTRACT), "doubts"), false);
  });

  test("a return that cannot be read leaves every doubt out rather than show part of them", () => {
    const root = makeRoot();
    writeReturn(root, "code-tdd.implement-code.t1.r1.a1", { ambiguity: DOUBT });
    writeFileSync(join(artifactsOf(root), "code-tdd.implement-code.t2.r1.a1.json"), "{ not json");

    assert.equal(Object.hasOwn(gateFacts("G:task-end", root, tddDone(), CONTRACT), "doubts"), false);
  });
});
