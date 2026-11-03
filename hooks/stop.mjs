#!/usr/bin/env node
// Stop hook: with a run open and no stage really running, tells the model the next action, so a turn cannot end with
// nobody told. A stop or a stage that never started leaves the stage active with nothing coming, so both are told. The
// block form is the one probe P5 recorded reaching the model. It also continues the turn, so a block must never repeat:
// one next action is told once per session, however many turns pass, and only a changed action blocks again. Each
// session keeps its own notice, so one cannot erase what another was told. A chain of changing actions ends at
// MAX_CHAIN, which bounds a loop that a changing action would not. A session that does not own the run is told nothing,
// unless the run has no owner, and Solo is told nothing because it stays on the old path until T10.
// stop_hook_active cannot be the guard: it stays true down the chain, so it would leave a second stage untold.
// Any failure stays silent, because a hook that errors here must not cost a turn. Built-ins only outside a run.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_CHAIN = 25;

const noticePath = (taskDir, sessionId) => join(taskDir, `stop-notice-${encodeURIComponent(sessionId)}.json`);

function readNotice(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeNotice(path, notice) {
  try {
    writeFileSync(path, JSON.stringify(notice));
    return true;
  } catch {
    return false;
  }
}

// A fresh turn starts a new chain. With no notice written the next call could not tell it had told, so inside a chain
// an unwritable notice means silence, which leaves at most one block a turn.
function shouldTell({ taskDir, action }, sessionId, inChain) {
  const path = noticePath(taskDir, sessionId);
  const prior = readNotice(path);
  const chain = inChain ? (prior?.chain ?? 0) + 1 : 1;
  if (prior?.action === action || chain > MAX_CHAIN) return false;
  return writeNotice(path, { action, chain }) || !inChain;
}

const isForSession = ({ running, action, owner }, sessionId) => !running && action !== null && (owner === null || owner === sessionId);

async function tellNextAction() {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const cwd = typeof payload.cwd === "string" && isAbsolute(payload.cwd) ? payload.cwd : process.cwd();
  const { findSessionRoot } = await import("../shared-node/run-root.mjs");
  const root = findSessionRoot(cwd, payload.session_id);
  if (root === null) return;
  const { readRun } = await import("../shared-node/next-action.mjs");
  const run = readRun(PLUGIN, root);
  if (isForSession(run, payload.session_id) && shouldTell(run, payload.session_id, payload.stop_hook_active === true)) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: `Pairing Buddy run at ${root}. ${run.action}` }));
  }
}

try {
  if (process.env.PAIRINGBUDDY_SOLO !== "true") await tellNextAction();
} catch {
  // Silent by design: see the header.
}
