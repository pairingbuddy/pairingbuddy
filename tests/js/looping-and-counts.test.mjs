// Scenario looping-and-counts: pure LOOPING tries, active agent counts, and drifted (unparseable) agent labels counted as unknown (node:test on shared-node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { glance } from "../../shared-node/glance.mjs";
import { buildLabel } from "../../shared-node/labels.mjs";
import { activeAgents, fitTries, loopingTries, unknownAgents } from "../../shared-node/now-building.mjs";

test("looping-lists-each-try-and-result", () => {
  const redTry = { kind: "workflow_agent", name: buildLabel({ stage: "tdd", phase: "RED", role: "implement-tests", item: "discount-applies", round: 1 }) };
  const threeRedTries = [redTry, redTry, redTry];
  const perTest = { "discount-applies": { red: { passed: false, exitCodes: [0] } } };

  const looping = loopingTries({ spawns: threeRedTries, perTest });
  const single = loopingTries({ spawns: threeRedTries.slice(0, 1), perTest });

  assert.deepEqual(
    looping,
    [
      { step: "RED", number: 1, result: "unknown" },
      { step: "RED", number: 2, result: "unknown" },
      { step: "RED", number: 3, result: "passed straight away, refused (exit 0)" },
    ],
    "each of the three RED tries is listed; the ledger's record belongs to the latest try only",
  );
  assert.equal(single, undefined, "one try is not looping, so there is no looping row");
});

test("active-agents-clear-on-finish", () => {
  const running = [{ agentId: "a1" }, { agentId: "a2" }, { agentId: "a3" }];
  const oneFinishedSpawns = [{ agentId: "a1" }, { agentId: "a2", finished: true }, { agentId: "a3" }];
  const allFinishedSpawns = running.map((spawn) => ({ ...spawn, finished: true }));

  const allRunning = activeAgents({ spawns: running });
  const oneFinished = activeAgents({ spawns: oneFinishedSpawns });
  const allFinished = activeAgents({ spawns: allFinishedSpawns });

  assert.equal(allRunning, 3, "each spawn raises the active count");
  assert.equal(oneFinished, 2, "a finished spawn lowers it by one");
  assert.equal(allFinished, 0, "once every spawn has finished the count is zero");
});

test("drifted-label-counted-unknown", () => {
  const good = { kind: "workflow_agent", name: buildLabel({ stage: "tdd", phase: "RED", role: "implement-tests", item: "discount-applies", round: 1 }) };
  const drifted = { kind: "workflow_agent", name: "implement tests for discount (round one)" };

  const withDrift = glance({ spawns: [good, drifted], tests: ["discount-applies"] });
  const withoutDrift = glance({ spawns: [good], tests: ["discount-applies"] });

  assert.deepEqual(withDrift.unknownLabels, ["implement tests for discount (round one)"], "exactly one drifted name is counted and shown raw, not dropped");
  assert.deepEqual(withoutDrift.unknownLabels, [], "a label that parses adds nothing to the unknown count");
  assert.equal(withDrift.rows.now, withoutDrift.rows.now, "the drifted spawn is not counted as a test step");
});

test("fit-tries-keeps-latest-result-whole-at-narrow-width", () => {
  const result = "passed straight away (exit 0)";
  const tries = [1, 2, 3].map((number) => ({ step: "RED", number, result }));

  const narrow = fitTries(tries, 50);

  assert.ok(narrow.includes(`try 3 at RED: ${result}`), `the latest try's result words stay whole, never cut: "${narrow}"`);
  assert.ok(!narrow.includes("try 1 at RED") && !narrow.includes("try 2 at RED"), `older tries fold away: "${narrow}"`);
  assert.ok([...narrow].length <= 50, `the line fits 50 columns, got ${[...narrow].length} cells: "${narrow}"`);
});

test("spawn-without-agent-id-counted-unknown", () => {
  const spawns = [{ agentId: "a1" }, {}, { agentId: "a2", finished: true }, { agentId: undefined }];

  const active = activeAgents({ spawns });
  const unknown = unknownAgents({ spawns });

  assert.equal(active, 1, "only a spawn with an agentId can be seen to finish, so only it counts as active");
  assert.equal(unknown, 2, "the two spawns with no agentId are counted as unknown, not as running forever");
});
