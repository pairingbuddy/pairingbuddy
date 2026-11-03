// Stage graph: reads contracts/stages.json and answers what a run may start next.
// Node built-ins only.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkpointSteps } from "./checkpoint.mjs";
import { parseKey } from "./keys.mjs";

// How long a stage marked active with no recorded run holds off another start.
export const START_LEASE_SECONDS = 120;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const EVIDENCE_TESTS = ["full", "selected"];
const EVIDENCE_ROLE = /^[a-z0-9_-]{1,64}$/;

// artifact:<role>, checkpoint:<step> or tests:<run>. Each is checked by stage finish, at the attempt it finishes.
function isEvidence(entry) {
  if (typeof entry !== "string") return false;
  const [kind, name, ...rest] = entry.split(":");
  if (rest.length > 0) return false;
  if (kind === "artifact") return EVIDENCE_ROLE.test(name ?? "");
  if (kind === "checkpoint") return checkpointSteps().includes(name);
  return kind === "tests" && EVIDENCE_TESTS.includes(name);
}

function nodeProblems(taskType, graph, classes) {
  if (!isObject(graph)) return [`${taskType}: has no nodes`];
  const problems = [];
  const seen = new Set();
  const gates = isObject(graph.gates) ? graph.gates : {};
  for (const node of Array.isArray(graph.nodes) ? graph.nodes : []) {
    if (!isObject(node)) {
      problems.push(`${taskType}: a node is not an object`);
      continue;
    }
    if (seen.has(node.name)) problems.push(`${taskType}: duplicate node ${node.name}`);
    seen.add(node.name);
    if (typeof node.name !== "string" || node.name === "") problems.push(`${taskType}: a node has no name`);
    if (!Array.isArray(node.evidence)) problems.push(`${taskType}: node ${node.name} has no evidence list`);
    else for (const entry of node.evidence.filter((item) => !isEvidence(item))) problems.push(`${taskType}: node ${node.name} has unknown evidence ${JSON.stringify(entry)}`);
    if (node.gate !== null && !Object.hasOwn(gates, node.gate)) problems.push(`${taskType}: node ${node.name} names unknown gate ${node.gate}`);
  }
  if (seen.size === 0) problems.push(`${taskType}: has no nodes`);
  for (const [gate, value] of Object.entries(gates)) {
    if (!isObject(value)) problems.push(`${taskType}: gate ${gate} is not an object`);
    else if (!Object.hasOwn(classes, value.class)) problems.push(`${taskType}: gate ${gate} has unknown gate class ${value.class}`);
  }
  return problems;
}

const isNameList = (list) => Array.isArray(list) && list.every((name) => typeof name === "string" && name !== "");

export function validateStages(contract) {
  if (!isObject(contract) || !isObject(contract.taskTypes) || !isObject(contract.gateClasses)) {
    return ["the contract needs taskTypes and gateClasses objects"];
  }
  const problems = Object.entries(contract.taskTypes).flatMap(([type, graph]) => nodeProblems(type, graph, contract.gateClasses));
  if (!Object.hasOwn(contract.taskTypes, contract.defaultTaskType)) problems.push(`unknown default task type ${contract.defaultTaskType}`);
  if (!isNameList(contract.migratedTypes)) problems.push("migratedTypes must be a list of task types");
  else for (const type of contract.migratedTypes.filter((name) => !Object.hasOwn(contract.taskTypes, name))) problems.push(`migrated type ${type} has no stage graph`);
  if (!isNameList(contract.newPathAgents)) problems.push("newPathAgents must be a list of agent names");
  return problems;
}

export function loadStages(pluginRoot) {
  const path = join(pluginRoot, "contracts", "stages.json");
  const contract = JSON.parse(readFileSync(path, "utf8"));
  const problems = validateStages(contract);
  if (problems.length > 0) throw new Error(`${path} is invalid: ${problems.join("; ")}`);
  return contract;
}

// A run opened before classification has a null taskType and takes the contract's default graph.
export function graphFor(contract, taskType) {
  const name = taskType ?? contract.defaultTaskType;
  if (!Object.hasOwn(contract.taskTypes, name)) throw new Error(`no stage graph for task type ${name}`);
  return { taskType: name, stages: contract.taskTypes[name].nodes.map((node) => node.name) };
}

// Every stage of every task type.
export const allStages = (contract) => Object.values(contract.taskTypes).flatMap((graph) => graph.nodes.map((node) => node.name));

export function evidenceFor(contract, taskType, stage) {
  const { taskType: name } = graphFor(contract, taskType);
  const node = contract.taskTypes[name].nodes.find((candidate) => candidate.name === stage);
  if (node === undefined) throw new Error(`stage ${stage} is not in the ${name} graph`);
  return node.evidence;
}

export const isStageActive = (ledger) => ledger.stage.status === "active";

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

export function pipelineAgents(pluginRoot) {
  const names = new Set();
  let inAgents = false;
  for (const line of readFileSync(join(pluginRoot, "contracts", "agent-config.yaml"), "utf8").split("\n")) {
    if (/^\S/.test(line)) inAgents = /^agents:\s*(#.*)?$/.test(line);
    else if (inAgents) {
      const match = /^ {2}([^\s:#][^:]*):/.exec(line);
      if (match) names.add(match[1].trim());
    }
  }
  return names;
}
