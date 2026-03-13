#!/usr/bin/env node
// Session drift guardian — re-injects workflow reminder based on elapsed time.
// Triggered by PostToolUse (timer-based) and SessionStart:compact (always inject).
// Pass "always" as argv[2] to force injection (used after compaction).

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const REMINDER = [
  "<pairingbuddy-guardian>",
  "Make sure to follow Pairing Buddy workflows strictly.",
  "You are not allowed to skip steps, and you MUST use the subagents.",
  "Do not waste context window here for work that should be done in those subagents.",
  "</pairingbuddy-guardian>",
].join("\n");

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
const shouldInject = forceInject || (now - last >= INTERVAL_MS);

if (shouldInject) {
  state.lastInjection = now.toISOString();
  state.trigger = forceInject ? "compact" : "timer";
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || "unknown",
      additionalContext: shouldInject ? REMINDER : "",
    },
  })
);
