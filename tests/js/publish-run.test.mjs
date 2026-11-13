// Publish run, CLI side: pb run open --kind publish, pb status --action on a publish run, keep local ending the run,
// pb task end refusing inside it, and pb publish closing it. The unit is opened by the real pb unit open and the publish
// run is reached through the real pr-draft stage path (publishRun in publishable-unit-fixture says how); only the task
// record pb task end would append is seeded.
import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { updateLedger, validateLedger } from "../../shared-node/ledger.mjs";
import { readRun } from "../../shared-node/next-action.mjs";
import { pbCommand } from "../../shared-node/verbs.mjs";
import { makeRepo, pb, pbWithEnv, ROOT } from "./cli-repo-fixture.mjs";
import { FAKE_PR_URL, installGhShim } from "./gh-shim-fixture.mjs";
import { REFUSED, evalGate, git, gitConfigPath, keepLocalThroughTap, readUnitRecord, unitFile } from "./publish-fixture.mjs";
import {
  CONTEXT, TASK, changeLedger, changeUnit, endedTaskUnit, ledgerFile, localRefs, makePrivateRefs, openRun, privateRefsOf, publishRun, publishUnit,
  publishableUnit, remoteRef, runDirOf, statusAction, taskDirOf, writeTaskJson,
} from "./publishable-unit-fixture.mjs";
import { sha256 } from "./tap-fixture.mjs";

const NO_RUN = /no run here/;

const readText = (path) => readFileSync(path, "utf8");

const openPublishRun = (repo) => openRun(repo, "publish");
const openCodeRun = (repo) => openRun(repo, "code");

// A repo with no unit at all, on a branch that is not protected, so run open reaches its own checks.
const repoWithoutUnit = () => makeRepo({ openTask: false });

// The refusal as a deliberate one: exit 1, stderr matching, no catch-all text and no stack trace.
function assertRefused(result, pattern) {
  assert.equal(result.code, REFUSED, `a refusal exits 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "a deliberate refusal");
  assert.doesNotMatch(result.stderr, /\n\s+at\s|node:internal/, "no stack trace");
}

describe("publish-run-open-happy-path", () => {
  test("opens-publish-ledger", () => {
    const repo = endedTaskUnit();

    const result = pb(repo, "run", "open", "--kind", "publish");

    assert.equal(result.code, 0, `run open --kind publish: ${result.stderr}`);
    const printed = JSON.parse(result.stdout);
    assert.equal(printed.ok, true);
    assert.equal(printed.kind, "publish");
    assert.equal(printed.branch, git(repo, "rev-parse", "--abbrev-ref", "HEAD"));
    assert.equal(printed.runDir, taskDirOf(repo));
    assert.ok(existsSync(join(taskDirOf(repo), "artifacts")), "artifacts/ exists");
    const ledger = repo.ledger();
    assert.equal(validateLedger(ledger).valid, true, "the ledger validates");
    assert.equal(ledger.kind, "publish");
    assert.equal(ledger.taskType, "publish");
    assert.equal(ledger.stage.name, "");
    assert.deepEqual([ledger.stages, ledger.gates, ledger.commits], [[], {}, []]);
    assert.equal(ledger.stop, null);
    assert.equal(ledger.needsHuman, null);
    assert.ok(typeof ledger.runId === "string" && ledger.runId !== "", "a runId");
  });

  test("classification-is-not-read", () => {
    const repo = endedTaskUnit();
    writeFileSync(join(repo.dir, ".pairingbuddy", "task-classification.json"), JSON.stringify({ task_type: "new_feature", rationale: "test" }));

    const result = pb(repo, "run", "open", "--kind", "publish");

    assert.equal(result.code, 0, `a runner without selector_template is no bar: ${result.stderr}`);
    assert.equal(repo.ledger().taskType, "publish", "never the classified type");
  });

  test("stores-task-and-hashes", () => {
    const repo = endedTaskUnit();

    openPublishRun(repo);

    const ledger = repo.ledger();
    assert.equal(ledger.task, `${TASK}\n\n${CONTEXT}`);
    assert.equal(ledger.configHash, sha256(readText(join(repo.dir, ".pairingbuddy", "test-config.json"))));
    assert.equal(ledger.gitConfigHash, sha256(readText(gitConfigPath(repo))));
  });

  test("status-names-pr-draft-first", () => {
    const repo = endedTaskUnit();
    openPublishRun(repo);

    const status = pb(repo, "status");

    assert.equal(status.code, 0, status.stderr);
    assert.deepEqual(JSON.parse(status.stdout).next, { stage: "pr-draft", attempt: 1 });
  });
});

describe("publish-run-open-refuses-without-unit", () => {
  test("no-unit-refuses", () => {
    const repo = repoWithoutUnit();

    const result = pb(repo, "run", "open", "--kind", "publish");

    assertRefused(result, /no unit is open[^\n]*unit\.json/);
    assert.equal(existsSync(taskDirOf(repo)), false, "no run/task");
  });

  const unreadable = { "not JSON": "this is not json", "no tasks array": JSON.stringify({ branch: "feature" }) };
  for (const [name, text] of Object.entries(unreadable)) {
    test(`unreadable-unit-refuses: ${name}`, () => {
      const repo = repoWithoutUnit();
      writeFileSync(unitFile(repo), text);

      const result = pb(repo, "run", "open", "--kind", "publish");

      assertRefused(result, /unit\.json/);
      assert.equal(existsSync(taskDirOf(repo)), false, "no run/task");
    });
  }
});

describe("publish-run-open-refuses-unit-with-no-ended-task", () => {
  test("empty-tasks-refuses", () => {
    const repo = endedTaskUnit({ tasks: [] });
    const before = readText(unitFile(repo));

    const result = pb(repo, "run", "open", "--kind", "publish");

    assertRefused(result, /no ended task/);
    assert.match(result.stderr, /task end/, "it names pb task end");
    assert.equal(existsSync(taskDirOf(repo)), false, "no run/task");
    assert.equal(readText(unitFile(repo)), before, "unit.json is unchanged");
  });
});

describe("publish-run-open-refuses-a-partial-plan-unit", () => {
  const twoTaskPlan = "# Plan\n\n#### PR: Export\n\n- [ ] Task A\n- [ ] Task B\n";

  test("a plan unit with a task that has no record refuses, naming it", () => {
    const repo = endedTaskUnit({ tasks: [{ title: "Task A" }] });
    writeFileSync(join(repo.dir, ".pairingbuddy", "plan.md"), twoTaskPlan);
    changeUnit(repo, { plan: ".pairingbuddy/plan.md", unit: "Export" });
    const before = readText(unitFile(repo));

    const result = pb(repo, "run", "open", "--kind", "publish");

    assertRefused(result, /no task record: Task B[^\n]*no publish run was opened/);
    assert.match(result.stderr, /task end/, "it names pb task end");
    assert.doesNotMatch(result.stderr, /Task A/, "the ended task is not named");
    assert.equal(existsSync(taskDirOf(repo)), false, "no run/task");
    assert.equal(readText(unitFile(repo)), before, "unit.json is unchanged");
  });

  test("a plan unit whose tasks all have a record opens", () => {
    const repo = endedTaskUnit({ tasks: [{ title: "Task A" }, { title: "Task B" }] });
    writeFileSync(join(repo.dir, ".pairingbuddy", "plan.md"), twoTaskPlan);
    changeUnit(repo, { plan: ".pairingbuddy/plan.md", unit: "Export" });

    assert.equal(openPublishRun(repo).kind, "publish");
  });
});

describe("publish-run-open-refuses-open-task-run", () => {
  test("open-task-run-refuses", () => {
    const repo = endedTaskUnit();
    openCodeRun(repo);
    const [ledgerBefore, unitBefore] = [readText(ledgerFile(repo)), readText(unitFile(repo))];

    const result = pb(repo, "run", "open", "--kind", "publish");

    assertRefused(result, /already active[^\n]*no publish run was opened/);
    assert.match(result.stderr, /task end/, "it names pb task end");
    assert.equal(readText(ledgerFile(repo)), ledgerBefore, "the ledger is unchanged");
    assert.equal(readText(unitFile(repo)), unitBefore, "unit.json is unchanged");
  });

  test("stopped-task-run-refuses-with-its-reason", () => {
    const repo = endedTaskUnit();
    openCodeRun(repo);
    updateLedger(ledgerFile(repo), (ledger) => ({ ...ledger, stop: { code: "human-stopped", reason: "stopped by the human", seq: ledger.seq + 1 } }));
    const [ledgerBefore, unitBefore] = [readText(ledgerFile(repo)), readText(unitFile(repo))];

    const result = pb(repo, "run", "open", "--kind", "publish");

    assertRefused(result, /stopped by the human/);
    assert.doesNotMatch(result.stderr, /task run is still open/, "the stop's own refusal, not the publish-run one");
    assert.equal(readText(ledgerFile(repo)), ledgerBefore, "the ledger is unchanged");
    assert.equal(readText(unitFile(repo)), unitBefore, "unit.json is unchanged");
  });
});

describe("publish-run-open-one-refusal-per-state", () => {
  test("an open run refuses the same way whether or not its ledger reads", () => {
    const readable = endedTaskUnit();
    openCodeRun(readable);
    const unreadable = endedTaskUnit();
    openCodeRun(unreadable);
    writeFileSync(ledgerFile(unreadable), "not a ledger");

    const [a, b] = [readable, unreadable].map((repo) => pb(repo, "run", "open", "--kind", "publish"));

    assertRefused(a, /already active/);
    assertRefused(b, /already active/);
    const wording = (stderr) => stderr.replace(/at \S+/, "at DIR");
    assert.equal(wording(a.stderr), wording(b.stderr));
  });
});

describe("ledger-kind-and-task-type-agree", () => {
  test("a publish ledger with another task type, and another kind with taskType publish, are invalid", () => {
    const repo = endedTaskUnit();
    openPublishRun(repo);
    const ledger = JSON.parse(readText(ledgerFile(repo)));

    assert.equal(validateLedger(ledger).valid, true);
    assert.equal(validateLedger({ ...ledger, taskType: "new_feature" }).valid, false);
    assert.equal(validateLedger({ ...ledger, kind: "code" }).valid, false);
    assert.equal(validateLedger({ ...ledger, kind: "code", taskType: "new_feature" }).valid, true);
  });
});

describe("publish-run-open-refuses-second-publish-run", () => {
  test("second-publish-open-refuses", () => {
    const repo = endedTaskUnit();
    openPublishRun(repo);
    const before = readText(ledgerFile(repo));

    const result = pb(repo, "run", "open", "--kind", "publish");

    assertRefused(result, /already active[^\n]*no publish run was opened/);
    assert.match(result.stderr, /status --action/, "it names the way on");
    assert.equal(readText(ledgerFile(repo)), before, "the first publish ledger is unchanged");
  });

  test("code-open-refused-inside-publish-run", () => {
    const repo = endedTaskUnit();
    openPublishRun(repo);
    const before = readText(ledgerFile(repo));

    const result = pb(repo, "run", "open", "--kind", "code");

    assertRefused(result, /already active/);
    assert.doesNotMatch(result.stderr, /publish run/, "a code open says no more than the claim");
    assert.equal(readText(ledgerFile(repo)), before, "the publish ledger is unchanged");
  });
});

describe("publish-run-action-walks-pr-draft-then-gate", () => {
  test("action-starts-pr-draft", () => {
    const repo = endedTaskUnit();
    openPublishRun(repo);

    const action = statusAction(repo);

    assert.match(action, /Start the workflow pairingbuddy:pr-draft by name/);
    const args = JSON.parse(/with the args (\{.*\})\./.exec(action)[1]);
    assert.deepEqual(args, { attempt: 1, pluginRoot: ROOT, task: { description: `${TASK}\n\n${CONTEXT}` } });
  });

  test("action-says-gate-eval-after-draft", () => {
    const { repo } = publishRun({ approve: false });

    const action = statusAction(repo);

    assert.match(action, /Gate G:publish is due/);
    assert.ok(action.includes(pbCommand("gate eval")), "it names pb gate eval");
  });

  test("action-holds-on-needs-human", () => {
    const { repo } = publishRun({ approve: false });
    evalGate(repo);

    const action = statusAction(repo);

    assert.match(action, /Gate G:publish needs the human/);
    assert.match(action, /human approve G:publish/, "it shows the human command");
    assert.equal(action.includes(pbCommand("publish")), false, "it does not name pb publish");
    assert.equal(action.includes(pbCommand("task end")), false, "it does not name pb task end");
  });
});

describe("publish-run-action-names-pb-publish-when-approved", () => {
  test("approved-action-is-pb-publish", () => {
    const { repo } = publishRun();

    const action = statusAction(repo);

    assert.ok(action.includes(pbCommand("publish")), `the action names pb publish: ${action}`);
    assert.equal(action.includes("task end"), false, "the action does not name task end");
  });

  test("a keep-local answer is not read as an approval", () => {
    const { repo } = publishRun({ approve: false });
    changeLedger(repo, (ledger) => ({ gates: { ...ledger.gates, "G:publish": { source: "human", answer: "keep-local" } } }));

    const action = statusAction(repo);

    assert.match(action, /keep local/);
    assert.ok(action.includes(pbCommand("publish")), `it names pb publish to finish closing: ${action}`);
    assert.equal(action.includes("approved"), false, "it does not say approved");
  });

  test("an auto record at G:publish is not an approval either: the gate is due", () => {
    const { repo } = publishRun({ approve: false });
    changeLedger(repo, (ledger) => ({ gates: { ...ledger.gates, "G:publish": { source: "auto" } } }));

    const action = statusAction(repo);

    assert.ok(action.includes(pbCommand("gate eval")), `the gate is due: ${action}`);
    assert.equal(action.includes(`${pbCommand("publish")}.`), false, "it does not name pb publish");
  });

  test("regression-guard-code-run-still-says-task-end", () => {
    const repo = makeRepo({
      ledger: {
        taskType: "config_change",
        stage: { name: "code-safety-net", status: "done", runId: "r1", attempt: 1 },
        stages: [{ name: "code-config", status: "done" }, { name: "code-safety-net", status: "done" }],
        gates: { "G:task-end": { source: "auto" } },
      },
    });

    const action = statusAction(repo);

    assert.ok(action.includes(pbCommand("task end")), `a code run still ends with task end: ${action}`);
  });
});

describe("refresh-run-action-names-pr-refresh", () => {
  const refreshPublishRun = (answer) => {
    const { repo } = publishRun({ approve: false });
    changeLedger(repo, (ledger) => ({ kind: "refresh", taskType: "refresh", gates: { ...ledger.gates, "G:publish": answer } }));
    return repo;
  };

  test("approved-refresh-action-is-pr-refresh", () => {
    const repo = refreshPublishRun({ source: "human", answer: "approve" });

    const action = statusAction(repo);

    assert.ok(action.includes(pbCommand("pr refresh")), `the action names pb pr refresh: ${action}`);
    assert.equal(action.includes(pbCommand("publish")), false, `it does not name pb publish: ${action}`);
  });

  test("keep-local-refresh-action-is-pr-refresh", () => {
    const repo = refreshPublishRun({ source: "human", answer: "keep-local" });

    const action = statusAction(repo);

    assert.ok(action.includes(pbCommand("pr refresh")), `the action names pb pr refresh: ${action}`);
    assert.equal(action.includes(pbCommand("publish")), false, `it does not name pb publish: ${action}`);
    assert.match(action, /left unchanged/, `the action says the PR is left unchanged: ${action}`);
  });
});

describe("keep-local-ends-publish-run", () => {
  test("keep-local-removes-run-task", () => {
    const unit = publishRun({ approve: false, commits: 2 });
    const { repo, branch } = unit;
    makePrivateRefs(repo, branch);
    const refsBefore = localRefs(repo).sort();
    const tip = git(repo, "rev-parse", "HEAD");
    const { baseSha } = readUnitRecord(repo);
    const commits = git(repo, "rev-list", "--reverse", `${baseSha}..HEAD`);

    const gh = keepLocalThroughTap(repo);

    assert.deepEqual(readdirSync(runDirOf(repo)).sort(), [".gitignore"], "only run/.gitignore remains");
    assert.equal(existsSync(taskDirOf(repo)), false, "run/task is gone");
    assert.equal(git(repo, "rev-parse", branch), tip, "the branch tip is unchanged");
    assert.equal(git(repo, "rev-list", "--reverse", `${baseSha}..HEAD`), commits, "the commits are unchanged");
    assert.deepEqual(localRefs(repo).sort(), refsBefore, "the refs/pairingbuddy refs survive");
    assert.deepEqual(refsBefore, privateRefsOf(branch).sort(), "the unit's own refs were there to survive");
    assert.equal(remoteRef(repo, `refs/heads/${branch}`), null, "nothing was pushed");
    assert.deepEqual(gh.calls(), [], "gh was not called");
  });

  test("next-code-not-blocked-after-keep-local", () => {
    const { repo } = publishRun({ approve: false });

    keepLocalThroughTap(repo);

    const status = pb(repo, "status");
    assert.equal(status.code, REFUSED);
    assert.match(status.stderr, NO_RUN);
    assert.equal(readRun(ROOT, repo.dir).action, null, "the Stop hook has no action to tell");
  });
});

describe("task-end-refuses-publish-run", () => {
  test("task-end-refused-in-publish-run", () => {
    const { repo } = publishRun();
    const unitBefore = readText(unitFile(repo));

    const result = pb(repo, "task", "end");

    assertRefused(result, /publish run/);
    assert.ok(result.stderr.includes(pbCommand("publish")), `it names pb publish: ${result.stderr}`);
    assert.equal(existsSync(ledgerFile(repo)), true, "run/task/ledger.json stays");
    assert.equal(readText(unitFile(repo)), unitBefore, "unit.json's tasks are unchanged");
  });
});

describe("pb-publish-uses-and-closes-publish-run", () => {
  test("no-run-refuses", () => {
    const repo = endedTaskUnit();
    const gh = installGhShim();

    const result = pbWithEnv(repo, gh.env({ PAIRINGBUDDY_GATE_POLICY: undefined }), "publish");

    assertRefused(result, NO_RUN);
    assert.deepEqual(gh.calls(), [], "no gh call");
  });

  // Everything pb publish asks for is in place and G:publish is approved; the one thing that differs from a publish run
  // is the run's kind, which is flipped by hand because no real path leaves a code run with an approved G:publish.
  test("refused-inside-an-open-code-run", () => {
    const unit = publishableUnit();
    changeLedger(unit.repo, () => ({ kind: "code", taskType: "new_feature" }));
    const [ledgerBefore, unitBefore] = [readText(ledgerFile(unit.repo)), readText(unitFile(unit.repo))];

    const { gh, result } = publishUnit(unit);

    assertRefused(result, /needs a publish run.*code run.*task end.*run open --kind publish/);
    assert.deepEqual(gh.calls(), [], "no gh call");
    assert.equal(readText(ledgerFile(unit.repo)), ledgerBefore, "the code run is untouched");
    assert.equal(readText(unitFile(unit.repo)), unitBefore, "unit.json is unchanged");
  });

  test("published-removes-publish-run", () => {
    const unit = publishRun();

    const { result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    const printed = JSON.parse(result.stdout);
    assert.equal(printed.result, "published");
    assert.equal(printed.url, FAKE_PR_URL);
    assert.ok(Array.isArray(printed.warnings), "warnings");
    assert.equal(existsSync(taskDirOf(unit.repo)), false, "run/task is gone");
    assert.equal(existsSync(unitFile(unit.repo)), false, "the unit files are gone");
    const status = pb(unit.repo, "status");
    assert.equal(status.code, REFUSED);
    assert.match(status.stderr, NO_RUN);
  });

  const closing = {
    skip: () => publishRun({ commits: 0, approve: false }),
    local: () => publishRun({ publishMode: "none" }),
  };
  for (const [expected, make] of Object.entries(closing)) {
    test(`${expected}-removes-publish-run`, () => {
      const unit = make();

      const { result } = publishUnit(unit);

      assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
      assert.equal(JSON.parse(result.stdout).result, expected);
      assert.equal(existsSync(taskDirOf(unit.repo)), false, "run/task is gone");
      assert.equal(existsSync(unitFile(unit.repo)), false, "the unit files are gone");
    });
  }

  test("refusal-keeps-publish-run", () => {
    const unit = publishRun({ fullSuite: { passed: true, head: "a".repeat(40) } });
    const unitBefore = readText(unitFile(unit.repo));

    const { gh, result } = publishUnit(unit);

    assertRefused(result, /pb test --full|not published/);
    assert.deepEqual(gh.calls(), [], "gh was not called");
    assert.equal(existsSync(ledgerFile(unit.repo)), true, "run/task/ledger.json stays");
    assert.equal(readText(unitFile(unit.repo)), unitBefore, "unit.json stays");
  });
});

describe("next-action-auto-pass", () => {
  test("next-action-names-pb-publish-for-bound-auto-pass", () => {
    const lens = { lenses: ["bugs"], findings: 0 };
    const { repo } = publishRun({ approve: false, mode: "auto", cleanLenses: true, tasks: [{ lenses: { "safety-net": lens } }] });
    assert.equal(evalGate(repo).result, "auto-pass", "the auto policy passes G:publish by itself");

    const action = statusAction(repo);

    assert.ok(action.includes(pbCommand("publish")), `the action names pb publish: ${action}`);
    assert.equal(action.includes(pbCommand("gate eval")), false, "it does not send the run back to pb gate eval");
  });
  // The next-action side of a bare auto record is covered by "an auto record at G:publish is not an approval either"; this is
  // the complementary check on the gate itself: eval voids the bare record and asks.
  test("next-action-bare-auto-says-gate-due", () => {
    const { repo } = publishRun({ approve: false });
    changeLedger(repo, (ledger) => ({ gates: { ...ledger.gates, "G:publish": { source: "auto" } } }));

    const asked = evalGate(repo);

    assert.equal(asked.result, "needs-human");
    assert.equal(Object.hasOwn(repo.ledger().gates, "G:publish"), false, "the bare record is voided out of the gates");
    assert.deepEqual(repo.ledger().voidedGates.map(({ record }) => record), [{ source: "auto" }]);
    assert.match(repo.ledger().voidedGates[0].reason, /carries no binding/, "the void reason says the record has no binding");
  });
});
