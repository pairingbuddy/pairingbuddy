#!/usr/bin/env node
// Tap: records StructuredOutput returns as run artifacts and stores the Workflow runId in the ledger.
// Never blocks a tool: every path exits 0 and nothing is printed.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
// The shared-node modules load inside the try so a packaging failure cannot make the hook exit non-zero.

function gitToplevel(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function logError(taskDir, message) {
  appendFileSync(join(taskDir, "tap-errors.log"), `${new Date().toISOString()} ${message}\n`);
}

function tapStructuredOutput({ parseKey, readLedger }, taskDir, ledgerPath, toolInput) {
  const pbKey = toolInput?.pb_key;
  if (typeof pbKey !== "string") return;
  let parsed;
  try {
    parsed = parseKey(pbKey);
  } catch {
    logError(taskDir, `bad key: ${JSON.stringify(pbKey)}`);
    return;
  }
  const { stage } = readLedger(ledgerPath);
  if (!stage || stage.name !== parsed.stage) {
    logError(taskDir, `stage mismatch: key ${pbKey}`);
    return;
  }
  if (stage.attempt !== parsed.attempt) {
    logError(taskDir, `attempt mismatch: key ${pbKey}`);
    return;
  }
  const dir = join(taskDir, "artifacts");
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${pbKey}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(temp, JSON.stringify(toolInput));
  renameSync(temp, join(dir, `${pbKey}.json`));
}

const hasStage = (ledger) => Boolean(ledger.stage?.name);

const belongsToStage = (stage, toolInput) =>
  toolInput?.name === `pairingbuddy:${stage.name}` && toolInput?.args?.attempt === stage.attempt;

function tapWorkflow({ readLedger, updateLedger }, taskDir, ledgerPath, toolInput, toolResponse) {
  const runId = toolResponse?.runId;
  if (typeof runId !== "string" || !hasStage(readLedger(ledgerPath))) return;
  let mismatch = null;
  updateLedger(ledgerPath, (ledger) => {
    if (!hasStage(ledger)) return ledger;
    if (!belongsToStage(ledger.stage, toolInput)) {
      mismatch = ledger.stage.name;
      return ledger;
    }
    return { ...ledger, stage: { ...ledger.stage, runId } };
  });
  if (mismatch !== null) logError(taskDir, `workflow mismatch: ${JSON.stringify(toolInput?.name)} for stage ${mismatch}`);
}

try {
  const { parseKey } = await import("../shared-node/keys.mjs");
  const { readLedger, updateLedger } = await import("../shared-node/ledger.mjs");
  const input = JSON.parse(readFileSync(0, "utf8"));
  const top = gitToplevel(input.cwd);
  const taskDir = join(top, ".pairingbuddy", "run", "task");
  const ledgerPath = join(taskDir, "ledger.json");
  if (existsSync(ledgerPath)) {
    try {
      if (input.tool_name === "StructuredOutput") tapStructuredOutput({ parseKey, readLedger }, taskDir, ledgerPath, input.tool_input);
      else if (input.tool_name === "Workflow") tapWorkflow({ readLedger, updateLedger }, taskDir, ledgerPath, input.tool_input, input.tool_response);
    } catch (e) {
      logError(taskDir, `error: ${e?.message ?? e}`);
    }
  }
} catch {
  // not a run situation
}
process.exit(0);
