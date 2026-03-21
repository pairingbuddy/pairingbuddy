#!/usr/bin/env node
// Solo progress tracker — records tool use activity during solo mode sessions.
// Triggered by PostToolUse. No-ops when PAIRINGBUDDY_SOLO is not set or false.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "fs";
import { join, resolve } from "path";

const isSoloMode =
  process.env.PAIRINGBUDDY_SOLO &&
  process.env.PAIRINGBUDDY_SOLO !== "false" &&
  process.env.PAIRINGBUDDY_SOLO !== "";

if (!isSoloMode) {
  process.exit(0);
}

try {

const input = JSON.parse(readFileSync("/dev/stdin", "utf8"));

if (input.tool_name !== "Agent") {
  process.exit(0);
}

const agentName = (input.tool_input && input.tool_input.subagent_type) || "unknown";
const taskDescription = (input.tool_input && input.tool_input.description) || null;

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

const BAR_WIDTH = 30;

function stripMarkdown(text) {
  return text.replace(/[*`]/g, "");
}

function readPlanTasks(planPath) {
  try {
    const content = readFileSync(planPath, "utf8");
    const lines = content.split("\n");
    const tasks = [];
    for (const line of lines) {
      const checkedMatch = line.match(/^\s*- \[x\] (.+)/);
      if (checkedMatch) {
        tasks.push({ text: stripMarkdown(checkedMatch[1].trim()), checked: true });
        continue;
      }
      const uncheckedMatch = line.match(/^\s*- \[ \] (.+)/);
      if (uncheckedMatch) {
        tasks.push({ text: stripMarkdown(uncheckedMatch[1].trim()), checked: false });
      }
    }
    return tasks;
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

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

const useColor = process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true";

const GREEN = useColor ? "\x1b[32m" : "";
const DARK_GRAY = useColor ? "\x1b[90m" : "";
const CYAN = useColor ? "\x1b[36m" : "";
const BOLD_WHITE = useColor ? "\x1b[1;37m" : "";
const BOLD = useColor ? "\x1b[1m" : "";
const RESET = useColor ? "\x1b[0m" : "";
const DIM = useColor ? "\x1b[2m" : "";

function formatTaskList(planTasks) {
  let foundCurrent = false;
  return planTasks.map((task) => {
    if (task.checked) {
      return `  ${GREEN}✓${RESET} ${task.text}`;
    }
    if (!foundCurrent) {
      foundCurrent = true;
      return `  ${CYAN}→${RESET} ${BOLD_WHITE}${task.text}${RESET}`;
    }
    return `  ${DIM}○ ${task.text}${RESET}`;
  }).join("\n");
}

function formatStatus(counts, agentName, currentFile, taskDescription, planTasks) {
  // Intentionally different formats by design: when progress is known the status
  // file shows a rich multi-line display (task list + progress bar + agent line),
  // while the unknown-progress case uses a compact single-line fallback.
  if (counts !== null) {
    const percentage = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
    const filled = counts.total > 0 ? Math.round((counts.completed / counts.total) * BAR_WIDTH) : 0;
    const empty = BAR_WIDTH - filled;
    const filledBar = `${CYAN}${"\u2588".repeat(filled)}${RESET}`;
    const emptyBar = `${DARK_GRAY}${"\u2591".repeat(empty)}${RESET}`;
    const percentagePart = `${percentage > 0 ? BOLD : ""}${percentage}%${percentage > 0 ? RESET : ""}`;
    const taskListPart = (planTasks && planTasks.length > 0) ? formatTaskList(planTasks) + "\n\n" : "";
    const descriptionLine = taskDescription ? `\n${DIM}  ${taskDescription}${RESET}` : "";
    return `${taskListPart}[${counts.completed}/${counts.total}] ${filledBar}${emptyBar} ${percentagePart}\nAgent: ${DIM}${agentName}${RESET}${descriptionLine}\n`;
  }
  const descriptionLine = taskDescription ? `\n  ${taskDescription}` : "";
  return `[?/?] Agent: ${CYAN}${agentName}${RESET}${descriptionLine}\n`;
}

function writeStatusFile(counts, agentName, currentFile, taskDescription, planTasks) {
  const pairingbuddyDir = join(process.cwd(), ".pairingbuddy");
  if (!existsSync(pairingbuddyDir)) return;
  const statusContent = formatStatus(counts, agentName, currentFile, taskDescription, planTasks);
  const statusPath = join(pairingbuddyDir, "solo-status");
  writeFileSync(statusPath, statusContent);
}

function appendProgressLog(counts, agentName, currentFile, taskDescription) {
  const pairingbuddyDir = join(process.cwd(), ".pairingbuddy");
  if (!existsSync(pairingbuddyDir)) return;
  const timestamp = new Date().toISOString();
  const progressTag = counts ? `[${counts.completed}/${counts.total}]` : '[?/?]';
  const taskPart = taskDescription ? ` ${taskDescription}` : "";
  const filePart = currentFile ? ` ${currentFile}` : "";
  const logLine = `${timestamp} ${progressTag} ${agentName}${taskPart}${filePart}\n`;
  const logPath = join(pairingbuddyDir, "solo-progress.log");
  appendFileSync(logPath, logLine);
}

const planPath = findPlanPath();
const counts = planPath ? countCheckboxes(planPath) : null;
const currentFile = findCurrentFile();
const planTasks = planPath ? readPlanTasks(planPath) : null;

writeStatusFile(counts, agentName, currentFile, taskDescription, planTasks);
appendProgressLog(counts, agentName, currentFile, taskDescription);

} catch (err) {
  const pairingbuddyDir = join(process.cwd(), ".pairingbuddy");
  if (existsSync(pairingbuddyDir)) {
    const timestamp = new Date().toISOString();
    const errorLogPath = join(pairingbuddyDir, "solo-progress-errors.log");
    appendFileSync(errorLogPath, `${timestamp} ${err.message}\n`);
  }
  process.exit(0);
}
