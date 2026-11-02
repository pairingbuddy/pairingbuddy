#!/usr/bin/env node
// Gate boot: the registered PreToolUse command. A syntax error in gate.mjs stops that file before any of its lines run,
// and a hook that exits 1 lets the tool through, so the deny has to come from here. gate.mjs reads stdin itself, so all
// but the import runs only after a failed load, when stdin is still unread.
// Node built-ins only, and small on purpose: a syntax error in this file is the one that still fails open.
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function hasRunAbove(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".pairingbuddy", "run"))) return true;
    if (dir === dirname(dir)) return false;
  }
}

function hasBoundRun(sessionId) {
  try {
    const root = readFileSync(join(tmpdir(), "pairingbuddy-sessions", basename(sessionId)), "utf8");
    return existsSync(join(root, ".pairingbuddy", "run"));
  } catch {
    return false;
  }
}

// Any run/ counts, empty or not, because the only result is a deny.
function isDuringRun(payload) {
  const cwd = typeof payload?.cwd === "string" && isAbsolute(payload.cwd) ? payload.cwd : process.cwd();
  const target = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
  const starts = typeof target === "string" ? [cwd, resolve(cwd, target)] : [cwd];
  return starts.some(hasRunAbove) || hasBoundRun(payload?.session_id);
}

function deny(failure) {
  const permissionDecisionReason = `The gate could not load, so the call is denied during a run: ${failure?.message ?? failure}. A human restores it from a separate terminal with git -C "${PLUGIN}" checkout -- hooks: see "gate.mjs parse failure" in CONTRIBUTING.md.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason } }));
}

try {
  await import("./gate.mjs");
} catch (e) {
  if (isDuringRun(readPayload())) deny(e);
}
