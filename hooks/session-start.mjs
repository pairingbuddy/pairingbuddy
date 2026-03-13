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

const context = [
  "<EXTREMELY_IMPORTANT>",
  "You have pairingbuddy.",
  "",
  "**The content below is from skills/using-pairingbuddy/SKILL.md - your introduction to using skills:**",
  "",
  skillContent,
  "",
  "</EXTREMELY_IMPORTANT>",
].join("\n");

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  })
);
