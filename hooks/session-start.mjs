#!/usr/bin/env node
// SessionStart hook — injects the using-pairingbuddy skill into session context.

import { readFileSync } from "fs";
import { join, dirname } from "path";
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

const context = parts.join("\n");

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  })
);
