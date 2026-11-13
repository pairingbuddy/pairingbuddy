#!/usr/bin/env node
// SessionStart hook — injects the using-pairingbuddy skill into session context, and reports an open run.
// After compaction guardian.mjs reports the run, so the report is not injected twice.

import { readFileSync } from "fs";
import { isAbsolute, join, dirname } from "path";
import { fileURLToPath } from "url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(pluginRoot, "skills", "using-pairingbuddy", "SKILL.md");

let skillContent;
try {
  skillContent = readFileSync(skillPath, "utf8");
} catch (e) {
  skillContent = `Error reading using-pairingbuddy skill: ${e.message}`;
}

const isSoloMode = process.env.PAIRINGBUDDY_SOLO === "true";

const parts = [
  "<EXTREMELY_IMPORTANT>",
  "You have pairingbuddy.",
  "",
  "**The content below is from skills/using-pairingbuddy/SKILL.md - your introduction to using skills:**",
  "",
  skillContent,
  "",
  "</EXTREMELY_IMPORTANT>",
];

if (isSoloMode) {
  parts.push(
    "",
    "<EXTREMELY_IMPORTANT>",
    "SOLO MODE ACTIVE: You are running as Solo Buddy in autonomous execution mode.",
    "You MUST use /pairingbuddy:code to execute the plan. Do not respond conversationally.",
    "Follow all skills, contracts, and workflows exactly. No exceptions.",
    "The human operator WILL review all code when this session ends.",
    "</EXTREMELY_IMPORTANT>"
  );
}

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8")) ?? {};
  } catch {
    return {};
  }
}

// A failure here must not cost the session the skill above.
async function openRunReport({ cwd, session_id: sessionId, source }) {
  if (source === "compact") return null;
  try {
    const { findSessionRoot } = await import("../shared-node/run-root.mjs");
    const root = findSessionRoot(typeof cwd === "string" && isAbsolute(cwd) ? cwd : process.cwd(), sessionId);
    if (root === null) return null;
    const { readRun, runReport } = await import("../shared-node/next-action.mjs");
    return runReport(readRun(pluginRoot, root), sessionId);
  } catch {
    return null;
  }
}

const runReportText = await openRunReport(readPayload());
if (runReportText !== null) parts.push("", "<pairingbuddy-run>", runReportText, "</pairingbuddy-run>");

const context = parts.join("\n");

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  })
);
