#!/usr/bin/env node
// Tap: records StructuredOutput returns as run artifacts, stores the Workflow runId in the ledger, and
// records a human's AskUserQuestion answer to the gate that is asking.
// Never blocks a tool: every path exits 0. It prints only when a publish answer could not be bound or the keep-local close failed, and then as
// additionalContext, the channel the other hooks use.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// The shared-node modules load inside the try so a packaging failure cannot make the hook exit non-zero.

function logError(taskDir, message) {
  appendFileSync(join(taskDir, "tap-errors.log"), `${new Date().toISOString()} ${message}\n`);
}

function tapStructuredOutput({ parseKey, readLedger }, taskDir, ledgerPath, { tool_input: toolInput, agent_type: agentType }) {
  const pbKey = toolInput?.pb_key;
  if (typeof pbKey !== "string") return;
  let parsed;
  try {
    parsed = parseKey(pbKey);
  } catch {
    logError(taskDir, `bad key: ${JSON.stringify(pbKey)}`);
    return;
  }
  // A model can pin any key in a schema of its own, so only the agent the key names may file under it.
  if (agentType !== `pairingbuddy:${parsed.role}`) {
    logError(taskDir, `agent mismatch: key ${pbKey} from ${JSON.stringify(agentType)}`);
    return;
  }
  const { stage } = readLedger(ledgerPath);
  if (!stage || stage.name !== parsed.stage) {
    logError(taskDir, `stage mismatch: key ${pbKey}`);
    return;
  }
  if (stage.attempt !== parsed.attempt) {
    logError(taskDir, `attempt mismatch: key ${pbKey}`);
    return;
  }
  // A key at the attempt that pb stage fail just closed still matches it. A done stage takes returns: its last runner's lands after finish.
  if (stage.status === "failed") {
    logError(taskDir, `voided attempt: key ${pbKey}`);
    return;
  }
  const dir = join(taskDir, "artifacts");
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${pbKey}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(temp, JSON.stringify(toolInput));
  renameSync(temp, join(dir, `${pbKey}.json`));
  writePrBody(taskDir, parsed, toolInput.body);
}

// The pr-draft return's body is the PR body file the later stages read, written whole or not at all.
function writePrBody(taskDir, parsed, body) {
  if (parsed.stage !== "pr-draft" || parsed.role !== "draft-pull-request" || typeof body !== "string") return;
  const runDir = join(taskDir, "..");
  const temp = join(runDir, `.pr-body.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(temp, body);
  renameSync(temp, join(runDir, "pr-body.md"));
}

const hasStage = (ledger) => Boolean(ledger.stage?.name);

const belongsToStage = (stage, toolInput) =>
  toolInput?.name === `pairingbuddy:${stage.name}` && toolInput?.args?.attempt === stage.attempt;

function tapWorkflow({ readLedger, updateLedger }, taskDir, ledgerPath, toolInput, toolResponse) {
  const runId = toolResponse?.runId;
  if (typeof runId !== "string" || !hasStage(readLedger(ledgerPath))) return;
  let mismatch = null;
  updateLedger(ledgerPath, (ledger) => {
    if (!hasStage(ledger)) return ledger;
    if (!belongsToStage(ledger.stage, toolInput)) {
      mismatch = ledger.stage.name;
      return ledger;
    }
    return { ...ledger, stage: { ...ledger.stage, runId } };
  });
  if (mismatch !== null) logError(taskDir, `workflow mismatch: ${JSON.stringify(toolInput?.name)} for stage ${mismatch}`);
}

function runGates({ gatesFor, loadStages }, ledger) {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? fileURLToPath(new URL("..", import.meta.url));
  return gatesFor(loadStages(pluginRoot), ledger.taskType);
}

function askedAnswer({ gateAnswer }, ledger, toolResponse) {
  const gate = ledger.needsHuman?.gate;
  return gate === undefined ? null : gateAnswer(gate, toolResponse);
}

// Pure: the binding of a publish answer is computed once by the caller, never here.
function withAnswer(modules, ledger, toolResponse, binding) {
  const answer = askedAnswer(modules, ledger, toolResponse);
  return answer === null ? ledger : modules.recordAnswer(ledger, ledger.needsHuman.gate, answer, runGates(modules, ledger), binding);
}

function say(message) {
  const hookSpecificOutput = { hookEventName: "PostToolUse", additionalContext: message };
  writeSync(1, `${JSON.stringify({ hookSpecificOutput })}\n`);
}

// A publish answer that cannot be bound is not approved. The gate keeps asking with the reason on it, and the hook says so.
function refuseAnswer({ updateLedger }, ledgerPath, gate, e) {
  const reason = `the publish answer could not be bound: ${e.message}`;
  updateLedger(ledgerPath, (current) => (current.needsHuman?.gate === gate ? { ...current, needsHuman: { ...current.needsHuman, reason } } : current));
  say(`Pairing Buddy did not record the ${gate} answer: ${e.message}. ${gate} is still asking.`);
}

// Only tool_response counts: it holds what the human chose, and tool_input is the model's.
function tapQuestion(modules, root, ledgerPath, toolResponse) {
  const { appendRedoFeedback, isBindingRefusal, publishBinding, readLedger, updateLedger, PUBLISH_LABEL, KEEP_LOCAL_LABEL } = modules;
  const ledger = readLedger(ledgerPath);
  const answer = askedAnswer(modules, ledger, toolResponse);
  if (answer === null) return;
  let binding;
  if (answer === PUBLISH_LABEL) {
    try {
      binding = publishBinding(root, ledger, ledger.needsHuman.shown ?? null);
    } catch (e) {
      if (!isBindingRefusal(e)) throw e;
      refuseAnswer(modules, ledgerPath, ledger.needsHuman.gate, e);
      return;
    }
  }
  updateLedger(ledgerPath, (current) => withAnswer(modules, current, toolResponse, binding));
  if (answer === "redo") appendRedoFeedback(root, ledger, runGates(modules, ledger), toolResponse);
  if (answer === KEEP_LOCAL_LABEL) closeKeptLocal(modules, root, ledger);
}

// Keep local closes the unit, and a publish run ends with it. Each step runs whatever the other did, and a failure is
// said through the hook, since the recorded answer stays: pb publish finishes what is left.
function closeKeptLocal(modules, root, ledger) {
  const runDir = join(root, ".pairingbuddy", "run");
  const failures = [];
  const attempt = (what, step) => {
    try {
      step();
    } catch (e) {
      failures.push(`${what}: ${e.message}`);
    }
  };
  attempt("the unit files were not removed", () => modules.closeUnit(runDir));
  if (modules.isPublishRun(ledger)) attempt("the publish run was not ended", () => modules.endRun(runDir));
  if (failures.length > 0) say(`Pairing Buddy recorded keep local at G:publish but could not finish closing (${failures.join("; ")}). Run ${modules.pbCommand("publish")} to finish; it closes the unit and ends the run without pushing.`);
}

function tapRun(modules, root, input) {
  const { parseKey, readLedger, updateLedger } = modules;
  const taskDir = join(root, ".pairingbuddy", "run", "task");
  const ledgerPath = join(taskDir, "ledger.json");
  if (!existsSync(ledgerPath)) return;
  try {
    if (input.tool_name === "StructuredOutput") tapStructuredOutput({ parseKey, readLedger }, taskDir, ledgerPath, input);
    else if (input.tool_name === "Workflow") tapWorkflow({ readLedger, updateLedger }, taskDir, ledgerPath, input.tool_input, input.tool_response);
    else if (input.tool_name === "AskUserQuestion" && input.agent_id === undefined) tapQuestion(modules, root, ledgerPath, input.tool_response);
  } catch (e) {
    logError(taskDir, `error: ${e?.message ?? e}`);
  }
}

try {
  const { KEEP_LOCAL_LABEL, PUBLISH_LABEL, appendRedoFeedback, gateAnswer, gatesFor, isBindingRefusal, publishBinding, recordAnswer } = await import("../shared-node/gates.mjs");
  const { parseKey } = await import("../shared-node/keys.mjs");
  const { isPublishRun, readLedger, updateLedger } = await import("../shared-node/ledger.mjs");
  const { pbCommand } = await import("../shared-node/verbs.mjs");
  const { closeUnit, endRun } = await import("../shared-node/unit-files.mjs");
  const { findSessionRoot } = await import("../shared-node/run-root.mjs");
  const { loadStages } = await import("../shared-node/stages.mjs");
  const input = JSON.parse(readFileSync(0, "utf8"));
  const root = findSessionRoot(input.cwd, input.session_id);
  if (root !== null) tapRun({ KEEP_LOCAL_LABEL, PUBLISH_LABEL, appendRedoFeedback, closeUnit, endRun, gateAnswer, gatesFor, isBindingRefusal, isPublishRun, loadStages, parseKey, pbCommand, publishBinding, readLedger, recordAnswer, updateLedger }, root, input);
} catch {
  // not a run situation
}
process.exit(0);
