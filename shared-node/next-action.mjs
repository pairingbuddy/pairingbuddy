// What a run does next: the status pb prints and the one sentence the hooks tell a turn. It reads and never writes,
// and it is loaded only once run state is found, so a hook outside a run never pays for it. Node built-ins only.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { PUBLISH_GATE, answeredGate, blockingGate, gatesFor, isPublishApproved, publishApproval } from "./gates.mjs";
import { LedgerShaMismatch, isPublishRun, isRefreshRun, readLedger } from "./ledger.mjs";
import { coveredTests, fixesOf, spendTotals } from "./stage-run.mjs";
import { graphFor, isStageActive, isStageUnstarted, loadStages, nextAttempt, nextStage, startLeaseSecondsLeft } from "./stages.mjs";
import { humanCommand, pbCommand, shaMismatchRemedy } from "./verbs.mjs";
import { SPIKE_SETUP_FILE } from "./unit-files.mjs";

function nextStep(contract, ledger) {
  if (isStageActive(ledger)) return null;
  const stage = nextStage(graphFor(contract, ledger.taskType), ledger);
  return stage === undefined ? null : { stage, attempt: nextAttempt(ledger, stage) };
}

export function runStatus(contract, ledger, artifactsDir) {
  const { stage, stop, needsHuman } = ledger;
  return { stage, next: nextStep(contract, ledger), stop, needsHuman, covered: coveredTests(ledger), spend: spendTotals(ledger, artifactsDir, contract), fixes: fixesOf(ledger, artifactsDir) };
}

// Active with no recorded run and no lease left: the gate marked it, and a declined prompt or a failed start left it.
const isStranded = (ledger) => isStageUnstarted(ledger) && startLeaseSecondsLeft(ledger.stage, Date.now()) === 0;

// A stage that is really running owns the turn. A stop or a stranded stage is still active, and nothing is coming.
const isRunning = (ledger) => isStageActive(ledger) && ledger.stop === null && !isStranded(ledger);

// The full args, because the gate denies a start without them. A run that stored no task has none to give.
function startAction({ stage, attempt }, pluginRoot, task) {
  const start = (args) => `Start the workflow pairingbuddy:${stage} by name with the args ${JSON.stringify(args)}.`;
  if (task === "") return `${start({ attempt, pluginRoot })} This run stored no task, so add the human's task as args.task, an object with a description.`;
  return start({ attempt, pluginRoot, task: { description: task } });
}

function activeAction(ledger, pluginRoot) {
  const { name, attempt } = ledger.stage;
  const clears = `${pbCommand("stage fail")} clears the stage.`;
  if (isStranded(ledger)) return `Stage ${name} has no recorded run and its start lease is over, so its workflow never started. ${startAction({ stage: name, attempt }, pluginRoot, ledger.task)} If it cannot start, ${clears}`;
  return `Stage ${name} is active at attempt ${attempt}. Wait for its workflow. If that workflow was killed or refused to start, ${clears}`;
}

// The order is what the gate enforces: a stop, then a gate, and only then a stage. A stop comes before an active
// stage because every stop the run raises leaves its stage active.
export function nextAction(contract, ledger, root, pluginRoot) {
  const gates = gatesFor(contract, ledger.taskType);
  // A keep-local answer to G:publish is final, not a gate waiting for an approval: pb publish finishes closing the unit.
  const finishVerb = isPublishRun(ledger) ? "publish" : isRefreshRun(ledger) ? "pr refresh" : null;
  if (ledger.stop === null && finishVerb !== null && publishApproval(ledger) === "keep-local") return `The human answered keep local at ${PUBLISH_GATE}, so ${isPublishRun(ledger) ? "the unit is kept local" : "the PR is left unchanged"}. Run ${pbCommand(finishVerb)} to finish closing it.`;
  const answered = answeredGate(gates, ledger);
  if (answered !== undefined) return `Gate ${answered.name} was answered ${answered.answer}. Only the human can go on: ask them to type ${humanCommand(root, `approve ${answered.name}`)}`;
  if (ledger.stop !== null) return `The run has stopped: ${ledger.stop.reason}. Nothing skips a stop, so report ${pbCommand("status")} to the human and go no further. Only if they say to go on, ${pbCommand("stage fail")} clears it.`;
  if (isStageActive(ledger)) return activeAction(ledger, pluginRoot);
  if (ledger.needsHuman !== null) {
    const { gate, reason } = ledger.needsHuman;
    return `Gate ${gate} needs the human: ${reason}. Show them the question and go no further: only they run ${humanCommand(root, `approve ${gate}`)}`;
  }
  const gate = blockingGate(gates, ledger);
  if (gate !== undefined) return `Gate ${gate.name} is due. Run ${pbCommand("gate eval")}.`;
  const step = nextStep(contract, ledger);
  if (ledger.taskType === "spike" && !existsSync(join(root, ".pairingbuddy", "run", "task", SPIKE_SETUP_FILE))) return `The task is a spike and its setup is not recorded yet. Run the setting-up-spike skill in this conversation, then run ${pbCommand("spike setup")}, then run ${pbCommand("status --action")} again.`;
  if (step !== null) return startAction(step, pluginRoot, ledger.task);
  if (finishVerb !== null) return isPublishApproved(ledger) ? `Every stage and gate is done and ${PUBLISH_GATE} is approved. Run ${pbCommand(finishVerb)}.` : `Gate ${PUBLISH_GATE} is due. Run ${pbCommand("gate eval")}.`;
  return `Every stage and gate is done. Run ${pbCommand("task end")}.`;
}

function unreadable(root, e) {
  return e instanceof LedgerShaMismatch ? shaMismatchRemedy(e.message, root) : `The run at ${root} cannot be read: ${e.message}. Report this to the human and go no further.`;
}

// status is null when there is nothing to report but the action. action is null for run state with no open task.
// owner is null with no owner, and for a ledger that cannot say who owns it.
export function readRun(pluginRoot, root) {
  const taskDir = join(root, ".pairingbuddy", "run", "task");
  const ledgerPath = join(taskDir, "ledger.json");
  if (!existsSync(ledgerPath)) return { root, taskDir, running: false, owner: null, status: null, action: null };
  try {
    const contract = loadStages(pluginRoot);
    const ledger = readLedger(ledgerPath);
    const status = runStatus(contract, ledger, join(taskDir, "artifacts"));
    return { root, taskDir, running: isRunning(ledger), owner: ledger.owner.sessionId, status, action: nextAction(contract, ledger, root, pluginRoot) };
  } catch (e) {
    return { root, taskDir, running: false, owner: null, status: null, action: unreadable(root, e) };
  }
}

// What SessionStart and the compact hook inject.
export function runReport({ root, status, action }) {
  const lines = [`A Pairing Buddy run is open at ${root}.`];
  if (status !== null) lines.push(`pb status: ${JSON.stringify(status)}`);
  lines.push(`Next action: ${action ?? "No task is open."}`);
  return lines.join("\n");
}
