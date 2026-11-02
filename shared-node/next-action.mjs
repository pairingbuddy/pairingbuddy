// What a run does next: the status pb prints and the one sentence the hooks tell a turn. It reads and never writes,
// and it is loaded only once run state is found, so a hook outside a run never pays for it. Node built-ins only.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { answeredGate, blockingGate, gatesFor } from "./gates.mjs";
import { LedgerShaMismatch, readLedger } from "./ledger.mjs";
import { spendTotals } from "./stage-run.mjs";
import { graphFor, isStageActive, loadStages, nextAttempt, nextStage } from "./stages.mjs";
import { humanCommand, pbCommand, shaMismatchRemedy } from "./verbs.mjs";

function nextStep(contract, ledger) {
  if (isStageActive(ledger)) return null;
  const stage = nextStage(graphFor(contract, ledger.taskType), ledger);
  return stage === undefined ? null : { stage, attempt: nextAttempt(ledger, stage) };
}

export function runStatus(contract, ledger, artifactsDir) {
  const { stage, stop, needsHuman } = ledger;
  return { stage, next: nextStep(contract, ledger), stop, needsHuman, spend: spendTotals(ledger, artifactsDir, contract.maxAgents) };
}

// The full args, because a workflow started without them refuses and strands its stage active, where no Stop hook speaks.
function startAction({ stage, attempt }, pluginRoot) {
  const args = `{"attempt":${attempt},"pluginRoot":${JSON.stringify(pluginRoot)},"task":{"description":"<this task>"}}`;
  return `Start the workflow pairingbuddy:${stage} by name with the args ${args}.`;
}

// The order is what the gate enforces: a stop, then a gate, and only then a stage.
function nextAction(contract, ledger, root, pluginRoot) {
  if (isStageActive(ledger)) {
    const { name, attempt } = ledger.stage;
    return `Stage ${name} is active at attempt ${attempt}. Wait for its workflow. If that workflow was killed or refused to start, ${pbCommand("stage fail")} clears the stage.`;
  }
  const gates = gatesFor(contract, ledger.taskType);
  const answered = answeredGate(gates, ledger);
  if (answered !== undefined) return `Gate ${answered.name} was answered ${answered.answer}. Only the human can go on: ask them to type ${humanCommand(root, `approve ${answered.name}`)}`;
  if (ledger.stop !== null) return `The run has stopped: ${ledger.stop.reason}. Nothing skips a stop, so report ${pbCommand("status")} to the human and go no further.`;
  if (ledger.needsHuman !== null) {
    const { gate, reason } = ledger.needsHuman;
    return `Gate ${gate} needs the human: ${reason}. Show them the question and go no further: only they run ${humanCommand(root, `approve ${gate}`)}`;
  }
  const gate = blockingGate(gates, ledger);
  if (gate !== undefined) return `Gate ${gate.name} is due. Run ${pbCommand("gate eval")}.`;
  const step = nextStep(contract, ledger);
  if (step !== null) return startAction(step, pluginRoot);
  return `Every stage and gate is done. Run ${pbCommand("task end")}.`;
}

function unreadable(root, e) {
  return e instanceof LedgerShaMismatch ? shaMismatchRemedy(e.message, root) : `The run at ${root} cannot be read: ${e.message}. Report this to the human and go no further.`;
}

// status is null when there is nothing to report but the action. action is null for run state with no open task.
export function readRun(pluginRoot, root) {
  const taskDir = join(root, ".pairingbuddy", "run", "task");
  const ledgerPath = join(taskDir, "ledger.json");
  if (!existsSync(ledgerPath)) return { root, taskDir, active: false, status: null, action: null };
  try {
    const contract = loadStages(pluginRoot);
    const ledger = readLedger(ledgerPath);
    const status = runStatus(contract, ledger, join(taskDir, "artifacts"));
    return { root, taskDir, active: isStageActive(ledger), status, action: nextAction(contract, ledger, root, pluginRoot) };
  } catch (e) {
    return { root, taskDir, active: false, status: null, action: unreadable(root, e) };
  }
}

// What SessionStart and the compact hook inject.
export function runReport({ root, status, action }) {
  const lines = [`A Pairing Buddy run is open at ${root}.`];
  if (status !== null) lines.push(`pb status: ${JSON.stringify(status)}`);
  lines.push(`Next action: ${action ?? "No task is open."}`);
  return lines.join("\n");
}
