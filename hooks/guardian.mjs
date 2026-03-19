#!/usr/bin/env node
// Session drift guardian — re-injects workflow reminder based on elapsed time.
// Triggered by PostToolUse (timer-based) and SessionStart:compact (always inject).
// Pass "always" as argv[2] to force injection (used after compaction).

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SOLO_INTERVAL_MS = 2.5 * 60 * 1000; // 150000 ms = 2.5 minutes

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
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));

  if (isSoloMode) {
    injectedContent = REMINDER + "\n" + SOLO_ADDITIONS;
  } else {
    injectedContent = REMINDER;
  }
}

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || "unknown",
      additionalContext: injectedContent,
    },
  })
);
