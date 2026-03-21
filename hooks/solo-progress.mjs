#!/usr/bin/env node
// Solo progress tracker — records tool use activity during solo mode sessions.
// Triggered by PostToolUse. No-ops when PAIRINGBUDDY_SOLO is not set or false.

import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

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

function findPlanPath() {
  if (process.env.PAIRINGBUDDY_PLAN_PATH) {
    return process.env.PAIRINGBUDDY_PLAN_PATH;
  }
  try {
    const planConfigPath = join(process.cwd(), ".pairingbuddy", "plan", "plan-config.json");
    const planConfig = JSON.parse(readFileSync(planConfigPath, "utf8"));
    if (planConfig.output_path) {
      return resolve(process.cwd(), planConfig.output_path);
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // plan-config.json not found — no plan configured
  }
  return null;
}

const BAR_WIDTH = 10;

function countCheckboxes(planPath) {
  try {
    const content = readFileSync(planPath, "utf8");
    const lines = content.split("\n");
    const { completed, incomplete } = lines.reduce(
      (acc, l) => {
        if (/^\s*- \[x\]/.test(l)) acc.completed++;
        else if (/^\s*- \[ \]/.test(l)) acc.incomplete++;
        return acc;
      },
      { completed: 0, incomplete: 0 }
    );
    return { completed, total: completed + incomplete };
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function formatStatus(counts, agentName) {
  if (counts !== null) {
    const percentage = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
    const filled = Math.round(percentage / BAR_WIDTH);
    const empty = BAR_WIDTH - filled;
    const filledBar = "\u2588".repeat(filled);
    const emptyBar = "\u2591".repeat(empty);
    return `[${counts.completed}/${counts.total}] ${filledBar}${emptyBar} ${percentage}%\nAgent: ${agentName}\n`;
  }
  return `[?/?] Agent: ${agentName}\n`;
}

const planPath = findPlanPath();
const counts = planPath ? countCheckboxes(planPath) : null;
const statusContent = formatStatus(counts, agentName);

const statusPath = join(process.cwd(), ".pairingbuddy", "solo-status");
writeFileSync(statusPath, statusContent);
