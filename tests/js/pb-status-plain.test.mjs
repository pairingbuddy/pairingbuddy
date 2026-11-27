// Scenario pb-status-plain: a human who runs pb status in a terminal reads a few plain lines, not one raw JSON line
// (recovery drill: the CONTRIBUTING recipe has the human run it). A pipe, as a model's Bash call is, still gets JSON.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { statusText } from "../../shared-node/next-action.mjs";

const CLI = fileURLToPath(new URL("../../cli/pb.mjs", import.meta.url));
const CONFIG = `${JSON.stringify({ runners: { pytest: { command: "pytest", test_directory: "tests", run_args: [] } }, default_runner: "pytest" })}\n`;

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

// A repo on a unit branch with a code run open.
function openRun() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-status-")));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  git(dir, "checkout", "-q", "-b", "feature/x");
  mkdirSync(join(dir, ".pairingbuddy"));
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), CONFIG);
  const opened = spawnSync("node", [CLI, "run", "open", "--kind", "code"], { cwd: dir, encoding: "utf8" });
  assert.equal(opened.status, 0, opened.stderr);
  return dir;
}

// pb status run in a pseudo-terminal, through script(1), whose flags differ between macOS and Linux.
function inTerminal(cwd, ...args) {
  const command = process.platform === "darwin" ? ["script", ["-q", "/dev/null", "node", CLI, ...args]] : ["script", ["-qec", ["node", CLI, ...args].join(" "), "/dev/null"]];
  const result = spawnSync(command[0], command[1], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // script echoes the end of its input (^D and two backspaces on macOS) and the terminal ends lines with \r\n.
  return { ...result, stdout: result.stdout.replace(/\^D\x08\x08/g, "").replace(/\r/g, "") };
}

const NOW = Date.parse("2026-11-22T10:10:00.000Z");
const ACTIVE = { name: "code-tdd", status: "active", runId: "wf_1", attempt: 2, startedAt: "2026-11-22T10:00:00.000Z" };

test("an active stage reads by its plain name, its status and which run of it this is, with the owner and when it was last seen", () => {
  const text = statusText({ stage: ACTIVE, stop: null, needsHuman: null, next: null }, { owner: "session-A", lastSeen: "2026-11-22T10:07:00.000Z", now: NOW });

  assert.deepEqual(text.split("\n"), [
    "Stage:     build test by test (code-tdd), active, run 2 (restarted once)",
    "Owner:     session session-A, last seen 3 minutes ago",
    "Next:      wait for the stage to finish",
  ]);
});

test("a stop and a question waiting each get their line, the gate by its plain name and the id a human types", () => {
  const status = { stage: ACTIVE, stop: { code: "step-failed", reason: "the stage failed three times", seq: 3 }, needsHuman: { gate: "G:task-end", seq: 4 }, next: null };

  const lines = statusText(status, { owner: null, now: NOW }).split("\n");

  assert.deepEqual(lines.slice(1), [
    "Owner:     none",
    "Stopped:   a step kept failing: the stage failed three times",
    "Needs you: your sign-off at the end (G:task-end)",
    "Next:      nothing runs until you act on the stop",
  ]);
});

test("a stop that knows why says what happened and lists what the human can do", () => {
  const stop = { code: "red-passes", reason: "test t1 already passes", seq: 3, why: "t1 passed before any code", detail: "test t1 already passes, before any code was written.", options: ["Cut it.", "Keep it as a regression guard."] };

  const lines = statusText({ stage: ACTIVE, stop, needsHuman: null, next: null }, { owner: null, now: NOW }).split("\n");

  assert.deepEqual(lines.slice(2, 6), [
    "Stopped:   a test passed before any code: t1 passed before any code",
    "Why:       test t1 already passes, before any code was written.",
    "You can:   1. Cut it.",
    "           2. Keep it as a regression guard.",
  ]);
});

test("between stages, next names the stage to start and which run of it that is", () => {
  const status = { stage: { name: "code-scenarios", status: "done", runId: null, attempt: 1, startedAt: null }, stop: null, needsHuman: null, next: { stage: "code-tdd", attempt: 1 } };

  assert.match(statusText(status, { owner: null, now: NOW }), /^Next: {6}build test by test \(code-tdd\), run 1$/m);
});

test("in a terminal pb status prints the plain lines", () => {
  const dir = openRun();

  const result = inTerminal(dir, "status");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Stage: +none yet$/m, result.stdout);
  assert.doesNotMatch(result.stdout, /"ok":/, result.stdout);
});

test("in a terminal --json still prints the JSON", () => {
  const dir = openRun();

  const result = inTerminal(dir, "status", "--action", "--json");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).ok, true);
});

test("through a pipe, as a model's Bash call reads it, pb status prints JSON", () => {
  const dir = openRun();

  const result = spawnSync("node", [CLI, "status"], { cwd: dir, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test("a person reading pb status is told as you, never as the human", () => {
  const status = { stage: { name: "code-tdd", status: "active", attempt: 1 }, stop: { code: "human-stopped", reason: "the human answered stop at G:task-end", seq: 1 }, needsHuman: null, next: null };

  const text = statusText(status, { owner: null, lastSeen: null, now: Date.now() });

  assert.match(text, /you answered stop at G:task-end/, text);
  assert.doesNotMatch(text, /the human/, text);
});

test("a gate question's raw reason is told as you", async () => {
  const { gateQuestion } = await import("../../shared-node/gates.mjs");

  const { question } = gateQuestion("G:task-end", { reason: "the human's keep local answer no longer holds for a pending check" });

  assert.doesNotMatch(question, /the human/, question);
  assert.match(question, /your keep local answer/, question);
});
