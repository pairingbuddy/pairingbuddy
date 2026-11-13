// Stage graph: validates and loads contracts/stages.json and answers what a run may start next.
// The pure graph functions live in stage-graph.mjs and are re-exported here.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkpointSteps } from "./checkpoint.mjs";

export * from "./stage-graph.mjs";

export const TASK_TYPES = ["config_change", "bug_fix", "new_feature", "refactoring", "spike"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const EVIDENCE_TESTS = ["full", "selected", "cycle"];
const EVIDENCE_ROLE = /^[a-z0-9_-]{1,64}$/;

// artifact:<role>, checkpoint:<step> or tests:<run>. Each is checked by stage finish, at the attempt it finishes, except
// tests:cycle: per-test evidence outlives the attempt that made it, because a re-run continues from it.
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

// A stage's own cap sits under the whole-workflow cap.
const stageCapProblems = ({ stageMaxAgents = {}, maxAgents }) =>
  Object.entries(stageMaxAgents).filter(([, cap]) => !(Number.isInteger(cap) && cap > 0 && cap <= maxAgents)).map(([stage]) => `stageMaxAgents for ${stage} must be a positive integer up to maxAgents`);

export function validateStages(contract) {
  if (!isObject(contract) || !isObject(contract.taskTypes) || !isObject(contract.gateClasses)) {
    return ["the contract needs taskTypes and gateClasses objects"];
  }
  const problems = Object.entries(contract.taskTypes).flatMap(([type, graph]) => nodeProblems(type, graph, contract.gateClasses));
  if (!Object.hasOwn(contract.taskTypes, contract.defaultTaskType)) problems.push(`unknown default task type ${contract.defaultTaskType}`);
  if (!isNameList(contract.migratedTypes)) problems.push("migratedTypes must be a list of task types");
  else for (const type of contract.migratedTypes.filter((name) => !Object.hasOwn(contract.taskTypes, name))) problems.push(`migrated type ${type} has no stage graph`);
  if (!isNameList(contract.newPathAgents)) problems.push("newPathAgents must be a list of agent names");
  return [...problems, ...stageCapProblems(contract)];
}

export function loadStages(pluginRoot) {
  const path = join(pluginRoot, "contracts", "stages.json");
  const contract = JSON.parse(readFileSync(path, "utf8"));
  const problems = validateStages(contract);
  if (problems.length > 0) throw new Error(`${path} is invalid: ${problems.join("; ")}`);
  return contract;
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
