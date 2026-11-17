// Scenario kept-runs-pruned: keeping a run keeps the runs of the last MAX_KEPT_TASKS ended tasks and removes older ones.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_KEPT_TASKS, keepRun } from "../../shared-node/unit-files.mjs";

const NEW_UNIT = { branch: "feat/new", baseSha: "a".repeat(40) };

// A .pairingbuddy folder whose run/ is ending run "new-run" of unit feat/new, with reports/runs/ already holding `kept`.
function pairingWith(kept) {
  const pairing = mkdtempSync(join(tmpdir(), "kept-runs-"));
  const runDir = join(pairing, "run");
  mkdirSync(join(runDir, "task"), { recursive: true });
  writeFileSync(join(runDir, "task", "ledger.json"), JSON.stringify({ runId: "new-run" }));
  writeFileSync(join(runDir, "unit.json"), JSON.stringify(NEW_UNIT));
  for (const { runId, unit, endedAt } of kept) {
    const dir = join(pairing, "reports", "runs", runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ledger.json"), JSON.stringify({ runId }));
    if (unit !== undefined) writeFileSync(join(dir, "kept.json"), JSON.stringify({ unit, endedAt }));
  }
  return { runDir, runs: join(pairing, "reports", "runs") };
}

// The nth older task, one run each, ended n minutes after a fixed past time.
const olderTask = (n) => ({ runId: `run-${n}`, unit: `feat/t${n} sha${n}`, endedAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString() });

test("keeping-a-run-removes-the-runs-of-tasks-past-the-limit", () => {
  const older = Array.from({ length: MAX_KEPT_TASKS + 1 }, (_, n) => olderTask(n));
  const { runDir, runs } = pairingWith(older);

  keepRun(runDir);

  const left = readdirSync(runs).sort();
  assert.equal(MAX_KEPT_TASKS, 20, "the last 20 ended tasks are kept");
  assert.equal(left.length, MAX_KEPT_TASKS, "the new task and the 19 newest before it");
  assert.ok(left.includes("new-run"), "the run just kept stays");
  assert.equal(existsSync(join(runs, "run-0")), false, "the oldest task's run is removed");
  assert.equal(existsSync(join(runs, "run-1")), false, "so is the next oldest");
  assert.ok(existsSync(join(runs, "run-2")), "the 19th newest stays");
});

// A code run and its publish run name one unit: they are one task, kept or removed together, dated by the later one.
test("the-runs-of-one-task-count-once-and-go-together", () => {
  const older = Array.from({ length: MAX_KEPT_TASKS }, (_, n) => olderTask(n + 1));
  const codeRunOfOldest = { runId: "run-1-code", unit: older[0].unit, endedAt: olderTask(0).endedAt };
  const codeRunOfNewest = { runId: `run-${MAX_KEPT_TASKS}-code`, unit: older.at(-1).unit, endedAt: olderTask(0).endedAt };
  const { runDir, runs } = pairingWith([...older, codeRunOfOldest, codeRunOfNewest]);

  keepRun(runDir);

  assert.equal(existsSync(join(runs, "run-1")), false, "the oldest task's publish run is removed");
  assert.equal(existsSync(join(runs, "run-1-code")), false, "and its code run with it");
  assert.ok(existsSync(join(runs, `run-${MAX_KEPT_TASKS}-code`)), "a kept task's early code run stays, dated by its task's last run");
  assert.equal(readdirSync(runs).length, MAX_KEPT_TASKS + 1, "20 tasks stay, one of them with two runs");
});

// Whatever the dates say (a clock set back), the task whose run is being kept keeps all its runs.
test("the-task-being-kept-is-never-removed", () => {
  const future = (n) => ({ ...olderTask(n), endedAt: new Date(Date.UTC(2100, 0, 1, 0, n)).toISOString() });
  const later = Array.from({ length: MAX_KEPT_TASKS }, (_, n) => future(n));
  const earlierRun = { runId: "new-run-code", unit: `${NEW_UNIT.branch} ${NEW_UNIT.baseSha}`, endedAt: olderTask(0).endedAt };
  const { runDir, runs } = pairingWith([...later, earlierRun]);

  keepRun(runDir);

  assert.ok(existsSync(join(runs, "new-run")), "the run just kept stays");
  assert.ok(existsSync(join(runs, "new-run-code")), "and so does the earlier run of its task");
  assert.equal(existsSync(join(runs, "run-0")), false, "the oldest other task gives way instead");
  assert.equal(readdirSync(runs).length, MAX_KEPT_TASKS + 1, "20 tasks stay, the kept one with two runs");
});

// A folder pb did not mark as kept is no ended task's run: it is never removed, and it takes no task's place.
test("a-run-folder-without-kept-json-is-never-removed", () => {
  const older = Array.from({ length: MAX_KEPT_TASKS + 1 }, (_, n) => olderTask(n));
  const unmarked = { runId: "run-unmarked" };
  const { runDir, runs } = pairingWith([unmarked, ...older]);

  keepRun(runDir);

  assert.ok(existsSync(join(runs, "run-unmarked")), "the unmarked folder stays");
  assert.ok(existsSync(join(runs, "run-2")), "and the 19 newest marked tasks stay beside the new one");
  assert.equal(existsSync(join(runs, "run-1")), false, "the tasks past the limit still go");
});
