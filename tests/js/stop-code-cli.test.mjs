// Scenario: cli-paths-write-stop-code. Every CLI path that stops a run writes a stop.code.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gateQuestion } from "../../shared-node/gates.mjs";
import { validateLedger } from "../../shared-node/ledger.mjs";
import { STAGE_STOP_REASONS } from "../../shared-node/verbs.mjs";
import { ATTEMPT, ROOT, RUNNER_WITHOUT_SELECTOR, env, makeRepo, pb } from "./cli-repo-fixture.mjs";

// The three orStop call sites each stop a run for a different kind of failure, so each has its own code.
const CONFIG_KEY = `code-config.apply-config-change.-.r1.a${ATTEMPT}`;
const TESTS_KEY = `code-tdd.create-test-placeholders.-.r1.a${ATTEMPT}`;
const writeArtifact = (repo, key, content) => writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${key}.json`), JSON.stringify(content));
// The checkpoint's test run is the fake runner's `node fake.mjs`; this makes it pass and keeps fake.mjs out of the commit plan.
const passingSuite = (repo) => {
  writeFileSync(join(repo.dir, "fake.mjs"), "process.exit(0);\n");
  writeFileSync(join(repo.dir, ".git", "info", "exclude"), "fake.mjs\n");
};
const refusingPreCommitHook = (repo) => {
  const hook = join(repo.dir, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o755);
};
const returnOf = (key, over) => ({ pb_key: key, ambiguity: "", commit_subject: "set a", files_changed: [], ...over });

// A human's answer reaches the ledger through the PostToolUse hook on AskUserQuestion, after `pb gate eval` asked the
// question. Only tool_response counts, so the payload is the question the CLI emitted with the human's answer to it.
const tapAnswer = (repo, question, answer) => {
  const response = { questions: [question], answers: { [question.question]: answer } };
  const input = { hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", session_id: "stop-code-session", cwd: repo.dir, tool_input: response, tool_response: response };
  return spawnSync(process.execPath, [join(ROOT, "hooks", "tap.mjs")], { cwd: repo.dir, input: JSON.stringify(input), encoding: "utf8", timeout: 30_000, env: env() });
};

const GATE = "G:task-end";
const askedRepo = () => makeRepo({
  ledger: {
    stage: { name: "code-safety-net", status: "done", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [{ name: "code-safety-net", status: "done" }],
    needsHuman: { gate: GATE, reason: "the human decides", seq: 1 },
  },
});

// Every stopping path, set up and run once. Each entry returns the repo it stopped and the result of the command that stopped it.
const STOPPING_PATHS = {
  "stage stop agent-budget": () => { const repo = makeRepo(); return { repo, result: pb(repo, "stage", "stop", "agent-budget") }; },
  "stage stop step-failed": () => { const repo = makeRepo(); return { repo, result: pb(repo, "stage", "stop", "step-failed") }; },
  "stage finish with no artifact": () => { const repo = makeRepo(); return { repo, result: pb(repo, "stage", "finish") }; },
  "commit plan that shows no change": () => {
    const repo = makeRepo();
    writeArtifact(repo, CONFIG_KEY, returnOf(CONFIG_KEY, { files_changed: ["a.txt"] }));
    return { repo, result: pb(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY) };
  },
  "commit that git refuses": () => {
    const repo = makeRepo();
    writeFileSync(join(repo.dir, "a.txt"), "changed\n");
    passingSuite(repo);
    refusingPreCommitHook(repo);
    writeArtifact(repo, CONFIG_KEY, returnOf(CONFIG_KEY, { files_changed: ["a.txt"] }));
    return { repo, result: pb(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY) };
  },
  "runner with no selector template": () => {
    const repo = makeRepo({ ledger: { taskType: "bug_fix", stage: { name: "code-tdd", status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null } } });
    const row = { test_id: "t1", test_case_id: "c", scenario_id: "s", runner_id: RUNNER_WITHOUT_SELECTOR, test_file: "tests/a.mjs", test_function: "t1" };
    writeArtifact(repo, TESTS_KEY, returnOf(TESTS_KEY, { commit_subject: "add placeholders", tests: [row] }));
    return { repo, result: pb(repo, "checkpoint", "--step", "placeholders", "--from", TESTS_KEY) };
  },
  "human answering stop": () => { const repo = askedRepo(); const { status, stdout, stderr } = tapAnswer(repo, gateQuestion(GATE), "stop"); return { repo, result: { code: status, stdout, stderr } }; },
};
const stopOn = (name) => STOPPING_PATHS[name]();

describe("stage-stop-writes-code-per-reason", () => {
  test("the reasons covered are the reasons that exist", () => {
    assert.deepEqual(Object.keys(STAGE_STOP_REASONS).sort(), ["agent-budget", "step-failed"], "the reasons this suite covers");
  });

  for (const reason of ["agent-budget", "step-failed"]) {
    test(reason, () => {
      const { repo, result } = stopOn(`stage stop ${reason}`);

      assert.equal(result.code, 0, `pb stage stop ${reason}, stderr: ${result.stderr}`);
      const { stop } = repo.ledger();
      assert.equal(stop.code, reason, `${reason}: stop.code is the key it was given`);
    });
  }
});

test("stage-stop-first-stop-stands", () => {
  // Guards that a second stop leaves the first stop's code (not only its reason) unchanged.
  const { repo, result: setup } = stopOn("stage stop agent-budget");
  assert.equal(setup.code, 0, `setup: first pb stage stop, stderr: ${setup.stderr}`);
  const first = repo.ledger().stop;

  const result = pb(repo, "stage", "stop", "step-failed");

  assert.equal(result.code, 0, `second pb stage stop, stderr: ${result.stderr}`);
  const { stop } = repo.ledger();
  assert.equal(stop.code, "agent-budget", "the first stop's code stands");
  assert.deepEqual(stop, first, "the first stop is unchanged");
});

test("stage-finish-missing-artifact-writes-code", () => {
  const { repo, result } = stopOn("stage finish with no artifact");

  assert.equal(result.code, 1, `pb stage finish with no artifact must refuse, stderr: ${result.stderr}`);
  const { stop } = repo.ledger();
  assert.notEqual(stop, null, `the missing artifact stops the run: ${result.stderr}`);
  assert.equal(stop.code, "missing-artifact", "stop.code names the missing artifact");
});

describe("or-stop-failure-writes-code", () => {
  test("a commit plan that shows no change writes commit-plan-unusable", () => {
    const { repo, result } = stopOn("commit plan that shows no change");

    assert.equal(result.code, 1, `pb checkpoint lists a file that did not change, stderr: ${result.stderr}`);
    const { stop } = repo.ledger();
    assert.notEqual(stop, null, `the plan failure stops the run: ${result.stderr}`);
    assert.equal(stop.code, "commit-plan-unusable", "stop.code names the unusable commit plan");
  });

  test("a commit that git refuses writes commit-failed", () => {
    const { repo, result } = stopOn("commit that git refuses");

    assert.equal(result.code, 1, `pb checkpoint with a failing pre-commit hook, stderr: ${result.stderr}`);
    const { stop } = repo.ledger();
    assert.notEqual(stop, null, `the failed commit stops the run: ${result.stderr}`);
    assert.equal(stop.code, "commit-failed", "stop.code names the failed commit");
  });

  test("a runner with no selector template writes no-selector-template", () => {
    const { repo, result } = stopOn("runner with no selector template");

    assert.equal(result.code, 1, `pb checkpoint with a runner that has no selector_template, stderr: ${result.stderr}`);
    const { stop } = repo.ledger();
    assert.notEqual(stop, null, `the unselectable runner stops the run: ${result.stderr}`);
    assert.equal(stop.code, "no-selector-template", "stop.code names the missing selector template");
  });
});

test("human-stop-answer-writes-code", () => {
  const { repo, result } = stopOn("human answering stop");

  assert.equal(result.code, 0, `the tap hook, stderr: ${result.stderr}`);
  const { stop } = repo.ledger();
  assert.notEqual(stop, null, "the human's stop answer stops the run");
  assert.equal(stop.code, "human-stopped", "stop.code names the human's stop");
});

describe("ledger-written-by-each-path-validates", () => {
  for (const [name, run] of Object.entries(STOPPING_PATHS)) {
    test(name, () => {
      const { repo } = run();

      const ledger = repo.ledger();

      assert.notEqual(ledger.stop, null, `${name}: the path stopped the run`);
      const result = validateLedger(ledger);
      assert.equal(result.valid, true, `${name}: the ledger it wrote validates, errors: ${JSON.stringify(result.errors)}`);
    });
  }
});

// The reason text as it was written before stop codes, so a code is added beside the reason and never into it.
describe("reason-text-unchanged", () => {
  const reasonOf = (name) => {
    const { repo } = stopOn(name);
    const { stop } = repo.ledger();
    assert.notEqual(stop, null, `${name}: the path stopped the run`);
    return stop.reason;
  };

  test("stage stop agent-budget", () => {
    assert.equal(reasonOf("stage stop agent-budget"), "agent-budget: the stage spawned its maxAgents, and a re-run continues from tests{}");
  });

  test("stage stop step-failed", () => {
    assert.equal(reasonOf("stage stop step-failed"), "step-failed: a step of the stage failed past its retries, and a re-run continues from tests{}");
  });

  test("stage finish with no artifact", () => {
    assert.equal(reasonOf("stage finish with no artifact"), `stage code-config cannot finish at attempt ${ATTEMPT}: artifact:apply-config-change has no return at attempt ${ATTEMPT}; checkpoint:config has no checkpoint at attempt ${ATTEMPT}`);
  });

  test("commit plan that shows no change", () => {
    assert.equal(reasonOf("commit plan that shows no change"), "step config lists files that did not change: a.txt. pb stage fail clears this");
  });

  test("commit that git refuses", () => {
    assert.ok(reasonOf("commit that git refuses").startsWith("the commit failed: "), "the reason still opens with the commit failure");
  });

  test("runner with no selector template", () => {
    assert.equal(reasonOf("runner with no selector template"), `runner ${RUNNER_WITHOUT_SELECTOR} has no selector_template in test-config.json, so RED cannot speak for one test. Tell the human, who owns that file. pb stage fail clears this`);
  });

  test("human answering stop", () => {
    assert.equal(reasonOf("human answering stop"), `the human answered stop at ${GATE}`);
  });
});
