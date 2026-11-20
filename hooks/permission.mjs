#!/usr/bin/env node
// Permission: Claude Code's own permission prompt is the human being needed. On the Notification Claude Code sends while a
// prompt stands unanswered (notification_type permission_prompt), it opens a permission wait in the run's ledger; on any later
// tool call, the turn's end or the human's next prompt, it closes the open one. Never blocks and never prints: every path exits 0.
// The ledger is read raw first, so a call with no open wait loads nothing more than the walk to the run.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPT = "permission_prompt";

function hasOpenWait(ledgerPath, openPermissionWait) {
  try {
    return openPermissionWait(JSON.parse(readFileSync(ledgerPath, "utf8"))) !== null;
  } catch {
    return false;
  }
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const { findSessionRoot } = await import("../shared-node/run-root.mjs");
  const root = findSessionRoot(input.cwd, input.session_id);
  const ledgerPath = root === null ? null : join(root, ".pairingbuddy", "run", "task", "ledger.json");
  if (ledgerPath !== null && existsSync(ledgerPath)) {
    const { answerPermission, askPermission, openPermissionWait, promptedTool } = await import("../shared-node/permission-wait.mjs");
    const at = new Date().toISOString();
    const asked = input.hook_event_name === "Notification" && input.notification_type === PROMPT;
    if (asked || hasOpenWait(ledgerPath, openPermissionWait)) {
      const { updateLedger } = await import("../shared-node/ledger.mjs");
      updateLedger(ledgerPath, (ledger) => (asked ? askPermission(ledger, { tool: promptedTool(input.message), at }) : answerPermission(ledger, at)));
    }
  }
} catch {
  // Not a run, or a ledger that cannot be written: the prompt still stands in Claude Code.
}
process.exit(0);
