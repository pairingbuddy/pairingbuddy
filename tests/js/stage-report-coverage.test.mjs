// Task 49: what the code-tdd report makes of the coverage loop. Each round of verify-test-coverage returns the gaps it
// still sees, so only the newest round of the attempt speaks for the stage, and a coverage check is no lens round.
import "./isolated-tmpdir.mjs";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildReport, closeStage } from "../../shared-node/stage-run.mjs";

const STAGE = { name: "code-tdd", status: "active", runId: "wf_1", attempt: 2, startedAt: null };
const LEDGER = { stage: STAGE, stages: [], tests: {}, checkpoints: [] };
const coverageKey = (round, attempt = 2) => `code-tdd.verify-test-coverage.-.r${round}.a${attempt}`;
const gap = (id) => ({ scenario_id: "s1", test_case_id: id, description: `no test for ${id}` });

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function artifactsWith(returns) {
  const dir = mkdtempSync(join(tmpdir(), "pb-report-"));
  dirs.push(dir);
  for (const [key, fields] of Object.entries(returns)) writeFileSync(join(dir, `${key}.json`), JSON.stringify({ pb_key: key, ambiguity: "", ...fields }));
  return dir;
}

test("the report's gaps are the newest coverage round's, not every round's", () => {
  const dir = artifactsWith({ [coverageKey(1)]: { gaps: [gap("c1"), gap("c2")] }, [coverageKey(2)]: { gaps: [gap("c2")] } });

  assert.deepEqual(buildReport(LEDGER, dir).gaps, [gap("c2")]);
});

test("a later round that closed every gap leaves the report with none", () => {
  const dir = artifactsWith({ [coverageKey(1)]: { gaps: [gap("c1")] }, [coverageKey(2)]: { gaps: [] } });

  assert.deepEqual(buildReport(LEDGER, dir).gaps, []);
});

test("a coverage check is no lens round, so the report still says none ran", () => {
  const dir = artifactsWith({ [coverageKey(1)]: { gaps: [] } });

  assert.ok(buildReport(LEDGER, dir).notCovered.some((line) => /no lens round/.test(line)));
});

test("a coverage return from an earlier attempt is not this attempt's", () => {
  const dir = artifactsWith({ [coverageKey(5, 1)]: { gaps: [gap("c1")] }, [coverageKey(1)]: { gaps: [] } });

  assert.deepEqual(buildReport(LEDGER, dir).gaps, []);
});

test("closing a stage keeps the startedAt it began with on its stages[] entry", () => {
  const startedAt = "2026-11-03T07:10:29.429Z";
  const ledger = { ...LEDGER, stage: { ...STAGE, startedAt }, spend: { agents: 0, tokens: 0 } };

  const closed = closeStage(ledger, "done", 1);

  assert.equal(closed.stages.find(({ name }) => name === STAGE.name).startedAt, startedAt);
});
