#!/usr/bin/env node
// Gate: PreToolUse enforcement during a run, loaded by gate-boot.mjs. With no run state it allows everything silently,
// except a Workflow call that would start a stage of this plugin: a stage has only ever run inside a run.
// An allow prints nothing, unless it is the runner's exact command; a decision exits 0 with the JSON form on stdout.
// Any error with run state denies.
// This wrapper imports only built-ins and loads everything else dynamically, so that a failed import can
// still deny, and so that a call outside a run costs little more than Node's startup.
import { existsSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

const TARGET_KEYS = { Write: "file_path", Edit: "file_path", NotebookEdit: "notebook_path" };
const MAX_SYMLINKS = 40;
const PLUGIN_PREFIX = "pairingbuddy:";
const ABSENT_CODES = ["ENOENT", "ENOTDIR"];

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
    if (dir === dirname(dir)) return null;
  }
}

// Used only when run-root.mjs cannot load, and for the same reason: its only result is a deny.
function pointedRunDirectory(sessionId) {
  try {
    const root = readFileSync(join(tmpdir(), "pairingbuddy-sessions", basename(sessionId)), "utf8");
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

function decide(permissionDecision, permissionDecisionReason) {
  const hookSpecificOutput = { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason };
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

// With no run a failure allows, except on this plugin's own names: nothing can then say one of them is not a stage.
async function denyStageWithNoRun(toolInput, cwd) {
  try {
    const { stageWithNoRun } = await import("../shared-node/stage-calls.mjs");
    const stage = stageWithNoRun(toolInput, cwd);
    if (stage !== undefined) decide("deny", `Stage ${stage} cannot start with no run open. Use /pairingbuddy:code, which opens the run.`);
  } catch (e) {
    if (toolInput.name?.startsWith?.(PLUGIN_PREFIX)) decide("deny", `Gate error with no run open: cannot tell whether ${toolInput.name} is a stage, so the call is denied: ${e?.message ?? e}`);
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

try {
  const payload = readPayload();
  const cwd = canonicalPath(workingDirectory(payload));
  const sessionRoot = findSessionRoot(cwd, payload?.session_id);
  if (sessionRoot !== null) runRoots.add(sessionRoot);
  const targets = targetPaths(payload, cwd);
  targets.forEach(addRunRoot);
  if (runRoots.size > 0) {
    if (importFailure !== null) throw importFailure;
    const { checkCall } = await import("../shared-node/gate-rules.mjs");
    const allowReason = checkCall({ runRoots: [...runRoots], sessionRoot, payload, targets, canonicalPath });
    if (allowReason !== null) decide("allow", allowReason);
  } else if (payload?.tool_name === "Workflow") {
    await denyStageWithNoRun(payload.tool_input ?? {}, cwd);
  }
} catch (e) {
  if (runRoots.size > 0) decide("deny", e.gateDenial ? e.message : `Gate error during a run, so the call is denied: ${e?.message ?? e}`);
}
