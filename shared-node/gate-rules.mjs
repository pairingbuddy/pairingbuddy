// Gate rules: what hooks/gate.mjs enforces once it has found run state. Every problem is thrown:
// a Denied carries the reason meant for the caller, and any other error also denies.
// Node built-ins only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, updateLedger } from "./ledger.mjs";
import { graphFor, isStageActive, isStageUnstarted, loadStages, nextAttempt, nextStage, pipelineAgents, startLeaseSecondsLeft } from "./stages.mjs";

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const PREFIX = "pairingbuddy:";
const EXPECTED_FIELDS = ["session_id", "cwd", "tool_name", "permission_mode"];
const AGENT_PAIR = ["agent_id", "agent_type"];
const PROTECTED_CONFIGS = ["test-config.json", "git-config.json"];
const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\](.*)$/gm;

const workflowName = (stage) => `${PREFIX}${stage}`;
const bundlePath = (stage) => join(PLUGIN_ROOT, "workflows", `${stage}.js`);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// Thrown inside updateLedger so that a deny leaves the ledger unwritten.
class Denied extends Error {
  gateDenial = true;
}

// ---------- platform drift ----------

const isFilledString = (value) => typeof value === "string" && value !== "";

function assertNoDrift(payload) {
  if (payload === null) throw new Denied("The hook payload is not a JSON object.");
  const missing = EXPECTED_FIELDS.filter((field) => !isFilledString(payload[field]));
  if (missing.length > 0) throw new Denied(`Platform drift: the hook payload has no ${missing.join(", ")}.`);
  const keys = Object.keys(payload).filter((key) => key.toLowerCase().includes("agent"));
  const unknown = keys.filter((key) => !AGENT_PAIR.includes(key));
  if (unknown.length > 0) throw new Denied(`Platform drift: unrecognised hook payload key ${unknown.join(", ")}.`);
  if (keys.length > 0 && !AGENT_PAIR.every((key) => isFilledString(payload[key]))) {
    throw new Denied(`Platform drift: ${AGENT_PAIR.join(" and ")} must appear together.`);
  }
}

// ---------- protected paths ----------

const isWithin = (path, dir) => path === dir || path.startsWith(`${dir}${sep}`);

function assertNotProtected(root, targets) {
  const stateDir = join(root, ".pairingbuddy");
  const runDir = join(stateDir, "run");
  for (const target of targets) {
    if (isWithin(target, runDir)) throw new Denied(`${target} is inside .pairingbuddy/run, which is denied during a run.`);
    const config = PROTECTED_CONFIGS.find((name) => target === join(stateDir, name));
    if (config !== undefined) throw new Denied(`${config} cannot change during a run: ${target}.`);
  }
}

// ---------- plan checkboxes ----------

const checkboxes = (text) => [...text.matchAll(CHECKBOX)].map(([, mark, label]) => ({ ticked: mark !== " ", label: label.trim() }));

// Drops the boxes both sides share, so a moved line is no change. What is left pairs up in order, which
// lets a relabelled box keep its state; a box with no partner was deleted, or added if the new side has it.
function changesCheckbox(oldText, newText) {
  const added = checkboxes(newText);
  const removed = checkboxes(oldText).filter(({ ticked, label }) => {
    const index = added.findIndex((box) => box.ticked === ticked && box.label === label);
    if (index === -1) return true;
    added.splice(index, 1);
    return false;
  });
  return removed.some(({ ticked }, i) => added[i]?.ticked !== ticked) || added.slice(removed.length).some((box) => box.ticked);
}

function readPlanOrEmpty(path) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function editedPlan({ file_path: path, old_string: oldString, new_string: newString, replace_all: replaceAll }, oldText) {
  if (typeof oldString !== "string" || typeof newString !== "string") throw new Denied(`Edit of the plan ${path} has no old_string and new_string to compare.`);
  if (!oldText.includes(oldString)) throw new Denied(`Edit of the plan ${path}: old_string is not in the file, so its checkbox changes cannot be compared.`);
  return replaceAll ? oldText.split(oldString).join(newString) : oldText.replace(oldString, () => newString);
}

function writtenPlan({ file_path: path, content }) {
  if (typeof content !== "string") throw new Denied(`Write of the plan ${path} has no content to compare.`);
  return content;
}

function checkPlanChange({ root, ledger, targets, canonicalPath, payload }, planAfter) {
  if (ledger.plan.path === "") return;
  const plan = canonicalPath(resolve(root, ledger.plan.path));
  if (!targets.includes(plan)) return;
  const oldText = readPlanOrEmpty(plan);
  if (changesCheckbox(oldText, planAfter(payload.tool_input, oldText))) {
    throw new Denied(`Plan checkbox changes are denied during a run: ${ledger.plan.path}. Only pb task end sets a checkbox.`);
  }
}

// ---------- Workflow ----------

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

function checkWorkflow({ ledgerPath, ledger, graph, payload: { tool_input: toolInput, cwd } }) {
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

// ---------- Agent ----------

function agentDenial(agent, ledger, graph) {
  if (isStageActive(ledger)) {
    const { name } = ledger.stage;
    return `Direct Agent call for ${agent} is denied during stage ${name}. Start the workflow ${workflowName(name)} instead.`;
  }
  const next = nextStage(graph, ledger);
  const remedy = next === undefined ? `All stages for ${graph.taskType} are done.` : `Start the workflow ${workflowName(next)} instead.`;
  return `Direct Agent call for ${agent} is denied during this run. ${remedy}`;
}

function checkAgent({ ledger, graph, payload: { agent_id: agentId, tool_input: toolInput } }) {
  const agent = toolInput.subagent_type;
  if (agentId !== undefined || typeof agent !== "string") return;
  const bare = agent.startsWith(PREFIX) ? agent.slice(PREFIX.length) : agent;
  if (!pipelineAgents(PLUGIN_ROOT).has(bare)) return;
  throw new Denied(agentDenial(agent, ledger, graph));
}

// ---------- entry ----------

const LEDGER_CHECKS = {
  Workflow: checkWorkflow,
  Agent: checkAgent,
  Write: (context) => checkPlanChange(context, writtenPlan),
  Edit: (context) => checkPlanChange(context, editedPlan),
};

function checkRun(root, { payload, targets, canonicalPath }) {
  assertNotProtected(root, targets);
  const ledgerPath = join(root, ".pairingbuddy", "run", "task", "ledger.json");
  if (!existsSync(ledgerPath)) return;
  const ledger = readLedger(ledgerPath);
  const graph = graphFor(loadStages(PLUGIN_ROOT), ledger.taskType);
  if (Object.hasOwn(LEDGER_CHECKS, payload.tool_name)) {
    LEDGER_CHECKS[payload.tool_name]({ root, ledgerPath, ledger, graph, payload, targets, canonicalPath });
  }
}

export function checkCall({ runRoots, payload, targets, canonicalPath }) {
  assertNoDrift(payload);
  for (const root of runRoots) checkRun(root, { payload, targets, canonicalPath });
}
