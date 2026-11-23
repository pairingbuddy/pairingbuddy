// Scenario run-words: a stage's runs and its fixes are told in different words, so a model relaying them cannot blur them
// (live T4d run: "on its sixth attempt. This is the last fix attempt: 4 of 5 are used"). A stage's start, restarts
// included, is a "run"; a fix is a "fix". Neither is an "attempt" in what the main session reads.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { nextAction, runStatus } from "../../shared-node/next-action.mjs";
import { loadStages } from "../../shared-node/stages.mjs";

const PLUGIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONTRACT = loadStages(PLUGIN_ROOT);
const SAFETY_NET = { name: "code-safety-net", status: "active", runId: "wf_b2905538-c8a", attempt: 6, startedAt: "2026-11-23T19:01:24.437Z" };
const LIVE = { taskType: "new_feature", task: "t", stage: SAFETY_NET, stages: [], gates: {}, tests: {}, stop: null, needsHuman: null, spend: { agents: 193, tokens: 0, tokensKnown: false } };
const NO_ARTIFACTS = mkdtempSync(join(tmpdir(), "run-words-"));
const fixKey = (group, round) => `code-safety-net.fix.${group}.r${round}.a6`;

test("run-words: an active stage is told by its run, restarts counted, never by an attempt", () => {
  const action = nextAction(CONTRACT, LIVE, "/repo", PLUGIN_ROOT);

  assert.match(action, /^Stage code-safety-net is active on run 6 \(restarted 5 times\)\. Wait for its workflow\./);
  assert.doesNotMatch(action, /attempt/);
});

test("run-words: a stage whose workflow has not started yet is told by its run too", () => {
  const unstarted = { ...LIVE, stage: { ...SAFETY_NET, runId: null, startedAt: new Date().toISOString() } };

  const action = nextAction(CONTRACT, unstarted, "/repo", PLUGIN_ROOT);

  assert.match(action, /^Stage code-safety-net is active on run 6 \(restarted 5 times\) with no recorded workflow yet\./);
});

test("run-words: the status says the stage's run and its fixes in plain words, each its own", () => {
  const checkpoints = [fixKey("g1", 2), fixKey("g1", 3), fixKey("g2", 2), fixKey("g3", 2)].map((key) => ({ key, step: "fix", stage: "code-safety-net", attempt: 6 }));
  const ledger = { ...LIVE, checkpoints, fixes: { rollbacks: [{ key: fixKey("g1", 2), kind: "red" }] } };

  const { say } = runStatus(CONTRACT, ledger, NO_ARTIFACTS);

  assert.equal(say, "safety-net review: run 6 (restarted 5 times) · fixes: 4 tried, undone: 1 of 5 allowed");
});

test("run-words: a stage that tried no fix says only its run", () => {
  const firstRun = { ...LIVE, stage: { ...SAFETY_NET, name: "code-tdd", attempt: 1 } };

  assert.equal(runStatus(CONTRACT, firstRun, NO_ARTIFACTS).say, "build test by test: run 1");
});

test("run-words: a run with no stage started yet says so", () => {
  const opened = { ...LIVE, stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null } };

  assert.equal(runStatus(CONTRACT, opened, NO_ARTIFACTS).say, "no stage started yet");
});
