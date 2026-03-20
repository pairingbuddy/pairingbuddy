#!/usr/bin/env node
// Solo progress tracker — records tool use activity during solo mode sessions.
// Triggered by PostToolUse. No-ops when PAIRINGBUDDY_SOLO is not set or false.

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const isSoloMode =
  process.env.PAIRINGBUDDY_SOLO &&
  process.env.PAIRINGBUDDY_SOLO !== "false" &&
  process.env.PAIRINGBUDDY_SOLO !== "";

const input = JSON.parse(readFileSync("/dev/stdin", "utf8"));

if (!isSoloMode) {
  process.exit(0);
}

if (input.tool_name !== "Task") {
  process.exit(0);
}

const agentName = (input.tool_input && input.tool_input.description) || "unknown";
const statusPath = join(process.cwd(), ".pairingbuddy", "solo-status");
writeFileSync(statusPath, `Agent: ${agentName}\nProgress: (tracking not yet enabled)\n`);
