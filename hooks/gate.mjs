#!/usr/bin/env node
// Gate: PreToolUse enforcement during a run, loaded by gate-boot.mjs. With no run state it allows everything silently,
// except a call that would start a stage of this plugin or reach an agent only a stage spawns: those have only ever run
// inside a run. It also spares curate-guidance a question nobody would answer, since only a hook sees the policy, and, run
// or not, lets this plugin's stage skills load without a prompt, since the Skill tool only loads their instructions.
// An allow prints nothing, unless it is the runner's exact command or the main context's own exact pb command: during a run
// any main verb bar publish and pr refresh, with no run the verbs that start or inspect one. A decision exits 0 with the
// JSON form on stdout.
// Any error with run state denies.
// This wrapper imports only built-ins and loads everything else dynamically, so that a failed import can
// still deny, and so that a call outside a run costs little more than Node's startup.
import { appendFileSync, existsSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_KEYS = { Write: "file_path", Edit: "file_path", NotebookEdit: "notebook_path" };
const MAX_SYMLINKS = 40;
const PLUGIN_PREFIX = "pairingbuddy:";
const CURATOR = `${PLUGIN_PREFIX}curate-guidance`;
const POLICY_ENV = "PAIRINGBUDDY_GATE_POLICY";
const ABSENT_CODES = ["ENOENT", "ENOTDIR"];
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));

// A linked worktree's top holds a .git file naming <repo>/.git/worktrees/<name>: the walk stops there (see run-root.mjs).
function isLinkedWorktreeTop(dir) {
  try {
    return /^gitdir: .*[\\/]worktrees[\\/][^\\/]+\s*$/.test(readFileSync(join(dir, ".git"), "utf8"));
  } catch {
    return false;
  }
}

function readlinkOrNull(path) {
  try {
    return readlinkSync(path);
  } catch (e) {
    if (e.code === "EINVAL" || ABSENT_CODES.includes(e.code)) return null;
    throw e;
  }
}

// realpath of the deepest part that exists, which on a case-insensitive filesystem also fixes the letter case.
function withRealCase(path) {
  const missing = [];
  for (let current = path; ; current = dirname(current)) {
    try {
      return join(realpathSync.native(current), ...missing);
    } catch (e) {
      if (!ABSENT_CODES.includes(e.code)) throw e;
      missing.unshift(basename(current));
    }
  }
}

// Follows symlinks one segment at a time, so that it works for paths that do not exist yet and for dangling links.
function canonicalPath(path) {
  const pending = path.split(sep).reverse();
  let current = sep;
  let links = 0;
  while (pending.length > 0) {
    const segment = pending.pop();
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, segment);
    const link = readlinkOrNull(next);
    if (link === null) {
      current = next;
      continue;
    }
    links += 1;
    if (links > MAX_SYMLINKS) throw new Error(`too many symlinks in ${path}`);
    if (isAbsolute(link)) current = sep;
    pending.push(...link.split(sep).reverse());
  }
  return withRealCase(current);
}

function readPayload() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    return payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isDirectory(path) {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

// A malformed payload, or a cwd that is not there, falls back to the hook's own cwd.
function workingDirectory(payload) {
  return typeof payload?.cwd === "string" && isAbsolute(payload.cwd) && isDirectory(payload.cwd) ? payload.cwd : process.cwd();
}

// Used only when run-root.mjs cannot load. Any run/ counts, empty or not, because the only result is a deny.
function nearestRunDirectory(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".pairingbuddy", "run"))) return dir;
    if (isLinkedWorktreeTop(dir) || dir === dirname(dir)) return null;
  }
}

// Used only when run-root.mjs cannot load, and for the same reason: its only result is a deny.
function pointedRunDirectory(sessionId) {
  try {
    const root = readFileSync(join(tmpdir(), "pairingbuddy-sessions-v2", basename(sessionId)), "utf8");
    return existsSync(join(root, ".pairingbuddy", "run")) ? root : null;
  } catch {
    return null;
  }
}

// The tool may collapse a `..` before following links, or the filesystem may do it after, so both readings count.
function targetPaths(payload, cwd) {
  const key = TARGET_KEYS[payload?.tool_name];
  if (key === undefined) return [];
  const path = payload.tool_input?.[key];
  if (typeof path !== "string" || path === "") throw new Error(`${payload.tool_name} has no usable ${key}`);
  const followed = isAbsolute(path) ? path : `${cwd}${sep}${path}`;
  return [...new Set([canonicalPath(followed), canonicalPath(resolve(cwd, path))])];
}

// `{a,b}` alternatives, one pattern each. Too many to check is an error, which the caller treats as a deny.
function expandBraces(pattern) {
  const group = /\{([^{}]*)\}/.exec(pattern);
  if (group === null) return [pattern];
  const expanded = group[1].split(",").flatMap((alternative) => expandBraces(pattern.slice(0, group.index) + alternative + pattern.slice(group.index + group[0].length)));
  if (expanded.length > 64) throw new Error("Glob pattern has too many brace alternatives to check");
  return expanded;
}

// Where one Glob pattern starts: its literal head, and the whole pattern when a `..` can climb back out of a wildcard.
function globStarts(pattern, base) {
  const tilde = pattern.startsWith("~") ? homedir() + pattern.slice(1) : pattern;
  const head = tilde.split(/[*?[\]()!]/)[0];
  const starts = head === "" ? [] : [isAbsolute(head) ? head : `${base}${sep}${head}`];
  if (tilde.split("/").includes("..")) starts.push(resolve(base, tilde));
  return starts;
}

// A Read is not a protected write target, so its path travels apart from targets.
function readPaths(payload, cwd) {
  const input = payload?.tool_input;
  const tool = payload?.tool_name;
  let path = tool === "Read" ? input?.file_path : tool === "Grep" || tool === "Glob" ? input?.path : undefined;
  if ((tool === "Grep" || tool === "Glob") && (path === undefined || path === "")) path = cwd;
  if (typeof path !== "string" || path === "") return [];
  const base = canonicalPath(isAbsolute(path) ? path : `${cwd}${sep}${path}`);
  if (tool !== "Glob" || typeof input?.pattern !== "string") return [base];
  const starts = expandBraces(input.pattern).flatMap((pattern) => globStarts(pattern, base));
  return [base, ...starts.map(canonicalPath)];
}

// What the gate decided for this call: "none" is the silent allow, which leaves no line in the transcript.
let decided = "none";

function decide(permissionDecision, permissionDecisionReason) {
  decided = permissionDecision;
  const hookSpecificOutput = { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason };
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

// With no run a failure allows, except on this plugin's own names: nothing can then say one of them is not a stage.
async function denyStageWithNoRun(toolInput, cwd) {
  try {
    const { workflowDenial } = await import("../shared-node/stage-calls.mjs");
    const reason = workflowDenial(toolInput, cwd);
    if (reason !== null) decide("deny", reason);
  } catch (e) {
    if (toolInput.name?.startsWith?.(PLUGIN_PREFIX)) decide("deny", `Gate error with no run open: cannot tell whether ${toolInput.name} is a stage, so the call is denied: ${e?.message ?? e}`);
  }
}

// Here a failure allows, because the old path's agents go through this too.
async function denyAgentWithNoRun(toolInput) {
  if (!toolInput.subagent_type?.startsWith?.(PLUGIN_PREFIX)) return;
  try {
    const { agentDenial } = await import("../shared-node/stage-calls.mjs");
    const reason = agentDenial(toolInput);
    if (reason !== null) decide("deny", reason);
  } catch {
    // Allowed: see above.
  }
}

// Either agent key marks a subagent, drift included: with no run only a subagent is held to D17, whatever the permission mode.
const isSubagent = (payload) => payload?.agent_id !== undefined || payload?.agent_type !== undefined;

// A command that moves to another directory may reach a run from a cwd outside it. Only such a command, or a subagent's, pays
// for the import, so a plain main-context call outside a run loads nothing new.
const MOVES_DIRECTORY = /(?:^|[\s;&|(){}])(?:(?:cd|pushd|-C)(?=\s|$)|--git-dir|--work-tree|GIT_DIR=|GIT_WORK_TREE=)/;
const MENTIONS_GIT = /\bg(?:it|h)\b/;
// Set when d17.mjs cannot be read for a command that moves to another directory: nothing can then say which run it touches.
let commandReadingFailure = null;

async function addCommandRunRoots(payload, cwd) {
  const command = payload.tool_input?.command;
  if (typeof command !== "string") return;
  const text = command.replace(/\\\n|['"\\]/g, "");
  if (!isSubagent(payload) && !(MOVES_DIRECTORY.test(text) && MENTIONS_GIT.test(text))) return;
  try {
    const { commandDirectories } = await import("../shared-node/d17.mjs");
    for (const dir of commandDirectories(command, cwd)) addRunRoot(canonicalPath(dir));
  } catch (e) {
    // Without the reading, only the cwd and the session say where the run is. The failure is kept: with no run found, a
    // command that could reach one is denied when it mutates (denyD17WithNoRun), and with a run the gate denies later.
    commandReadingFailure = e;
  }
}

// What a subagent may run when d17.mjs cannot be read: git and gh calls that only read, found in the raw text. The same
// list as shared-node/d17.mjs, without its option parsing, so anything it cannot place is a deny.
const GIT_READ_ONLY_VERB = /^(?:status|log|diff|show|rev-parse|ls-files|ls-tree|cat-file|blame|grep|describe|shortlog|merge-base|rev-list|for-each-ref|name-rev|check-ignore|var|help|version)$/;
const GH_READ_ONLY_CALL = /^(?:pr (?:view|list|status|checks|diff)|issue (?:view|list)|repo view|run (?:view|list)|help|version)$/;
const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);
const GH_GLOBAL_WITH_VALUE = new Set(["-R", "--repo", "--hostname"]);
const WRITING_API_FLAG = /^(?:-[A-Za-z]*[fFX]|--(?:field|raw-field|input|method))/;

function rawCallIsReadOnly(name, words) {
  const value = name === "git" ? GIT_GLOBAL_WITH_VALUE : GH_GLOBAL_WITH_VALUE;
  const positional = [];
  for (let i = 0; i < words.length && positional.length < 2; i += 1) {
    if (words[i].startsWith("-")) i += value.has(words[i]) ? 1 : 0;
    else positional.push(words[i]);
  }
  const [first, second] = positional;
  if (first === undefined) return true;
  if (name === "git") return GIT_READ_ONLY_VERB.test(first) || (first === "config" && words.some((word) => /^--(?:get|list)/.test(word) || word === "-l"));
  if (first === "api") return !words.some((word) => WRITING_API_FLAG.test(word));
  return GH_READ_ONLY_CALL.test(second === undefined ? first : `${first} ${second}`);
}

function rawAllowlistDenial(text) {
  for (const [, name, rest] of text.matchAll(/(?<![\w.-])(git|gh)(?![\w.-])([^;&|\n()`]*)/g)) {
    if (!rawCallIsReadOnly(name, rest.trim().split(/\s+/).filter(Boolean))) return name;
  }
  return null;
}

// Text that could change a run's state from a directory the gate could not read.
const MUTATING_RAW = /\bgit\b[^;&|\n]*\b(?:push|send-pack|http-push|reset|clean|checkout|restore|switch|branch|rebase|stash|bisect|update-ref|symbolic-ref|commit|worktree|read-tree|checkout-index)\b|\bgh\b[^;&|\n]*\b(?:pr|release|repo)\b/;

// With no run, D17 holds subagents only. A failure denies every git or gh call that is not plainly read-only, since a subagent
// must never publish or revert. The main context is held only when its command moved to a directory the gate could not read.
async function denyD17WithNoRun(payload, cwd) {
  const command = payload.tool_input?.command;
  const subagent = isSubagent(payload);
  if (typeof command !== "string" || (!subagent && commandReadingFailure === null)) return;
  const text = command.replace(/\\\n|['"\\]/g, "");
  if (!subagent) {
    if (MUTATING_RAW.test(text)) decide("deny", `Gate error with no run open: cannot tell which run this git or gh call reaches, so the call is denied: ${commandReadingFailure?.message ?? commandReadingFailure}`);
    return;
  }
  try {
    const { d17Denial } = await import("../shared-node/d17.mjs");
    const reason = d17Denial({ command, cwd, runState: "none", isSubagent: true });
    if (reason !== null) decide("deny", reason);
  } catch (e) {
    const call = rawAllowlistDenial(text);
    if (call !== null) decide("deny", `Gate error with no run open: cannot tell whether this ${call} call is read-only, so the call is denied for a subagent: ${e?.message ?? e}`);
  }
}

// The main context's exact pb command for a verb that starts or inspects a run. Only a command that names a pb.mjs pays for
// the import, so a plain main-context call outside a run still loads nothing new.
async function allowPbCommandWithNoRun(payload) {
  const command = payload.tool_input?.command;
  if (isSubagent(payload) || typeof command !== "string" || !command.startsWith("node ") || !command.includes("/cli/pb.mjs ")) return false;
  try {
    const { noRunAllowReason } = await import("../shared-node/gate-rules.mjs");
    const reason = noRunAllowReason(payload);
    if (reason === null) return false;
    decide("allow", reason);
    return true;
  } catch {
    return false;
  }
}

// A confined agent stays confined with no run. The roster mirrors CONFINED_AGENTS in gate-rules.mjs, kept apart so the main
// context never pays for that import: only a confined payload loads it, and if the load fails the call is denied.
const CONFINED_AGENT = /^pairingbuddy:(?:lens|refuter|synthesizer|course-checker)$/;
async function denyConfinedCallWithNoRun(payload, cwd, reads) {
  if (!CONFINED_AGENT.test(payload.agent_type)) return;
  try {
    const { assertReadConfined } = await import("../shared-node/gate-rules.mjs");
    assertReadConfined(cwd, { payload, reads }, canonicalPath);
  } catch (e) {
    decide("deny", `Confined agent call with no run open is denied: ${e?.message ?? e}`);
  }
}

// The curating-guidance skill, in the main context, marks its question with this header.
const GUIDANCE_HEADER = "Guidance";
const isGuidanceQuestion = ({ agent_type: agentType, tool_input: input }) =>
  agentType === CURATOR || (agentType === undefined && Array.isArray(input?.questions) && input.questions.some((q) => q?.header === GUIDANCE_HEADER));

const noHumanAnswers = ({ permission_mode: mode }) =>
  mode === "auto" || process.env[POLICY_ENV] === "auto" || process.env.CLAUDE_CODE_ENTRYPOINT === "sdk-cli";

// Run or no run: between plan tasks a unit is open, and the guidance question must not stop the run there either.
const isUnaskedGuidanceQuestion = (payload) => payload?.tool_name === "AskUserQuestion" && isGuidanceQuestion(payload) && noHumanAnswers(payload);

function denyQuestionWithNoHuman() {
  decide("deny", "No human answers under the auto policy or claude -p, so nothing is asked. Carry the guidance over as it stands, write the output, and finish.");
}

// The Skill tool only loads instructions, so this plugin's stage skills need no prompt: each workflow whose description says
// it is an internal stage, and the stage skills the main context runs. Built-ins only, so no run pays for an import.
const MAIN_CONTEXT_STAGE_SKILLS = ["curating-guidance", "setting-up-spike"];
const STAGE_SKILL_REASON = "Pairing Buddy stage skill, auto-allowed by the Pairing Buddy gate: it only loads instructions.";

function isStageSkill(payload) {
  const skill = payload?.tool_name === "Skill" ? payload.tool_input?.skill : undefined;
  if (typeof skill !== "string" || !skill.startsWith(PLUGIN_PREFIX)) return false;
  const name = skill.slice(PLUGIN_PREFIX.length);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return false;
  if (MAIN_CONTEXT_STAGE_SKILLS.includes(name)) return true;
  try {
    return readFileSync(join(PLUGIN, "workflows", `${name}.js`), "utf8").split("\n", 1)[0].includes("description: 'Internal stage");
  } catch {
    return false;
  }
}

// A failed import is held back, not thrown here: only the walk can say whether this call is inside a run.
let findRunRoot = nearestRunDirectory;
let findSessionRoot = (cwd, sessionId) => nearestRunDirectory(cwd) ?? pointedRunDirectory(sessionId);
let importFailure = null;
try {
  ({ findRunRoot, findSessionRoot } = await import("../shared-node/run-root.mjs"));
} catch (e) {
  importFailure = e;
}

const runRoots = new Set();
function addRunRoot(start) {
  const root = findRunRoot(start);
  if (root !== null) runRoots.add(root);
}

let traced = null;
try {
  const payload = readPayload();
  traced = payload;
  const cwd = canonicalPath(workingDirectory(payload));
  const sessionRoot = findSessionRoot(cwd, payload?.session_id);
  if (sessionRoot !== null) runRoots.add(sessionRoot);
  const targets = targetPaths(payload, cwd);
  const reads = readPaths(payload, cwd);
  targets.forEach(addRunRoot);
  if (payload?.tool_name === "Bash") await addCommandRunRoots(payload, cwd);
  if (isUnaskedGuidanceQuestion(payload)) {
    denyQuestionWithNoHuman();
  } else if (CONFINED_AGENT.test(payload?.agent_type) && runRoots.size === 0) {
    await denyConfinedCallWithNoRun(payload, cwd, reads);
  } else if (runRoots.size > 0) {
    if (importFailure !== null) throw importFailure;
    const { checkCall } = await import("../shared-node/gate-rules.mjs");
    const allowReason = checkCall({ runRoots: [...runRoots], sessionRoot, payload, targets, reads, canonicalPath }) ?? (isStageSkill(payload) ? STAGE_SKILL_REASON : null);
    if (allowReason !== null) decide("allow", allowReason);
  } else if (isStageSkill(payload)) {
    decide("allow", STAGE_SKILL_REASON);
  } else if (payload?.tool_name === "Workflow") {
    await denyStageWithNoRun(payload.tool_input ?? {}, cwd);
  } else if (payload?.tool_name === "Agent") {
    await denyAgentWithNoRun(payload.tool_input ?? {});
  } else if (payload?.tool_name === "Bash") {
    if (!(await allowPbCommandWithNoRun(payload))) await denyD17WithNoRun(payload, cwd);
  }
} catch (e) {
  if (runRoots.size > 0) decide("deny", e.gateDenial ? e.message : `Gate error during a run, so the call is denied: ${e?.message ?? e}`);
}

// PAIRINGBUDDY_GATE_TRACE names a file the smokes read: one line per call, so a silent allow shows the hook ran.
// Any failure here is ignored, because the trace must never change a decision.
const TRACE = process.env.PAIRINGBUDDY_GATE_TRACE;
if (typeof TRACE === "string" && isAbsolute(TRACE)) {
  try {
    const line = { tool_use_id: traced?.tool_use_id ?? null, tool_name: traced?.tool_name ?? null, agent_type: traced?.agent_type ?? null, decision: decided };
    appendFileSync(TRACE, `${JSON.stringify(line)}\n`);
  } catch {
    // the trace is for the smokes only
  }
}
