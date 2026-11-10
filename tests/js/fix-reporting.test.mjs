// Scenario: fix-reporting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLedger } from "../../shared-node/ledger.mjs";
import { buildReport } from "../../shared-node/stage-run.mjs";
import { makeRepo as makeCliRepo, pb as pbCli } from "./cli-repo-fixture.mjs";
import { rollbackHeading, parseFixNotes } from "../../shared-node/fix-notes.mjs";

const MAX_ATTEMPTS = JSON.parse(readFileSync(new URL("../../contracts/lenses.json", import.meta.url), "utf8")).maxAttempts;

// Writes a ledger that is ready for `pb task end`: config hash matches, stages done, task-end gate passed.
function makeReadyToEndTask(repo, doneStage) {
  const pbDir = join(repo.dir, ".pairingbuddy");
  const configText = readFileSync(join(pbDir, "test-config.json"), "utf8");
  writeLedger(join(pbDir, "run", "task", "ledger.json"), {
    ...repo.ledger(),
    task: "Task A",
    configHash: createHash("sha256").update(configText).digest("hex"),
    stage: { name: doneStage, status: "done", runId: "wf_2", attempt: 1, startedAt: null },
    stages: [{ name: "code-config", status: "done", attempt: 1 }, { name: doneStage, status: "done", attempt: 1 }],
    gates: { "G:task-end": { source: "auto" } },
  });
}

// Test case: build-report-fixes-block
test("buildReport returns fixes {attempts, rolledBack, maxAttempts, lessons} with attempts counted as distinct fix keys across checkpoints and rollbacks", () => {
  const run = mkdtempSync(join(tmpdir(), "fix-reporting-"));
  try {
    const artifacts = join(run, "task", "artifacts");
    mkdirSync(artifacts, { recursive: true });
    mkdirSync(join(run, "task", "notes"), { recursive: true });
    const kept = "code-safety-net.fix.g1.r2.a2";
    const rolled = "code-safety-net.fix.g2.r3.a2";
    const earlier = "code-safety-net.fix.g1.r2.a1";
    const otherStage = "code-scenarios.fix.g1.r2.a1";
    writeFileSync(join(run, "task", "notes", "code-safety-net.md"),
      `${rollbackHeading(1, earlier)}\nthe first fix broke the parser\n\n${rollbackHeading(2, rolled)}\nthe second fix removed a test\n`);
    const ledger = {
      stage: { name: "code-safety-net", status: "active", runId: "wf_1", attempt: 2, startedAt: null },
      tests: {},
      taskType: "new_feature",
      checkpoints: [
        { step: "fix", key: kept, committed: true, sha: "a1", stage: "code-safety-net", attempt: 2 },
        { step: "fix", key: rolled, committed: true, sha: "a2", stage: "code-safety-net", attempt: 2 },
        { step: "docs", key: "code-safety-net.docs.-.r1.a2", committed: true, sha: "a3", stage: "code-safety-net", attempt: 2 },
        { step: "fix", key: otherStage, committed: true, sha: "a4", stage: "code-scenarios", attempt: 1 },
      ],
      fixes: { rollbacks: [{ key: earlier, kind: "red" }, { key: rolled, kind: "red" }, { key: otherStage, kind: "red" }] },
    };

    const report = buildReport(ledger, artifacts);

    assert.deepEqual(report.fixes, {
      attempts: 3,
      rolledBack: 2,
      maxAttempts: MAX_ATTEMPTS,
      lessons: [
        { number: 1, key: earlier, text: "the first fix broke the parser" },
        { number: 2, key: rolled, text: "the second fix removed a test" },
      ],
    }, "fixes counts this stage's distinct fix keys and its rollbacks, and carries the cap and the lessons");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});
// Test case: notes-parser-reads-rollback-headings
test("The notes parser turns '## Rollback <n>: <key>' sections into [{number, key, text}] and returns an empty list for empty input", () => {
  const key1 = "code-safety-net.fix.g1.r2.a1";
  const key2 = "code-safety-net.fix.g2.r3.a2";
  const written = (number, key, body) => `${rollbackHeading(number, key)}\n\n${body}\n\n`;
  const text = written(1, key1, "the first fix broke the parser") + written(2, key2, "the second fix\nremoved a test\nand hid the failure");

  const entries = parseFixNotes(text);

  assert.deepEqual(entries, [
    { number: 1, key: key1, text: "the first fix broke the parser" },
    { number: 2, key: key2, text: "the second fix\nremoved a test\nand hid the failure" },
  ], "each rollback section becomes an entry, in file order, with a multi-line body kept whole");
  assert.deepEqual(parseFixNotes(""), [], "empty input gives an empty list");
});
// Test case: status-shows-fixes
test("pb status shows fixes for the current stage in the same shape", () => {
  const key = "code-safety-net.fix.g1.r2.a1";
  const repo = makeCliRepo({
    ledger: {
      stage: { name: "code-safety-net", status: "active", runId: "wf_1", attempt: 1, startedAt: null },
      checkpoints: [{ step: "fix", key, committed: true, sha: "a1", stage: "code-safety-net", attempt: 1 }],
      fixes: { rollbacks: [{ key, kind: "commit", ref: null, sha: null, base: null }] },
    },
  });
  const notes = join(repo.dir, ".pairingbuddy", "run", "task", "notes");
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, "code-safety-net.md"), `${rollbackHeading(1, key)}\nthe fix broke the parser\n`);

  const result = pbCli(repo, "status");

  assert.equal(result.code, 0, `status exits 0, stderr: ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout).fixes, {
    attempts: 1,
    rolledBack: 1,
    maxAttempts: MAX_ATTEMPTS,
    lessons: [{ number: 1, key, text: "the fix broke the parser" }],
  }, "status carries the same fixes block as the report");
});
// Test case: task-end-records-lessons
test("pb task end puts every notes entry of the task into the unit.json task record's lessons as {stage, number, key, text}", () => {
  const net = "code-safety-net";
  const scenarios = "code-scenarios";
  const repo = makeCliRepo({ openTask: false, remote: true });
  const opened = pbCli(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `unit open: ${opened.stderr}`);
  const run = pbCli(repo, "run", "open", "--kind", "code");
  assert.equal(run.code, 0, `run open: ${run.stderr}`);
  makeReadyToEndTask(repo, net);
  const pbDir = join(repo.dir, ".pairingbuddy");
  const notes = join(pbDir, "run", "task", "notes");
  mkdirSync(notes, { recursive: true });
  const keyS = "code-scenarios.fix.g1.r2.a1";
  const keyN1 = "code-safety-net.fix.g1.r2.a1";
  const keyN2 = "code-safety-net.fix.g2.r3.a2";
  writeFileSync(join(notes, `${scenarios}.md`), `${rollbackHeading(1, keyS)}\n\nthe scenarios fix dropped a case\n\n`);
  writeFileSync(join(notes, `${net}.md`),
    `${rollbackHeading(1, keyN1)}\n\nthe first fix broke the parser\n\n${rollbackHeading(2, keyN2)}\n\nthe second fix removed a test\n\n`);

  const result = pbCli(repo, "task", "end");

  assert.equal(result.code, 0, `task end exits 0, stderr: ${result.stderr}`);
  const unit = JSON.parse(readFileSync(join(pbDir, "run", "unit.json"), "utf8"));
  assert.deepEqual(unit.tasks[0].lessons, [
    { stage: net, number: 1, key: keyN1, text: "the first fix broke the parser" },
    { stage: net, number: 2, key: keyN2, text: "the second fix removed a test" },
    { stage: scenarios, number: 1, key: keyS, text: "the scenarios fix dropped a case" },
  ], "the task record carries every notes entry of the task, tagged with its stage, in notes file-name order then file order");
});
// Test case: tdd-state-hands-on-kept-scenarios-fix
test("pb tdd state hands on the newest standing scenarios return from either the enumerator or a fix in code-scenarios, newest by attempt then round", () => {
  const enumerated = "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1";
  const fixed = "code-scenarios.fix.g1.r2.a1";
  const repo = makeCliRepo({
    ledger: {
      stage: { name: "code-tdd", status: "active", runId: "wf_1", attempt: 1, startedAt: null },
      stages: [{ name: "code-scenarios", status: "done", attempt: 1 }],
    },
  });
  const artifacts = join(repo.dir, ".pairingbuddy", "run", "task", "artifacts");
  writeFileSync(join(artifacts, `${enumerated}.json`), JSON.stringify({ pb_key: enumerated, ambiguity: "", scenarios: [] }));
  writeFileSync(join(artifacts, `${fixed}.json`), JSON.stringify({ pb_key: fixed, ambiguity: "", scenarios: [] }));

  const result = pbCli(repo, "tdd", "state");

  assert.equal(result.code, 0, `tdd state exits 0, stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).scenarios, `.pairingbuddy/run/task/artifacts/${fixed}.json`, "the kept fix return is handed on, not the enumerator's");

  const laterAttempt = "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a2";
  writeFileSync(join(artifacts, `${laterAttempt}.json`), JSON.stringify({ pb_key: laterAttempt, ambiguity: "", scenarios: [] }));

  const again = pbCli(repo, "tdd", "state");

  assert.equal(again.code, 0, `tdd state exits 0, stderr: ${again.stderr}`);
  assert.equal(JSON.parse(again.stdout).scenarios, `.pairingbuddy/run/task/artifacts/${laterAttempt}.json`, "a higher-attempt enumerator return beats a later-round fix return");
});

// Test case: tdd-state-ignores-fix-return-from-another-stage
test("pb tdd state does not hand on a newer fix return from code-safety-net as the scenarios", () => {
  const enumerated = "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1";
  const netFix = "code-safety-net.fix.g1.r2.a3";
  const repo = makeCliRepo({
    ledger: {
      stage: { name: "code-tdd", status: "active", runId: "wf_1", attempt: 1, startedAt: null },
      stages: [{ name: "code-scenarios", status: "done", attempt: 1 }],
    },
  });
  const artifacts = join(repo.dir, ".pairingbuddy", "run", "task", "artifacts");
  writeFileSync(join(artifacts, `${enumerated}.json`), JSON.stringify({ pb_key: enumerated, ambiguity: "", scenarios: [] }));
  writeFileSync(join(artifacts, `${netFix}.json`), JSON.stringify({ pb_key: netFix, ambiguity: "", scenarios: [] }));

  const result = pbCli(repo, "tdd", "state");

  assert.equal(result.code, 0, `tdd state exits 0, stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).scenarios, `.pairingbuddy/run/task/artifacts/${enumerated}.json`, "a safety-net fix return is not the scenarios, however new");
});
// Test case: tdd-state-ignores-enumerator-return-with-an-item
test("pb tdd state does not count an enumerator return under a key with an item as the scenarios", () => {
  const withItem = "code-scenarios.enumerate-scenarios-and-test-cases.t1.r1.a1";
  const repo = makeCliRepo({
    ledger: {
      stage: { name: "code-tdd", status: "active", runId: "wf_1", attempt: 1, startedAt: null },
      stages: [{ name: "code-scenarios", status: "done", attempt: 1 }],
    },
  });
  const artifacts = join(repo.dir, ".pairingbuddy", "run", "task", "artifacts");
  writeFileSync(join(artifacts, `${withItem}.json`), JSON.stringify({ pb_key: withItem, ambiguity: "", scenarios: [] }));

  const result = pbCli(repo, "tdd", "state");

  assert.equal(result.code, 1, `tdd state refuses, stderr: ${result.stderr}`);
  assert.match(result.stderr, /no scenarios return stands/, "an enumerator return with an item is not the scenarios");
});
// Test case: tdd-state-skips-voided-attempt-scenarios
test("pb tdd state skips a scenarios return from an attempt that failed and was replaced", () => {
  const voided = "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1";
  const repo = makeCliRepo({
    ledger: {
      stage: { name: "code-tdd", status: "active", runId: "wf_1", attempt: 1, startedAt: null },
      stages: [{ name: "code-scenarios", status: "failed", attempt: 1 }, { name: "code-scenarios", status: "done", attempt: 2 }],
    },
  });
  const artifacts = join(repo.dir, ".pairingbuddy", "run", "task", "artifacts");
  writeFileSync(join(artifacts, `${voided}.json`), JSON.stringify({ pb_key: voided, ambiguity: "", scenarios: [] }));

  const result = pbCli(repo, "tdd", "state");

  assert.equal(result.code, 1, `tdd state refuses, stderr: ${result.stderr}`);
  assert.match(result.stderr, /no scenarios return stands/, "a failed attempt's scenarios return does not stand");
});
// Test case: task-end-ignores-non-markdown-notes
test("pb task end ignores a file in run/task/notes that is not a .md file", () => {
  const net = "code-safety-net";
  const repo = makeCliRepo({ openTask: false, remote: true });
  assert.equal(pbCli(repo, "unit", "open", "--type", "feat", "--slug", "x").code, 0, "unit open");
  assert.equal(pbCli(repo, "run", "open", "--kind", "code").code, 0, "run open");
  makeReadyToEndTask(repo, net);
  const pbDir = join(repo.dir, ".pairingbuddy");
  const notes = join(pbDir, "run", "task", "notes");
  mkdirSync(notes, { recursive: true });
  const key = "code-safety-net.fix.g1.r2.a1";
  writeFileSync(join(notes, `${net}.md`), `${rollbackHeading(1, key)}\n\nthe fix broke the parser\n\n`);
  writeFileSync(join(notes, "scratch.txt"), `${rollbackHeading(1, key)}\n\nnot a rollback note\n\n`);

  const result = pbCli(repo, "task", "end");

  assert.equal(result.code, 0, `task end exits 0, stderr: ${result.stderr}`);
  const unit = JSON.parse(readFileSync(join(pbDir, "run", "unit.json"), "utf8"));
  assert.deepEqual(unit.tasks[0].lessons, [{ stage: net, number: 1, key, text: "the fix broke the parser" }], "only the .md note counts");
});
