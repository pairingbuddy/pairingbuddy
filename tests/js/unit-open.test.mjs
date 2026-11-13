import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { writeLedger } from "../../shared-node/ledger.mjs";
import { join } from "node:path";
import { env, makeRepo, pb, pbWithEnv } from "./cli-repo-fixture.mjs";
import { violations } from "./schema-check.mjs";

const gitIn = (repo, ...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), encoding: "utf8" }).trim();

const unitPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "unit.json");

// Captures what a refused `pb unit open` must leave alone.
const snapshotRepo = (repo) => ({ head: gitIn(repo, "rev-parse", "HEAD"), branches: gitIn(repo, "branch", "--list") });

const assertUntouched = (repo, before, label) => {
  assert.equal(gitIn(repo, "branch", "--list"), before.branches, `${label}: no branch was created`);
  assert.equal(gitIn(repo, "rev-parse", "HEAD"), before.head, `${label}: HEAD did not move`);
  assert.equal(existsSync(unitPath(repo)), false, `${label}: no unit.json was written`);
};

// The CLI reads no gate policy (only hooks do), so an inherited or explicit policy must never reach it.
const pbUnitOpen = (repo, extraEnv, ...args) =>
  pbWithEnv(repo, { PAIRINGBUDDY_GATE_POLICY: undefined, ...extraEnv }, "unit", "open", ...args);

// Pushes a new commit to `branch` on the bare remote from a throwaway second clone and returns the new tip.
const pushFromSecondClone = (repo, branch, file) => {
  const clone = mkdtempSync(join(tmpdir(), "pb-clone-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: clone, env: env(), encoding: "utf8" }).trim();
    execFileSync("git", ["clone", "-q", repo.remoteDir, clone], { env: env(), stdio: "ignore" });
    git("config", "user.name", "Other");
    git("config", "user.email", "other@example.com");
    git("checkout", "-q", "-B", branch, "origin/main");
    writeFileSync(join(clone, file), `${file}\n`);
    git("add", file);
    git("commit", "-q", "-m", `add ${file}`);
    git("push", "-q", "origin", `${branch}:${branch}`);
    return git("rev-parse", "HEAD");
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
};

// Placeholders created from .pairingbuddy/scenarios.json. Each one fails
// until its implementation exists. Never use { skip } here: the JS suite
// treats skipped tests as failures.

// Scenario: unit-open-creates-branch-and-record

test("yes-creates-template-branch-and-writes-record", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const baseTip = gitIn(repo, "rev-parse", "origin/main");
  const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/unit.schema.json", import.meta.url), "utf8"));

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--yes");

  assert.equal(result.code, 0, `pb unit open exits 0: ${result.stderr}`);
  assert.equal(gitIn(repo, "rev-parse", "--abbrev-ref", "HEAD"), "feat/x", "HEAD is on the template branch feat/x");
  const unit = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), "utf8"));
  assert.equal(unit.branch, "feat/x", "unit.branch records the branch");
  assert.equal(unit.base, "main", "unit.base is the remote default branch");
  assert.equal(unit.baseSha, baseTip, "unit.baseSha equals the base tip");
  assert.match(unit.configHash, /^[0-9a-f]{64}$/, "unit.configHash is a sha256 hex digest");
  assert.match(unit.gitConfigHash, /^[0-9a-f]{64}$/, "unit.gitConfigHash is a sha256 hex digest");
  assert.deepEqual(unit.tasks, [], "tasks starts empty");
  assert.deepEqual(unit.commits, [], "commits starts empty");
  for (const key of ["unit", "plan", "tracer"]) assert.ok(key in unit, `unit.${key} is present`);
  assert.deepEqual(violations(schema, unit), [], "the record validates against the unit schema");
});

test("unit-schema-rejects-bad-records", () => {
  const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/unit.schema.json", import.meta.url), "utf8"));
  const valid = {
    unit: "x", plan: "p", tracer: "t", branch: "feat/x", base: "main",
    baseSha: "a".repeat(40), configHash: "b".repeat(64), gitConfigHash: "c".repeat(64),
    tasks: [], commits: [],
  };
  assert.deepEqual(violations(schema, valid), [], "the baseline record validates");

  const { branch, ...withoutBranch } = valid;
  assert.match(violations(schema, withoutBranch).join("\n"), /branch/, "schema rejects a record missing branch");
  const wrongType = violations(schema, { ...valid, tasks: "none" });
  assert.equal(wrongType.length, 1, "schema rejects tasks given as a string");
  assert.match(wrongType[0], /tasks/, "the rejection names tasks");
});

test("custom-branch-template-is-honoured", () => {
  const writeTemplate = (repo, branch_template) => {
    mkdirSync(join(repo.dir, ".pairingbuddy"), { recursive: true });
    writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ branch_template }));
  };
  const custom = makeRepo({ openTask: false, remote: true });
  writeTemplate(custom, "work/{type}-{slug}");
  const created = pbUnitOpen(custom, {}, "--type", "feat", "--slug", "x", "--yes");
  assert.equal(created.code, 0, `pb unit open exits 0: ${created.stderr}`);
  assert.equal(gitIn(custom, "rev-parse", "--abbrev-ref", "HEAD"), "work/feat-x", "HEAD is on the branch rendered from the custom template");
  const unit = JSON.parse(readFileSync(join(custom.dir, ".pairingbuddy", "run", "unit.json"), "utf8"));
  assert.equal(unit.branch, "work/feat-x", "unit.branch records the custom-template branch");

  const bad = makeRepo({ openTask: false, remote: true });
  writeTemplate(bad, "work/{type}-{ticket}");
  const before = snapshotRepo(bad);
  const refused = pbUnitOpen(bad, {}, "--type", "feat", "--slug", "x", "--yes");
  assert.notEqual(refused.code, 0, "an unknown placeholder refuses with a nonzero exit");
  assert.match(refused.stderr + refused.stdout, /\{ticket\}/, "the refusal names the unknown placeholder {ticket}");
  assertUntouched(bad, before, "unknown placeholder");
});

// Scenario: unit-open-interactive-confirmation

test("interactive-without-flag-refuses-and-prints-proposal", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const before = snapshotRepo(repo);

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x");

  const output = result.stdout + result.stderr;
  assert.notEqual(result.code, 0, "without --branch or --yes the verb refuses with a nonzero exit");
  assert.match(output, /feat\/x[^\n]*!.*--yes/, "the proposal line names feat/x together with the human-typed (!) instruction ending in --yes");
  assert.match(output, /--branch/, "the output names --branch as the way to override");
  assertUntouched(repo, before, "without a confirming flag");
});

test("policy-env-var-does-not-confirm-without-flag", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const before = snapshotRepo(repo);

  const result = pbUnitOpen(repo, { PAIRINGBUDDY_GATE_POLICY: "auto" }, "--type", "feat", "--slug", "x");

  assert.notEqual(result.code, 0, "the CLI ignores PAIRINGBUDDY_GATE_POLICY=auto and still refuses");
  assert.match(result.stdout + result.stderr, /feat\/x[^\n]*!.*--yes/, "the refusal still presents the proposal for the human to accept");
  assertUntouched(repo, before, "with the policy env var");
});

test("interactive-branch-flag-overrides-proposal-and-yes-accepts-it", () => {
  const overridden = makeRepo({ openTask: false, remote: true });
  const withBranch = pbUnitOpen(overridden, {}, "--type", "feat", "--slug", "x", "--branch", "my/x");
  assert.equal(withBranch.code, 0, `--branch my/x opens the unit: ${withBranch.stderr}`);
  assert.equal(gitIn(overridden, "rev-parse", "--abbrev-ref", "HEAD"), "my/x", "HEAD is on the branch given by --branch");
  assert.equal(gitIn(overridden, "branch", "--list", "feat/x"), "", "the template branch feat/x was not created");
  const unit = JSON.parse(readFileSync(join(overridden.dir, ".pairingbuddy", "run", "unit.json"), "utf8"));
  assert.equal(unit.branch, "my/x", "unit.branch records the --branch value");

  const accepted = makeRepo({ openTask: false, remote: true });
  const withYes = pbUnitOpen(accepted, {}, "--type", "feat", "--slug", "x", "--yes");
  assert.equal(withYes.code, 0, `--yes opens the unit: ${withYes.stderr}`);
  assert.equal(gitIn(accepted, "rev-parse", "--abbrev-ref", "HEAD"), "feat/x", "--yes creates the template proposal feat/x");

  for (const badArgs of [["--branch"], ["--branch", "--yes"], ["--branch", "-x"]]) {
    const repo = makeRepo({ openTask: false, remote: true });
    const before = snapshotRepo(repo);
    const refused = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", ...badArgs);
    const label = badArgs.join(" ");
    assert.notEqual(refused.code, 0, `'${label}' is a usage error with a nonzero exit`);
    assertUntouched(repo, before, `'${label}'`);
  }
});

test("branch-name-that-is-protected-or-invalid-refuses", () => {
  // `release` does not exist yet, so only a protection check can refuse it.
  const cases = [
    { label: "configured protected branch release", branch: "release", protectedList: ["release"], named: /release/, reason: /protected/i },
    { label: "name with '..'", branch: "bad..name", named: /bad\.\.name/, reason: /invalid|ref(erence)? format/i },
    { label: "name with a space", branch: "has space", named: /has space/, reason: /invalid|ref(erence)? format/i },
  ];
  for (const { label, branch, protectedList, named, reason } of cases) {
    const repo = makeRepo({ openTask: false, remote: true });
    if (protectedList) {
      mkdirSync(join(repo.dir, ".pairingbuddy"), { recursive: true });
      writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ protected_branches: protectedList }));
    }
    assert.equal(gitIn(repo, "branch", "--list", branch), "", `${label}: the branch does not exist beforehand`);
    const before = snapshotRepo(repo);

    const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--branch", branch);

    const output = result.stderr + result.stdout;
    assert.notEqual(result.code, 0, `${label}: --branch ${branch} refuses with a nonzero exit`);
    assert.match(output, named, `${label}: the refusal names the branch`);
    assert.match(output, reason, `${label}: the refusal states the reason`);
    assertUntouched(repo, before, label);
  }
});

// Scenario: unit-open-guards-and-base

test("dirty-tree-refuses-without-touching-anything", () => {
  const dirtyings = [
    { name: "a modified tracked file", file: "a.txt", content: "changed\n" },
    { name: "an untracked file outside .pairingbuddy/", file: "scratch.txt", content: "scratch\n" },
  ];
  for (const { name, file, content } of dirtyings) {
    const repo = makeRepo({ openTask: false, remote: true });
    mkdirSync(join(repo.dir, ".pairingbuddy"), { recursive: true });
    writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), "{}\n");
    writeFileSync(join(repo.dir, file), content);
    const before = snapshotRepo(repo);

    const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--yes");

    assert.notEqual(result.code, 0, `${name}: pb unit open exits nonzero`);
    assert.match(result.stderr + result.stdout, /dirty|uncommitted/i, `${name}: the refusal says the tree is dirty or has uncommitted changes`);
    assertUntouched(repo, before, name);
    assert.equal(readFileSync(join(repo.dir, file), "utf8"), content, `${name}: the dirty file is untouched`);
  }

  const clean = makeRepo({ openTask: false, remote: true });
  mkdirSync(join(clean.dir, ".pairingbuddy"), { recursive: true });
  writeFileSync(join(clean.dir, ".pairingbuddy", "git-config.json"), "{}\n");
  const opened = pbUnitOpen(clean, {}, "--type", "feat", "--slug", "x", "--yes");
  assert.equal(opened.code, 0, `.pairingbuddy/ contents do not count as dirty: ${opened.stderr}`);
});

test("fetches-and-branches-from-updated-remote-default", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const staleTip = gitIn(repo, "rev-parse", "origin/main");
  const other = pushFromSecondClone(repo, "main", "newer.txt");
  assert.notEqual(other, staleTip, "the second clone pushed a new commit");

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--yes");

  assert.equal(result.code, 0, `pb unit open exits 0: ${result.stderr}`);
  assert.equal(gitIn(repo, "rev-parse", "feat/x"), other, "the branch starts at the fetched remote tip, not the stale ref");
  const unit = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), "utf8"));
  assert.equal(unit.base, "main", "unit.base is the remote default branch");
  assert.equal(unit.baseSha, other, "unit.baseSha equals the new remote tip");
});

test("pr-base-branch-wins-over-default-branch", () => {
  const writeBase = (repo, base_branch) => {
    mkdirSync(join(repo.dir, ".pairingbuddy"), { recursive: true });
    writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ pr: { base_branch } }));
  };
  const repo = makeRepo({ openTask: false, remote: true });
  const developTip = pushFromSecondClone(repo, "develop", "develop.txt");
  assert.notEqual(developTip, gitIn(repo, "rev-parse", "origin/main"), "develop differs from the default branch");
  writeBase(repo, "develop");

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--yes");

  assert.equal(result.code, 0, `pb unit open exits 0: ${result.stderr}`);
  assert.equal(gitIn(repo, "rev-parse", "feat/x"), developTip, "the branch starts at the tip of develop");
  const unit = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), "utf8"));
  assert.equal(unit.base, "develop", "unit.base names the configured base branch");
  assert.equal(unit.baseSha, developTip, "unit.baseSha is the tip of develop");

  const missing = makeRepo({ openTask: false, remote: true });
  writeBase(missing, "nonexistent-base");
  const before = snapshotRepo(missing);
  const refused = pbUnitOpen(missing, {}, "--type", "feat", "--slug", "x", "--yes");
  assert.notEqual(refused.code, 0, "a base branch missing on the remote refuses with a nonzero exit");
  assert.match(refused.stderr + refused.stdout, /nonexistent-base/, "the refusal names the missing base branch");
  assertUntouched(missing, before, "missing base branch");
});

test("fetch-failure-refuses-before-creating-anything", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  gitIn(repo, "remote", "set-url", "origin", `${repo.remoteDir}-missing`);
  const before = snapshotRepo(repo);

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--yes");

  assert.notEqual(result.code, 0, "an unreachable remote refuses with a nonzero exit");
  assert.match(result.stderr + result.stdout, /fetch/i, "the refusal names the fetch failure");
  assertUntouched(repo, before, "fetch failure");
});

test("existing-unit-or-branch-name-collision-refuses", () => {
  const withUnit = makeRepo({ openTask: false, remote: true });
  const existingBytes = '{ "unit":"earlier",   "branch":"feat/earlier" }\n\n';
  mkdirSync(join(withUnit.dir, ".pairingbuddy", "run"), { recursive: true });
  writeFileSync(unitPath(withUnit), existingBytes);
  const unitHeadBefore = gitIn(withUnit, "rev-parse", "HEAD");
  const unitBranchesBefore = gitIn(withUnit, "branch", "--list");

  const unitRefused = pbUnitOpen(withUnit, {}, "--type", "feat", "--slug", "x", "--yes");

  const unitOutput = unitRefused.stderr + unitRefused.stdout;
  assert.equal(unitRefused.code, 1, "an existing unit.json refuses with the deliberate refusal exit code");
  assert.match(unitOutput, /unit\.json|unit (is )?already/i, "the refusal says a unit is already open");
  assert.doesNotMatch(unitOutput, /fatal:|unexpected failure/, "the refusal is deliberate, not a git error or the catch-all");
  assert.equal(readFileSync(unitPath(withUnit), "utf8"), existingBytes, "the existing unit.json is byte-identical");
  assert.equal(gitIn(withUnit, "branch", "--list"), unitBranchesBefore, "no branch was created");
  assert.equal(gitIn(withUnit, "rev-parse", "HEAD"), unitHeadBefore, "HEAD did not move");

  const withBranch = makeRepo({ openTask: false, remote: true });
  gitIn(withBranch, "branch", "feat/x");
  const before = snapshotRepo(withBranch);
  const branchTipBefore = gitIn(withBranch, "rev-parse", "feat/x");

  const branchRefused = pbUnitOpen(withBranch, {}, "--type", "feat", "--slug", "x", "--yes");

  const branchOutput = branchRefused.stderr + branchRefused.stdout;
  assert.equal(branchRefused.code, 1, "an existing local branch refuses with the deliberate refusal exit code");
  assert.match(branchOutput, /feat\/x/, "the refusal names the colliding branch");
  assert.match(branchOutput, /already exists|exists already|already in use/i, "the refusal says the branch already exists");
  assert.doesNotMatch(branchOutput, /fatal:|unexpected failure/, "the refusal is deliberate, not a raw git error");
  assert.equal(gitIn(withBranch, "rev-parse", "feat/x"), branchTipBefore, "the existing branch was not moved");
  assertUntouched(withBranch, before, "branch collision");
});

// Scenario: run-open-protected-branch-guard

test("run-open-on-protected-branch-points-at-unit-open", () => {
  const taskDir = (repo) => join(repo.dir, ".pairingbuddy", "run", "task");

  const onMain = makeRepo({ openTask: false, remote: true });
  assert.equal(gitIn(onMain, "rev-parse", "--abbrev-ref", "HEAD"), "main", "the repo starts on the protected default branch");

  const refused = pb(onMain, "run", "open", "--kind", "code");

  const output = refused.stderr + refused.stdout;
  assert.equal(refused.code, 1, "pb run open on main refuses with the deliberate refusal exit code");
  assert.match(output, /protected/i, "the refusal is the protected-branch guard");
  assert.match(output, /pb unit open/, "the refusal points at pb unit open");
  assert.equal(existsSync(taskDir(onMain)), false, "no run/task was created");
  assert.equal(gitIn(onMain, "rev-parse", "--abbrev-ref", "HEAD"), "main", "HEAD did not move");

  const fresh = makeRepo({ openTask: false, remote: true });
  const opened = pbUnitOpen(fresh, {}, "--type", "feat", "--slug", "x", "--yes");
  assert.equal(opened.code, 0, `pb unit open --yes moves to the unit branch: ${opened.stderr}`);
  assert.equal(gitIn(fresh, "rev-parse", "--abbrev-ref", "HEAD"), "feat/x", "HEAD is on the unit branch");

  const run = pb(fresh, "run", "open", "--kind", "code");

  assert.equal(run.code, 0, `pb run open succeeds on the unit branch: ${run.stderr}`);
  assert.equal(existsSync(join(taskDir(fresh), "ledger.json")), true, "run/task/ledger.json was written");
});

// Scenario: task-end-appends-task-record-to-unit

const NET = "code-safety-net";
const D19_FIELDS = ["title", "stages", "gateSources", "headSha", "reportSummary", "blocking", "attempts", "lessons", "spend"];

// Marks the open run/task ledger as finished, the way existing pb task end tests set it up.
const finishLedger = (repo, task) => {
  const pairing = join(repo.dir, ".pairingbuddy");
  const configText = readFileSync(join(pairing, "test-config.json"), "utf8");
  writeLedger(join(pairing, "run", "task", "ledger.json"), {
    ...repo.ledger(),
    task,
    configHash: createHash("sha256").update(configText).digest("hex"),
    stage: { name: NET, status: "done", runId: "wf_2", attempt: 1, startedAt: null },
    stages: [{ name: "code-config", status: "done", attempt: 1 }, { name: NET, status: "done", attempt: 1 }],
    gates: { "G:task-end": { source: "auto" } },
  });
};

// A repo with an open unit and an open task, optionally finished.
const unitRepo = ({ finished }) => {
  const repo = makeRepo({ openTask: false, remote: true });
  const opened = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--yes");
  assert.equal(opened.code, 0, `pb unit open --yes: ${opened.stderr}`);
  const run = pb(repo, "run", "open", "--kind", "code");
  assert.equal(run.code, 0, `pb run open: ${run.stderr}`);
  if (finished) finishLedger(repo, "Task A");
  return repo;
};

test("task-end-appends-record-and-it-survives-run-task-removal", () => {
  const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/unit.schema.json", import.meta.url), "utf8"));
  const repo = unitRepo({ finished: true });
  const unitPath = join(repo.dir, ".pairingbuddy", "run", "unit.json");

  const first = pb(repo, "task", "end");

  assert.equal(first.code, 0, `pb task end exits 0: ${first.stderr}`);
  assert.equal(existsSync(join(repo.dir, ".pairingbuddy", "run", "task")), false, "run/task is removed");
  const afterFirst = JSON.parse(readFileSync(unitPath, "utf8"));
  assert.equal(afterFirst.tasks.length, 1, "one task record was appended");
  const record = afterFirst.tasks[0];
  for (const field of D19_FIELDS) assert.ok(field in record, `the task record has ${field}`);
  assert.equal(record.headSha, gitIn(repo, "rev-parse", "HEAD"), "headSha equals HEAD");
  assert.equal(record.title, "Task A", "title is the task");
  assert.deepEqual(violations(schema, afterFirst), [], "the unit stays schema-valid");

  const run = pb(repo, "run", "open", "--kind", "code");
  assert.equal(run.code, 0, `second pb run open: ${run.stderr}`);
  finishLedger(repo, "Task B");
  const second = pb(repo, "task", "end");

  assert.equal(second.code, 0, `second pb task end exits 0: ${second.stderr}`);
  const afterSecond = JSON.parse(readFileSync(unitPath, "utf8"));
  assert.equal(afterSecond.tasks.length, 2, "the second record was appended");
  assert.deepEqual(afterSecond.tasks[0], record, "the earlier record is unchanged");
  assert.equal(afterSecond.tasks[1].title, "Task B", "the second record comes after the first");
  assert.deepEqual(violations(schema, afterSecond), [], "the unit stays schema-valid");
});

test("task-end-with-refusal-or-missing-unit-leaves-state-untouched", () => {
  const taskDir = (repo) => join(repo.dir, ".pairingbuddy", "run", "task");

  const dirty = unitRepo({ finished: true });
  const unitPath = join(dirty.dir, ".pairingbuddy", "run", "unit.json");
  writeFileSync(join(dirty.dir, "a.txt"), "changed\n");
  const before = readFileSync(unitPath);
  const dirtyResult = pb(dirty, "task", "end");
  assert.notEqual(dirtyResult.code, 0, "a dirty tree refuses task end");
  assert.match(dirtyResult.stderr + dirtyResult.stdout, /dirty/i, "the refusal says the tree is dirty");
  assert.deepEqual(readFileSync(unitPath), before, "unit.json is byte-identical after the dirty refusal");
  assert.equal(existsSync(taskDir(dirty)), true, "run/task stays after the dirty refusal");

  const unfinished = unitRepo({ finished: false });
  const unfinishedPath = join(unfinished.dir, ".pairingbuddy", "run", "unit.json");
  const beforeUnfinished = readFileSync(unfinishedPath);
  const unfinishedResult = pb(unfinished, "task", "end");
  assert.notEqual(unfinishedResult.code, 0, "unfinished stages refuse task end");
  assert.match(unfinishedResult.stderr + unfinishedResult.stdout, /is not finished/i, "the refusal says a stage is not finished");
  assert.deepEqual(readFileSync(unfinishedPath), beforeUnfinished, "unit.json is byte-identical after the unfinished refusal");
  assert.equal(existsSync(taskDir(unfinished)), true, "run/task stays after the unfinished refusal");

  const noUnit = unitRepo({ finished: true });
  rmSync(join(noUnit.dir, ".pairingbuddy", "run", "unit.json"));
  const ended = pb(noUnit, "task", "end");
  assert.equal(ended.code, 0, `without a unit, task end still ends the task: ${ended.stderr}`);
  assert.equal(existsSync(taskDir(noUnit)), false, "run/task is removed");
  assert.equal(existsSync(join(noUnit.dir, ".pairingbuddy", "run", "unit.json")), false, "no unit.json was created");
});
