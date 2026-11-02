#!/usr/bin/env node
// Gate: PreToolUse enforcement during a run. With no run state it allows everything silently.
// An allow prints nothing, unless it is the runner's exact command; a decision exits 0 with the JSON form on stdout.
// Any error with run state denies.
// This wrapper imports only built-ins and loads everything else dynamically, so that a failed import can
// still deny, and so that a call outside a run costs little more than Node's startup.
import { existsSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

const TARGET_KEYS = { Write: "file_path", Edit: "file_path", NotebookEdit: "notebook_path" };
const MAX_SYMLINKS = 40;
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

// A failed import is held back, not thrown here: only the walk can say whether this call is inside a run.
let findRunRoot = nearestRunDirectory;
let importFailure = null;
try {
  ({ findRunRoot } = await import("../shared-node/run-root.mjs"));
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
  addRunRoot(cwd);
  const targets = targetPaths(payload, cwd);
  targets.forEach(addRunRoot);
  if (runRoots.size > 0) {
    if (importFailure !== null) throw importFailure;
    const { checkCall } = await import("../shared-node/gate-rules.mjs");
    const allowReason = checkCall({ runRoots: [...runRoots], payload, targets, canonicalPath });
    if (allowReason !== null) decide("allow", allowReason);
  }
} catch (e) {
  if (runRoots.size > 0) decide("deny", e.gateDenial ? e.message : `Gate error during a run, so the call is denied: ${e?.message ?? e}`);
}
