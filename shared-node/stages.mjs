// Stage graph: reads contracts/stages.json and answers what a run may start next.
// Node built-ins only.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// How long a stage marked active with no recorded run holds off another start.
export const START_LEASE_SECONDS = 120;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

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
    if (node.gate !== null && !Object.hasOwn(gates, node.gate)) problems.push(`${taskType}: node ${node.name} names unknown gate ${node.gate}`);
  }
  if (seen.size === 0) problems.push(`${taskType}: has no nodes`);
  for (const [gate, value] of Object.entries(gates)) {
    if (!isObject(value)) problems.push(`${taskType}: gate ${gate} is not an object`);
    else if (!Object.hasOwn(classes, value.class)) problems.push(`${taskType}: gate ${gate} has unknown gate class ${value.class}`);
  }
  return problems;
}

export function validateStages(contract) {
  if (!isObject(contract) || !isObject(contract.taskTypes) || !isObject(contract.gateClasses)) {
    return ["the contract needs taskTypes and gateClasses objects"];
  }
  const problems = Object.entries(contract.taskTypes).flatMap(([type, graph]) => nodeProblems(type, graph, contract.gateClasses));
  if (!Object.hasOwn(contract.taskTypes, contract.defaultTaskType)) problems.push(`unknown default task type ${contract.defaultTaskType}`);
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

export const isStageActive = (ledger) => ledger.stage.status === "active";

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
