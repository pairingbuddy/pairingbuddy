// The pure planning of pb publish: publishSteps(facts) and its helpers, with no git, gh or files.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { NO_COMMITS_REASON, PR_URL, branchShapeProblem, evidenceRefusals, foreignPrReason, publishSteps, pushArgv, unitRefPrefix } from "../../shared-node/publish.mjs";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const task = (over = {}) => ({ title: "Task A", stages: ["code-safety-net"], gateSources: {}, blocking: [], fullSuite: { passed: true, head: HEAD }, ...over });

// Facts under which a publish goes through; over replaces fields.
const facts = (over = {}) => ({
  unit: { branch: "feat/x", tasks: [task()], commits: [HEAD] },
  runStop: null, publishMode: undefined, commits: [HEAD], taskRunOpen: false, changedConfigs: [], approval: "human", voidReason: null, lint: { status: "ok", ok: true, failures: [] },
  safetyNets: ["code-safety-net"], planBoxes: null, planProblem: null, head: HEAD, dirty: [],
  branchProblem: null, branchIsProtected: false, currentBranch: "feat/x", branchTip: HEAD, remoteSha: null,
  ...over,
});

const stepNames = (plan) => plan.steps.map((step) => step.do);

describe("publishSteps: a publish", () => {
  test("For a publishable fact set, the step list has a comment step after open-pr and before plan-line and close, in that order", () => {
    const plan = publishSteps(facts());

    assert.deepEqual(plan.refusals, []);
    assert.deepEqual(stepNames(plan), ["push", "set-upstream", "open-pr", "comment", "plan-line", "delete-refs", "close"]);
    assert.deepEqual(plan.steps[0], { do: "push", sha: HEAD, branch: "feat/x" }, "the push is of the approved SHA");
    assert.equal(plan.steps.at(-1).result, "published");
  });

  test("skips the push only when the remote is at the approved SHA", () => {
    assert.deepEqual(stepNames(publishSteps(facts({ remoteSha: HEAD }))).slice(0, 2), ["set-upstream", "open-pr"], "remote at HEAD: no push");
    assert.equal(stepNames(publishSteps(facts({ remoteSha: OLD })))[0], "push", "remote elsewhere: push");
  });

  test("a retry with a recorded url carries it to open-pr, which verifies it", () => {
    const plan = publishSteps(facts({ unit: { ...facts().unit, pr: { url: "https://github.com/o/r/pull/3" } } }));

    assert.equal(plan.steps.find((step) => step.do === "open-pr").recordedUrl, "https://github.com/o/r/pull/3");
  });

  test("deletes only the refs under the unit's own prefix", () => {
    const plan = publishSteps(facts());

    assert.equal(plan.steps.find((step) => step.do === "delete-refs").prefix, "refs/pairingbuddy/feat/x/");
    assert.equal(unitRefPrefix("feat/x"), "refs/pairingbuddy/feat/x/");
  });

  test("stop is reported before anything else, and alone", () => {
    const plan = publishSteps(facts({ runStop: { reason: "the build keeps failing" }, dirty: ["a.txt"], commits: [] }));

    assert.deepEqual(plan.refusals, ["the run stopped: the build keeps failing"]);
    assert.deepEqual(plan.steps, []);
  });

  test("reports every refusal, the evidence and the branch together", () => {
    const plan = publishSteps(facts({ dirty: ["a.txt"], currentBranch: "other", branchTip: OLD }));

    assert.equal(plan.refusals.length, 3);
    assert.match(plan.refusals.join("|"), /uncommitted files: a\.txt/);
    assert.match(plan.refusals.join("|"), /checked-out branch is other, not the unit branch feat\/x/);
    assert.match(plan.refusals.join("|"), /feat\/x is at bbbbbbb but HEAD is aaaaaaa/);
    assert.deepEqual(plan.steps, []);
  });

  test("refuses an unusable or protected branch", () => {
    assert.match(publishSteps(facts({ branchProblem: "the unit branch is bad" })).refusals.join(), /the unit branch is bad/);
    assert.match(publishSteps(facts({ branchIsProtected: true })).refusals.join(), /feat\/x is protected/);
  });
});

describe("publishSteps: closing in place", () => {
  test("no commits closes as skip when no task run is open and the configs stand", () => {
    const plan = publishSteps(facts({ commits: [] }));

    assert.deepEqual(plan.steps, [{ do: "close", result: "skip", reason: NO_COMMITS_REASON }]);
  });

  test("no commits refuses with a task run open or a config changed", () => {
    assert.match(publishSteps(facts({ commits: [], taskRunOpen: true })).refusals.join(), /task run is open/);
    assert.match(publishSteps(facts({ commits: [], changedConfigs: ["git-config.json"] })).refusals.join(), /git-config\.json/);
  });

  test("publish none closes as local only with a fresh human approval and unchanged configs", () => {
    const ok = publishSteps(facts({ publishMode: "none" }));
    assert.deepEqual(stepNames(ok), ["close"]);
    assert.equal(ok.steps[0].result, "local");

    assert.match(publishSteps(facts({ publishMode: "none", approval: "none" })).refusals.join(), /no approval/);
    assert.match(publishSteps(facts({ publishMode: "none", voidReason: "the G:publish approval no longer holds: HEAD moved" })).refusals.join(), /HEAD moved/);
    assert.match(publishSteps(facts({ publishMode: "none", changedConfigs: ["test-config.json"] })).refusals.join(), /test-config\.json/);
  });
});

describe("evidence reasons", () => {
  test("an approval is told apart: none and keep local each have their own reason", () => {
    const reasons = ["none", "keep-local"].map((approval) => evidenceRefusals(facts({ approval })).join());

    assert.match(reasons[0], /no approval; run pb gate eval/);
    assert.match(reasons[1], /answered keep local/);
  });

  test("a stale approval is reported by its own reason and not also as missing", () => {
    const reasons = evidenceRefusals(facts({ approval: "human", voidReason: "the G:publish approval no longer holds: the PR title changed" }));

    assert.deepEqual(reasons, ["the G:publish approval no longer holds: the PR title changed"]);
  });

  test("a full-suite result with no head is not 'passed at null', and an empty unit is not asked for one", () => {
    const noHead = evidenceRefusals(facts({ unit: { ...facts().unit, tasks: [task({ fullSuite: { passed: true, head: null } })] } })).join();

    assert.match(noHead, /no full-suite result at HEAD/);
    assert.doesNotMatch(noHead, /null/);
    assert.doesNotMatch(evidenceRefusals(facts({ unit: { ...facts().unit, tasks: [] }, planBoxes: [] })).join(), /full-suite/);
  });

  test("publish-evidence-exempts-human-boxes: a [HUMAN] plan box needs no task record, an agent box without one still refuses", () => {
    const built = { ...facts().unit, tasks: [task({ title: "Build it" })] };

    const humanOnly = evidenceRefusals(facts({ unit: built, planBoxes: ["Build it", "Task 2: [HUMAN] Sign it", "[HUMAN] Sign it too"] }));
    const agentMissing = evidenceRefusals(facts({ unit: built, planBoxes: ["Build it", "Wire it", "[HUMAN] Sign it"] }));

    assert.deepEqual(humanOnly, [], "a bare or numbered [HUMAN] box is not asked for a record");
    assert.equal(agentMissing.length, 1, "the agent box without a record is refused");
    assert.match(agentMissing[0], /no task record: Wire it$/, "the refusal names only the agent box");
  });

  test("publish-all-human-unit-needs-a-record: a unit whose plan boxes are all [HUMAN] and that has no task records still refuses", () => {
    const refusals = evidenceRefusals(facts({ unit: { ...facts().unit, tasks: [] }, planBoxes: ["Task 1: [HUMAN] Sign it", "[HUMAN] Sign it too"] }));

    assert.deepEqual(refusals, ["the unit has no task records"], "a unit with nothing built by an agent has nothing to publish");
  });

  test("a plan that cannot be read is a refusal", () => {
    assert.match(evidenceRefusals(facts({ planProblem: "the plan p.md cannot be read: ENOENT" })).join(), /p\.md cannot be read/);
  });
});

describe("argv helpers", () => {
  test("pushArgv sends the SHA to an explicit ref after --, never forced", () => {
    assert.deepEqual(pushArgv("origin", HEAD, "feat/x"), ["push", "--", "origin", `${HEAD}:refs/heads/feat/x`]);
  });

  test("branchShapeProblem refuses flags, forced and split refspecs, and empty names", () => {
    for (const bad of ["--force", "-x", "+main", "a:b", "", undefined]) assert.notEqual(branchShapeProblem(bad), null, JSON.stringify(bad));
    assert.equal(branchShapeProblem("feat/x-1"), null);
  });

  test("foreignPrReason accepts only the unit branch into the target with a PR url", () => {
    const view = { url: "https://github.com/o/r/pull/7", headRefName: "feat/x", baseRefName: "main" };
    const unit = { branch: "feat/x", target: "main" };

    assert.equal(foreignPrReason(view, unit), null);
    assert.match(foreignPrReason({ ...view, headRefName: "y" }, unit), /from y/);
    assert.match(foreignPrReason({ ...view, baseRefName: "dev" }, unit), /into dev/);
    assert.match(foreignPrReason({ ...view, url: "http://x/pull/1" }, unit), /not a pull request URL/);
    assert.match(foreignPrReason(null, unit), /not a pull request URL/);
    assert.equal(PR_URL.test("https://github.com/o/r/pull/12"), true);
    assert.equal(PR_URL.test("https://github.com/o/r/pull/12\nrm -rf"), false);
  });
});

describe("publishSteps: the coordination comment", () => {
  test("With null coordination, the step list has no comment step", () => {
    const plan = publishSteps(facts({ coordination: null }));

    assert.deepEqual(stepNames(plan), ["push", "set-upstream", "open-pr", "plan-line", "delete-refs", "close"]);
  });

  test("With a recorded url and commented unset, the comment step is still planned (the partner of the commented: true case)", () => {
    const plan = publishSteps(facts({ unit: { ...facts().unit, pr: { url: "https://github.com/o/r/pull/3" } } }));

    assert.deepEqual(stepNames(plan), ["push", "set-upstream", "open-pr", "comment", "plan-line", "delete-refs", "close"]);
  });

  test("When unit.pr records commented: true, publishSteps plans no comment step (open-pr, plan-line, delete-refs, close remain)", () => {
    const plan = publishSteps(facts({ unit: { ...facts().unit, pr: { url: "https://github.com/o/r/pull/3", commented: true } } }));

    assert.deepEqual(stepNames(plan), ["push", "set-upstream", "open-pr", "plan-line", "delete-refs", "close"]);
  });
});

// Scenario: publish-rebase-suite-evidence. staleFullSuite treats unit.rebaseSuite at exactly HEAD as the full-suite evidence.
describe("publish-rebase-suite-evidence", () => {
  test("rebase-suite-at-head-stands-in-for-last-task", () => {
    const OTHER = "c".repeat(40);
    const factsWith = (rebaseSuite) => facts({ unit: { ...facts().unit, rebaseSuite, tasks: [task({ fullSuite: { passed: true, head: OLD } })] } });

    const passedAtHead = evidenceRefusals(factsWith({ passed: true, head: HEAD })).join("\n");
    const failedAtHead = evidenceRefusals(factsWith({ passed: false, head: HEAD })).join("\n");
    const atOtherHead = evidenceRefusals(factsWith({ passed: true, head: OTHER })).join("\n");

    assert.doesNotMatch(passedAtHead, /full.suite/i, "a passed rebaseSuite at HEAD gives no full-suite refusal");
    assert.match(failedAtHead, /full suite failed at/, "a failed rebaseSuite at HEAD says the full suite failed at HEAD");
    assert.ok(failedAtHead.includes(HEAD.slice(0, 7)), "the refusal names HEAD");
    assert.ok(failedAtHead.includes("after the rebase"), "the refusal says it was after the rebase");
    assert.ok(atOtherHead.includes(OLD.slice(0, 7)), "a rebaseSuite at another head falls back to the last-task message");
  });
});

// Scenario: unticked-plan-box-blocks-publish. A unit with an unticked [HUMAN] box is not done.
describe("unticked-plan-box-blocks-publish", () => {
  test("publish-steps-refuses-unticked-human-box", () => {
    const unticked = "Task 2: [HUMAN] Check the fix by hand";

    const plan = publishSteps(facts({ planUnticked: [unticked] }));

    assert.deepEqual(plan.steps, [], "an unticked [HUMAN] box plans no steps");
    assert.match(plan.refusals.join("\n"), /Task 2: \[HUMAN\] Check the fix by hand/, "the refusal names the unticked task");
    assert.match(plan.refusals.join("\n"), /ticked by the human/, "the refusal says a [HUMAN] task is ticked by the human once done");
  });
});
