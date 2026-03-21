#!/usr/bin/env node
// Solo progress tracker — records tool use activity during solo mode sessions.
// Triggered by PostToolUse. No-ops when PAIRINGBUDDY_SOLO is not set or false.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "fs";
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

function readFirstTestFile(filePath, arrayKey) {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    if (data[arrayKey] && data[arrayKey].length > 0 && data[arrayKey][0].test_file) {
      return data[arrayKey][0].test_file;
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return null;
}

function findCurrentFile() {
  const pairingbuddyDir = join(process.cwd(), ".pairingbuddy");

  // Try current-batch.json first
  const fromBatch = readFirstTestFile(join(pairingbuddyDir, "current-batch.json"), "batch");
  if (fromBatch) return fromBatch;

  // Fall back to tests.json
  const fromTests = readFirstTestFile(join(pairingbuddyDir, "tests.json"), "tests");
  if (fromTests) return fromTests;

  return null;
}

function formatStatus(counts, agentName, currentFile) {
  // Intentionally different formats by design: when progress is known the status
  // file shows a rich multi-line display (progress bar + separate Agent line),
  // while the unknown-progress case uses a compact single-line fallback.
  if (counts !== null) {
    const percentage = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
    const filled = counts.total > 0 ? Math.round((counts.completed / counts.total) * BAR_WIDTH) : 0;
    const empty = BAR_WIDTH - filled;
    const filledBar = "\u2588".repeat(filled);
    const emptyBar = "\u2591".repeat(empty);
    const fileLine = currentFile ? `\nFile: ${currentFile}` : "";
    return `[${counts.completed}/${counts.total}] ${filledBar}${emptyBar} ${percentage}%\nAgent: ${agentName}${fileLine}\n`;
  }
  return `[?/?] Agent: ${agentName}\n`;
}

function writeStatusFile(counts, agentName, currentFile) {
  const pairingbuddyDir = join(process.cwd(), ".pairingbuddy");
  if (!existsSync(pairingbuddyDir)) return;
  const statusContent = formatStatus(counts, agentName, currentFile);
  const statusPath = join(pairingbuddyDir, "solo-status");
  writeFileSync(statusPath, statusContent);
}

function appendProgressLog(counts, agentName, currentFile) {
  const pairingbuddyDir = join(process.cwd(), ".pairingbuddy");
  if (!existsSync(pairingbuddyDir)) return;
  const timestamp = new Date().toISOString();
  const progressTag = counts ? `[${counts.completed}/${counts.total}]` : '[?/?]';
  const filePart = currentFile ? ` ${currentFile}` : "";
  const logLine = `${timestamp} ${progressTag} ${agentName}${filePart}\n`;
  const logPath = join(pairingbuddyDir, "solo-progress.log");
  appendFileSync(logPath, logLine);
}

const planPath = findPlanPath();
const counts = planPath ? countCheckboxes(planPath) : null;
const currentFile = findCurrentFile();

writeStatusFile(counts, agentName, currentFile);
appendProgressLog(counts, agentName, currentFile);
