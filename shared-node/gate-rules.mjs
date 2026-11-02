// Gate rules: what hooks/gate.mjs enforces once it has found run state. Every problem is thrown:
// a Denied carries the reason meant for the caller, and any other error also denies.
// Node built-ins only.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { isCheckpointCall, isKey } from "./checkpoint.mjs";
import { answeredGate, blockingGate, gateQuestion, gatesFor, isGateQuestionCall } from "./gates.mjs";
import { LedgerShaMismatch, readLedger, updateLedger } from "./ledger.mjs";
import { checkboxes } from "./plan-boxes.mjs";
import { bindSession, sessionsDirectory } from "./run-root.mjs";
import { PLUGIN_ROOT, PREFIX, bundlePath, calledStage, matchesBundle, suppliedScripts, workflowName } from "./stage-calls.mjs";
import { graphFor, isStageActive, isStageUnstarted, loadStages, nextAttempt, nextStage, pipelineAgents, startLeaseSecondsLeft } from "./stages.mjs";
import { disguisesPb, pbInvocations, pbWithEnvironment } from "./shell-calls.mjs";
import { shellWord } from "./shell-word.mjs";
import { VERB_CLASSES, classOf, humanCommand, matchVerb, shaMismatchRemedy } from "./verbs.mjs";

const EXPECTED_FIELDS = ["session_id", "cwd", "tool_name", "permission_mode"];
const AGENT_PAIR = ["agent_id", "agent_type"];
const PROTECTED_CONFIGS = ["test-config.json", "git-config.json"];
const SETTINGS_FILES = ["settings.json", "settings.local.json"];
const GATE_HEADER_START = "PB gate:";
const RUNNER_AGENT = `${PREFIX}runner`;
const PB_COMMAND = `node ${shellWord(join(PLUGIN_ROOT, "cli", "pb.mjs"))}`;
const RUNNER_COMMANDS = [...VERB_CLASSES.runner, "test --full"].map((args) => `${PB_COMMAND} ${args}`);
const CHECKPOINT_START = `${PB_COMMAND} checkpoint --step `;
const ARTIFACT_CHECK_START = `${PB_COMMAND} artifact check `;
const AUTO_ALLOW_REASON = "Runner CLI command, auto-allowed by the Pairing Buddy gate.";
const SHELL_QUOTING = /\\\n|\$(?=['"])|['"\\]/g;
const PB_CALL = /(?<![\w.-])pb(?:\.mjs)?(?=\s+([\w.-]+)(?:\s+([\w.-]+))?)/g;
const POLICY_ENV = "PAIRINGBUDDY_GATE_POLICY";
const VERB_OWNERS = { runner: "the runner agent", main: "the main context" };

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

// Any .claude/ counts, the user's own included: each one's settings can set a hook's environment. A file that does
// not exist yet keeps the letter case it was asked for, which a case-insensitive filesystem ignores.
const isClaudeSettings = (path) => basename(dirname(path)).toLowerCase() === ".claude" && SETTINGS_FILES.includes(basename(path).toLowerCase());

function assertNotProtected(root, targets, canonicalPath) {
  const stateDir = join(root, ".pairingbuddy");
  const runDir = join(stateDir, "run");
  for (const target of targets) {
    if (isWithin(target, runDir)) throw new Denied(`${target} is inside .pairingbuddy/run, which is denied during a run.`);
    const config = PROTECTED_CONFIGS.find((name) => target === join(stateDir, name));
    if (config !== undefined) throw new Denied(`${config} cannot change during a run: ${target}.`);
    if (isClaudeSettings(target)) throw new Denied(`.claude/settings files can set the gate policy, so they cannot change during a run: ${target}.`);
    if (isWithin(target, canonicalPath(sessionsDirectory()))) throw new Denied(`${target} binds a session to its run, which is denied during a run.`);
  }
}

// ---------- plan checkboxes ----------

// Drops the boxes both sides share, so a moved line is no change. A title still on both sides then has a different
// tick, since the title is what names a task (D12). What is left pairs up in order, which lets a relabelled box
// keep its state; a box with no partner was deleted, or added if the new side has it.
function changesCheckbox(oldText, newText) {
  const added = checkboxes(newText);
  const removed = checkboxes(oldText).filter(({ ticked, label }) => {
    const index = added.findIndex((box) => box.ticked === ticked && box.label === label);
    if (index === -1) return true;
    added.splice(index, 1);
    return false;
  });
  if (removed.some(({ label }) => added.some((box) => box.label === label))) return true;
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

// ---------- gate policy ----------

// The env var is read here and never by the CLI, because a Bash call's environment does not reach a hook. Claude's
// settings files do set it, so the Write tools cannot touch them during a run. Section 8 accepts a Bash edit of one.
function observedPolicy({ permission_mode: mode }) {
  return process.env[POLICY_ENV] === "auto" ? { mode: "auto", source: POLICY_ENV } : { mode, source: "permission_mode" };
}

const speaksForRun = ({ owner }, { agent_id: agentId, session_id: sessionId }) =>
  agentId === undefined && (owner.sessionId === null || owner.sessionId === sessionId);

function withPolicy(ledger, payload) {
  const policy = observedPolicy(payload);
  const unchanged = policy.mode === ledger.policy.mode && policy.source === ledger.policy.source;
  return unchanged || !speaksForRun(ledger, payload) ? ledger : { ...ledger, policy };
}

function withOwner(ledger, { agent_id: agentId, session_id: sessionId }) {
  if (agentId !== undefined || ledger.owner.sessionId !== null) return ledger;
  return { ...ledger, owner: { sessionId, lastSeen: new Date().toISOString() } };
}

const withSession = (ledger, payload) => withPolicy(withOwner(ledger, payload), payload);

// Reads first, so that a call with nothing new costs no write.
function recordSession(ledgerPath, ledger, payload) {
  if (withSession(ledger, payload) !== ledger) updateLedger(ledgerPath, (current) => withSession(current, payload));
}

function readableLedger(ledgerPath) {
  try {
    return existsSync(ledgerPath) ? readLedger(ledgerPath) : null;
  } catch {
    return null;
  }
}

const invokesGateEval = ({ tool_name: tool, tool_input: toolInput }) => tool === "Bash" && pbInvocations(toolInput.command).some((words) => matchVerb(words) === "gate eval");

// A ledger problem must not take these tools away from the recovery route, and the CLI refuses a broken ledger with
// its own error. A failed write only matters to gate eval, which would decide on the mode this call failed to record.
function recordSessionIfPossible(ledgerPath, payload) {
  const ledger = readableLedger(ledgerPath);
  if (ledger === null) return;
  try {
    recordSession(ledgerPath, ledger, payload);
  } catch (e) {
    if (invokesGateEval(payload)) throw new Denied(`The gate policy could not be recorded, so pb gate eval would decide on a stale mode. Try again: ${e.message}`);
  }
}

// ---------- Workflow ----------

// A stage reached any way but by its pairingbuddy: name. The tap would not recognise it, so it would run with no runId.
function misnamedStage(toolInput, scripts, graph) {
  if (graph.stages.includes(toolInput.name)) return toolInput.name;
  if (scripts.length === 0) return undefined;
  return graph.stages.find((stage) => matchesBundle(stage, scripts));
}

// What the stage's own script refuses. It would refuse after this gate marked it active, stranding it, so it stops here.
const isMissing = (value) => value === undefined || value === null || value === "";

function argsDenial(called, attempt, { args }) {
  if (args?.attempt !== attempt) return `Wrong attempt for ${called}: got ${JSON.stringify(args?.attempt)}. Use attempt ${attempt}.`;
  if (args?.pluginRoot !== PLUGIN_ROOT) return `Wrong pluginRoot for ${called}: got ${JSON.stringify(args?.pluginRoot)}. Use pluginRoot ${PLUGIN_ROOT}.`;
  if (isMissing(args?.task)) return `Missing task for ${called}: got ${JSON.stringify(args?.task)}. Pass the task as args.task, as {"description":"<this task>"}.`;
  return null;
}

function activeDenial(stage, ledger) {
  const { name, attempt } = ledger.stage;
  const called = workflowName(stage);
  const wait = `Stage ${name} is active at attempt ${attempt}. Wait for it to finish before starting ${called}. A stranded stage is cleared by the human running pb stage fail.`;
  if (!isStageUnstarted(ledger)) return wait;
  const seconds = startLeaseSecondsLeft(ledger.stage, Date.now());
  if (seconds > 0) return `${wait} It has no recorded run yet: ${seconds} seconds remain on its start lease.`;
  if (name === stage) return null;
  return `Stage ${name} is active at attempt ${attempt} with no recorded run, so it may never have started. Restart ${workflowName(name)} at attempt ${attempt} before starting ${called}.`;
}

// The real next step when a human's answer has halted the run, or null.
function answeredStep(ledger, { gates, root }) {
  const gate = answeredGate(gates, ledger);
  if (gate === undefined) return null;
  const stopped = ledger.stop === null ? "" : ` The run stopped: ${ledger.stop.reason}.`;
  return `Gate ${gate.name} was answered ${gate.answer}.${stopped} Only the human can go on from here: ask them to type ${humanCommand(root, `approve ${gate.name}`)} at the prompt.`;
}

function stageDenial(stage, ledger, graph, toolInput, scripts) {
  const called = workflowName(stage);
  if (isStageActive(ledger)) {
    const activeProblem = activeDenial(stage, ledger);
    if (activeProblem) return activeProblem;
  }
  const halted = answeredStep(ledger, graph);
  if (halted) return `Stage order: ${called} cannot start now. ${halted}`;
  const next = nextStage(graph, ledger);
  if (next === undefined) return `Stage order: ${called} cannot start now. All stages for ${graph.taskType} are done.`;
  if (stage !== next) return `Stage order: ${called} cannot start now. The next stage is ${workflowName(next)}.`;
  const gate = blockingGate(graph.gates, ledger);
  if (gate !== undefined) return `Stage order: ${called} cannot start now. Gate ${gate.name} has not passed: run pb gate eval, and a human must approve it if it asks.`;
  if (!existsSync(bundlePath(stage))) return `Cannot start ${called}: its built bundle ${bundlePath(stage)} is missing.`;
  const argsProblem = argsDenial(called, nextAttempt(ledger, stage), toolInput);
  if (argsProblem) return argsProblem;
  if (scripts.length > 0 && !matchesBundle(stage, scripts)) {
    return `Script for ${called} does not match the built bundle ${bundlePath(stage)}. Call ${called} by name with no script.`;
  }
  return null;
}

function startStage(ledgerPath, stage, graph, payload, scripts) {
  const { tool_input: toolInput } = payload;
  updateLedger(ledgerPath, (ledger) => {
    const reason = stageDenial(stage, ledger, graph, toolInput, scripts);
    if (reason) throw new Denied(reason);
    return { ...withSession(ledger, payload), stage: { name: stage, status: "active", runId: null, attempt: toolInput.args.attempt, startedAt: new Date().toISOString() } };
  });
}

function runPosition(ledger, graph) {
  if (isStageActive(ledger)) return `Stage ${ledger.stage.name} is active at attempt ${ledger.stage.attempt}.`;
  const halted = answeredStep(ledger, graph);
  if (halted) return halted;
  const next = nextStage(graph, ledger);
  if (next === undefined) return `All stages for ${graph.taskType} are done.`;
  return `The next stage is ${workflowName(next)}: call it by name.`;
}

function checkWorkflow({ ledgerPath, ledger, graph, payload }) {
  const { tool_input: toolInput, cwd } = payload;
  const scripts = suppliedScripts(toolInput, cwd);
  const stage = calledStage(toolInput);
  if (stage !== undefined) {
    startStage(ledgerPath, stage, graph, payload, scripts);
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
  return `Direct Agent call for ${agent} is denied during this run. ${answeredStep(ledger, graph) ?? remedy}`;
}

function checkAgent({ ledger, graph, payload: { agent_id: agentId, tool_input: toolInput } }) {
  const agent = toolInput.subagent_type;
  if (agentId !== undefined || typeof agent !== "string") return;
  const bare = agent.startsWith(PREFIX) ? agent.slice(PREFIX.length) : agent;
  if (!pipelineAgents(PLUGIN_ROOT).has(bare)) return;
  throw new Denied(agentDenial(agent, ledger, graph));
}

// ---------- Bash ----------

// The words after each pb in the text, wherever it sits, a mere mention included: conservative for the pb human rule.
// With the quoting gone a quoted word reads like a plain one. This sees only the text: a script file hides its calls.
function pbMentions(command) {
  return [...command.replace(SHELL_QUOTING, "").matchAll(PB_CALL)].map(([, verb, argument]) => [verb, argument].filter(Boolean));
}

const callerClass = (agentType) => {
  if (agentType === undefined) return "main";
  return agentType === RUNNER_AGENT ? "runner" : "subagent";
};

function checkBash({ tool_input: toolInput, agent_type: agentType }) {
  const command = toolInput?.command;
  if (!isFilledString(command)) throw new Denied("Bash call has no usable command.");
  if (pbMentions(command).some(([word]) => word === "human")) {
    throw new Denied("pb human commands are for the human alone. Ask the human to type the command, with its leading !, at the prompt: a pasted ! line reaches the model.");
  }
  const caller = callerClass(agentType);
  const wrongVerb = pbInvocations(command).map(matchVerb).find((verb) => verb !== undefined && classOf(verb) !== caller);
  if (wrongVerb !== undefined) {
    throw new Denied(`pb ${wrongVerb} belongs to ${VERB_OWNERS[classOf(wrongVerb)]}, so this caller cannot run it.`);
  }
  if (disguisesPb(command)) {
    throw new Denied("pb takes literal words: nothing a shell expands ($, a backtick, {, a backslash, ?, *, [) may follow its name, xargs may not feed it, and pb.mjs takes no other letter case.");
  }
  if (pbWithEnvironment(command)) {
    throw new Denied("pb takes no environment of its own: an assignment before it, or the env command, could change what its tests run or skip a commit hook. Run it exactly as given.");
  }
}

// ---------- AskUserQuestion ----------

const asksGate = (gate, question) => question?.question === gateQuestion(gate).question || (typeof question?.header === "string" && question.header.startsWith(GATE_HEADER_START));

function checkQuestion({ tool_input: toolInput }, ledgerPath) {
  if (toolInput?.answers !== undefined) throw new Denied("AskUserQuestion cannot carry its own answers: only a human answers a question.");
  const gate = readableLedger(ledgerPath)?.needsHuman?.gate;
  const questions = toolInput?.questions;
  if (gate === undefined || !Array.isArray(questions) || !questions.some((question) => asksGate(gate, question))) return;
  if (!isGateQuestionCall(gate, questions)) {
    throw new Denied(`Gate ${gate} takes one question, exactly as pb gate eval gave it, with nothing else in the call: ${JSON.stringify(gateQuestion(gate))}`);
  }
}

// One space between words, and a key cannot hold shell syntax, so an exact match on the shape leaves nothing to expand.
function isCheckpointCommand(command) {
  if (!command.startsWith(CHECKPOINT_START)) return false;
  const words = command.slice(CHECKPOINT_START.length).split(" ");
  return words.length === 3 && words[1] === "--from" && isCheckpointCall(words[0], words[2]);
}

const isArtifactCheckCommand = (command) => command.startsWith(ARTIFACT_CHECK_START) && isKey(command.slice(ARTIFACT_CHECK_START.length));

const isRunnerCommand = ({ tool_name: tool, agent_type: agentType, tool_input: toolInput }) =>
  tool === "Bash" && agentType === RUNNER_AGENT && (RUNNER_COMMANDS.includes(toolInput.command) || isCheckpointCommand(toolInput.command) || isArtifactCheckCommand(toolInput.command));

// ---------- entry ----------

const LEDGER_CHECKS = {
  Workflow: checkWorkflow,
  Agent: checkAgent,
  Write: (context) => checkPlanChange(context, writtenPlan),
  Edit: (context) => checkPlanChange(context, editedPlan),
};

const NO_LEDGER_CHECKS = { Bash: checkBash, AskUserQuestion: checkQuestion };

function checkLedgerRun(root, { payload, targets, canonicalPath }) {
  const ledgerPath = join(root, ".pairingbuddy", "run", "task", "ledger.json");
  // Before the ledger: a unit run has none, and a ledger problem must not take these from the recovery route.
  if (Object.hasOwn(NO_LEDGER_CHECKS, payload.tool_name)) {
    NO_LEDGER_CHECKS[payload.tool_name](payload, ledgerPath);
    recordSessionIfPossible(ledgerPath, payload);
    return;
  }
  if (!existsSync(ledgerPath)) return;
  const ledger = readLedger(ledgerPath);
  const contract = loadStages(PLUGIN_ROOT);
  const graph = { ...graphFor(contract, ledger.taskType), gates: gatesFor(contract, ledger.taskType), root };
  if (Object.hasOwn(LEDGER_CHECKS, payload.tool_name)) {
    LEDGER_CHECKS[payload.tool_name]({ root, ledgerPath, ledger, graph, payload, targets, canonicalPath });
  }
  // A Workflow records with its stage start, and any other workflow leaves the run untouched.
  if (payload.tool_name !== "Workflow") recordSession(ledgerPath, ledger, payload);
}

function checkRun(root, context) {
  assertNotProtected(root, context.targets, context.canonicalPath);
  try {
    checkLedgerRun(root, context);
  } catch (e) {
    if (e instanceof LedgerShaMismatch) throw new Denied(shaMismatchRemedy(e.message, root));
    throw e;
  }
}

// Returns the reason for an explicit allow, or null to add no decision. sessionRoot is the run the session's own
// position gave, cwd or pointer; a run reached only through a target path does not bind it.
export function checkCall({ runRoots, sessionRoot, payload, targets, canonicalPath }) {
  assertNoDrift(payload);
  if (sessionRoot !== null && payload.agent_id === undefined) bindSession(payload.session_id, sessionRoot);
  for (const root of runRoots) checkRun(root, { payload, targets, canonicalPath });
  return isRunnerCommand(payload) ? AUTO_ALLOW_REASON : null;
}
