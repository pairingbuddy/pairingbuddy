// Safeguards for shared-node/stage-run.mjs: tests:cycle reports tests it cannot read as a problem (other errors still throw),
// and a return that cannot be read counts in the report as an empty return.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStages } from "../../shared-node/stages.mjs";
import { buildReport, finishProblems } from "../../shared-node/stage-run.mjs";

const contract = loadStages(fileURLToPath(new URL("../..", import.meta.url)));
const artifactsDir = () => mkdtempSync(join(tmpdir(), "stage-run-safeguards-"));
const tddLedger = () => ({ taskType: "bug_fix", stage: { name: "code-tdd", status: "active", runId: "wf_1", attempt: 1 }, stages: [], tests: {}, checkpoints: [] });

test("tests-cycle-names-tests-it-cannot-read", () => {
  const problems = finishProblems(contract, tddLedger(), artifactsDir(), "abc", () => ({}));

  assert.ok(problems.includes("tests:cycle cannot read the tests: no tests artifact for stage code-tdd at attempt 1, so there is nothing to select"), problems.join("\n"));
});

test("tests-cycle-rethrows-an-error-that-is-no-refusal", () => {
  const broken = () => {
    throw new TypeError("config exploded");
  };

  assert.throws(() => finishProblems(contract, tddLedger(), artifactsDir(), "abc", broken), { name: "TypeError", message: "config exploded" });
});

test("unreadable-return-counts-as-an-empty-return", () => {
  const dir = artifactsDir();
  writeFileSync(join(dir, "code-tdd.create-test-placeholders.-.r1.a1.json"), "{ not json");

  const report = buildReport(tddLedger(), dir);

  assert.deepEqual(report.ran.returns, ["code-tdd.create-test-placeholders.-.r1.a1"]);
  assert.deepEqual(report.ambiguities, []);
  assert.equal(report.spend.agents, 1);
});
