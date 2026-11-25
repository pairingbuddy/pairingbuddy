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

// The script with backslash line continuations joined, so a multi-line command reads as one line.
function scriptLines() {
  return readFileSync(SOLO_SCRIPT, "utf8").replace(/\\\n\s*/g, " ").split("\n");
}

// A shell word without its surrounding single or double quotes.
const unquote = (word) => word.replace(/^(["'])(.*)\1$/, "$2");

// The file a command line writes its stdout to: the word after `>`, `>>` or `tee [-a]`, quotes removed.
function stdoutTarget(line) {
  const words = line.trim().split(/\s+/);
  const at = words.findIndex((word) => /^(>>?|tee|-a)$/.test(word) || /^>>?\S/.test(word));
  if (at === -1) return undefined;
  const word = words[at];
  if (/^>>?\S/.test(word)) return unquote(word.replace(/^>>?/, ""));
  return unquote(words[word === "tee" && words[at + 1] === "-a" ? at + 2 : at + 1] ?? "");
}

// A word with a "$NAME" or $NAME reference replaced by the value the script assigns to NAME at the top level.
function expandVariable(word, lines) {
  const reference = word.match(/^"?\$\{?(\w+)\}?"?$/);
  if (!reference) return word;
  const assignment = lines.map((line) => line.match(new RegExp(`^${reference[1]}=(\\S+)`))).find(Boolean);
  return assignment ? unquote(assignment[1]) : word;
}

test("claude-output-captured-to-stream-file", () => {
  const lines = scriptLines();
  const invocation = lines.find((line) => /^\s*claude\s+"\$\{CLAUDE_ARGS\[@\]\}"/.test(line));
  assert.ok(invocation, "solo-buddy.sh must invoke claude with CLAUDE_ARGS");

  const streamFile = expandVariable(stdoutTarget(invocation) ?? "", lines);
  assert.ok(streamFile?.startsWith(".pairingbuddy/"), `the claude invocation must write its output under .pairingbuddy, got: ${invocation.trim()}`);

  const rendererReads = lines.flatMap((line) => [...line.matchAll(/\bread_state_line\s+(\S+)/g)].map((match) => expandVariable(unquote(match[1]), lines)));
  assert.ok(
    rendererReads.includes(streamFile),
    `the renderer must read the file claude writes to (${streamFile}) as the first argument of read_state_line; it reads: ${rendererReads.join(", ")}`,
  );
});
