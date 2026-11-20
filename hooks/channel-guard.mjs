#!/usr/bin/env node
// SessionStart and UserPromptSubmit hook: refuses a session with both Pairing Buddy channels on. SessionStart cannot
// stop a session (`continue: false` is ignored there), so it tells the person, and every prompt is then blocked.
// Silent when one channel is on, and a settings file it cannot read is skipped.

import { readFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";
import { CHANNEL_CONFLICT, bothChannelsOn, mergeEnabledPlugins } from "../shared-node/channels.mjs";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const payload = readJson(0) ?? {};
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const projectDir = process.env.CLAUDE_PROJECT_DIR || (typeof payload.cwd === "string" && isAbsolute(payload.cwd) ? payload.cwd : process.cwd());

const enabled = mergeEnabledPlugins([
  readJson(join(configDir, "settings.json")),
  readJson(join(projectDir, ".claude", "settings.json")),
  readJson(join(projectDir, ".claude", "settings.local.json")),
]);

if (bothChannelsOn(enabled)) {
  const output = payload.hook_event_name === "UserPromptSubmit" ? { decision: "block", reason: CHANNEL_CONFLICT } : { systemMessage: CHANNEL_CONFLICT };
  console.log(JSON.stringify(output));
}
