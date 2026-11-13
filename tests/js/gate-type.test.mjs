import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildKey } from "../../shared-node/keys.mjs";
import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { RUNNER_WITHOUT_SELECTOR, makeRepo, pb } from "./cli-repo-fixture.mjs";
import { INTAKE_DONE } from "./ledger-fixture.mjs";

// Placeholders for Task 92. Each one becomes a real test before its code is written.

const G_TYPE = "G:type";

// A run whose intake is done at attempt 1 and whose G:type has no record yet, with the intake classify-task return filed.
// testConfig, when given, replaces the repo's test-config.json and the ledger's configHash follows it.
function repoAtTypeGate({ confidence, taskType = "config_change", mode = "auto", stageAttempt = 1, returnAttempt = 1, testConfig, stop, extraReturns = [] }) {
  const repo = makeRepo();
  const taskDir = join(repo.dir, ".pairingbuddy", "run", "task");
  const ledgerPath = join(taskDir, "ledger.json");
  const { gates: { [G_TYPE]: _passed, ...gates }, ...ledger } = readLedger(ledgerPath);
  const configHash = testConfig === undefined ? ledger.configHash : createHash("sha256").update(testConfig).digest("hex");
  if (testConfig !== undefined) writeFileSync(join(repo.dir, ".pairingbuddy", "test-config.json"), testConfig);
  writeLedger(ledgerPath, {
    ...ledger,
    configHash,
    ...(stop === undefined ? {} : { stop }),
    taskType,
    policy: { mode, source: "permission_mode" },
    stage: { name: "intake", status: "done", runId: "wf_1", attempt: stageAttempt, startedAt: null },
    stages: [INTAKE_DONE],
    gates,
  });
  for (const { role, item = null, round, attempt = returnAttempt, ...body } of extraReturns) {
    const key = buildKey({ stage: "intake", role, item, round, attempt });
    writeFileSync(join(taskDir, "artifacts", `${key}.json`), JSON.stringify({ pb_key: key, ambiguity: "", task_type: taskType, rationale: "test", ...body }));
  }
  if (confidence === undefined) return repo;
  const pbKey = buildKey({ stage: "intake", role: "classify-task", item: null, round: 1, attempt: returnAttempt });
  writeFileSync(join(taskDir, "artifacts", `${pbKey}.json`), JSON.stringify({ pb_key: pbKey, ambiguity: "", task_type: taskType, confidence, rationale: "test" }));
  return repo;
}

test("gate-type-passes-when-certain-under-auto", () => {
  const repo = repoAtTypeGate({ confidence: "certain" });

  const result = pb(repo, "gate", "eval");

  assert.equal(result.code, 0, `pb gate eval exits 0, stderr ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, result: "auto-pass", gate: G_TYPE, source: "auto" }, "a certain classification passes G:type under auto");
});
function evalNeedsHuman(repo) {
  const result = pb(repo, "gate", "eval");
  assert.equal(result.code, 0, `pb gate eval exits 0, stderr ${result.stderr}`);
  return JSON.parse(result.stdout);
}

for (const confidence of ["likely", "unsure"]) {
  test(`gate-type-asks-when-likely-or-unsure (${confidence})`, () => {
    const repo = repoAtTypeGate({ confidence });

    const out = evalNeedsHuman(repo);

    assert.equal(out.result, "needs-human", `a ${confidence} classification asks at G:type`);
    assert.match(out.reason, /classifier does not report certain/, "the reason names the classifier");
  });
}

test("gate-type-asks-without-classification-return", () => {
  const repo = repoAtTypeGate({});

  const out = evalNeedsHuman(repo);

  assert.equal(out.result, "needs-human", "no classify-task return asks at G:type");
});

test("gate-type-ignores-voided-return", () => {
  const repo = repoAtTypeGate({ confidence: "certain", stageAttempt: 2, returnAttempt: 1 });

  const out = evalNeedsHuman(repo);

  assert.equal(out.result, "needs-human", "an attempt-1 return does not count once intake is at attempt 2");
});

test("gate-type-asks-under-non-auto-policy-even-when-certain", () => {
  const repo = repoAtTypeGate({ confidence: "certain", mode: "default" });

  const out = evalNeedsHuman(repo);

  assert.equal(out.result, "needs-human", "a non-auto policy asks at G:type");
  assert.match(out.reason, /the gate policy is default, not auto/, "the reason is the policy");
});

test("gate-type-asks-when-runner-lacks-selector-template", () => {
  const repo = repoAtTypeGate({ confidence: "certain", taskType: "bug_fix" });

  const out = evalNeedsHuman(repo);

  assert.equal(out.result, "needs-human", "a runner without selector_template asks at G:type");
  assert.ok(out.reason.includes(RUNNER_WITHOUT_SELECTOR), "the reason names the runner");
  assert.match(out.reason, /selector_template/, "the reason names selector_template");
  assert.ok(out.reason.startsWith(`runner ${RUNNER_WITHOUT_SELECTOR} has no selector_template`), "one runner is named in the singular");
});

test("gate-type-passes-when-every-runner-has-a-selector-template", () => {
  const testConfig = JSON.stringify({ source_directory: ".", runners: { fake: { name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [], selector_template: ["{test_file}::{test_function}"] } }, default_runner: "fake" });
  const repo = repoAtTypeGate({ confidence: "certain", taskType: "bug_fix", testConfig });

  const result = pb(repo, "gate", "eval");

  assert.equal(result.code, 0, `pb gate eval exits 0, stderr ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, result: "auto-pass", gate: G_TYPE, source: "auto" }, "a certain bug_fix whose runners all select one test passes G:type");
});

test("gate-type-names-the-missing-selector-before-the-classifier", () => {
  const repo = repoAtTypeGate({ confidence: "likely", taskType: "bug_fix" });

  const out = evalNeedsHuman(repo);

  assert.match(out.reason, /selector_template/, "the selector problem, which needs the run abandoned, is the reason given");
});

test("gate-type-gives-a-stop-before-its-own-reason", () => {
  const repo = repoAtTypeGate({ confidence: "likely", stop: { reason: "agent-budget", seq: 0, code: "agent-budget" } });

  const out = evalNeedsHuman(repo);

  assert.match(out.reason, /^the run stopped: agent-budget/, "the stop is the reason, not the classifier");
});

test("certain-kept-fix-after-likely-first-passes", () => {
  const repo = repoAtTypeGate({ confidence: "likely", extraReturns: [{ role: "fix", item: "g1", round: 2, confidence: "certain" }] });

  const result = pb(repo, "gate", "eval");

  assert.equal(result.code, 0, `pb gate eval exits 0, stderr ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, result: "auto-pass", gate: G_TYPE, source: "auto" }, "the kept fix's certain classification, not the likely first one, decides G:type");
});
test("likely-kept-fix-after-certain-first-asks", () => {
  const repo = repoAtTypeGate({ confidence: "certain", extraReturns: [{ role: "fix", item: "g1", round: 2, confidence: "likely" }] });

  const out = evalNeedsHuman(repo);

  assert.equal(out.result, "needs-human", "the kept fix's likely classification, not the certain first one, decides G:type");
  assert.match(out.reason, /classifier does not report certain/, "the reason names the classifier");
});

test("open-survivor-without-kept-fix-asks-under-auto", () => {
  const repo = repoAtTypeGate({ confidence: "certain" });
  const survivor = { id: "f1", lens: "classification", class: "fix", blocking: true, rule: "type-fits-task", message: "the task reads as a bug fix, not a config change" };
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "report.json"), JSON.stringify({ stage: "intake", attempt: 1, survivors: [survivor], refuted: [], unrefuted: [], uncovered: [], gaps: [] }));

  const out = evalNeedsHuman(repo);

  assert.equal(out.result, "needs-human", "an open classification finding asks at G:type under auto");
  assert.match(out.reason, /classification lens has an open finding/, "the reason names the classification lens");
});
test("survivor-with-kept-fix-passes", () => {
  const repo = repoAtTypeGate({ confidence: "certain", extraReturns: [{ role: "fix", item: "g1", round: 2, confidence: "certain" }] });
  const survivor = { id: "f1", lens: "classification", class: "fix", blocking: true, rule: "type-fits-task", message: "the task reads as a bug fix, not a config change" };
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "report.json"), JSON.stringify({ stage: "intake", attempt: 1, survivors: [survivor], refuted: [], unrefuted: [], uncovered: [], gaps: [] }));

  const result = pb(repo, "gate", "eval");

  assert.equal(result.code, 0, `pb gate eval exits 0, stderr ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, result: "auto-pass", gate: G_TYPE, source: "auto" }, "a kept fix return stands in for the open classification finding, so G:type passes under auto");
});
test("non-blocking-survivor-passes", () => {
  const repo = repoAtTypeGate({ confidence: "certain" });
  const survivor = { id: "f1", lens: "classification", class: "fix", blocking: false, message: "the task text could also read as a refactoring" };
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "report.json"), JSON.stringify({ stage: "intake", attempt: 1, survivors: [survivor], refuted: [], unrefuted: [], uncovered: [], gaps: [] }));

  const result = pb(repo, "gate", "eval");

  assert.equal(result.code, 0, `pb gate eval exits 0, stderr ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, result: "auto-pass", gate: G_TYPE, source: "auto" }, "a non-blocking survivor is not an open finding, so G:type passes under auto");
});

const BLOCKING_SURVIVOR = { id: "f1", lens: "classification", class: "fix", blocking: true, rule: "type-fits-task", message: "the task reads as a bug fix, not a config change" };
const writeReport = (repo, attempt = 1) => writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "report.json"), JSON.stringify({ stage: "intake", attempt, survivors: [BLOCKING_SURVIVOR], refuted: [], unrefuted: [], uncovered: [], gaps: [] }));

test("voided-fix-does-not-stand-in-for-open-survivor", () => {
  const repo = repoAtTypeGate({ confidence: "certain", stageAttempt: 2, returnAttempt: 2, extraReturns: [{ role: "fix", item: "g1", round: 2, attempt: 1, confidence: "certain" }] });
  writeReport(repo, 2);

  const out = evalNeedsHuman(repo);

  assert.equal(out.result, "needs-human", "an attempt-1 fix does not count as kept once intake is at attempt 2");
  assert.match(out.reason, /classification lens has an open finding/, "the reason names the classification lens");
});
test("gate-type-names-the-missing-selector-before-the-lens", () => {
  const repo = repoAtTypeGate({ confidence: "certain", taskType: "bug_fix" });
  writeReport(repo);

  const out = evalNeedsHuman(repo);

  assert.match(out.reason, /selector_template/, "the selector problem, which needs the run abandoned, is the reason given");
});
test("gate-type-names-the-classifier-before-the-lens", () => {
  const repo = repoAtTypeGate({ confidence: "likely" });
  writeReport(repo);

  const out = evalNeedsHuman(repo);

  assert.match(out.reason, /classifier does not report certain/, "the classifier's doubt is the reason given");
});
test("another-stage-fix-return-does-not-decide-g-type", () => {
  const repo = repoAtTypeGate({ confidence: "certain" });
  const key = buildKey({ stage: "code-scenarios", role: "fix", item: "g1", round: 3, attempt: 1 });
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${key}.json`), JSON.stringify({ pb_key: key, confidence: "likely" }));

  const result = pb(repo, "gate", "eval");

  assert.equal(result.code, 0, `pb gate eval exits 0, stderr ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, result: "auto-pass", gate: G_TYPE, source: "auto" }, "only intake's own returns decide G:type");
});
