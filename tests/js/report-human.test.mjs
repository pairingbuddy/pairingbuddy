// Scenario report-leads-with-what-you-need: the report opens with where the task is, what needs the human, what was done and
// what changed in plan or scope; how it ran is kept whole, closed, at the bottom. Read on a real task pb kept (the
// ended-task fixture, trimmed from a watched run).
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../../shared-node/report.mjs";
import { taskRuns } from "../../shared-node/task-runs.mjs";
import { CHANGED, CODE_RUN, KEPT_FILES } from "../../mod/fixtures/ended-task/index.ts";
import { headerOf, sectionOf, spentOf } from "./report-fixture.mjs";

// The kept runs as the mod reads them (readKeptRun in mod/inputs.ts): one per folder, its returns as calls.
function keptRuns(files) {
  const byRun = new Map();
  for (const [path, value] of Object.entries(files)) {
    const [, runId, rest] = /reports\/runs\/([^/]+)\/(.+)$/.exec(path);
    const run = byRun.get(runId) ?? { calls: [] };
    if (rest === "ledger.json") run.ledger = value;
    else if (rest === "kept.json") Object.assign(run, { unit: value.unit ?? null, endedAt: value.endedAt, prUrl: value.prUrl });
    else run.calls.push({ input: value });
    byRun.set(runId, run);
  }
  return [...byRun.values()];
}

const RUNS = taskRuns({ ledger: null, kept: keptRuns(KEPT_FILES) });
const report = (overrides = {}) => renderReport({ runs: RUNS, spawns: [], changed: CHANGED.map(({ path }) => path), commits: [], ...overrides });

describe("report-leads-with-what-you-need", () => {
  test("NEEDS YOU holds the one review finding left open, with its gist, its file and the question it left", () => {
    const section = sectionOf(report(), "NEEDS YOU");
    const items = section.match(/<li>/g) ?? [];

    assert.equal(items.length, 1, `one thing needs the human, got ${section}`);
    assert.ok(section.includes("Float sum of cent-rounded totals may drift"), "the finding's gist");
    assert.ok(section.includes("cart.py:9-10"), "where it is");
    assert.ok(section.includes("Should order_total round its sum to cents?"), "the question it left for the human");
  });

  test("NEEDS YOU of a stopped run says where it stopped, why, and how to go on", () => {
    const stopped = { ...CODE_RUN, stage: { ...CODE_RUN.stage, name: "code-tdd", status: "active" }, stages: CODE_RUN.stages.slice(0, 2), stop: { code: "step-failed", reason: "step-failed: past its retries", seq: 9 } };
    const section = sectionOf(renderReport({ ledger: stopped, spawns: [] }), "NEEDS YOU");

    assert.ok(section.includes("It stopped at build test by test: a step kept failing."), `the stop in plain words, got ${section}`);
    assert.ok(section.includes("Re-run /pairingbuddy:code."), "how to go on");
  });

  test("NEEDS YOU of a run waiting on a question names the question, and the doubts it asks over", () => {
    const doubt = { step: "write test scenarios", ambiguity: "Does an empty order total 0.0?" };
    const waiting = { ...CODE_RUN, stage: { ...CODE_RUN.stage, name: "code-scenarios", status: "done" }, stages: CODE_RUN.stages.slice(0, 2), gates: { "G:type": CODE_RUN.gates["G:type"] }, needsHuman: { gate: "G:scenarios", reason: "open doubts", seq: 9, doubts: [doubt] } };
    const section = sectionOf(renderReport({ ledger: waiting, spawns: [] }), "NEEDS YOU");

    assert.ok(section.includes("Answer the question waiting for you: your OK on the scenarios."), `the question, got ${section}`);
    assert.ok(section.includes("Decide: Does an empty order total 0.0?"), "the doubt it asks over");
  });

  test("NEEDS YOU asks for a check by hand of a test that never failed first", () => {
    const perTest = { ...CODE_RUN.tests.perTest, "empty-order-totals-zero": { red: { done: true, passed: true, exitCodes: [0] }, covered: { done: true, stage: "code-tdd", after: "order-total-sums-two-lines" } } };
    const covered = { ...CODE_RUN, tests: { perTest } };
    const section = sectionOf(renderReport({ ledger: covered, spawns: [] }), "NEEDS YOU");

    assert.ok(section.includes("Check by hand: the test empty order totals zero passed before any new code was written, so it never failed first."), `got ${section}`);
  });

  test("NEEDS YOU asks for a check by hand of a scenario the last coverage check still found untested", () => {
    const coverage = (round, gaps) => ({ input: { pb_key: `code-tdd.verify-test-coverage.-.r${round}.a1`, ambiguity: "", status: gaps.length ? "incomplete" : "complete", gaps } });
    const gap = { scenario_id: "s2", description: "an empty order has no test" };
    const section = (calls) => sectionOf(renderReport({ ledger: CODE_RUN, spawns: [], calls }), "NEEDS YOU");

    assert.ok(section([coverage(1, [gap])]).includes("Check by hand: a scenario has no test: an empty order has no test."), `got ${section([coverage(1, [gap])])}`);
    assert.ok(!section([coverage(1, [gap]), coverage(2, [])]).includes("has no test"), "a gap a later check found covered is not asked about");
  });

  const EARLY_GATES = { "G:type": CODE_RUN.gates["G:type"], "G:scenarios": CODE_RUN.gates["G:scenarios"] };

  test("NEEDS YOU of a run still going says nothing needs the human yet", () => {
    const running = { ...CODE_RUN, stage: { ...CODE_RUN.stage, status: "active" }, gates: EARLY_GATES };
    const section = sectionOf(renderReport({ ledger: running, spawns: [] }), "NEEDS YOU");

    assert.ok(section.includes("<p>Nothing needs you right now: the run is still going.</p>"), `got ${section}`);
  });

  test("NEEDS YOU of a finished run not signed off yet asks for the sign-off", () => {
    const unsigned = { ...CODE_RUN, gates: EARLY_GATES };
    const section = sectionOf(renderReport({ ledger: unsigned, spawns: [] }), "NEEDS YOU");

    assert.ok(section.includes("Review the result and give your sign-off."), `got ${section}`);
  });

  test("WHAT WAS DONE says in plain words which files changed, which tests were added and pass, and the pull request", () => {
    const section = sectionOf(report(), "WHAT WAS DONE");

    assert.ok(section.includes("Changed 2 files: cart.py, tests/test_cart.py"), `got ${section}`);
    assert.ok(section.includes("Added 1 test, passing: order total sums two lines"), "the test added");
    assert.ok(section.includes('Opened pull request #7: <a href="https://github.com/example/repo/pull/7">https://github.com/example/repo/pull/7</a>'), "the pull request");
  });

  test("CHANGES OF PLAN OR SCOPE is left out when nothing material changed", () => {
    assert.throws(() => sectionOf(report(), "CHANGES OF PLAN OR SCOPE"), /no CHANGES OF PLAN OR SCOPE section/);
  });

  // The task-type review's fix is the classifier asked again; only a new type changes the plan, a new confidence does not.
  const classified = (task_type, confidence) => ({ ambiguity: "", task_type, confidence, rationale: "Adds a function." });
  const intake = (role, item, round, input) => ({ input: { pb_key: `intake.${role}.${item}.r${round}.a1`, ...input } });
  const reclassified = (again) => [
    intake("classify-task", "-", 1, classified("new_feature", "certain")),
    intake("lens", "classification", 1, { ambiguity: null, findings: [{ rule: "", severity: "low", kind: "drift", title: "Certain rests on an unread line_total", claim: "x.", where: "", focus: undefined }] }),
    intake("fix", "g1", 2, again),
    intake("course-checker", "g1", 2, { finding_id: "classification-1", verdict: "better", mistake: "none", what_went_wrong: "" }),
  ];
  const withCodeCalls = (calls, taskType = "new_feature") => report({ runs: [{ ...RUNS[0], ledger: { ...RUNS[0].ledger, taskType }, calls: [...calls, ...RUNS[0].calls] }, RUNS[1]] });

  test("CHANGES OF PLAN OR SCOPE names a new task type the review led to", () => {
    const section = sectionOf(withCodeCalls(reclassified(classified("bug_fix", "certain")), "bug_fix"), "CHANGES OF PLAN OR SCOPE");

    assert.ok(section.includes("The task type changed after a review: now bug fix, was new feature."), `got ${section}`);
  });

  test("CHANGES OF PLAN OR SCOPE leaves out a new confidence in the same task type", () => {
    assert.throws(() => sectionOf(withCodeCalls(reclassified(classified("new_feature", "likely"))), "CHANGES OF PLAN OR SCOPE"), /no CHANGES/);
  });

  test("CHANGES OF PLAN OR SCOPE names the tests added for a scenario the coverage check found untested", () => {
    const coverage = (round, gaps) => ({ input: { pb_key: `code-tdd.verify-test-coverage.-.r${round}.a1`, ambiguity: "", status: gaps.length ? "incomplete" : "complete", gaps } });
    const section = sectionOf(withCodeCalls([coverage(1, [{ scenario_id: "s2", description: "an empty order has no test" }]), coverage(2, [])]), "CHANGES OF PLAN OR SCOPE");

    assert.ok(section.includes("Tests were added because a scenario had none: an empty order has no test."), `got ${section}`);
  });

  // A review that found a real problem and had it fixed changed the work; the pull request's wording fixed is no change of plan.
  test("CHANGES OF PLAN OR SCOPE names each fix a review forced on the work, and not the pull request's wording", () => {
    const net = (role, item, round, input) => ({ input: { pb_key: `code-safety-net.${role}.${item}.r${round}.a1`, ...input } });
    const fixing = [
      net("lens", "code", 1, { ambiguity: null, findings: [{ rule: "", severity: "low", kind: "drift", title: "Empty order returns int 0", claim: "x.", where: "cart.py:3" }] }),
      net("fix", "g1", 2, { ambiguity: "", commit_subject: "fix: float for empty", no_change_reason: "", files_changed: ["cart.py"] }),
      net("course-checker", "g1", 2, { finding_id: "code-1", verdict: "better", mistake: "none", what_went_wrong: "" }),
    ];
    const pr = (role, item, round, input) => ({ input: { pb_key: `pr-draft.${role}.${item}.r${round}.a1`, ...input } });
    const wording = [
      pr("lens", "claims", 1, { ambiguity: null, findings: [{ rule: "", severity: "low", kind: "drift", title: "Changes section restates the diff", claim: "x.", where: "pr-body.md:9" }] }),
      pr("fix", "g1", 2, { ambiguity: "" }),
      pr("course-checker", "g1", 2, { finding_id: "claims-1", verdict: "better", mistake: "none", what_went_wrong: "" }),
    ];
    const html = report({ runs: [{ ...RUNS[0], calls: fixing }, { ...RUNS[1], calls: wording }] });
    const section = sectionOf(html, "CHANGES OF PLAN OR SCOPE");

    assert.ok(section.includes("The safety-net review had this fixed: Empty order returns int 0 · cart.py:3"), `got ${section}`);
    assert.ok(!section.includes("restates the diff"), "the pull request's wording is not a change of plan");
  });

  test("the header holds the goal, where the task is and its pull request, and nothing of how it ran", () => {
    const header = headerOf(report());

    assert.ok(header.includes("Add order_total(lines) to cart.py"), "the goal");
    assert.ok(header.includes(">DONE<"), "where it is");
    assert.ok(header.includes('pull request #7: <a href="https://github.com/example/repo/pull/7">'), `the pull request, got ${header}`);
    assert.ok(!header.includes("new feature"), "the task type is for how it ran");
  });

  test("the header of a run waiting on a question says it is waiting on you", () => {
    const waiting = { ...CODE_RUN, stage: { ...CODE_RUN.stage, status: "active" }, needsHuman: { gate: "G:task-end", reason: "auto mode is off", seq: 9 } };

    assert.ok(headerOf(renderReport({ ledger: waiting, spawns: [] })).includes(">WAITING ON YOU<"));
  });

  test("How it ran holds the rest, closed, at the bottom", () => {
    const html = report();
    const details = /<details>\s*<summary>How it ran<\/summary>([\s\S]*)<\/details>/.exec(html)?.[1];

    assert.ok(details, "a closed How it ran section");
    for (const title of ["AT A GLANCE", "STEPS", "SCENARIOS", "TESTS", "BUILT", "REVIEW", "COMMITS"]) assert.doesNotThrow(() => sectionOf(details, title), `How it ran holds ${title}`);
    assert.ok(details.includes("new feature"), "the task type is told there");
    assert.ok(html.indexOf("WHAT WAS DONE") < html.indexOf("<details>"), "after the sections for the human");
    assert.ok(!html.includes("WHAT YOU CAN DO") && !html.includes("OPEN DOUBTS"), "what the human must do is NEEDS YOU's alone");
  });

  // The publish question waited four hours on the human: that is no working time, and How it ran says it apart.
  test("How it ran leaves the time spent waiting on you out of Spent and tells it apart", () => {
    const publish = RUNS[1];
    const waited = { ...publish, ledger: { ...publish.ledger, gates: { "G:publish": { ...publish.ledger.gates["G:publish"], askedAt: "2026-11-16T15:42:30.000Z", answeredAt: "2026-11-16T19:43:50.000Z" } } } };
    const html = report({ runs: [RUNS[0], waited] });

    assert.ok(spentOf(html).includes(" · 24:47 · "), `the task's 4:26:07 less the 4:01:20 wait, got ${spentOf(html)}`);
    assert.match(sectionOf(html, "AT A GLANCE"), /<strong>Waited<\/strong> 4h 1m waiting for you/);
  });

  test("How it ran says nothing of waiting when no wait was recorded", () => {
    assert.doesNotMatch(sectionOf(report(), "AT A GLANCE"), /Waited/);
  });
});

