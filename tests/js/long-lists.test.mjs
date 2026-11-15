// Scenario long-lists: a big task keeps the gate questions short, and every "+ n more" a question folds into names the
// full question file, which holds the whole list (docs/design/progress-mod/DIRECTION.md, "Long lists").
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { fullQuestion, gateQuestion } from "../../shared-node/gates.mjs";

const POLICY = "the gate policy is default, not auto";
const AMBIGUITY = "these returns carry an open ambiguity: a.json, b.json";
const LONG = "and keeps the order's currency, rounding and tax lines exactly as the cart recorded them at checkout time";

// 15 scenarios holding 40 tests between them, every description over 100 characters.
const TEST_COUNTS = [4, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 1, 1, 1, 1];
const BIG_SCENARIOS = TEST_COUNTS.map((count, s) => ({
  description: `order_total scenario ${s + 1} sums price times quantity ${LONG}`,
  tests: Array.from({ length: count }, (_, t) => `scenario ${s + 1} test ${t + 1} checks one line total ${LONG}`),
}));
const BIG_FILES = Array.from({ length: 20 }, (_, i) => `src/shop/checkout/order_total_part_${i + 1}_with_a_long_module_name.py`);

const GOAL_FINDINGS = ["README does not name order_total", "The plan says tax is included", "CHANGELOG has no entry"].map((title, i) => ({ title, claim: `${title}.`, where: `doc${i}.md` }));

const FULL_AT = "/repo/.pairingbuddy/run/question.md";
const linesOf = (gate, facts) => gateQuestion(gate, { reason: POLICY, facts, fullAt: FULL_AT }).question.split("\n");

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
    assert.equal(built[0], `Built: ${BIG_FILES.slice(0, 5).join(", ")}; 40 tests, all passing; + 15 more files: ${FULL_AT}`);
    assert.ok(!lines.some((line) => BIG_FILES.slice(5).some((file) => line.includes(file))), "the other 15 files are only in the report");
  });
});

describe("every '+ n more' names the full question file, and that file holds the whole list", () => {
  const scenarios = [...BIG_SCENARIOS, ...BIG_SCENARIOS.slice(0, 3).map((s, i) => ({ ...s, description: `extra scenario ${i + 1} ${LONG}` }))];
  const goalCheck = GOAL_FINDINGS.map(({ title }) => ({ gist: title, outcome: "left as is" }));
  const body = Array.from({ length: 11 }, (_, i) => `body line ${i + 1} ${LONG}`).join("\n");
  const doubts = Array.from({ length: 5 }, (_, i) => ({ step: "making the test pass", ambiguity: `doubt ${i + 1} ${LONG}?` }));
  // Each fold, the question it shows in, and every item of the list the full question file must hold.
  const FOLDS = [
    { gate: "G:scenarios", facts: { scenarios }, items: scenarios.flatMap(({ description, tests }) => [description, ...tests]) },
    { gate: "G:task-end", facts: { files: BIG_FILES }, items: BIG_FILES },
    { gate: "G:task-end", facts: { goalCheck }, items: GOAL_FINDINGS.map(({ title }) => title) },
    { gate: "G:publish", facts: { title: "T", body }, items: body.split("\n") },
    { gate: "G:task-end", facts: { doubts }, reason: AMBIGUITY, items: doubts.map(({ ambiguity }) => ambiguity) },
  ];

  for (const { gate, facts, items, reason = POLICY } of FOLDS) {
    test(`${gate} ${Object.keys(facts).at(-1)} folds once into the full question file`, () => {
      const folds = gateQuestion(gate, { reason, facts, fullAt: FULL_AT }).question.split("\n").filter((line) => /^\+ \d+ more|; \+ \d+ more/.test(line));
      const full = fullQuestion(gate, { reason, facts });

      assert.equal(folds.length, 1, `the long list folds once: ${JSON.stringify(folds)}`);
      assert.ok(folds[0].endsWith(`: ${FULL_AT}`), `the fold names the file: ${folds[0]}`);
      for (const item of items) assert.ok(full.includes(item), `the full question holds ${item}`);
    });
  }
});
