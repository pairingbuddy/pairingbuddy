// What a run does next: the status pb prints and the one sentence the hooks tell a turn. It reads and never writes,
// and it is loaded only once run state is found, so a hook outside a run never pays for it. Node built-ins only.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { GO_ON_WAIT, PUBLISH_GATE, answeredGate, blockingGate, gatesFor, isPublishApproved, publishApproval } from "./gates.mjs";
import { LedgerShaMismatch, isPublishRun, isRefreshRun, readLedger, seenRecently } from "./ledger.mjs";
import { coveredTests, fixesOf, spendTotals } from "./stage-run.mjs";
import { graphFor, isStageActive, isStageUnstarted, loadStages, nextAttempt, nextStage, startLeaseSecondsLeft } from "./stages.mjs";
import { humanCommand, pbCommand, shaMismatchRemedy } from "./verbs.mjs";
import { SPIKE_SETUP_FILE } from "./unit-files.mjs";
import { fixesLine, forYou, plainName, stageRun } from "./plain-names.mjs";
import { CONFIG_GATE, CONFIG_WAIT_LINE, TYPED_FALLBACKS } from "./config-wait.mjs";

function nextStep(contract, ledger) {
  if (isStageActive(ledger)) return null;
  const stage = nextStage(graphFor(contract, ledger.taskType), ledger);
  return stage === undefined ? null : { stage, attempt: nextAttempt(ledger, stage) };
}

// say: the stage's run and its fixes in the plain words a model relays to the human, each its own (sayRun).
export function runStatus(contract, ledger, artifactsDir) {
  const { stage, stop, needsHuman } = ledger;
  const fixes = fixesOf(ledger, artifactsDir);
  return { stage, next: nextStep(contract, ledger), stop, needsHuman, covered: coveredTests(ledger), spend: spendTotals(ledger, artifactsDir, contract), fixes, say: sayRun(stage, fixes) };
}

// "safety-net review: run 6 (restarted 5 times) · fixes: 4 tried, undone: 1 of 5 allowed"; the fixes part only once one was tried.
function sayRun(stage, fixes) {
  if (!stage.name) return "no stage started yet";
  return [`${plainName(stage.name) ?? stage.name}: ${stageRun(stage.attempt)}`, ...(fixes.attempts > 0 ? [fixesLine(fixes)] : [])].join(" · ");
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
  if (isStageUnstarted(ledger)) return `Stage ${name} is active on ${stageRun(attempt)} with no recorded workflow yet. If its Workflow call was declined or failed before it ran, run ${pbCommand("stage release")} to free the start now. Then: ${startAction({ stage: name, attempt }, pluginRoot, ledger.task)} Otherwise wait for its workflow.`;
  return `Stage ${name} is active on ${stageRun(attempt)}. Wait for its workflow. If that workflow was killed or refused to start, ${clears}`;
}

// The plain name the human knows a gate by, as the progress pane shows it.
const plainGate = (gate) => plainName(gate) ?? `the human's OK at ${gate}`;

// The question box first, since the tap records its answer; the ! command only when an asked question left the gate waiting.
function askHuman(root, gate, question, command = humanCommand(root, `approve ${gate}`)) {
  const fallback = `tell the human the run still needs ${plainGate(gate)} and show them ${command}, then go no further: only they run it.`;
  if (question === undefined) return `Ask the human for it: ${fallback}`;
  const asked = JSON.stringify({ questions: [question] });
  return `If you have not asked them yet, ask with AskUserQuestion, passing exactly this question: ${asked}. Then run ${pbCommand("status --action")}. If you asked and it still waits, ${fallback}`;
}

// The order is what the gate enforces: a stop, then a gate, and only then a stage. A stop comes before an active
// stage because every stop the run raises leaves its stage active.
export function nextAction(contract, ledger, root, pluginRoot) {
  const gates = gatesFor(contract, ledger.taskType);
  // A keep-local answer to G:publish is final, not a gate waiting for an approval: pb publish finishes closing the unit.
  const finishVerb = isPublishRun(ledger) ? "publish" : isRefreshRun(ledger) ? "pr refresh" : null;
  if (ledger.stop === null && finishVerb !== null && publishApproval(ledger) === "keep-local") return `The human answered keep local at ${PUBLISH_GATE}, so ${isPublishRun(ledger) ? "the unit is kept local" : "the PR is left unchanged"}. Run ${pbCommand(finishVerb)} to finish closing it.`;
  // The question whether to go on past the human's own stop comes before the stop: it is the way past it.
  if (ledger.needsHuman?.wait === GO_ON_WAIT) return `The human stopped the run at ${plainGate(ledger.needsHuman.gate)}. ${askHuman(root, ledger.needsHuman.gate, ledger.needsHuman.question)}`;
  const answered = answeredGate(gates, ledger);
  if (answered?.answer === "stop") return `The human answered stop at ${plainGate(answered.name)}, so the run stays stopped. Report ${pbCommand("status")} to them and go no further. Only if they say they want to go on, run ${pbCommand("gate eval")}: it gives the question that asks them, and only their answer lifts the stop.`;
  if (answered !== undefined) return `The human answered ${answered.answer} at ${plainGate(answered.name)}. Only they can go on: ask them to type ${humanCommand(root, `approve ${answered.name}`)}`;
  if (ledger.stop !== null) return `The run has stopped: ${ledger.stop.reason}. Nothing skips a stop, so report ${pbCommand("status")} to the human and go no further. Only if they say to go on, ${pbCommand("stage fail")} clears it.`;
  if (isStageActive(ledger)) return activeAction(ledger, pluginRoot);
  if (ledger.needsHuman?.gate === CONFIG_GATE) return `The run is waiting on the human: ${CONFIG_WAIT_LINE}. ${askHuman(root, CONFIG_GATE, ledger.needsHuman.question, humanCommand(root, TYPED_FALLBACKS[CONFIG_GATE]))}`;
  if (ledger.needsHuman !== null) {
    const { gate, reason } = ledger.needsHuman;
    return `The run is waiting for ${plainGate(gate)}: ${reason}. ${askHuman(root, gate, ledger.needsHuman.question, humanCommand(root, TYPED_FALLBACKS[gate] ?? `approve ${gate}`))}`;
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
  if (!existsSync(ledgerPath)) return { root, taskDir, running: false, owner: null, lastSeen: null, status: null, action: null };
  try {
    const contract = loadStages(pluginRoot);
    const ledger = readLedger(ledgerPath);
    const status = runStatus(contract, ledger, join(taskDir, "artifacts"));
    return { root, taskDir, running: isRunning(ledger), owner: ledger.owner.sessionId, lastSeen: ledger.owner.lastSeen, status, action: nextAction(contract, ledger, root, pluginRoot) };
  } catch (e) {
    return { root, taskDir, running: false, owner: null, lastSeen: null, status: null, action: unreadable(root, e) };
  }
}

// How the human moves the run here. An owner seen recently makes a plain adopt refuse, so the line is the --force one at
// once, on the condition that the owner's session is closed: one round, not a refusal and a retype.
function adoptAdvice(root, lastSeen) {
  if (seenRecently(lastSeen)) return `If that session is closed, the human types ${humanCommand(root, "adopt --force")} to move the run here; if it is still working, leave the run to it.`;
  return `To move it here the human types ${humanCommand(root, "adopt")}.`;
}

// How long ago a time was, in the words a human reads: "just now", "3 minutes ago", "2 hours ago", "4 days ago".
function ago(time, now) {
  const minutes = Math.floor((now - Date.parse(time)) / 60_000);
  if (Number.isNaN(minutes)) return "at an unknown time";
  const say = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "just now";
  if (minutes < 60) return say(minutes, "minute");
  if (minutes < 48 * 60) return say(Math.floor(minutes / 60), "hour");
  return say(Math.floor(minutes / (24 * 60)), "day");
}

const named = (id) => (plainName(id) ? `${plainName(id)} (${id})` : id);

// What comes next, plainly: the action when --action asked for it, else what the run waits on.
function nextLine({ stage, stop, needsHuman, next }, action) {
  if (action) return action;
  if (stop) return "nothing runs until you act on the stop";
  if (needsHuman) return "nothing runs until you answer";
  if (stage?.status === "active") return "wait for the stage to finish";
  return next ? `${named(next.stage)}, ${stageRun(next.attempt)}` : "nothing left to run";
}

// pb status for a human at a terminal: a few labelled lines in place of the JSON a pipe gets.
export function statusText(status, { owner, lastSeen, now = Date.now(), action } = {}) {
  const { stage, stop, needsHuman } = status;
  const line = (label, text) => `${`${label}:`.padEnd(11)}${text}`;
  const lines = [line("Stage", stage?.name ? `${named(stage.name)}, ${stage.status || "not started"}, ${stageRun(stage.attempt)}` : "none yet")];
  lines.push(line("Owner", owner ? `session ${owner}, last seen ${ago(lastSeen, now)}` : "none"));
  if (stop) lines.push(line("Stopped", [plainName(stop.code), stop.reason && forYou(stop.reason)].filter(Boolean).join(": ") || "yes"));
  if (needsHuman?.gate) lines.push(line("Needs you", named(needsHuman.gate)));
  lines.push(line("Next", nextLine(status, action)));
  return lines.join("\n");
}

// What SessionStart and the compact hook inject.
export function runReport({ root, owner, lastSeen, status, action }, sessionId) {
  const lines = [`A Pairing Buddy run is open at ${root}.`];
  if (owner && sessionId && owner !== sessionId) lines.push(`The run belongs to session ${owner}, last seen ${lastSeen}; this session must not drive it. ${adoptAdvice(root, lastSeen)}`);
  if (status !== null) lines.push(`pb status: ${JSON.stringify(status)}`);
  lines.push(`Next action: ${action ?? "No task is open."}`);
  return lines.join("\n");
}
