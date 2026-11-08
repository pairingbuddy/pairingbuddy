// The pure half of the stage graph: what a contract and a ledger say about the stages and what may start next.
// No node built-ins, so a mod can import it; reading and validating the contract stays in stages.mjs.
import { parseKey } from "./keys.mjs";
import { readLabel } from "./labels.mjs";

// How long a stage marked active with no recorded run holds off another start.
export const START_LEASE_SECONDS = 120;

// A run opened before classification has a null taskType and takes the contract's default graph.
export function graphFor(contract, taskType) {
  const name = taskType ?? contract.defaultTaskType;
  if (!Object.hasOwn(contract.taskTypes, name)) throw new Error(`no stage graph for task type ${name}`);
  return { taskType: name, stages: contract.taskTypes[name].nodes.map((node) => node.name) };
}

// The task type's stages from the contract, else only those the ledger has recorded (a type the contract does not know).
export function stageNamesFor(contract, ledger) {
  const known = Object.hasOwn(contract.taskTypes, ledger?.taskType ?? contract.defaultTaskType);
  return known ? graphFor(contract, ledger?.taskType).stages : (ledger?.stages ?? []).map((stage) => stage.name);
}

// Whether a run of this type has to name one test at RED and GREEN.
export function needsTestSelection(contract, taskType) {
  const { taskType: name } = graphFor(contract, taskType);
  return contract.taskTypes[name].nodes.some((node) => node.evidence.includes("tests:cycle"));
}

// Every stage of every task type.
export const allStages = (contract) => Object.values(contract.taskTypes).flatMap((graph) => graph.nodes.map((node) => node.name));

// The stages that close a task, whatever its type: a unit's tasks may be of different types.
export const safetyNetStages = (contract) => [...new Set(allStages(contract).filter((name) => /(^|-)safety-net$/.test(name)))];

export function evidenceFor(contract, taskType, stage) {
  const { taskType: name } = graphFor(contract, taskType);
  const node = contract.taskTypes[name].nodes.find((candidate) => candidate.name === stage);
  if (node === undefined) throw new Error(`stage ${stage} is not in the ${name} graph`);
  return node.evidence;
}

export const maxAgentsOf = ({ maxAgents, stageMaxAgents = {} }, stage) => (Object.hasOwn(stageMaxAgents, stage) ? stageMaxAgents[stage] : maxAgents);

// Tolerates a ledger that has no stage yet.
export const isStageActive = (ledger) => ledger?.stage?.status === "active";

// The status of a stage a human sent back. It is not done, so it is next again, and it is not active,
// so it re-runs at the following attempt.
export const REDO_STATUS = "redo";

// The status pb stage fail leaves. It is not done either, and its attempt is void from that moment.
export const FAILED_STATUS = "failed";

export const withStageStatus = (ledger, name, status) => ({
  ...ledger,
  stages: ledger.stages.map((stage) => (stage.name === name ? { ...stage, status } : stage)),
  stage: ledger.stage.name === name ? { ...ledger.stage, status } : ledger.stage,
});

// Active with no runId: the gate marked the stage, but no run was recorded. The start may have failed, so it can be retried.
export const isStageUnstarted = (ledger) => isStageActive(ledger) && ledger.stage.runId === null;

// Whole seconds left on an unstarted stage's start lease, 0 once it has expired. A startedAt that is
// missing, unparseable or in the future cannot hold a lease, so a run cannot wedge.
export function startLeaseSecondsLeft({ startedAt }, now) {
  const left = Math.ceil((Date.parse(startedAt ?? "") + START_LEASE_SECONDS * 1000 - now) / 1000);
  return left > 0 && left <= START_LEASE_SECONDS ? left : 0;
}

export function nextStage(graph, ledger) {
  const done = new Set(ledger.stages.filter((s) => s.status === "done").map((s) => s.name));
  return graph.stages.find((name) => !done.has(name));
}

// A stage that is still next but already holds an attempt failed, so it re-runs at the following one.
// An unstarted stage used nothing, so it keeps its attempt.
export function nextAttempt(ledger, stage) {
  if (ledger.stage.name !== stage) return 1;
  return isStageUnstarted(ledger) ? ledger.stage.attempt : ledger.stage.attempt + 1;
}

// What a file in artifacts/ is filed under, or null for a name that is no key.
export function returnFileKey(file) {
  try {
    return parseKey(file.replace(/\.json$/, ""));
  } catch {
    return null;
  }
}

// True for what a later attempt overtook, or an attempt that failed. The last attempt of a stage stands while the
// stage is active, done or sent back, since a human can undo a redo. A stage the ledger never ran voids nothing.
export function isVoidedAttempt(ledger, stage, attempt) {
  const current = ledger.stage.name === stage ? ledger.stage : undefined;
  const standing = Math.max(current?.attempt ?? 0, ...ledger.stages.filter(({ name }) => name === stage).map((entry) => entry.attempt ?? 0));
  return attempt < standing || (attempt === standing && current?.status === FAILED_STATUS);
}

// The agent the next spawn will be: with the stage active and no agent spawned yet, the first artifact:<agent> entry of the
// stage's evidence. Only spawns labelled with the active stage count; earlier stages' spawns are ignored.
// Once an agent has spawned in the stage the contract does not say what follows, so it is undefined.
export function nextAgent(contract, ledger, spawns) {
  if (!isStageActive(ledger) || spawns.some((spawn) => readLabel(spawn.name).stage === ledger.stage.name)) return undefined;
  try {
    const entry = evidenceFor(contract, ledger.taskType, ledger.stage.name).find((item) => item.startsWith("artifact:"));
    return entry?.slice("artifact:".length);
  } catch {
    return undefined;
  }
}
