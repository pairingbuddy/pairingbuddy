// pb publish. Titles are the test case ids from .pairingbuddy/scenarios.json. Each describe is one scenario. The setup is
// publishableUnit in publishable-unit-fixture.mjs and the recording gh in gh-shim-fixture.mjs.
import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FAKE_PR_URL, flagValues, GH_FAILURE, viewEnv } from "./gh-shim-fixture.mjs";
import { pb } from "./cli-repo-fixture.mjs";
import { CLEAN_BODY, CLEAN_TITLE, DRAFT_KEY, commitMore, git, gitConfigPath, readUnitRecord, REFUSED, unitFile } from "./publish-fixture.mjs";
import {
  OTHER_UNIT_REF, PLAN, RUN_FILES, SAFETY_NET,
  changeLedger, changeUnit, divergeRemote, localRefs, makePrivateRefs, planFile, privateRefsOf, publishableUnit, publishUnit,
  installPrePushHook, planBecomesDirectoryAtPush, prLinePattern, remoteRef, remoteRefs, runFile, unitWithRecordedPr, withPlan,
} from "./publishable-unit-fixture.mjs";

// Publishes a fresh publishable unit and returns what the tests look at.
function published({ ghEnv = {}, ...options } = {}) {
  const unit = publishableUnit(options);
  const { gh, result } = publishUnit(unit, ghEnv);
  assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
  const [create] = gh.prCreates();
  assert.ok(create, "gh pr create was called");
  return { ...unit, gh, result, printed: JSON.parse(result.stdout), argv: create.argv, create };
}

// Runs pb publish on the unit and checks what every refusal has in common: exit 1, the reason on stderr, nothing pushed,
// no gh call, the unit still there. Returns the stderr for the test's own check of the reason.
function refused(unit) {
  const { gh, result } = publishUnit(unit);

  assert.equal(result.code, REFUSED, `pb publish refuses with exit 1, stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), null, "nothing was pushed to the remote");
  assert.deepEqual(gh.calls(), [], "no gh call was made");
  assert.ok(existsSync(unitFile(unit.repo)), "unit.json is still there");
  return result.stderr;
}

// The arguments of every `git push` that ran, read from a GIT_TRACE file. Only git's own "built-in: git push" lines count.
const tracedPushes = (traceFile) => readFileSync(traceFile, "utf8").split("\n")
  .filter((line) => line.includes("built-in: git push"))
  .map((line) => line.slice(line.indexOf("built-in: git ") + "built-in: git ".length).split(" "));
const newTraceFile = () => join(mkdtempSync(join(tmpdir(), "pb-git-trace-")), "trace.txt");

describe("publish-happy-path", () => {
  test("pushes-branch-with-upstream", () => {
    const { repo, head, branch } = published();

    assert.equal(remoteRef(repo, `refs/heads/${branch}`), head, "the unit branch is on the remote at HEAD");
    assert.equal(git(repo, "rev-parse", "--abbrev-ref", `${branch}@{upstream}`), `origin/${branch}`, "the local branch tracks origin");
  });

  test("opens-pr-with-body-file-title-head-base", () => {
    const { gh, branch, argv, create, printed } = published();

    assert.equal(gh.prCreates().length, 1, "exactly one pr create");
    assert.equal(flagValues(argv, "--title").join(), CLEAN_TITLE, "--title is the draft title");
    assert.equal(flagValues(argv, "--head").join(), branch, "--head is the unit branch");
    assert.equal(flagValues(argv, "--base").join(), "main", "--base is the target");
    const [bodyFile] = flagValues(argv, "--body-file");
    assert.match(bodyFile, /run[\\/]pr-body\.\d+\.snapshot\.md$/, `--body-file names a snapshot of the body inside run/, got ${bodyFile}`);
    assert.equal(existsSync(bodyFile), false, "the snapshot is removed afterwards");
    assert.equal(create.bodyFile, CLEAN_BODY, "the body file is unchanged");
    assert.equal(printed.url, FAKE_PR_URL, "the JSON result has the url gh printed");
    assert.equal(printed.result, "published", "the JSON result says the PR was published");
  });

  test("ready-pr-without-draft-flag-when-policy-not-auto", () => {
    const { argv } = published({ mode: "default", env: { PAIRINGBUDDY_GATE_POLICY: "auto" } });

    assert.equal(argv.includes("--draft"), false, "no --draft, whatever the CLI's environment says");
  });

  test("draft-flag-under-auto-policy-from-ledger", () => {
    const { repo, argv } = published({ mode: "auto", env: { PAIRINGBUDDY_GATE_POLICY: "default" } });

    assert.equal(repo.ledger().policy.mode, "auto", "the gate hook recorded auto");
    assert.equal(argv.filter((arg) => arg === "--draft").length, 1, "--draft, whatever the CLI's environment says");
  });

  test("labels-passed-through-unchanged", () => {
    const labelled = published({ labels: ["Needs Review", "area:cli", "z"] });
    const bare = published({ labels: [] });

    assert.deepEqual(flagValues(labelled.argv, "--label"), ["Needs Review", "area:cli", "z"], "each label verbatim, in order");
    assert.equal(bare.argv.includes("--label"), false, "no labels, no --label");
  });
});

describe("publish-evidence-refusals", () => {
  test("refuses-plan-task-box-without-record", () => {
    for (const mark of [" ", "x"]) {
      const unit = publishableUnit({ tasks: [{ title: "Task A" }] });
      withPlan(unit.repo, `# Plan\n\n## Phase one\n\n#### PR: Export\n\n- [x] Task A\n- [${mark}] Task B\n\n#### PR: Other\n\n- [ ] Task C\n`);

      const stderr = refused(unit);

      assert.match(stderr, /Task B/, `the refusal names the plan box [${mark}] with no record`);
      assert.doesNotMatch(stderr, /Task C/, "a box under another heading is not this unit's");
    }
  });

  test("refuses-unit-without-task-records-when-no-plan", () => {
    const unit = publishableUnit({ tasks: [] });

    const stderr = refused(unit);

    assert.match(stderr, /no task records/, "the refusal says the unit has no task records");
  });

  test("refuses-task-without-safety-net-finished", () => {
    const unit = publishableUnit({ tasks: [{ title: "Task A" }, { title: "Task B", stages: ["code-config"] }] });

    const stderr = refused(unit);

    assert.match(stderr, /Task B/, "the refusal names the task");
    assert.match(stderr, new RegExp(SAFETY_NET), "the refusal names the missing safety-net");
  });

  test("refuses-task-with-invalid-gate-source", () => {
    const unit = publishableUnit({ tasks: [{ gateSources: { "G:task-end": "auto", "G:tests": "whatever" } }] });

    const stderr = refused(unit);

    assert.match(stderr, /G:tests/, "the refusal names the gate with the invalid source");
  });

  test("refuses-last-task-full-suite-missing-or-red", () => {
    const fullSuites = { missing: null, red: { passed: false } };
    for (const [name, fullSuite] of Object.entries(fullSuites)) {
      const unit = publishableUnit({ fullSuite });

      const stderr = refused(unit);

      assert.match(stderr, /pb test --full/, `the refusal says to run pb test --full (full suite ${name})`);
    }
  });

  test("refuses-full-suite-head-not-current", () => {
    const old = "a".repeat(40);
    const unit = publishableUnit({ fullSuite: { passed: true, head: old } });

    const stderr = refused(unit);

    assert.ok(stderr.includes(old.slice(0, 7)), "the refusal names the recorded SHA");
    assert.ok(stderr.includes(unit.head.slice(0, 7)), "the refusal names the current HEAD");
  });

  test("refuses-dirty-tree", () => {
    const unit = publishableUnit({ dirty: true });
    writeFileSync(join(unit.repo.dir, ".pairingbuddy", "scratch.txt"), "ignored\n");

    const stderr = refused(unit);

    assert.match(stderr, /uncommitted\.txt/, "the refusal lists the untracked source file");
    assert.doesNotMatch(stderr, /scratch\.txt/, "a file under gitignored .pairingbuddy/ is not listed");
  });

  test("refuses-open-blocking-finding", () => {
    const unit = publishableUnit({ tasks: [{ blocking: ["unescaped-sql-in-export"] }] });

    const stderr = refused(unit);

    assert.match(stderr, /unescaped-sql-in-export/, "the refusal names the finding");
  });

  test("refuses-changed-config-hashes", () => {
    const changes = {
      "test-config.json": (repo) => appendFileSync(join(repo.dir, ".pairingbuddy", "test-config.json"), "\n"),
      "git-config.json": (repo) => writeFileSync(gitConfigPath(repo), JSON.stringify({ pr: { base_branch: "main" }, changed: true })),
    };
    for (const [file, change] of Object.entries(changes)) {
      const unit = publishableUnit();
      change(unit.repo);

      const stderr = refused(unit);

      assert.match(stderr, new RegExp(file.replace(".", "\\.")), `the refusal names ${file}`);
    }
  });

  test("refuses-after-stop", () => {
    const unit = publishableUnit();
    changeLedger(unit.repo, (ledger) => ({ stop: { code: "human-stopped", reason: "the build keeps failing on CI parity", seq: ledger.seq + 1 } }));

    const stderr = refused(unit);

    assert.match(stderr, /the build keeps failing on CI parity/, "the refusal quotes the stop reason");
  });

  test("refuses-without-valid-publish-approval", () => {
    const approvals = [
      ["none", null],
      ["auto", { source: "auto", answer: "approve" }],
      ["another answer", { source: "human", answer: "redo" }],
    ];
    for (const [name, record] of approvals) {
      const unit = publishableUnit({ approval: "none" });
      if (record !== null) changeLedger(unit.repo, (ledger) => ({ gates: { ...ledger.gates, "G:publish": record } }));

      const stderr = refused(unit);

      assert.match(stderr, /pb gate eval|pb human approve/, `the refusal points at the way to approve (${name})`);
    }
  });

  test("refuses-approval-bound-to-other-head-body-base-or-target", () => {
    const changes = {
      "a new commit after the approval": { change: (repo) => commitMore(repo, "after"), reason: /HEAD moved/ },
      "an edited pr-body.md": { change: (repo) => appendFileSync(join(repo.dir, ".pairingbuddy", "run", "pr-body.md"), "More words.\n"), reason: /pr-body\.md/ },
      "a different base": { change: (repo) => changeUnit(repo, { base: "elsewhere" }), reason: /base changed/ },
      "a different configured target": { change: (repo) => writeFileSync(gitConfigPath(repo), JSON.stringify({ pr: { base_branch: "integration" } })), reason: /target changed/ },
    };
    for (const [name, { change, reason }] of Object.entries(changes)) {
      const unit = publishableUnit();
      change(unit.repo);

      const stderr = refused(unit);

      assert.match(stderr, reason, `the refusal says what the approval no longer matches (${name})`);
      const [voided] = unit.repo.ledger().voidedGates ?? [];
      assert.equal(voided?.gate, "G:publish", `the stale approval is kept in voidedGates (${name})`);
      assert.equal("G:publish" in unit.repo.ledger().gates, false, `the stale approval left the gates (${name})`);
    }
  });

  test("refuses-commit-not-in-unit-record", () => {
    const unit = publishableUnit({ unrecordedCommit: true });

    const stderr = refused(unit);

    assert.match(stderr, new RegExp(`not in the unit record: .*${unit.head.slice(0, 7)}`), "the refusal lists the commit that unit.commits lacks");
  });
});

describe("publish-target-base", () => {
  test("targets-configured-base-branch", () => {
    const { argv } = published({ baseBranch: "integration" });

    assert.deepEqual(flagValues(argv, "--base"), ["integration"], "--base is pr.base_branch");
  });

  test("targets-unit-base-when-unset", () => {
    const { argv } = published();

    assert.deepEqual(flagValues(argv, "--base"), ["main"], "--base is the unit base");
  });
});

describe("publish-local-and-skip-modes", () => {
  test("publish-none-closes-unit-keeping-everything-local", () => {
    const unit = publishableUnit({ publishMode: "none" });
    withPlan(unit.repo);
    makePrivateRefs(unit.repo, unit.branch);

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).result, "local", "the result is local");
    assert.deepEqual(gh.calls(), [], "gh was not called");
    assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), null, "nothing was pushed");
    for (const name of RUN_FILES) assert.equal(existsSync(runFile(unit.repo, name)), false, `${name} is closed`);
    assert.equal(git(unit.repo, "rev-parse", "HEAD"), unit.head, "the commits are kept");
    assert.equal(git(unit.repo, "rev-parse", "--verify", `refs/heads/${unit.branch}`), unit.head, "the branch is kept");
    assert.deepEqual(localRefs(unit.repo).sort(), privateRefsOf(unit.branch).sort(), "the refs/pairingbuddy refs remain");
    assert.equal(readFileSync(planFile(unit.repo), "utf8"), PLAN, "no PR: line is written");
  });

  test("stop-wins-over-publish-none", () => {
    const unit = publishableUnit({ publishMode: "none" });
    changeLedger(unit.repo, (ledger) => ({ stop: { code: "human-stopped", reason: "stopped by the human", seq: ledger.seq + 1 } }));

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, REFUSED, `pb publish refuses, stdout ${result.stdout}`);
    assert.match(result.stderr, /stopped by the human/, "the refusal quotes the stop reason");
    assert.deepEqual(gh.calls(), [], "gh was not called");
    assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), null, "nothing was pushed");
    for (const name of RUN_FILES) assert.ok(existsSync(runFile(unit.repo, name)), `${name} remains`);
  });

  test("no-commits-skips-and-closes-unit", () => {
    const unit = publishableUnit({ commits: 0, approval: "none" });
    withPlan(unit.repo);

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).result, "skip", "the result is skip");
    assert.deepEqual(gh.calls(), [], "gh was not called");
    assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), null, "nothing was pushed");
    for (const name of RUN_FILES) assert.equal(existsSync(runFile(unit.repo, name)), false, `${name} is closed`);
    assert.equal(readFileSync(planFile(unit.repo), "utf8"), PLAN, "no PR: line is written");
  });
});

describe("publish-never-merges-or-forces", () => {
  test("argv-has-no-force-or-merge", () => {
    const traceFile = newTraceFile();

    const { gh, head, branch, result } = published({ ghEnv: { GIT_TRACE: traceFile } });

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.deepEqual(gh.calls().map(({ argv }) => argv.slice(0, 2).join(" ")), ["pr create", "pr comment"], "the only gh calls are pr create then pr comment");
    const everyArg = gh.calls().flatMap(({ argv }) => argv);
    assert.equal(everyArg.includes("--force"), false, "no gh call passes --force");
    assert.equal(everyArg.includes("--merge"), false, "no gh call passes --merge");
    assert.deepEqual(tracedPushes(traceFile), [["push", "--", "origin", `${head}:refs/heads/${branch}`]], "one plain push of the approved SHA, no force flag");
  });

  test("diverged-remote-branch-refuses-without-forcing", () => {
    const unit = publishableUnit();
    const remoteSha = divergeRemote(unit.repo, unit.branch);

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, REFUSED, `pb publish refuses, stdout ${result.stdout}`);
    assert.match(result.stderr, /git push .* failed:.*(rejected|non-fast-forward)/s, "the refusal comes from the rejected push");
    assert.deepEqual(gh.calls(), [], "no gh call was made");
    assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), remoteSha, "the remote ref is unchanged");
    assert.ok(existsSync(unitFile(unit.repo)), "the unit is intact");
  });
});

describe("publish-private-refs", () => {
  test("refused-publish-keeps-private-refs", () => {
    const unit = publishableUnit({ dirty: true });
    makePrivateRefs(unit.repo, unit.branch);

    refused(unit);

    assert.deepEqual(localRefs(unit.repo).sort(), privateRefsOf(unit.branch).sort(), "a refused publish keeps the local refs");
  });

  test("refs-pairingbuddy-never-pushed-and-deleted-locally", () => {
    const unit = publishableUnit();
    makePrivateRefs(unit.repo, unit.branch);
    git(unit.repo, "update-ref", OTHER_UNIT_REF, "HEAD");

    const { result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.deepEqual(remoteRefs(unit.repo), [], "the remote lists no refs/pairingbuddy ref");
    assert.deepEqual(localRefs(unit.repo), [OTHER_UNIT_REF], "only this unit's refs are deleted; another unit's ref survives");
  });
});

describe("publish-records-and-closes-unit", () => {
  test("writes-pr-line-under-unit-heading", () => {
    const unit = publishableUnit();
    withPlan(unit.repo);

    const { result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    const lines = readFileSync(planFile(unit.repo), "utf8").split("\n");
    const at = lines.indexOf("#### PR: Export");
    assert.equal(lines[at + 1], `PR: ${FAKE_PR_URL} branch: ${unit.branch}`, "the PR: line is directly under the heading");
    lines.splice(at + 1, 1);
    assert.equal(lines.join("\n"), PLAN, "the rest of the file is byte-identical");
  });

  test("no-plan-path-writes-nothing-to-plan", () => {
    const unit = publishableUnit();
    writeFileSync(planFile(unit.repo), PLAN);
    changeUnit(unit.repo, { unit: "Export" });

    const { result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    const printed = JSON.parse(result.stdout);
    assert.equal(printed.result, "published", "the PR was opened");
    assert.deepEqual(printed.warnings ?? [], [], "a unit with no plan path has nothing to warn about");
    assert.equal(readFileSync(planFile(unit.repo), "utf8"), PLAN, "the plan file is untouched");
  });

  test("missing-heading-is-reported-not-failed", () => {
    const other = "# Plan\n\n## Phase one\n\n#### PR: Other\n\n- [ ] Task C\n";
    const unit = publishableUnit();
    withPlan(unit.repo, other);

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, 0, `exit 0, stderr ${result.stderr}`);
    assert.equal(gh.prCreates().length, 1, "the PR exists");
    const printed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(printed.warnings) && printed.warnings.some((warning) => /Export/.test(warning)), `warnings name the missing heading: ${result.stdout}`);
    assert.equal(existsSync(unitFile(unit.repo)), false, "the unit is closed");
    assert.equal(readFileSync(planFile(unit.repo), "utf8"), other, "the plan is untouched");
  });

  test("removes-unit-files-after-publish", () => {
    const unit = publishableUnit();

    const { result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    for (const name of RUN_FILES) assert.equal(existsSync(runFile(unit.repo, name)), false, `${name} is gone`);
    const opened = pb(unit.repo, "unit", "open", "--type", "feat", "--slug", "next", "--yes");
    assert.equal(opened.code, 0, `a new unit can be opened: ${opened.stderr}`);
  });

  test("pr-url-recorded-in-unit-before-plan-line", () => {
    const unit = publishableUnit();
    withPlan(unit.repo);
    planBecomesDirectoryAtPush(unit.repo);

    const { result } = publishUnit(unit);

    assert.equal(result.code, REFUSED, `the plan write fails, so publish refuses: ${result.stdout}`);
    assert.match(result.stderr, /could not be written.*run pb publish again/, "the refusal says the plan could not be written and a rerun is safe");
    assert.ok(existsSync(unitFile(unit.repo)), "the unit stays");
    assert.equal(readUnitRecord(unit.repo).pr?.url, FAKE_PR_URL, "the PR url is recorded in unit.json");
  });

  test("retry-with-recorded-url-skips-create-and-finishes", () => {
    const unit = unitWithRecordedPr();

    const { gh, result } = publishUnit(unit, viewEnv({ head: unit.branch }));

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.deepEqual(gh.prCreates(), [], "no second gh pr create");
    assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), unit.head, "the remote branch is at HEAD");
    assert.match(readFileSync(planFile(unit.repo), "utf8"), prLinePattern(unit.branch), "the PR: line is written");
    assert.deepEqual(localRefs(unit.repo), [], "the private refs are deleted");
    assert.equal(existsSync(unitFile(unit.repo)), false, "the unit is closed");
  });

  test("push-failure-leaves-unit-intact", () => {
    const unit = publishableUnit();
    withPlan(unit.repo);
    makePrivateRefs(unit.repo, unit.branch);
    const hook = join(unit.repo.remoteDir, "hooks", "pre-receive");
    mkdirSync(join(unit.repo.remoteDir, "hooks"), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\necho rejected by hook >&2\nexit 1\n");
    chmodSync(hook, 0o755);

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, REFUSED, `pb publish refuses, stdout ${result.stdout}`);
    assert.match(result.stderr, /rejected by hook/, "the refusal is the pre-receive hook's");
    assert.deepEqual(gh.calls(), [], "no gh call");
    assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), null, "the remote has no unit branch");
    assert.ok(existsSync(unitFile(unit.repo)), "the unit is intact");
    assert.equal(readFileSync(planFile(unit.repo), "utf8"), PLAN, "no PR: line is written");
    assert.deepEqual(localRefs(unit.repo).sort(), privateRefsOf(unit.branch).sort(), "the refs remain");
  });

  test("gh-failure-leaves-unit-intact", () => {
    const unit = publishableUnit();
    withPlan(unit.repo);
    makePrivateRefs(unit.repo, unit.branch);

    const { result } = publishUnit(unit, { GH_SHIM_FAIL: "pr create" });

    assert.equal(result.code, REFUSED, `pb publish refuses, stdout ${result.stdout}`);
    assert.ok(result.stderr.includes(GH_FAILURE), "gh's stderr is in the refusal");
    assert.ok(existsSync(unitFile(unit.repo)), "the unit is intact");
    assert.equal(readUnitRecord(unit.repo).pr, undefined, "no url is recorded");
    assert.equal(readFileSync(planFile(unit.repo), "utf8"), PLAN, "no PR: line is written");
    assert.deepEqual(localRefs(unit.repo).sort(), privateRefsOf(unit.branch).sort(), "the refs remain");
  });
});

const changeDraft = (repo, change) => {
  const file = join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${DRAFT_KEY}.json`);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...change }));
};

describe("publish-pushes-the-approved-commit-of-the-unit-branch", () => {
  test("refuses-when-checked-out-branch-is-not-the-unit-branch", () => {
    const unit = publishableUnit();
    git(unit.repo, "checkout", "-q", "-b", "elsewhere");

    const stderr = refused(unit);

    assert.match(stderr, /checked-out branch is elsewhere, not the unit branch/, "the refusal names both branches");
  });

  test("refuses-when-unit-branch-tip-is-not-head", () => {
    const unit = publishableUnit();
    git(unit.repo, "checkout", "-q", "--detach");
    git(unit.repo, "update-ref", `refs/heads/${unit.branch}`, "main");

    const stderr = refused(unit);

    assert.match(stderr, /unit branch .* is at .* but HEAD is/, "the refusal says the branch is not at HEAD");
  });

  test("pushes-the-approved-sha-to-an-explicit-ref", () => {
    const unit = publishableUnit();
    const traceFile = newTraceFile();

    const { result } = publishUnit(unit, { GIT_TRACE: traceFile });

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    const refspecs = tracedPushes(traceFile).map((args) => args.at(-1));
    assert.deepEqual(refspecs, [`${unit.head}:refs/heads/${unit.branch}`], "the push sends <sha>:refs/heads/<branch>");
  });

  test("remote-already-at-head-skips-push-but-a-remote-elsewhere-does-not", () => {
    const unit = publishableUnit();
    git(unit.repo, "push", "-q", "origin", `${unit.head}:refs/heads/${unit.branch}`);
    const traceFile = newTraceFile();

    const { result } = publishUnit(unit, { GIT_TRACE: traceFile });

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.deepEqual(tracedPushes(traceFile).filter((args) => !args.includes("--set-upstream") && !args.includes("-u")), [], "no push when the remote branch is at the approved SHA");
    assert.equal(git(unit.repo, "rev-parse", "--abbrev-ref", `${unit.branch}@{upstream}`), `origin/${unit.branch}`, "the upstream is still set");
  });
});

describe("publish-refuses-an-unsafe-unit-branch", () => {
  test("refuses-branch-names-that-git-or-argv-would-misread", () => {
    for (const branch of ["--force", "--mirror", "+feat/x", "feat/x:main", "feat/x:refs/pairingbuddy/a", "a..b", "has space", "@{-1}", ""]) {
      const unit = publishableUnit();
      changeUnit(unit.repo, { branch });

      const stderr = refused(unit);

      assert.match(stderr, /unit branch|branch name/, `the refusal is about the branch (${JSON.stringify(branch)})`);
    }
  });

  test("refuses-a-protected-unit-branch", () => {
    const unit = publishableUnit();
    changeUnit(unit.repo, { branch: "main" });

    const stderr = refused({ ...unit, branch: "never-pushed" });

    assert.match(stderr, /unit branch main is protected/, "the refusal says the branch is protected");
    assert.equal(remoteRef(unit.repo, "refs/heads/main"), git(unit.repo, "rev-parse", "main"), "main on the remote is not moved");
  });
});

describe("publish-binds-title-and-labels", () => {
  test("refuses-when-draft-title-changed-after-approval", () => {
    const unit = publishableUnit();
    changeDraft(unit.repo, { title: "feat: something else entirely" });

    const stderr = refused(unit);

    assert.match(stderr, /PR title changed/, "the refusal says the title changed");
    assert.equal(unit.repo.ledger().voidedGates?.[0]?.gate, "G:publish", "the approval is voided");
  });

  test("refuses-when-draft-labels-changed-after-approval", () => {
    const unit = publishableUnit({ labels: ["a"] });
    changeDraft(unit.repo, { labels: ["a", "sneaky"] });

    const stderr = refused(unit);

    assert.match(stderr, /PR labels changed/, "the refusal says the labels changed");
    assert.equal("G:publish" in unit.repo.ledger().gates, false, "the stale approval left the gates");
  });
});

describe("publish-closes-in-place-only-with-approval", () => {
  test("publish-none-refuses-without-a-fresh-human-approval", () => {
    const withdrawApproval = (repo) => changeLedger(repo, (ledger) => {
      const { "G:publish": _gone, ...gates } = ledger.gates;
      return { gates };
    });
    const changes = {
      "a withdrawn approval": { change: withdrawApproval, reason: /no approval/ },
      "a new commit": { change: (repo) => commitMore(repo, "after"), reason: /HEAD moved/ },
      "a changed test-config.json": { change: (repo) => appendFileSync(join(repo.dir, ".pairingbuddy", "test-config.json"), "\n"), reason: /test-config\.json/ },
    };
    for (const [name, { change, reason }] of Object.entries(changes)) {
      const unit = publishableUnit({ publishMode: "none" });
      change(unit.repo);

      const stderr = refused(unit);

      assert.match(stderr, reason, `the refusal says what is missing (${name})`);
    }
  });

  test("no-commits-skip-refuses-while-a-task-run-is-open", () => {
    const unit = publishableUnit({ commits: 0, approval: "none" });
    changeLedger(unit.repo, () => ({ taskType: "new_feature" }));

    const stderr = refused(unit);

    assert.match(stderr, /task run is open/, "the refusal says a task run is open");
  });

  test("no-commits-skip-refuses-when-a-config-changed", () => {
    const unit = publishableUnit({ commits: 0, approval: "none" });
    appendFileSync(join(unit.repo.dir, ".pairingbuddy", "test-config.json"), "\n");

    const stderr = refused(unit);

    assert.match(stderr, /test-config\.json/, "the refusal names the changed config");
  });

  test("refusal-names-keep-local-and-auto-apart-from-no-approval", () => {
    const records = [
      [{ source: "human", answer: "keep-local" }, /answered keep local/],
      [{ source: "auto", answer: "approve" }, /auto policy/],
    ];
    for (const [record, reason] of records) {
      const unit = publishableUnit({ approval: "none" });
      changeLedger(unit.repo, (ledger) => ({ gates: { ...ledger.gates, "G:publish": record } }));

      const stderr = refused(unit);

      assert.match(stderr, reason, "each record has its own reason");
    }
  });
});

describe("publish-body-snapshot", () => {
  test("a body edit after the check does not reach gh", () => {
    const unit = publishableUnit();
    installPrePushHook(unit.repo, `echo "sneaky edit" >> "${runFile(unit.repo, "pr-body.md")}"`);

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    const [create] = gh.prCreates();
    assert.equal(create.bodyFile, CLEAN_BODY, "gh got the bytes that were approved, not the edited file");
  });
});

describe("publish-adopts-its-own-pr", () => {
  test("create-fails-because-the-pr-exists-adopts-it", () => {
    const unit = publishableUnit();
    withPlan(unit.repo);

    const { gh, result } = publishUnit(unit, { GH_SHIM_FAIL: "pr create", ...viewEnv({ head: unit.branch }) });

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).url, FAKE_PR_URL, "the existing PR's url is the result");
    assert.equal(gh.prViews().length, 1, "gh pr view was asked once");
    assert.deepEqual(gh.prViews()[0].argv.slice(-2), ["--", unit.branch], "the branch follows --");
    assert.match(readFileSync(planFile(unit.repo), "utf8"), prLinePattern(unit.branch), "the PR: line is written");
    assert.equal(existsSync(unitFile(unit.repo)), false, "the unit is closed");
  });

  test("a pr from another head or into another base is refused", () => {
    for (const [name, over, reason] of [
      ["other head", { head: "somebody-elses" }, /from somebody-elses, not the unit branch/],
      ["other base", { base: "release" }, /into release, not the target main/],
      ["not a PR url", { url: "https://example.com/not-a-pr" }, /not a pull request URL/],
    ]) {
      const unit = publishableUnit();

      const { result } = publishUnit(unit, { GH_SHIM_FAIL: "pr create", ...viewEnv({ head: unit.branch, ...over }) });

      assert.equal(result.code, REFUSED, `pb publish refuses (${name}), stdout ${result.stdout}`);
      assert.match(result.stderr, reason, `the refusal says why (${name})`);
      assert.equal(readUnitRecord(unit.repo).pr, undefined, `no url is recorded (${name})`);
      assert.ok(existsSync(unitFile(unit.repo)), `the unit is intact (${name})`);
    }
  });

  test("a recorded url is checked with gh pr view and a mismatch is refused", () => {
    for (const [name, over, reason] of [
      ["other head", { head: "somebody-elses" }, /not the unit branch/],
      ["other url", { head: "SAME", url: "https://github.com/example/repo/pull/99" }, /records the PR .*pull\/7.*pull\/99/],
    ]) {
      const unit = publishableUnit();
      changeUnit(unit.repo, { pr: { url: FAKE_PR_URL } });

      const { gh, result } = publishUnit(unit, viewEnv({ ...over, head: over.head === "SAME" ? unit.branch : over.head }));

      assert.equal(result.code, REFUSED, `pb publish refuses (${name}), stdout ${result.stdout}`);
      assert.match(result.stderr, reason, `the refusal says why (${name})`);
      assert.deepEqual(gh.prCreates(), [], `no create (${name})`);
      assert.ok(existsSync(unitFile(unit.repo)), `the unit is intact (${name})`);
    }
  });

  test("a recorded url with no PR behind it is refused", () => {
    const unit = publishableUnit();
    changeUnit(unit.repo, { pr: { url: FAKE_PR_URL } });

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, REFUSED, `pb publish refuses, stdout ${result.stdout}`);
    assert.deepEqual(gh.prCreates(), [], "no create");
    assert.ok(existsSync(unitFile(unit.repo)), "the unit is intact");
  });

  test("output that is not a pr url is not recorded and says to run again", () => {
    const unit = publishableUnit();

    const { result } = publishUnit(unit, { GH_SHIM_URL: "all done" });

    assert.equal(result.code, REFUSED, `pb publish refuses, stdout ${result.stdout}`);
    assert.match(result.stderr, /not a pull request URL/, "the refusal says so");
    assert.match(result.stderr, /run pb publish again/, "the refusal says a rerun is safe");
    assert.equal(readUnitRecord(unit.repo).pr, undefined, "nothing is recorded");
  });

  test("failures after the push say what was reached", () => {
    const unit = publishableUnit();

    const { result } = publishUnit(unit, { GH_SHIM_FAIL: "pr" });

    assert.equal(result.code, REFUSED, `pb publish refuses, stdout ${result.stdout}`);
    assert.match(result.stderr, new RegExp(`${unit.branch} is pushed to origin, but the PR was not opened; run pb publish again, the push will not repeat`), "the refusal names the state reached and the next step");
    assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), unit.head, "the push did happen");
  });
});
