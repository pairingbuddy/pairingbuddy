#!/usr/bin/env node
// Stop hook: with a run open and no stage active, tells the model the next action, so a turn cannot end with nobody
// told. The block form is the one probe P5 recorded reaching the model. It also continues the turn, so a block must
// never repeat: one next action is told once per session, however many turns pass, and only a changed action blocks
// again. A chain of changing actions ends at MAX_CHAIN, which bounds a loop that a changing action would not.
// stop_hook_active cannot be the guard: it stays true down the chain, so it would leave a second stage untold.
// Any failure stays silent, because a hook that errors here must not cost a turn. Built-ins only outside a run.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));
const NOTICE_FILE = "stop-notice.json";
const MAX_CHAIN = 25;

function readNotice(taskDir, sessionId) {
  try {
    const notice = JSON.parse(readFileSync(join(taskDir, NOTICE_FILE), "utf8"));
    return notice?.sessionId === sessionId ? notice : null;
  } catch {
    return null;
  }
}

function writeNotice(taskDir, notice) {
  try {
    writeFileSync(join(taskDir, NOTICE_FILE), JSON.stringify(notice));
    return true;
  } catch {
    return false;
  }
}

// A fresh turn starts a new chain. With no notice written the next call could not tell it had told, so inside a chain
// an unwritable notice means silence, which leaves at most one block a turn.
function shouldTell({ taskDir, action }, sessionId, inChain) {
  const prior = readNotice(taskDir, sessionId);
  const chain = inChain ? (prior?.chain ?? 0) + 1 : 1;
  if (prior?.action === action || chain > MAX_CHAIN) return false;
  return writeNotice(taskDir, { sessionId, action, chain }) || !inChain;
}

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const cwd = typeof payload.cwd === "string" && isAbsolute(payload.cwd) ? payload.cwd : process.cwd();
  const { findSessionRoot } = await import("../shared-node/run-root.mjs");
  const root = findSessionRoot(cwd, payload.session_id);
  if (root !== null) {
    const { readRun } = await import("../shared-node/next-action.mjs");
    const run = readRun(PLUGIN, root);
    if (!run.active && run.action !== null && shouldTell(run, payload.session_id, payload.stop_hook_active === true)) {
      process.stdout.write(JSON.stringify({ decision: "block", reason: `Pairing Buddy run at ${root}. ${run.action}` }));
    }
  }
} catch {
  // Silent by design: see the header.
}
