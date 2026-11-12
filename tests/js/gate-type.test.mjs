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
function repoAtTypeGate({ confidence, taskType = "config_change", mode = "auto", stageAttempt = 1, returnAttempt = 1, testConfig, stop }) {
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
