// Safeguards for shared-node/stage-graph.mjs: evidence for a stage outside the graph throws, withStageStatus leaves another
// current stage alone, a file name that is no key reads as null, and nextAgent names the stage's first artifact agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { evidenceFor, loadStages, nextAgent, returnFileKey, withStageStatus } from "../../shared-node/stages.mjs";

const contract = loadStages(fileURLToPath(new URL("../..", import.meta.url)));
const ledgerAt = (stage, status = "active") => ({ taskType: "bug_fix", stage: { name: stage, status, runId: "wf_1", attempt: 1 }, stages: [] });
const spawnIn = (stage) => ({ name: `pb1 ${stage} - create-test-placeholders - r1` });

test("evidence-for-a-stage-outside-the-graph-throws", () => {
  assert.throws(() => evidenceFor(contract, "bug_fix", "nope"), { message: "stage nope is not in the bug_fix graph" });
});

test("with-stage-status-leaves-another-current-stage-alone", () => {
  const ledger = { stage: { name: "code-tdd", status: "active" }, stages: [{ name: "code-scenarios", status: "done" }] };

  const changed = withStageStatus(ledger, "code-scenarios", "redo");

  assert.deepEqual(changed.stage, { name: "code-tdd", status: "active" });
  assert.deepEqual(changed.stages, [{ name: "code-scenarios", status: "redo" }]);
});

test("file-name-that-is-no-key-reads-as-null", () => {
  assert.equal(returnFileKey("notes.json"), null);
});

test("next-agent-is-the-first-artifact-of-the-active-stage", () => {
  assert.equal(nextAgent(contract, ledgerAt("code-tdd"), []), "create-test-placeholders");
});

test("next-agent-ignores-spawns-of-earlier-stages", () => {
  assert.equal(nextAgent(contract, ledgerAt("code-tdd"), [spawnIn("code-scenarios")]), "create-test-placeholders");
});

test("next-agent-is-unknown-once-the-stage-spawned", () => {
  assert.equal(nextAgent(contract, ledgerAt("code-tdd"), [spawnIn("code-tdd")]), undefined);
});

test("next-agent-is-unknown-when-no-stage-is-active", () => {
  assert.equal(nextAgent(contract, ledgerAt("code-tdd", "done"), []), undefined);
});

test("next-agent-is-unknown-for-a-stage-outside-the-graph", () => {
  assert.equal(nextAgent(contract, ledgerAt("nope"), []), undefined);
});
