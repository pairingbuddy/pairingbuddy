// Safeguards for shared-node/gates.mjs: reopenedGate, an unreadable report stopping the gate when no artifacts are on file,
// the refusal when git has no HEAD, and recordApproval restoring a redo and clearing only the stop its own gate set.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseLedger } from "./ledger-fixture.mjs";
import { PublishRefused, askReason, fileHash, gatesFor, publishFacts, recordAnswer, recordApproval, reopenedGate } from "../../shared-node/gates.mjs";
import { loadStages } from "../../shared-node/stages.mjs";

const contract = loadStages(fileURLToPath(new URL("../..", import.meta.url)));
const GATES = gatesFor(contract, "bug_fix");
const SCENARIOS_GATE = GATES.find(({ name }) => name === "G:scenarios");
const STOP = { code: "human-stopped", reason: "the human answered stop at G:scenarios", seq: 4 };

const ledgerWith = (fields) => ({ ...baseLedger(), taskType: "bug_fix", ...fields });
const redoLedger = (fields = {}) => ledgerWith({ stage: { name: "code-scenarios", status: "redo", runId: "r1", attempt: 1 }, stages: [{ name: "code-scenarios", status: "redo" }], ...fields });

test("reopened-gate-is-the-gate-of-a-stage-sent-back", () => {
  assert.deepEqual(reopenedGate(GATES, redoLedger()), SCENARIOS_GATE);
});

test("no-gate-is-reopened-while-the-stage-is-done", () => {
  assert.equal(reopenedGate(GATES, ledgerWith({ stage: { name: "code-scenarios", status: "done", runId: "r1", attempt: 1 } })), undefined);
});

test("approval-of-the-reopened-gate-restores-its-stage-to-done", () => {
  const approved = recordApproval(redoLedger(), "G:scenarios", GATES);

  assert.equal(approved.stage.status, "done");
  assert.deepEqual(approved.stages, [{ name: "code-scenarios", status: "done" }]);
  assert.deepEqual(approved.gates["G:scenarios"], { source: "human-cli", answer: "approve" });
});

test("approval-of-another-gate-leaves-the-redo-standing", () => {
  const approved = recordApproval(redoLedger(), "G:task-end", GATES);

  assert.equal(approved.stage.status, "redo");
  assert.deepEqual(approved.stages, [{ name: "code-scenarios", status: "redo" }]);
});

test("approval-clears-the-stop-its-own-gate-set", () => {
  const stopped = ledgerWith({ gates: { "G:scenarios": { source: "human", answer: "stop" } }, stop: STOP });

  assert.equal(recordApproval(stopped, "G:scenarios", GATES).stop, null);
});

test("approval-of-another-gate-keeps-the-stop", () => {
  const stopped = ledgerWith({ gates: { "G:scenarios": { source: "human", answer: "stop" } }, stop: STOP });

  assert.deepEqual(recordApproval(stopped, "G:task-end", GATES).stop, STOP);
});

const DOUBTS = [{ step: "listing scenarios", ambiguity: "An empty order returns int 0, not 0.0." }];

test("approval-keeps-the-doubts-it-was-given-past", () => {
  const asked = ledgerWith({ needsHuman: { gate: "G:task-end", reason: "open doubts", seq: 3, doubts: DOUBTS } });

  const approved = recordApproval(asked, "G:task-end", GATES);

  assert.equal(approved.needsHuman, null, "the question is answered");
  assert.deepEqual(approved.gates["G:task-end"].doubts, DOUBTS, "the gate record keeps the doubts the human approved past, for the report");
});

test("an approve answered in the question keeps its doubts too", () => {
  const asked = ledgerWith({ needsHuman: { gate: "G:task-end", reason: "open doubts", seq: 3, doubts: DOUBTS } });

  const answered = recordAnswer(asked, "G:task-end", "approve", GATES);

  assert.deepEqual(answered.gates["G:task-end"], { source: "human", answer: "approve", doubts: DOUBTS });
});

function runRoot(report) {
  const root = mkdtempSync(join(tmpdir(), "gates-safeguards-"));
  mkdirSync(join(root, ".pairingbuddy", "run", "task"), { recursive: true });
  writeFileSync(join(root, ".pairingbuddy", "test-config.json"), "{}\n");
  if (report !== undefined) writeFileSync(join(root, ".pairingbuddy", "run", "task", "report.json"), report);
  return root;
}

const askingLedger = (root) => ledgerWith({ configHash: fileHash(join(root, ".pairingbuddy", "test-config.json")), policy: { mode: "auto", source: "constant" } });

for (const [label, report] of [["not JSON", "{ not json"], ["a list that is no array", JSON.stringify({ gaps: "none" })]]) {
  test(`report-that-is-${label.replace(/ /g, "-")}-stops-the-gate-with-no-artifacts-on-file`, () => {
    const root = runRoot(report);

    assert.equal(askReason(contract, askingLedger(root), SCENARIOS_GATE, root), `${join(root, ".pairingbuddy", "run", "task", "report.json")} cannot be read`);
  });
}

test("no-report-and-no-artifacts-pass-under-auto", () => {
  const root = runRoot();

  assert.equal(askReason(contract, askingLedger(root), SCENARIOS_GATE, root), null);
});

test("publish-facts-refuse-when-git-has-no-head", () => {
  const root = runRoot();
  writeFileSync(join(root, ".pairingbuddy", "run", "unit.json"), JSON.stringify({ base: "main", baseSha: "0".repeat(40) }));

  assert.throws(() => publishFacts(root), (error) => error instanceof PublishRefused && error.message === "git has no HEAD here, so the publish binding cannot be read");
});

// The wait on the human is no working time: an answer to an asked question records when it was asked and when answered.
const ASKED_AT = "2026-11-16T15:42:30.000Z";
const ANSWERED_AT = "2026-11-16T19:43:50.000Z";
const askedAtPublish = () => ledgerWith({ needsHuman: { gate: "G:task-end", reason: "auto mode is off", seq: 3, askedAt: ASKED_AT } });

test("an-answer-records-when-its-question-was-asked-and-answered", () => {
  const answered = recordAnswer(askedAtPublish(), "G:task-end", "approve", GATES, {}, ANSWERED_AT);

  assert.equal(answered.gates["G:task-end"].askedAt, ASKED_AT);
  assert.equal(answered.gates["G:task-end"].answeredAt, ANSWERED_AT);
});

test("an-approval-from-the-cli-records-when-its-question-was-asked-and-answered", () => {
  const approved = recordApproval(askedAtPublish(), "G:task-end", GATES, {}, ANSWERED_AT);

  assert.deepEqual(approved.gates["G:task-end"], { source: "human-cli", answer: "approve", askedAt: ASKED_AT, answeredAt: ANSWERED_AT });
});
