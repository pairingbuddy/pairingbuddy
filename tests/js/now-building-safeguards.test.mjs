// Safeguards for shared-node/now-building.mjs: the current test follows the ledger stage, the progress row folds waiting then
// finished items at narrow widths, and shortName spaces out a test id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleMarker, fitProgress, progressRow, shortName, stepAge } from "../../shared-node/now-building.mjs";

const entry = (name, mark) => ({ id: name, name, mark });
const PROGRESS = { entries: [entry("a", "done"), entry("b", "covered"), entry("c", "current"), entry("d", "waiting"), entry("e", "waiting")] };

test("the-current-test-its-marker-and-age-follow-the-ledger-stage", () => {
  const tdd = (phase, role, item) => ({ kind: "workflow_agent", name: `pb1 code-tdd ${phase} ${role} ${item} r1`, startedAt: "2026-11-14T10:00:00.000Z" });
  const spawns = [tdd("RED", "implement-tests", "t1"), tdd("RED", "implement-tests", "t1"), tdd("RED", "implement-tests", "t1")];
  const review = { stage: { name: "code-safety-net", status: "active" } };
  const building = { stage: { name: "code-tdd", status: "active" } };
  const now = Date.parse("2026-11-14T10:00:03.000Z");

  assert.deepEqual(progressRow({ tests: [{ test_id: "t1" }], spawns, stage: "code-safety-net" }).entries.map(({ mark }) => mark), ["waiting"], "no test is current outside its stage");
  assert.deepEqual(cycleMarker({ spawns, ledger: review }).steps, [], "no phase is lit outside the TDD stage");
  assert.equal(stepAge({ spawns, now, stage: "code-safety-net" }), "time unknown", "no step age outside its stage");
  assert.equal(progressRow({ tests: [{ test_id: "t1" }], spawns, stage: "code-tdd" }).entries[0].mark, "current", "in its stage the test is current");
  assert.equal(cycleMarker({ spawns, ledger: building }).steps.find(({ lit }) => lit).name, "RED", "in its stage the phase is lit");
  assert.equal(stepAge({ spawns, now, stage: "code-tdd" }), "0:03");
});

test("progress-row-is-whole-with-no-width-budget", () => {
  assert.equal(fitProgress(PROGRESS, undefined), "✓ a   ◌ b   ▸ c   · d   · e");
});

test("progress-row-drops-waiting-items-into-more-when-the-total-is-known", () => {
  assert.equal(fitProgress({ ...PROGRESS, known: true }, 25), "✓ a   ◌ b   ▸ c   +2 more");
});

test("progress-row-drops-waiting-items-uncounted-when-the-total-is-unknown", () => {
  assert.equal(fitProgress(PROGRESS, 20), "✓ a   ◌ b   ▸ c");
});

test("progress-row-folds-finished-items-when-dropping-waiting-is-not-enough", () => {
  assert.equal(fitProgress({ ...PROGRESS, known: true }, 12), "✓ 1 done   ◌ 1 covered   ▸ c   +2 more");
});

test("short-name-is-the-id-spaced-out", () => {
  assert.equal(shortName("adds-a-button"), "adds a button");
  assert.equal(shortName("adds_a_button"), "adds a button", "underscores read as spaces too");
});
