#!/usr/bin/env node
// Session drift guardian — re-injects workflow reminder based on elapsed time.
// Triggered by PostToolUse (timer-based) and SessionStart:compact (always inject).
// Pass "always" as argv[2] to force injection (used after compaction).

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

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

let injectedContent = "";
if (shouldInject) {
  state.lastInjection = now.toISOString();
  state.trigger = forceInject ? "compact" : "timer";

  if (isSoloMode) {
    injectedContent = REMINDER + "\n" + SOLO_ADDITIONS;
  } else {
    injectedContent = REMINDER;
  }
}

// Always update tool info and write state
state.lastTool = lastTool;
state.lastAgent = lastAgent;
state.lastDescription = lastDescription;

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
