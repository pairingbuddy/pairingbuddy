// What a Workflow call says about the stages: the name it gives and the scripts it carries. hooks/gate.mjs loads this
// for a Workflow call with no run, so it stays clear of the rules module, which is what a run pays for.
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

export function calledStage(toolInput) {
  const { name } = toolInput;
  return typeof name === "string" && name.startsWith(PREFIX) ? name.slice(PREFIX.length) : undefined;
}

// The stage a call with no run would start, by any name or none, or undefined. One bundle among the call's scripts is
// enough, because which of two the tool runs is not the gate's to know.
export function stageWithNoRun(toolInput, cwd) {
  const stages = allStages(loadStages(PLUGIN_ROOT));
  const named = calledStage(toolInput) ?? toolInput.name;
  if (stages.includes(named)) return named;
  const scripts = suppliedScripts(toolInput, cwd);
  return stages.find((stage) => scripts.some((script) => matchesBundle(stage, [script])));
}
