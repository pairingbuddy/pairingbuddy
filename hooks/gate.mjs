#!/usr/bin/env node
// Gate: PreToolUse enforcement of the stage graph. With no run state it allows everything silently.
// An allow prints nothing; a deny exits 0 with the JSON form on stdout.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, updateLedger } from "../shared-node/ledger.mjs";
import { graphFor, isStageActive, isStageUnstarted, loadStages, nextAttempt, nextStage, pipelineAgents, startLeaseSecondsLeft } from "../shared-node/stages.mjs";

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const PREFIX = "pairingbuddy:";

const workflowName = (stage) => `${PREFIX}${stage}`;
const bundlePath = (stage) => join(PLUGIN_ROOT, "workflows", `${stage}.js`);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// Thrown inside updateLedger so that a deny leaves the ledger unwritten.
class Denied extends Error {}

function runLedgerPath(cwd) {
  let top;
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
  const path = join(top, ".pairingbuddy", "run", "task", "ledger.json");
  return existsSync(path) ? path : null;
}

function readTextOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// Every script the call supplies, with null for a scriptPath that cannot be read.
function suppliedScripts(toolInput, cwd) {
  const scripts = [];
  if (typeof toolInput.script === "string") scripts.push(toolInput.script);
  if (typeof toolInput.scriptPath === "string") scripts.push(readTextOrNull(resolve(cwd, toolInput.scriptPath)));
  return scripts;
}

function matchesBundle(stage, scripts) {
  const bundle = readTextOrNull(bundlePath(stage));
  return bundle !== null && scripts.every((script) => script !== null && sha256(script) === sha256(bundle));
}

function calledStage(toolInput) {
  const { name } = toolInput;
  return typeof name === "string" && name.startsWith(PREFIX) ? name.slice(PREFIX.length) : undefined;
}

// A stage reached any way but by its pairingbuddy: name. The tap would not recognise it, so it would run with no runId.
function misnamedStage(toolInput, scripts, graph) {
  if (graph.stages.includes(toolInput.name)) return toolInput.name;
  if (scripts.length === 0) return undefined;
  return graph.stages.find((stage) => matchesBundle(stage, scripts));
}

function argsDenial(called, attempt, { args }) {
  if (args?.attempt !== attempt) return `Wrong attempt for ${called}: got ${JSON.stringify(args?.attempt)}. Use attempt ${attempt}.`;
  if (args?.pluginRoot !== PLUGIN_ROOT) return `Wrong pluginRoot for ${called}: got ${JSON.stringify(args?.pluginRoot)}. Use pluginRoot ${PLUGIN_ROOT}.`;
  return null;
}

function activeDenial(stage, ledger) {
  const { name, attempt } = ledger.stage;
  const called = workflowName(stage);
  const wait = `Stage ${name} is active at attempt ${attempt}. Wait for it to finish before starting ${called}.`;
  if (!isStageUnstarted(ledger)) return wait;
  const seconds = startLeaseSecondsLeft(ledger.stage, Date.now());
  if (seconds > 0) return `${wait} It has no recorded run yet: ${seconds} seconds remain on its start lease.`;
  if (name === stage) return null;
  return `Stage ${name} is active at attempt ${attempt} with no recorded run, so it may never have started. Restart ${workflowName(name)} at attempt ${attempt} before starting ${called}.`;
}

function stageDenial(stage, ledger, graph, toolInput, scripts) {
  const called = workflowName(stage);
  if (isStageActive(ledger)) {
    const activeProblem = activeDenial(stage, ledger);
    if (activeProblem) return activeProblem;
  }
  const next = nextStage(graph, ledger);
  if (next === undefined) return `Stage order: ${called} cannot start now. All stages for ${graph.taskType} are done.`;
  if (stage !== next) return `Stage order: ${called} cannot start now. The next stage is ${workflowName(next)}.`;
  if (!existsSync(bundlePath(stage))) return `Cannot start ${called}: its built bundle ${bundlePath(stage)} is missing.`;
  const argsProblem = argsDenial(called, nextAttempt(ledger, stage), toolInput);
  if (argsProblem) return argsProblem;
  if (scripts.length > 0 && !matchesBundle(stage, scripts)) {
    return `Script for ${called} does not match the built bundle ${bundlePath(stage)}. Call ${called} by name with no script.`;
  }
  return null;
}

function startStage(ledgerPath, stage, graph, toolInput, scripts) {
  updateLedger(ledgerPath, (ledger) => {
    const reason = stageDenial(stage, ledger, graph, toolInput, scripts);
    if (reason) throw new Denied(reason);
    return { ...ledger, stage: { name: stage, status: "active", runId: null, attempt: toolInput.args.attempt, startedAt: new Date().toISOString() } };
  });
}

function runPosition(ledger, graph) {
  if (isStageActive(ledger)) return `Stage ${ledger.stage.name} is active at attempt ${ledger.stage.attempt}.`;
  const next = nextStage(graph, ledger);
  if (next === undefined) return `All stages for ${graph.taskType} are done.`;
  return `The next stage is ${workflowName(next)}: call it by name.`;
}

function checkWorkflow(ledgerPath, { tool_input: toolInput, cwd }) {
  const ledger = readLedger(ledgerPath);
  const graph = graphFor(loadStages(PLUGIN_ROOT), ledger.taskType);
  const scripts = suppliedScripts(toolInput, cwd);
  const stage = calledStage(toolInput);
  if (stage !== undefined) {
    startStage(ledgerPath, stage, graph, toolInput, scripts);
    return;
  }
  const misnamed = misnamedStage(toolInput, scripts, graph);
  if (misnamed !== undefined) {
    throw new Denied(`Stage ${misnamed} cannot run under another name or none. Call ${workflowName(misnamed)} by name.`);
  }
  if (scripts.includes(null)) throw new Denied(`Script file ${toolInput.scriptPath} could not be read. ${runPosition(ledger, graph)}`);
  if (scripts.some((script) => script.includes(PREFIX))) {
    throw new Denied(`Inline script containing ${PREFIX} is denied. ${runPosition(ledger, graph)}`);
  }
}

function agentDenial(agent, ledger) {
  if (isStageActive(ledger)) {
    const { name } = ledger.stage;
    return `Direct Agent call for ${agent} is denied during stage ${name}. Start the workflow ${workflowName(name)} instead.`;
  }
  const graph = graphFor(loadStages(PLUGIN_ROOT), ledger.taskType);
  const next = nextStage(graph, ledger);
  const remedy = next === undefined ? `All stages for ${graph.taskType} are done.` : `Start the workflow ${workflowName(next)} instead.`;
  return `Direct Agent call for ${agent} is denied during this run. ${remedy}`;
}

function checkAgent(ledgerPath, { agent_id: agentId, tool_input: toolInput }) {
  const agent = toolInput.subagent_type;
  if (agentId !== undefined || typeof agent !== "string") return;
  const bare = agent.startsWith(PREFIX) ? agent.slice(PREFIX.length) : agent;
  if (!pipelineAgents(PLUGIN_ROOT).has(bare)) return;
  throw new Denied(agentDenial(agent, readLedger(ledgerPath)));
}

function deny(reason) {
  const hookSpecificOutput = { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason };
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

const CHECKS = { Workflow: checkWorkflow, Agent: checkAgent };

const payload = JSON.parse(readFileSync(0, "utf8"));
const ledgerPath = runLedgerPath(payload.cwd);
if (ledgerPath !== null && Object.hasOwn(CHECKS, payload.tool_name)) {
  try {
    CHECKS[payload.tool_name](ledgerPath, payload);
  } catch (e) {
    if (!(e instanceof Denied)) throw e;
    deny(e.message);
  }
}
