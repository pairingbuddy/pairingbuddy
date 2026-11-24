import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// solo-buddy.sh invokes claude with an output format that supplies task_progress and
// task_notification events (stream-json, per P14 and D14), and keeps the captured output for the renderer.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOLO_SCRIPT = join(REPO_ROOT, "scripts", "solo-buddy.sh");

// Every CLAUDE_ARGS=(...) and CLAUDE_ARGS+=(...) block, which may span lines.
function claudeArgsBlocks() {
  const source = readFileSync(SOLO_SCRIPT, "utf8");
  return [...source.matchAll(/^\s*CLAUDE_ARGS\+?=\(([^)]*)\)/gm)].map((match) => match[1]);
}

test("claude-args-use-output-format-per-p14", () => {
  const blocks = claudeArgsBlocks();
  assert.ok(blocks.length > 0, "solo-buddy.sh must define CLAUDE_ARGS");

  const formats = blocks.flatMap((block) => [...block.matchAll(/--output-format[ =]+(\S+)/g)].map((match) => match[1]));

  assert.deepEqual(formats, ["stream-json"], `CLAUDE_ARGS must carry exactly one --output-format, stream-json, got: ${blocks.join(" | ")}`);
});

test("claude-output-captured-to-stream-file", () => {
  const source = readFileSync(SOLO_SCRIPT, "utf8");
  const invocation = source.split("\n").find((line) => /^\s*claude\s+"\$\{CLAUDE_ARGS\[@\]\}"/.test(line));
  assert.ok(invocation, "solo-buddy.sh must invoke claude with CLAUDE_ARGS");

  const written = invocation.match(/(?:>>?|\btee\s+(?:-a\s+)?)\s*"?(\.pairingbuddy\/[^\s"|;&]+)/);
  assert.ok(written, `the claude invocation must write its output under .pairingbuddy, got: ${invocation.trim()}`);

  const streamFile = written[1];
  const renderer = source.match(/read_state_line\s+"([^"]+)"/g) ?? [];
  assert.ok(
    renderer.some((call) => call.includes(`"${streamFile}"`)),
    `the renderer must read the file claude writes to (${streamFile}); renderer reads: ${renderer.join(", ")}`,
  );
});
