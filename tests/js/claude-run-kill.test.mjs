import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Budget, KilledError, runClaude } from "../smoke/claude-run.mjs";

// A fake `claude` first on PATH: it prints one stream event, starts a child of its own that would outlive it, writes
// both pids, and sleeps. Only a kill of the whole process group stops both.
function fakeClaude() {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const pids = join(dir, "pids");
  writeFileSync(join(dir, "claude"), `#!/bin/sh\nsleep 60 &\necho "$$ $!" > "${pids}"\necho '{"type":"system","subtype":"init","session_id":"s1"}'\nsleep 60\n`);
  chmodSync(join(dir, "claude"), 0o755);
  return { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, pids };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("claude-run-abort-kills-the-process-group-and-charges-the-run's-cap", { timeout: 10_000 }, async () => {
  const { env, pids } = fakeClaude();
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  const budget = new Budget(6);
  const controller = new AbortController();
  const lines = [];

  const running = runClaude(repo, "prompt", budget, { env, capUsd: 1.5, signal: controller.signal, onLine: (event) => {
    lines.push(event);
    controller.abort();
  } });

  await assert.rejects(running, KilledError, "an aborted run rejects with KilledError");
  assert.equal(lines.length, 1, "the event before the kill reached onLine");
  const [shell, child] = readFileSync(pids, "utf8").trim().split(" ").map(Number);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(alive(shell), false, "the claude process is gone");
  assert.equal(alive(child), false, "its child is gone too: the whole group was killed");
  assert.equal(budget.spent, 1.5, "a killed run reports no cost, so its whole cap is charged");
  assert.equal(budget.upperBound, true, "the spend is marked as an upper bound");
});
