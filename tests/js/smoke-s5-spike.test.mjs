import { test } from "node:test";
import assert from "node:assert/strict";
import * as s5 from "../smoke/s5.mjs";
import { SmokeError } from "../smoke/claude-run.mjs";

// Smoke S5's spike half: assertSpikeRun over synthetic ledgers, no live run.
// Scenario smoke-s5-spike-half, modelled on smoke-s5.test.mjs. The ledger is the source of truth for the units: SPIKE_UNITS (an export of tests/smoke/s5.mjs) is the floor.

function goodLedger() {
  return {
    taskType: "spike",
    stages: [
      { name: "intake", status: "done" },
      { name: "code-spike-unit", status: "done", explored: ["u1", "u2"] },
      { name: "code-spike-document", status: "done" },
    ],
    checkpoints: [
      { key: "code-spike-unit.explore-spike-unit.u1.r1.a1", step: "spike-unit", committed: true, sha: "s1" },
      { key: "code-spike-unit.explore-spike-unit.u2.r1.a1", step: "spike-unit", committed: true, sha: "s2" },
      { step: "spike-doc", committed: true, sha: "d1" },
    ],
  };
}

const withStage = (ledger, name, over) => ({ ...ledger, stages: ledger.stages.map((s) => (s.name === name ? { ...s, ...over } : s)) });
const commit = (sha, subject) => ({ sha, subject });
const GOOD_LOG = [commit("s1", "chore: explore rounding"), commit("s2", "chore: explore decimal"), commit("d1", "docs: record the spike findings in docs/spikes/rounding.md")];
const GOOD_FACTS = { publishSeen: false, ghCalls: [["issue", "list"]], unitOpen: false, docInHead: true };

test("s5-spike-accepts-a-conforming-spike-run", () => {
  const summary = s5.assertSpikeRun(goodLedger(), GOOD_LOG, GOOD_FACTS);

  assert.deepEqual(summary, { units: 2, docCommits: 1 }, "the summary counts explored units and committed spike-doc checkpoints");
});

const VIOLATIONS = [
  ["wrong task type", () => [{ ...goodLedger(), taskType: "new_feature" }, GOOD_LOG, GOOD_FACTS], /taskType.*new_feature/],
  ["wrong stage list", () => [{ ...goodLedger(), stages: goodLedger().stages.slice(0, 2) }, GOOD_LOG, GOOD_FACTS], /stages are \[intake,code-spike-unit\]/],
  ["a stage not done", () => [withStage(goodLedger(), "code-spike-document", { status: "running" }), GOOD_LOG, GOOD_FACTS], /not done/],
  ["only one unit explored", () => [withStage(goodLedger(), "code-spike-unit", { explored: ["u1"] }), GOOD_LOG, GOOD_FACTS], /at least \d+ units/],
  ["an explored unit with no committed spike-unit checkpoint", () => [{ ...goodLedger(), checkpoints: goodLedger().checkpoints.map((c) => (c.sha === "s2" ? { ...c, committed: false } : c)) }, GOOD_LOG, GOOD_FACTS], /u2.*spike-unit checkpoint|spike-unit checkpoint.*u2/],
  ["no committed spike-doc", () => [{ ...goodLedger(), checkpoints: goodLedger().checkpoints.map((c) => (c.step === "spike-doc" ? { ...c, committed: false } : c)) }, GOOD_LOG, GOOD_FACTS], /spike-doc/],
  ["a feat commit", () => [goodLedger(), [...GOOD_LOG, commit("f1", "feat: add rounding")], GOOD_FACTS], /feat:/],
  ["a fix commit", () => [goodLedger(), [...GOOD_LOG, commit("f2", "fix: rounding")], GOOD_FACTS], /fix:/],
  ["a commit that is neither chore nor docs", () => [goodLedger(), [...GOOD_LOG, commit("r1", "refactor: tidy")], GOOD_FACTS], /neither chore: nor docs:.*refactor: tidy/],
  ["a publish run seen", () => [goodLedger(), GOOD_LOG, { ...GOOD_FACTS, publishSeen: true }], /a publish run was seen/],
  ["a gh pr create call", () => [goodLedger(), GOOD_LOG, { ...GOOD_FACTS, ghCalls: [["pr", "create", "--draft"]] }], /pr create/],
  ["a unit still open", () => [goodLedger(), GOOD_LOG, { ...GOOD_FACTS, unitOpen: true }], /a unit is still open/],
  ["the doc missing from HEAD", () => [goodLedger(), GOOD_LOG, { ...GOOD_FACTS, docInHead: false }], /HEAD/],
];

for (const [label, build, cause] of VIOLATIONS) {
  test(`s5-spike-rejects: ${label}`, () => {
    const args = build();

    assert.throws(() => s5.assertSpikeRun(...args), (err) => err instanceof SmokeError && cause.test(err.message), `${label} throws a SmokeError naming the cause`);
  });
}
