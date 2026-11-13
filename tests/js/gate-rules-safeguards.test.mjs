// Safeguards for shared-node/gate-rules.mjs, called in process through checkCall: plan Write and Edit calls the checkbox
// rule cannot compare are denied, a plan not on disk yet compares as empty, and the stage-order denials name an answered
// gate's stop and a gate that has not passed.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseLedger } from "./ledger-fixture.mjs";
import { writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
process.env.CLAUDE_PLUGIN_ROOT = ROOT;
delete process.env.PAIRINGBUDDY_SOLO;
delete process.env.PAIRINGBUDDY_GATE_POLICY;
const { checkCall } = await import("../../shared-node/gate-rules.mjs");
const { humanCommand } = await import("../../shared-node/verbs.mjs");

const PLAN = "docs/plans/plan.md";
const STOP = { code: "human-stopped", reason: "the human answered stop at G:scenarios", seq: 1 };

function runRepo(ledgerFields = {}, planText = null) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gate-rules-safeguards-")));
  mkdirSync(join(root, ".pairingbuddy", "run", "task"), { recursive: true });
  writeLedger(join(root, ".pairingbuddy", "run", "task", "ledger.json"), { ...baseLedger(), policy: { mode: "", source: "" }, plan: { path: PLAN, title: "Plan" }, ...ledgerFields });
  if (planText !== null) {
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    writeFileSync(join(root, PLAN), planText);
  }
  return root;
}

const call = (root, toolName, toolInput, targets = []) =>
  checkCall({ runRoots: [root], sessionRoot: null, payload: { session_id: "s1", cwd: root, tool_name: toolName, permission_mode: "default", tool_input: toolInput }, targets, canonicalPath: (path) => path });
const denial = (message) => (error) => error.gateDenial === true && error.message === message;

test("write-of-a-plan-not-on-disk-yet-compares-as-empty", () => {
  const root = runRepo();
  const plan = join(root, PLAN);

  assert.equal(call(root, "Write", { file_path: plan, content: "- [ ] Task 1\n" }, [plan]), null);
});

test("write-of-a-new-plan-with-a-ticked-box-is-denied", () => {
  const root = runRepo();
  const plan = join(root, PLAN);

  assert.throws(() => call(root, "Write", { file_path: plan, content: "- [x] Task 1\n" }, [plan]), denial(`Plan checkbox changes are denied during a run: ${PLAN}. Only pb task end sets a checkbox.`));
});

test("write-of-the-plan-with-no-content-is-denied", () => {
  const root = runRepo({}, "- [ ] Task 1\n");
  const plan = join(root, PLAN);

  assert.throws(() => call(root, "Write", { file_path: plan }, [plan]), denial(`Write of the plan ${plan} has no content to compare.`));
});

test("edit-of-the-plan-with-no-old-string-is-denied", () => {
  const root = runRepo({}, "- [ ] Task 1\n");
  const plan = join(root, PLAN);

  assert.throws(() => call(root, "Edit", { file_path: plan, new_string: "x" }, [plan]), denial(`Edit of the plan ${plan} has no old_string and new_string to compare.`));
});

test("edit-of-the-plan-whose-old-string-is-not-in-it-is-denied", () => {
  const root = runRepo({}, "- [ ] Task 1\n");
  const plan = join(root, PLAN);

  assert.throws(() => call(root, "Edit", { file_path: plan, old_string: "Task 9", new_string: "Task 10" }, [plan]),
    denial(`Edit of the plan ${plan}: old_string is not in the file, so its checkbox changes cannot be compared.`));
});

const SCENARIOS_DONE = {
  taskType: "bug_fix",
  stage: { name: "code-scenarios", status: "done", runId: "wf_1", attempt: 1 },
  stages: [{ name: "code-scenarios", status: "done" }],
};
const STOPPED_AT_SCENARIOS = { ...SCENARIOS_DONE, gates: { "G:scenarios": { source: "human", answer: "stop" } }, stop: STOP };
const halted = (root) => `Gate G:scenarios was answered stop. The run stopped: ${STOP.reason}. Only the human can go on from here: ask them to type ${humanCommand(root, "approve G:scenarios")} at the prompt.`;

test("stage-start-after-an-answered-stop-names-the-stop", () => {
  const root = runRepo(STOPPED_AT_SCENARIOS);

  assert.throws(() => call(root, "Workflow", { name: "pairingbuddy:code-tdd" }), denial(`Stage order: pairingbuddy:code-tdd cannot start now. ${halted(root)}`));
});

test("inline-script-after-an-answered-stop-names-the-stop", () => {
  const root = runRepo(STOPPED_AT_SCENARIOS);

  assert.throws(() => call(root, "Workflow", { script: "agent({agentType:'pairingbuddy:x'})" }), denial(`Inline script containing pairingbuddy: is denied. ${halted(root)}`));
});

test("stage-start-behind-a-gate-that-has-not-passed-is-denied", () => {
  const root = runRepo(SCENARIOS_DONE);

  assert.throws(() => call(root, "Workflow", { name: "pairingbuddy:code-tdd" }),
    denial("Stage order: pairingbuddy:code-tdd cannot start now. Gate G:scenarios has not passed: run pb gate eval, and a human must approve it if it asks."));
});
