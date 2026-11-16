// Scenario report-leads-with-what-you-need: the report opens with where the task is, what needs the human, what was done and
// what changed in plan or scope; how it ran is kept whole, closed, at the bottom. Read on a real task pb kept (the
// ended-task fixture, trimmed from a watched run).
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../../shared-node/report.mjs";
import { taskRuns } from "../../shared-node/task-runs.mjs";
import { CHANGED, CODE_RUN, KEPT_FILES } from "../../mod/fixtures/ended-task/index.ts";
import { sectionOf } from "./report-fixture.mjs";

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
    const waiting = { ...CODE_RUN, gates: { "G:type": CODE_RUN.gates["G:type"], "G:scenarios": CODE_RUN.gates["G:scenarios"] }, needsHuman: { gate: "G:task-end", reason: "open doubts", seq: 9, doubts: [doubt] } };
    const section = sectionOf(renderReport({ ledger: waiting, spawns: [] }), "NEEDS YOU");

    assert.ok(section.includes("Answer the question waiting for you: your sign-off at the end."), `the question, got ${section}`);
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

    assert.ok(section.includes("Look over the result and give your sign-off."), `got ${section}`);
  });
});

