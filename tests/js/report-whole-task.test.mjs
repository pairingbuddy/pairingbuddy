// Scenario report-of-the-whole-task: once a task is over, its report describes the code run and the publish run that
// followed it, from the runs pb kept under reports/runs/ (renderReport's `runs`), not only the last ledger polled.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../../shared-node/report.mjs";
import { cardsOf, headerOf, rowsOf, sectionOf, spentOf } from "./report-fixture.mjs";

const TASK = "Add order_total(lines) to cart.py: it sums line_total over the lines.";
const TEST_ID = "order-total-example-two-lines";
const at = (clock) => `2026-11-16T${clock}.000Z`;
const stage = (name, startedAt) => ({ name, status: "done", attempt: 1, startedAt: at(startedAt) });
const DOUBT = { step: "listing scenarios", ambiguity: "An empty order returns int 0, not 0.0." };
const SHA_RED = "1".repeat(40);
const SHA_GREEN = "2".repeat(40);
const SHA_TIDY = "3".repeat(40);
const PR_URL = "https://github.com/o/r/pull/7";

// The code run as pb task end kept it: a new feature, signed off past one open doubt, one test with its three commits.
const CODE_RUN = {
  kind: "code",
  taskType: "new_feature",
  runId: "code-run",
  task: TASK,
  stage: stage("code-safety-net", "10:07:00"),
  stages: [stage("intake", "10:00:00"), stage("code-scenarios", "10:00:30"), stage("code-tdd", "10:02:00"), stage("code-safety-net", "10:07:00")],
  gates: { "G:type": { source: "auto" }, "G:scenarios": { source: "auto" }, "G:task-end": { source: "human-cli", answer: "approve", doubts: [DOUBT] } },
  tests: { perTest: { [TEST_ID]: { red: { passed: true, done: true, exitCodes: [1] }, green: { passed: true, done: true, exitCodes: [0] } } } },
  commits: [SHA_RED, SHA_GREEN, SHA_TIDY],
  checkpoints: [
    { step: "red", key: `code-tdd.implement-tests.${TEST_ID}.r1.a1`, committed: true, sha: SHA_RED, stage: "code-tdd", attempt: 1 },
    { step: "green", key: `code-tdd.implement-code.${TEST_ID}.r1.a1`, committed: true, sha: SHA_GREEN, stage: "code-tdd", attempt: 1 },
    { step: "refactor", key: `code-tdd.refactor-tests.${TEST_ID}.r1.a1`, committed: true, sha: SHA_TIDY, stage: "code-tdd", attempt: 1 },
  ],
  spend: { agents: 30, tokens: 10000, tokensKnown: true },
  stop: null,
  needsHuman: null,
  fixes: { rollbacks: [] },
};

// The publish run that followed: the pull request drafted, reviewed and opened.
const PUBLISH_RUN = {
  kind: "publish",
  taskType: "publish",
  runId: "publish-run",
  task: TASK,
  stage: stage("pr-draft", "10:09:30"),
  stages: [stage("pr-draft", "10:09:30")],
  gates: { "G:publish": { source: "human", answer: "approve" } },
  tests: {},
  commits: [],
  spend: { agents: 13, tokens: 6248, tokensKnown: true },
  stop: null,
  needsHuman: null,
  fixes: { rollbacks: [] },
};

const SCENARIOS = [{ description: "Two lines sum their line totals", tests: ["order_total([(10, 2), (4, 1)]) returns 30.0"] }];

const call = (pbKey, findings) => ({ input: { pb_key: pbKey, ambiguity: null, findings } });
const finding = (title, focus) => ({ rule: "", severity: "low", kind: "drift", title, claim: `${title}.`, where: "cart.py:3", focus });
// The returns the kept runs hold: the light review of the test, the safety-net review, and the review of the PR text.
const CODE_CALLS = [
  call(`code-tdd.lens.${TEST_ID}.r1.a1`, [finding("Test name says example", "test-quality")]),
  call("code-safety-net.lens.code.r1.a1", [finding("Sum of an empty order is int", undefined)]),
];
const PUBLISH_CALLS = [call("pr-draft.lens.permanence.r1.a1", [finding("Passed at the head commit is transient", undefined)])];

const workflow = (name, startedAt, seconds) => ({ kind: "workflow_agent", name, startedAt: at(startedAt), seconds, finished: true });
// The session's agents, in order: the test's cycle, its light review and tidy, the safety-net lens and the PR review lens.
const SPAWNS = [
  workflow(`pb1 code-tdd RED implement-tests ${TEST_ID} r1`, "10:02:05", 20),
  workflow(`pb1 code-tdd RED runner ${TEST_ID} r1`, "10:02:25", 5),
  workflow(`pb1 code-tdd GREEN implement-code ${TEST_ID} r1`, "10:02:30", 30),
  workflow(`pb1 code-tdd GREEN runner ${TEST_ID} r2`, "10:03:00", 5),
  workflow(`pb1 code-tdd REFACTOR lens ${TEST_ID} r1`, "10:03:10", 40),
  workflow(`pb1 code-tdd REFACTOR refactor-tests ${TEST_ID} r1`, "10:03:50", 30),
  workflow(`pb1 code-tdd REFACTOR runner ${TEST_ID} r2`, "10:04:20", 5),
  workflow("pb1 code-safety-net - lens code r1", "10:07:05", 60),
  workflow("pb1 pr-draft - lens permanence r1", "10:10:00", 30),
];

const RUNS = [
  { ledger: CODE_RUN, endedAt: at("10:09:00"), calls: CODE_CALLS, scenarios: SCENARIOS },
  { ledger: PUBLISH_RUN, endedAt: at("10:14:00"), calls: PUBLISH_CALLS, prUrl: PR_URL },
];

const COMMITS = [
  { sha: SHA_RED, subject: "test: order_total sums two lines" },
  { sha: SHA_GREEN, subject: "feat: add order_total" },
  { sha: SHA_TIDY, subject: "refactor: name the example test" },
];

const report = (overrides = {}) => renderReport({ runs: RUNS, spawns: SPAWNS, commits: COMMITS, changed: ["cart.py", "tests/test_cart.py"], ...overrides });

describe("report-of-the-whole-task", () => {
  test("how it ran names the code run's task type and the whole task's time", () => {
    const html = report();

    assert.ok(headerOf(html).includes("DONE"), "the task is done");
    assert.match(sectionOf(html, "AT A GLANCE"), /<strong>Task type<\/strong> new feature/, "the task type is the code run's");
    // The code run ran 9:00 and the publish run 4:30; the half minute between them ran nothing.
    assert.ok(spentOf(html).includes("13:30"), `the time is each run's own time added up, got ${spentOf(html)}`);
  });

  test("STEPS lists every step of both runs, timed from the task's start", () => {
    const rows = rowsOf(sectionOf(report(), "STEPS"));

    assert.deepEqual(rows, [
      ["work out the task type", "0:00"],
      ["write test scenarios", "0:30"],
      ["build test by test", "2:00"],
      ["safety-net review", "7:00"],
      ["write the pull request", "9:30"],
    ]);
  });

  test("SCENARIOS are the code run's", () => {
    const section = sectionOf(report(), "SCENARIOS");

    assert.ok(section.includes("Two lines sum their line totals"), `the code run's scenario is listed, got ${section}`);
    assert.ok(section.includes("returns 30.0"), "with its test");
  });

  test("a TESTS card names its test by its short name, as the pane does, not its id", () => {
    const [card] = cardsOf(report());

    assert.match(card, /<h3><small>test 1<\/small> order total example two lines<\/h3>/);
    assert.doesNotMatch(card, new RegExp(TEST_ID));
  });

  test("TESTS give each step's result from the code run, and its commit", () => {
    const [card] = cardsOf(report());

    assert.deepEqual(rowsOf(card).slice(0, 2), [
      ["RED", "1", "0:25", "0:20", "0:05", "failed, as it should (exit 1)", SHA_RED.slice(0, 7)],
      ["GREEN", "1", "0:35", "0:30", "0:05", "passed (exit 0)", SHA_GREEN.slice(0, 7)],
    ]);
  });

  // A cycle's REFACTOR is two agents, the quick review and then the tidy of the side it found something on: two rows, named apart.
  test("REFACTOR's review and its tidy are told apart, each with what it did", () => {
    const [card] = cardsOf(report());

    assert.deepEqual(rowsOf(card).slice(2), [
      ["REFACTOR: quick review", "1", "0:40", "0:40", "0:00", "1 finding", ""],
      ["REFACTOR: tidying the tests", "1", "0:35", "0:30", "0:05", "tidied, the tests still pass", SHA_TIDY.slice(0, 7)],
    ]);
  });

  test("the quick review's row counts a finding said twice, as a test issue and a code issue, once", () => {
    const twice = [finding("Test name says example", "test-quality"), finding("Test name says example", "code-smell")];
    const calls = [call(`code-tdd.lens.${TEST_ID}.r1.a1`, twice), ...CODE_CALLS.slice(1)];
    const [card] = cardsOf(report({ runs: [{ ...RUNS[0], calls }, RUNS[1]] }));

    assert.equal(rowsOf(card)[2][5], "1 finding");
  });

  test("REVIEW shows the safety-net review and the review of the pull request", () => {
    const section = sectionOf(report(), "REVIEW");

    assert.ok(section.includes("safety-net review"), `the safety-net round is named, got ${section}`);
    assert.ok(section.includes("Sum of an empty order is int"), "with its finding");
    assert.ok(section.includes("write the pull request"), "the pull request's round is named");
    assert.ok(section.includes("Passed at the head commit is transient"), "with its finding");
    assert.ok(section.indexOf("safety-net review") < section.indexOf("write the pull request"), "in the order they ran");
    assert.ok(!section.includes("Test name says example"), "a cycle's quick review is in TESTS, not here");
  });

  // The human answered the sign-off over the doubt, so it is settled: How it ran keeps it, NEEDS YOU does not ask again.
  test("NEEDS YOU leaves out the doubt the human approved the task past; How it ran lists it with its step", () => {
    const html = report();

    assert.ok(!sectionOf(html, "NEEDS YOU").includes(DOUBT.ambiguity), `the doubt is no open action, got ${sectionOf(html, "NEEDS YOU")}`);
    const section = sectionOf(html, "DOUBTS RAISED");
    assert.ok(section.includes(`${DOUBT.ambiguity} <small>(raised while listing scenarios; answered at your sign-off at the end)</small>`), `the doubt, its step and the answer that covered it, got ${section}`);
  });

  // A reviewer's doubt recorded before doubts named their stage: the review is the one that ends at the gate it was answered at.
  test("a reviewer's doubt reads by the review it was raised during, never 'while a reviewer'", () => {
    const reviewer = { step: "a reviewer", ambiguity: "Does the image add anything?" };
    const ledger = { ...CODE_RUN, gates: { ...CODE_RUN.gates, "G:scenarios": { source: "human", answer: "approve", doubts: [reviewer] } } };
    const section = sectionOf(report({ runs: [{ ...RUNS[0], ledger }, RUNS[1]] }), "DOUBTS RAISED");

    assert.ok(section.includes("Does the image add anything? <small>(raised during the review in write test scenarios; answered at your OK on the scenarios)</small>"), `got ${section}`);
    assert.doesNotMatch(section, /while a reviewer/);
  });

  test("the header names the pull request; NEEDS YOU does not ask to review it", () => {
    const html = report();

    assert.ok(headerOf(html).includes(`<a href="${PR_URL}">PR #7</a>`), "the header links the pull request");
    assert.ok(!sectionOf(html, "NEEDS YOU").includes("sign-off"), "the task was signed off already");
  });

  // Left only means something while the task runs: a finished one says what it spent and that it is done.
  test("AT A GLANCE of a finished task leaves out the rows that only mean something live", () => {
    const section = sectionOf(report(), "AT A GLANCE");

    assert.match(section, /<strong>Where it is<\/strong> finished/);
    assert.match(section, /<strong>Spent<\/strong> 43 agents · 13:30 · 16248 output tokens/, "both runs' tokens over the whole task's time");
    assert.doesNotMatch(section, /Left|Looping|Off track/);
    assert.doesNotMatch(section, /<\/strong> unknown<\/p>/, "no row is unknown as a whole");
  });

  // A reload empties the session's spawns; the runs pb kept still record how many agents each ran.
  test("Spent of a finished task counts the agents its runs recorded, not the session's spawns", () => {
    const section = sectionOf(report({ spawns: [] }), "AT A GLANCE");

    assert.match(section, /<strong>Spent<\/strong> 43 agents · /, "the code run's 30 and the publish run's 13");
  });
});

// The task-type review's "fix" is the classifier asked again: the report says what that changed, not "fixed".
describe("report-of-a-classification-review", () => {
  const intake = (role, item, round, input) => ({ input: { pb_key: `intake.${role}.${item}.r${round}.a1`, ...input } });
  const classified = (task_type, confidence) => ({ ambiguity: "", task_type, confidence, rationale: "Adds a function." });
  const INTAKE_CALLS = (again) => [
    intake("classify-task", "-", 1, classified("new_feature", "certain")),
    intake("lens", "classification", 1, { ambiguity: null, findings: [finding("Certain confidence rests on an unverified line_total", undefined)] }),
    intake("fix", "g1", 2, again),
    intake("course-checker", "g1", 2, { finding_id: "classification-1", verdict: "better", mistake: "none", what_went_wrong: "" }),
  ];
  const reviewOf = (again) => sectionOf(report({ runs: [{ ...RUNS[0], calls: [...INTAKE_CALLS(again), ...CODE_CALLS] }, RUNS[1]] }), "REVIEW");

  test("a re-classification that kept the type and lowered the confidence says so plainly", () => {
    const section = reviewOf(classified("new_feature", "likely"));

    assert.ok(section.includes("Certain confidence rests on an unverified line_total</strong> · task type kept: new feature; less sure than first thought"), `got ${section}`);
  });

  test("a re-classification that raised the confidence says it is surer", () => {
    const section = sectionOf(report({ runs: [{ ...RUNS[0], calls: [intake("classify-task", "-", 1, classified("new_feature", "likely")), ...INTAKE_CALLS(classified("new_feature", "certain")).slice(1), ...CODE_CALLS] }, RUNS[1]] }), "REVIEW");

    assert.ok(section.includes("· task type kept: new feature; surer than first thought"), `got ${section}`);
  });

  test("a re-classification that changed the type names the new type and the old", () => {
    const section = reviewOf(classified("bug_fix", "certain"));

    assert.ok(section.includes("· task type changed: bug fix (was new feature) · cart.py:3"), `got ${section}`);
  });

  test("a finding on the task's wording names no place: its subject and return key are not shown", () => {
    const onSubject = { ...finding("Certain confidence rests on an unverified line_total", undefined), where: "subject: task_type/confidence (intake.classify-task.-.r1.a1)" };
    const calls = [...INTAKE_CALLS(classified("new_feature", "likely")).map((call) => (call.input.pb_key === "intake.lens.classification.r1.a1" ? intake("lens", "classification", 1, { ambiguity: null, findings: [onSubject] }) : call)), ...CODE_CALLS];
    const section = sectionOf(report({ runs: [{ ...RUNS[0], calls }, RUNS[1]] }), "REVIEW");

    assert.ok(section.includes("· task type kept: new feature; less sure than first thought<br>"), `got ${section}`);
    assert.doesNotMatch(section, /subject:|intake\.classify-task/);
  });
});

// A doubt a reviewer raised on a finding, which a later fix in the same review settled before the human signed off: the
// report says how it was settled and does not ask the human to decide it again.
describe("report-of-a-doubt-a-later-fix-settled", () => {
  const AMBIGUITY = "Should order_total([]) return a float 0.0, or is the int 0 acceptable?";
  const SHA_FIX = "4".repeat(40);
  const net = (role, item, round, input) => ({ input: { pb_key: `code-safety-net.${role}.${item}.r${round}.a1`, ...input } });
  // The order the kept returns record: the lens finds it (r1), its refuter upholds it with the doubt (r1), then the fix
  // (g1, r2) changes the code and the check says it is better.
  const SETTLING_CALLS = [
    net("lens", "code", 1, { ambiguity: null, findings: [finding("order_total returns int 0 for an empty list", undefined)] }),
    net("refuter", "code-1", 1, { finding_id: "code-1", verdict: "survives", ambiguity: AMBIGUITY }),
    net("fix", "g1", 2, { ambiguity: "", commit_subject: "fix: order_total returns float for empty list", no_change_reason: "", files_changed: ["cart.py"] }),
    net("course-checker", "g1", 2, { finding_id: "code-1", verdict: "better", mistake: "none", what_went_wrong: "" }),
  ];
  const settledRun = {
    ...CODE_RUN,
    gates: { ...CODE_RUN.gates, "G:task-end": { source: "human", answer: "approve", doubts: [{ step: "a reviewer", stage: "code-safety-net", ambiguity: AMBIGUITY }] } },
    checkpoints: [...CODE_RUN.checkpoints, { step: "fix", key: "code-safety-net.fix.g1.r2.a1", committed: true, sha: SHA_FIX, stage: "code-safety-net", attempt: 1 }],
  };
  const settledReport = (calls = SETTLING_CALLS) => report({ runs: [{ ...RUNS[0], ledger: settledRun, calls }, RUNS[1]] });

  test("the doubt is no longer open, and the report says the later fix settled it", () => {
    const html = settledReport();

    assert.ok(!sectionOf(html, "NEEDS YOU").includes(AMBIGUITY), "no doubt is open");
    const section = sectionOf(html, "DOUBTS RAISED");
    assert.ok(section.includes(`${AMBIGUITY} <small>(raised during the safety-net review; settled by a later fix in the safety-net review: order_total returns int 0 for an empty list · ${SHA_FIX.slice(0, 7)})</small>`), `the doubt in full, where it was raised and how it was settled, got ${section}`);
  });

  test("a doubt on a finding another lens said first for the same lines is settled by its own lens's later fix", () => {
    const same = { ...finding("order_total returns int 0 for an empty list", undefined), where: "cart.py:11" };
    const calls = [
      net("lens", "code", 1, { ambiguity: null, findings: [{ ...same, title: "Empty order gives an int" }] }),
      net("lens", "tests", 1, { ambiguity: null, findings: [same] }),
      net("refuter", "code-1", 1, { finding_id: "code-1", verdict: "survives" }),
      net("refuter", "tests-1", 1, { finding_id: "tests-1", verdict: "survives", ambiguity: AMBIGUITY }),
      net("fix", "g1", 2, { ambiguity: "", commit_subject: "fix: the code", no_change_reason: "", files_changed: ["cart.py"] }),
      net("course-checker", "g1", 2, { finding_id: "code-1", verdict: "better", mistake: "none", what_went_wrong: "" }),
      net("fix", "g2", 3, { ambiguity: "", commit_subject: "fix: the tests", no_change_reason: "", files_changed: ["tests/test_cart.py"] }),
      net("course-checker", "g2", 3, { finding_id: "tests-1", verdict: "better", mistake: "none", what_went_wrong: "" }),
    ];
    const ledger = { ...settledRun, checkpoints: [...CODE_RUN.checkpoints, { step: "fix", key: "code-safety-net.fix.g2.r3.a1", committed: true, sha: SHA_FIX, stage: "code-safety-net", attempt: 1 }] };
    const html = report({ runs: [{ ...RUNS[0], ledger, calls }, RUNS[1]] });

    assert.ok(!sectionOf(html, "NEEDS YOU").includes(AMBIGUITY), "no doubt is open");
    const section = sectionOf(html, "DOUBTS RAISED");
    assert.ok(section.includes(`settled by a later fix in the safety-net review: Empty order gives an int · ${SHA_FIX.slice(0, 7)}`), `under the gist shown, got ${section}`);
  });

  test("a doubt still asked on a finding another lens said first for the same lines is asked under the finding shown", () => {
    const same = { ...finding("order_total returns int 0 for an empty list", undefined), where: "cart.py:11" };
    const calls = [
      net("lens", "code", 1, { ambiguity: null, findings: [{ ...same, title: "Empty order gives an int" }] }),
      net("lens", "tests", 1, { ambiguity: null, findings: [same] }),
      net("refuter", "tests-1", 1, { finding_id: "tests-1", verdict: "survives", ambiguity: AMBIGUITY }),
    ];
    const asking = { ...CODE_RUN, needsHuman: { gate: "G:task-end", reason: "open doubts", seq: 9, doubts: [{ step: "a reviewer", stage: "code-safety-net", ambiguity: AMBIGUITY }] } };
    const section = sectionOf(report({ runs: [{ ...RUNS[0], ledger: asking, calls }] }), "NEEDS YOU");

    assert.ok(section.includes(`<strong>Empty order gives an int</strong> · cart.py:11<br>Decide: ${AMBIGUITY}`), `the doubt is asked under the one finding, got ${section}`);
  });

  test("a doubt whose finding no fix settled is settled by the sign-off the human answered over it", () => {
    const html = settledReport(SETTLING_CALLS.slice(0, 2));

    assert.ok(!sectionOf(html, "NEEDS YOU").includes(`Decide: ${AMBIGUITY}`), "the doubt is no open action");
    assert.ok(sectionOf(html, "DOUBTS RAISED").includes(`${AMBIGUITY} <small>(raised during the safety-net review; answered at your sign-off at the end)</small>`), "How it ran says the sign-off answered it");
  });
});
