#!/usr/bin/env node
// Session drift guardian — re-injects workflow reminder based on elapsed time.
// Triggered by PostToolUse (timer-based) and SessionStart:compact (always inject).
// Pass "always" as argv[2] to force injection (used after compaction).
// With run state the reminder is reworded, and after compaction `pb status` and the next action replace it.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";

const INTERVAL_MS = 4 * 60 * 1000; // 4 minutes
const SOLO_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const GUARDIAN_OPEN = "<pairingbuddy-guardian>";
const GUARDIAN_CLOSE = "</pairingbuddy-guardian>";

const REMINDER = [
  GUARDIAN_OPEN,
  "Make sure to follow Pairing Buddy workflows strictly.",
  "You are not allowed to skip steps, and you MUST use the subagents.",
  "Do not waste context window here for work that should be done in those subagents.",
  "No task is too small or simple to skip the workflow. Do not rationalize efficiency, speed, or simplicity as reasons to bypass subagents.",
  GUARDIAN_CLOSE,
].join("\n");

const RUN_REMINDER = [
  GUARDIAN_OPEN,
  "A Pairing Buddy run is open, and its stages do the work.",
  "Start each stage as its workflow, and take every result from pb status, never from a workflow's reported status.",
  "Do not do a stage's work here, and do not go past a gate or a stop.",
  GUARDIAN_CLOSE,
].join("\n");

const SOLO_ADDITIONS = [
  "SOLO MODE: You are operating autonomously without a human pairing partner.",
  "Stay strictly focused on the current task. Do not add unrequested features.",
  "Update .pairingbuddy/SOLO_BUDDY_REPORT.md after each task (_update_solo_report).",
  "The human operator WILL review all code when this session ends. No shortcuts, no sloppiness, no skipping quality steps because nobody is watching. Someone IS watching.",
].join("\n");

const isSoloMode = process.env.PAIRINGBUDDY_SOLO === "true";

const input = JSON.parse(readFileSync("/dev/stdin", "utf8"));
const sessionId = input.session_id || "unknown";
const forceInject = process.argv[2] === "always";
const stateDir = join(process.cwd(), ".pairingbuddy", "hooks");
const stateFile = join(stateDir, `${sessionId}.json`);

// Extract tool info from input
const lastTool = input.tool_name || null;
const lastAgent =
  input.tool_name === "Agent" && input.tool_input && input.tool_input.subagent_type
    ? input.tool_input.subagent_type
    : null;
const lastDescription =
  input.tool_name === "Agent" && input.tool_input && input.tool_input.description
    ? input.tool_input.description
    : null;

// Read existing state
let state = { lastInjection: null, trigger: null };
try {
  state = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {}

const now = new Date();
const last = state.lastInjection ? new Date(state.lastInjection) : new Date(0);
const intervalMs = isSoloMode ? SOLO_INTERVAL_MS : INTERVAL_MS;
const shouldInject = forceInject || (now - last >= intervalMs);

// Looked up only when something is injected, so a call between injections pays nothing. A failed lookup keeps the
// plain reminder, because this hook must not cost a tool call.
async function runReminder() {
  try {
    const cwd = typeof input.cwd === "string" && isAbsolute(input.cwd) ? input.cwd : process.cwd();
    const { findSessionRoot } = await import("../shared-node/run-root.mjs");
    const root = findSessionRoot(cwd, sessionId);
    if (root === null) return REMINDER;
    if (!forceInject) return RUN_REMINDER;
    const { readRun, runReport } = await import("../shared-node/next-action.mjs");
    const plugin = dirname(dirname(fileURLToPath(import.meta.url)));
    return [GUARDIAN_OPEN, runReport(readRun(plugin, root)), GUARDIAN_CLOSE].join("\n");
  } catch {
    return REMINDER;
  }
}

let injectedContent = "";
if (shouldInject) {
  state.lastInjection = now.toISOString();
  state.trigger = forceInject ? "compact" : "timer";

  const reminder = await runReminder();
  injectedContent = isSoloMode ? reminder + "\n" + SOLO_ADDITIONS : reminder;
}

// Always update tool info and write state
state.lastTool = lastTool;
// Only update agent info when tool is Agent — preserve previous values for other tools
if (lastAgent !== null) {
  state.lastAgent = lastAgent;
}
if (lastDescription !== null) {
  state.lastDescription = lastDescription;
}

mkdirSync(stateDir, { recursive: true });
writeFileSync(stateFile, JSON.stringify(state, null, 2));

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || "unknown",
      additionalContext: injectedContent,
    },
  })
);
