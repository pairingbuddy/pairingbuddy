// What a Workflow or Agent call says about the stages: the names it gives and the scripts it carries. hooks/gate.mjs
// loads this for those calls with no run, so it stays clear of the rules module, which is what a run pays for.
// Node built-ins only, apart from the stage contract.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { allStages, loadStages } from "./stages.mjs";

export const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
export const PREFIX = "pairingbuddy:";

export const workflowName = (stage) => `${PREFIX}${stage}`;
export const bundlePath = (stage) => join(PLUGIN_ROOT, "workflows", `${stage}.js`);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function readTextOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// Every script the call supplies, with null for a scriptPath that cannot be read.
export function suppliedScripts(toolInput, cwd) {
  const scripts = [];
  if (typeof toolInput.script === "string") scripts.push(toolInput.script);
  if (typeof toolInput.scriptPath === "string") scripts.push(readTextOrNull(resolve(cwd, toolInput.scriptPath)));
  return scripts;
}

export function matchesBundle(stage, scripts) {
  const bundle = readTextOrNull(bundlePath(stage));
  return bundle !== null && scripts.every((script) => script !== null && sha256(script) === sha256(bundle));
}

const pluginName = (name) => (typeof name === "string" && name.startsWith(PREFIX) ? name.slice(PREFIX.length) : undefined);

export const calledStage = ({ name }) => pluginName(name);

const withoutTrailingSpace = (text) => text.replace(/[^\S\n]+$/gm, "").trimEnd();

// matchesBundle is what a run needs. This is what no run needs: trailing space changes no behaviour.
function copiesBundle(stage, script) {
  const bundle = readTextOrNull(bundlePath(stage));
  return bundle !== null && withoutTrailingSpace(script) === withoutTrailingSpace(bundle);
}

const NO_RUN_REMEDY = "Use /pairingbuddy:code, which opens the run.";
const stageNeedsRun = (stage) => `Stage ${stage} cannot start with no run open. ${NO_RUN_REMEDY}`;
const agentNeedsRun = (agent) => `Agent ${workflowName(agent)} runs only inside a stage, and no run is open. ${NO_RUN_REMEDY}`;

// Why a Workflow call with no run is denied, or null. It would start a stage by any name or none, or reach a stage or
// a new-path agent by a literal name. One script among the call's is enough, because which of two the tool runs is not
// the gate's to know. A name built from string fragments passes, which Section 8 accepts.
export function workflowDenial(toolInput, cwd) {
  const contract = loadStages(PLUGIN_ROOT);
  const stages = allStages(contract);
  const named = calledStage(toolInput) ?? toolInput.name;
  if (stages.includes(named)) return stageNeedsRun(named);
  const scripts = suppliedScripts(toolInput, cwd).filter((script) => script !== null);
  const isNamed = (name) => scripts.some((script) => script.includes(workflowName(name)));
  const stage = stages.find((candidate) => isNamed(candidate) || scripts.some((script) => copiesBundle(candidate, script)));
  if (stage !== undefined) return stageNeedsRun(stage);
  const agent = contract.newPathAgents.find(isNamed);
  return agent === undefined ? null : agentNeedsRun(agent);
}

// Why an Agent call with no run is denied, or null. Only the prefixed name reaches this plugin's agent: a project may
// have a runner of its own.
export function agentDenial({ subagent_type: agentType }) {
  const agent = pluginName(agentType);
  return loadStages(PLUGIN_ROOT).newPathAgents.includes(agent) ? agentNeedsRun(agent) : null;
}
