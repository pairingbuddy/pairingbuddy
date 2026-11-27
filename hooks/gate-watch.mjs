#!/usr/bin/env node
// Gate watch: a syntax error in gate-boot.mjs is the one break that fails open, since a hook that exits 1 lets the tool
// through and Claude Code tells the model nothing. This hook loads apart from it and says so during a run.
// Node built-ins only, and it imports neither gate-boot.mjs nor gate.mjs: it checks gate-boot.mjs from a child process.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOKS = dirname(fileURLToPath(import.meta.url));
const PLUGIN = dirname(HOOKS);
const GATE_BOOT = join(HOOKS, "gate-boot.mjs");

// A linked worktree's top holds a .git file naming <repo>/.git/worktrees/<name>: the walk stops there (see run-root.mjs).
function isLinkedWorktreeTop(dir) {
  try {
    return /^gitdir: .*[\\/]worktrees[\\/][^\\/]+\s*$/.test(readFileSync(join(dir, ".git"), "utf8"));
  } catch {
    return false;
  }
}

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8")) ?? {};
  } catch {
    return {};
  }
}

const holdsRun = (dir) => existsSync(join(dir, ".pairingbuddy", "run", "task", "ledger.json"));

function runRootAbove(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (holdsRun(dir)) return dir;
    if (isLinkedWorktreeTop(dir) || dir === dirname(dir)) return null;
  }
}

// The pointer shared-node/run-root.mjs writes, read here by hand so this hook needs nothing else of the plugin.
function boundRoot(sessionId) {
  if (typeof sessionId !== "string" || !/^[\w-][\w.-]*$/.test(sessionId)) return null;
  try {
    const root = readFileSync(join(tmpdir(), "pairingbuddy-sessions-v2", sessionId), "utf8");
    return isAbsolute(root) && holdsRun(root) ? root : null;
  } catch {
    return null;
  }
}

// Loads gate-boot.mjs in a child with ./gate.mjs swapped for an empty module, so a parse or link error shows and nothing
// of the gate runs. A plain node --check would miss an import of a name its module does not export.
const RESOLVE = `(specifier, context, next) => specifier === "./gate.mjs" ? { url: "data:text/javascript,", shortCircuit: true } : next(specifier, context)`;
const LOAD = `import * as m from "node:module";
if (m.registerHooks) m.registerHooks({ resolve: ${RESOLVE} });
else m.register("data:text/javascript," + encodeURIComponent(${JSON.stringify(`export const resolve = async ${RESOLVE};`)}));
await import(process.argv[1]);`;

function loadFailure() {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", LOAD, pathToFileURL(GATE_BOOT).href], { input: "", encoding: "utf8" });
  return result.status === 0 ? null : result.stderr.trim().split("\n").find((line) => /Error/.test(line)) ?? "it does not load";
}

const message = (failure) =>
  `The safety checks are off: Pairing Buddy's gate (hooks/gate-boot.mjs) cannot load (${failure}), so nothing checks your tool calls during this run. Stop now: make no more tool calls, and tell the human. They restore it from a separate terminal with git -C "${PLUGIN}" checkout -- hooks: see "gate-boot.mjs parse failure" in CONTRIBUTING.md.`;

// The verdict for gate-boot.mjs as it stands, kept by its time and size so a call costs a child only after it changed.
const CACHE = join(tmpdir(), "pairingbuddy-gate-watch", `${createHash("sha256").update(GATE_BOOT).digest("hex").slice(0, 16)}.json`);

function gateBootFailure() {
  let key;
  try {
    const { mtimeMs, size } = statSync(GATE_BOOT);
    key = `${mtimeMs}:${size}`;
    const cached = JSON.parse(readFileSync(CACHE, "utf8"));
    if (cached.key === key) return cached.failure;
  } catch {
    // No verdict kept: load it.
  }
  const failure = loadFailure();
  try {
    mkdirSync(dirname(CACHE), { recursive: true, mode: 0o700 });
    const temp = `${CACHE}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ key, failure }));
    renameSync(temp, CACHE);
  } catch {
    // The next call loads it again.
  }
  return failure;
}

// What the mod reads in place of loading gate-boot.mjs. It names the file as it stood, so the mod sees a restored file
// at once, before any hook runs again. A failed write costs only the mod's line, never the model's.
function mark(root, failure) {
  const marker = join(root, ".pairingbuddy", "run", "gate-off.json");
  try {
    if (failure === null) return rmSync(marker, { force: true });
    const { mtimeMs, size } = statSync(GATE_BOOT);
    const temp = `${marker}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ path: GATE_BOOT, plugin: PLUGIN, mtimeMs, size, failure, at: new Date().toISOString() })}\n`);
    renameSync(temp, marker);
  } catch {
    // The model is still told.
  }
}

const payload = readPayload();
const cwd = typeof payload.cwd === "string" && isAbsolute(payload.cwd) ? payload.cwd : process.cwd();
const root = runRootAbove(cwd) ?? boundRoot(payload.session_id);
const failure = root === null ? null : gateBootFailure();
if (root !== null) mark(root, failure);
// Before a call it denies, as gate-boot.mjs would; after a call and on a prompt it tells the model.
function output(hookEventName, text) {
  if (hookEventName === "PreToolUse") return { hookSpecificOutput: { hookEventName, permissionDecision: "deny", permissionDecisionReason: text } };
  return { hookSpecificOutput: { hookEventName, additionalContext: text } };
}

if (failure !== null) process.stdout.write(JSON.stringify(output(payload.hook_event_name ?? "PostToolUse", message(failure))));
