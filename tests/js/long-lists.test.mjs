// Scenario long-lists: a big task keeps the gate questions short, and every "+ n more in the report" a question folds into
// names a list the report really holds (docs/design/progress-mod/DIRECTION.md, "Long lists").
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { gateQuestion } from "../../shared-node/gates.mjs";
import { renderReport } from "../../shared-node/report.mjs";
import { sectionOf } from "./report-fixture.mjs";

const POLICY = "the gate policy is default, not auto";
const LONG = "and keeps the order's currency, rounding and tax lines exactly as the cart recorded them at checkout time";

// 15 scenarios holding 40 tests between them, every description over 100 characters.
const TEST_COUNTS = [4, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 1, 1, 1, 1];
const BIG_SCENARIOS = TEST_COUNTS.map((count, s) => ({
  description: `order_total scenario ${s + 1} sums price times quantity ${LONG}`,
  tests: Array.from({ length: count }, (_, t) => `scenario ${s + 1} test ${t + 1} checks one line total ${LONG}`),
}));
const BIG_FILES = Array.from({ length: 20 }, (_, i) => `src/shop/checkout/order_total_part_${i + 1}_with_a_long_module_name.py`);

const SAFETY_NET = { name: "code-safety-net", status: "done", attempt: 1, startedAt: "2026-11-14T10:00:00.000Z" };
const LEDGER = { task: "Add order_total to cart.py.", taskType: "new_feature", stage: SAFETY_NET, stages: [SAFETY_NET], tests: { perTest: {} } };
const GOAL_FINDINGS = ["README does not name order_total", "The plan says tax is included", "CHANGELOG has no entry"].map((title, i) => ({ title, claim: `${title}.`, where: `doc${i}.md` }));
const GOAL_CALLS = [{ at: "2026-11-14T10:00:01.000Z", input: { pb_key: "code-safety-net.lens.corpus-misalignment.r1.a1", findings: GOAL_FINDINGS } }];

const linesOf = (gate, facts) => gateQuestion(gate, { reason: POLICY, facts }).question.split("\n");

describe("long lists in the gate questions", () => {
  test("15 scenarios with 40 tests show one line per scenario with its count and no test lines", () => {
    const lines = linesOf("G:scenarios", { scenarios: BIG_SCENARIOS });

    assert.equal(lines[0], "Scenarios (15 scenarios, 40 tests):");
    assert.deepEqual(lines.slice(1, 16), BIG_SCENARIOS.map(({ description, tests }) => `- ${description} (${tests.length} ${tests.length === 1 ? "test" : "tests"})`));
    assert.equal(lines[16], "Auto mode is off, so this asks you.", "all 15 fit, so nothing folds");
    assert.ok(!lines.some((line) => line.startsWith("    - ")), "no test line is shown");
  });

  test("the task-done Built line stays one line with 20 changed files", () => {
    const lines = linesOf("G:task-end", { files: BIG_FILES, tests: 40, passing: true });
    const built = lines.filter((line) => line.startsWith("Built: "));

    assert.equal(built.length, 1);
    assert.equal(built[0], `Built: ${BIG_FILES.slice(0, 5).join(", ")}, + 15 more in the report; 40 tests, all passing.`);
    assert.ok(!lines.some((line) => BIG_FILES.slice(5).some((file) => line.includes(file))), "the other 15 files are only in the report");
  });
});

describe("every '+ n more in the report' names a list the report holds", () => {
  const scenarios = [...BIG_SCENARIOS, ...BIG_SCENARIOS.slice(0, 3).map((s, i) => ({ ...s, description: `extra scenario ${i + 1} ${LONG}` }))];
  const html = renderReport({ ledger: LEDGER, spawns: [], calls: GOAL_CALLS, scenarios, changed: BIG_FILES });
  const goalCheck = GOAL_FINDINGS.map(({ title }) => ({ gist: title, outcome: "left as is" }));
  // Each fold, the question it shows in, and what the report must hold for it: the report section and every item of the list.
  const FOLDS = [
    { gate: "G:scenarios", facts: { scenarios }, section: "SCENARIOS", items: scenarios.flatMap(({ description, tests }) => [description, ...tests]) },
    { gate: "G:task-end", facts: { files: BIG_FILES }, section: "BUILT", items: BIG_FILES },
    { gate: "G:task-end", facts: { goalCheck }, section: "REVIEW", items: GOAL_FINDINGS.map(({ title }) => title) },
  ];

  for (const { gate, facts, section, items } of FOLDS) {
    test(`${gate} ${Object.keys(facts)[0]} folds into the report's ${section}`, () => {
      const folds = linesOf(gate, facts).filter((line) => line.includes("in the report"));
      const held = sectionOf(html, section);

      assert.equal(folds.length, 1, `the long list folds once: ${JSON.stringify(folds)}`);
      for (const item of items) assert.ok(held.includes(item.replaceAll("'", "&#39;")), `the report's ${section} holds ${item}`);
    });
  }
});
