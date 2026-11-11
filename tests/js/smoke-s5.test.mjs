import { test } from "node:test";
import assert from "node:assert/strict";
import { assertRefactoringRun } from "../smoke/s5.mjs";
import { SmokeError } from "../smoke/claude-run.mjs";

// These tests run the pure assertRefactoringRun helper of tests/smoke/s5.mjs on synthetic ledgers.
// The live S5 run is by hand (`node tests/smoke/s5.mjs`) and is not a test case here.

const POLICY = { mode: "auto", source: "permission_mode" };

function goodLedger(over = {}) {
  return {
    taskType: "refactoring",
    policy: POLICY,
    stages: ["code-refactor-scope", "code-refactor-apply", "code-safety-net"].map((name) => ({ name, status: "done" })),
    checkpoints: [
      { step: "refactor-step", committed: true, sha: "r1" },
      { step: "refactor-step", committed: true, sha: "r2" },
      { step: "docs", committed: true, sha: "d1" },
    ],
    lenses: {
      "safety-net": {
        stage: "code-safety-net",
        attempt: 1,
        lenses: [
          { name: "behaviour-preservation", model: "opus" },
          { name: "tests", model: "sonnet" },
          { name: "corpus-misalignment", model: "sonnet" },
        ],
        survivors: 0,
        refuted: 0,
        unrefuted: 0,
        uncovered: 0,
      },
    },
    ...over,
  };
}

const commit = (sha, subject) => ({ sha, subject });
const GOOD_LOG = [commit("r1", "refactor: extract the parser"), commit("r2", "refactor: rename the helper"), commit("d1", "docs: note the move")];

test("s5-accepts-a-conforming-refactoring-ledger", () => {
  const summary = assertRefactoringRun(goodLedger(), GOOD_LOG);

  assert.equal(summary.refactorSteps, 2, "the summary counts the refactor-step commits");
});

const PREFIX = "s5-rejects";

const lensesWith = (lenses) => ({ "safety-net": { ...goodLedger().lenses["safety-net"], lenses } });
const lensList = goodLedger().lenses["safety-net"].lenses;
const stagesDone = goodLedger().stages;

const BROKEN = [
  ["feat-commit", goodLedger(), [...GOOD_LOG, commit("f1", "feat: add a new option")], /feat: commit/],
  ["fix-commit", goodLedger(), [...GOOD_LOG, commit("x1", "fix: correct the parser")], /fix: commit/],
  ["task-type-bug-fix", goodLedger({ taskType: "bug_fix" }), GOOD_LOG, /taskType/],
  [
    "apply-before-scope",
    goodLedger({ stages: [stagesDone[1], stagesDone[0], stagesDone[2]] }),
    GOOD_LOG,
    /order/,
  ],
  [
    "stage-not-done",
    goodLedger({ stages: [stagesDone[0], { ...stagesDone[1], status: "running" }, stagesDone[2]] }),
    GOOD_LOG,
    /not done/,
  ],
  [
    "no-refactor-step-checkpoint",
    goodLedger({ checkpoints: [{ step: "docs", committed: true, sha: "d1" }] }),
    GOOD_LOG,
    /refactor-step checkpoint/,
  ],
  [
    "behaviour-preservation-missing",
    goodLedger({ lenses: lensesWith(lensList.filter((l) => l.name !== "behaviour-preservation")) }),
    GOOD_LOG,
    /behaviour-preservation.*missing/,
  ],
  [
    "behaviour-preservation-on-sonnet",
    goodLedger({
      lenses: lensesWith(lensList.map((l) => (l.name === "behaviour-preservation" ? { ...l, model: "sonnet" } : l))),
    }),
    GOOD_LOG,
    /behaviour-preservation.*opus/,
  ],
];

for (const [name, ledger, log, message] of BROKEN) {
  test(`${PREFIX}-${name}`, () => {
    assert.throws(
      () => assertRefactoringRun(ledger, log),
      (e) => e instanceof SmokeError && message.test(e.message),
      `${name} is reported as a SmokeError matching ${message}`,
    );
  });
}
