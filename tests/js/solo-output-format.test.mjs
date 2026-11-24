import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// solo-buddy.sh invokes claude with an output format that supplies task_progress and
// task_notification events (stream-json, per P14 and D14), and keeps the captured output for the renderer.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOLO_SCRIPT = join(REPO_ROOT, "scripts", "solo-buddy.sh");

function claudeArgsLine() {
  const lines = readFileSync(SOLO_SCRIPT, "utf8").split("\n");
  return lines.find((line) => line.startsWith("CLAUDE_ARGS=")) ?? "";
}

test("claude-args-use-output-format-per-p14", () => {
  const line = claudeArgsLine();

  assert.match(line, /--output-format stream-json\b/, `CLAUDE_ARGS must carry --output-format stream-json, got: ${line}`);
});

test("claude-output-captured-to-stream-file", () => {
  assert.fail("not implemented: The claude invocation writes its output to the stream file the renderer reads, and the file is under .pairingbuddy");
});
