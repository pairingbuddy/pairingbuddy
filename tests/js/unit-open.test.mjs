import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { writeLedger } from "../../shared-node/ledger.mjs";
import { join } from "node:path";
import { env, makeRepo, pb, pbWithEnv, writePlan } from "./cli-repo-fixture.mjs";
import { violations } from "./schema-check.mjs";
import { FAKE_PR_URL, GH_FAILURE, installGhShim, viewEnv, viewsEnv } from "./gh-shim-fixture.mjs";

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

test("creates-template-branch-and-writes-record", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const baseTip = gitIn(repo, "rev-parse", "origin/main");
  const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/unit.schema.json", import.meta.url), "utf8"));

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x");

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
  const created = pbUnitOpen(custom, {}, "--type", "feat", "--slug", "x");
  assert.equal(created.code, 0, `pb unit open exits 0: ${created.stderr}`);
  assert.equal(gitIn(custom, "rev-parse", "--abbrev-ref", "HEAD"), "work/feat-x", "HEAD is on the branch rendered from the custom template");
  const unit = JSON.parse(readFileSync(join(custom.dir, ".pairingbuddy", "run", "unit.json"), "utf8"));
  assert.equal(unit.branch, "work/feat-x", "unit.branch records the custom-template branch");

  const bad = makeRepo({ openTask: false, remote: true });
  writeTemplate(bad, "work/{type}-{ticket}");
  const before = snapshotRepo(bad);
  const refused = pbUnitOpen(bad, {}, "--type", "feat", "--slug", "x");
  assert.equal(refused.code, 1, "an unknown placeholder refuses with the deliberate refusal exit code");
  assert.ok((refused.stderr + refused.stdout).includes("branch_template has unknown placeholder {ticket}"), "the refusal names the unknown placeholder {ticket}");
  assertUntouched(bad, before, "unknown placeholder");
});

// Scenario: unit-open-without-flag

test("policy-env-var-still-ignored", () => {
  const repo = makeRepo({ openTask: false, remote: true });

  const result = pbUnitOpen(repo, { PAIRINGBUDDY_GATE_POLICY: "auto" }, "--type", "feat", "--slug", "x");

  assert.equal(result.code, 0, `the no-flag open exits 0 with the policy env var set: ${result.stderr}`);
  assert.equal(gitIn(repo, "rev-parse", "--abbrev-ref", "HEAD"), "feat/x", "HEAD is on feat/x, the same as without the env var");
  const unit = JSON.parse(readFileSync(unitPath(repo), "utf8"));
  assert.equal(unit.branch, "feat/x", "unit.branch records feat/x");
});

test("yes-flag-is-refused-as-unknown-and-touches-nothing", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const before = snapshotRepo(repo);

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--yes");

  const output = result.stderr + result.stdout;
  assert.equal(result.code, 2, "--yes is a usage error with exit code 2");
  assert.match(output, /--yes is no longer accepted: pb unit open has no confirm step\. usage: pb unit open --type <type> --slug <slug> \[--branch <name>\]/, "the message names --yes and shows the usage");
  assertUntouched(repo, before, "--yes");
});

test("branch-flag-overrides-the-template-branch", () => {
  const overridden = makeRepo({ openTask: false, remote: true });
  const withBranch = pbUnitOpen(overridden, {}, "--type", "feat", "--slug", "x", "--branch", "my/x");
  assert.equal(withBranch.code, 0, `--branch my/x opens the unit: ${withBranch.stderr}`);
  assert.equal(gitIn(overridden, "rev-parse", "--abbrev-ref", "HEAD"), "my/x", "HEAD is on the branch given by --branch");
  assert.equal(gitIn(overridden, "branch", "--list", "feat/x"), "", "the template branch feat/x was not created");
  const unit = JSON.parse(readFileSync(join(overridden.dir, ".pairingbuddy", "run", "unit.json"), "utf8"));
  assert.equal(unit.branch, "my/x", "unit.branch records the --branch value");

  for (const badArgs of [["--branch"], ["--branch", "-x"]]) {
    const repo = makeRepo({ openTask: false, remote: true });
    const before = snapshotRepo(repo);
    const refused = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", ...badArgs);
    const label = badArgs.join(" ");
    assert.equal(refused.code, 2, `'${label}' is a usage error with exit code 2`);
    assert.match(refused.stderr + refused.stdout, /--branch needs a branch name that does not start with '-'/, `'${label}' says --branch needs a name`);
    assertUntouched(repo, before, `'${label}'`);
  }
});

test("branch-name-that-is-protected-or-invalid-refuses", () => {
  // `release` does not exist yet, so only a protection check can refuse it.
  const cases = [
    { label: "configured protected branch release", branch: "release", protectedList: ["release"], message: "branch release is protected; choose another name" },
    { label: "name with '..'", branch: "bad..name", message: "invalid branch name: bad..name" },
    { label: "name with a space", branch: "has space", message: "invalid branch name: has space" },
  ];
  for (const { label, branch, protectedList, message } of cases) {
    const repo = makeRepo({ openTask: false, remote: true });
    if (protectedList) {
      mkdirSync(join(repo.dir, ".pairingbuddy"), { recursive: true });
      writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ protected_branches: protectedList }));
    }
    assert.equal(gitIn(repo, "branch", "--list", branch), "", `${label}: the branch does not exist beforehand`);
    const before = snapshotRepo(repo);

    const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--branch", branch);

    const output = result.stderr + result.stdout;
    assert.equal(result.code, 1, `${label}: --branch ${branch} refuses with the deliberate refusal exit code`);
    assert.ok(output.includes(message), `${label}: the refusal says "${message}", got: ${output}`);
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

    const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x");

    assert.equal(result.code, 1, `${name}: pb unit open refuses with the deliberate refusal exit code`);
    assert.ok((result.stderr + result.stdout).includes(`the tree is dirty, so the unit cannot open. Commit or remove these, nothing was touched: ${file}`), `${name}: the refusal says the tree is dirty and names ${file}`);
    assertUntouched(repo, before, name);
    assert.equal(readFileSync(join(repo.dir, file), "utf8"), content, `${name}: the dirty file is untouched`);
  }

  const clean = makeRepo({ openTask: false, remote: true });
  mkdirSync(join(clean.dir, ".pairingbuddy"), { recursive: true });
  writeFileSync(join(clean.dir, ".pairingbuddy", "git-config.json"), "{}\n");
  const opened = pbUnitOpen(clean, {}, "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `.pairingbuddy/ contents do not count as dirty: ${opened.stderr}`);
});

test("fetches-and-branches-from-updated-remote-default", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const staleTip = gitIn(repo, "rev-parse", "origin/main");
  const other = pushFromSecondClone(repo, "main", "newer.txt");
  assert.notEqual(other, staleTip, "the second clone pushed a new commit");

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x");

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

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x");

  assert.equal(result.code, 0, `pb unit open exits 0: ${result.stderr}`);
  assert.equal(gitIn(repo, "rev-parse", "feat/x"), developTip, "the branch starts at the tip of develop");
  const unit = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), "utf8"));
  assert.equal(unit.base, "develop", "unit.base names the configured base branch");
  assert.equal(unit.baseSha, developTip, "unit.baseSha is the tip of develop");

  const missing = makeRepo({ openTask: false, remote: true });
  writeBase(missing, "nonexistent-base");
  const before = snapshotRepo(missing);
  const refused = pbUnitOpen(missing, {}, "--type", "feat", "--slug", "x");
  assert.equal(refused.code, 1, "a base branch missing on the remote refuses with the deliberate refusal exit code");
  assert.match(refused.stderr + refused.stdout, /nonexistent-base/, "the refusal names the missing base branch");
  assertUntouched(missing, before, "missing base branch");
});

test("fetch-failure-refuses-before-creating-anything", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  gitIn(repo, "remote", "set-url", "origin", `${repo.remoteDir}-missing`);
  const before = snapshotRepo(repo);

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x");

  assert.equal(result.code, 1, "an unreachable remote refuses with exit code 1");
  assert.ok((result.stderr + result.stdout).includes("pb: git fetch origin failed:"), "the refusal names the fetch failure");
  assertUntouched(repo, before, "fetch failure");
});

test("existing-unit-or-branch-name-collision-refuses", () => {
  const withUnit = makeRepo({ openTask: false, remote: true });
  const existingBytes = '{ "unit":"earlier",   "branch":"feat/earlier" }\n\n';
  mkdirSync(join(withUnit.dir, ".pairingbuddy", "run"), { recursive: true });
  writeFileSync(unitPath(withUnit), existingBytes);
  const unitHeadBefore = gitIn(withUnit, "rev-parse", "HEAD");
  const unitBranchesBefore = gitIn(withUnit, "branch", "--list");

  const unitRefused = pbUnitOpen(withUnit, {}, "--type", "feat", "--slug", "x");

  const unitOutput = unitRefused.stderr + unitRefused.stdout;
  assert.equal(unitRefused.code, 1, "an existing unit.json refuses with the deliberate refusal exit code");
  assert.ok(unitOutput.includes("a unit is already open (run/unit.json exists); nothing was touched"), "the refusal says a unit is already open");
  assert.doesNotMatch(unitOutput, /fatal:|unexpected failure/, "the refusal is deliberate, not a git error or the catch-all");
  assert.equal(readFileSync(unitPath(withUnit), "utf8"), existingBytes, "the existing unit.json is byte-identical");
  assert.equal(gitIn(withUnit, "branch", "--list"), unitBranchesBefore, "no branch was created");
  assert.equal(gitIn(withUnit, "rev-parse", "HEAD"), unitHeadBefore, "HEAD did not move");

  const withBranch = makeRepo({ openTask: false, remote: true });
  gitIn(withBranch, "branch", "feat/x");
  const before = snapshotRepo(withBranch);
  const branchTipBefore = gitIn(withBranch, "rev-parse", "feat/x");

  const branchRefused = pbUnitOpen(withBranch, {}, "--type", "feat", "--slug", "x");

  const branchOutput = branchRefused.stderr + branchRefused.stdout;
  assert.equal(branchRefused.code, 1, "an existing local branch refuses with the deliberate refusal exit code");
  assert.ok(branchOutput.includes("branch feat/x already exists; choose another name"), "the refusal says the colliding branch feat/x already exists");
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
  const opened = pbUnitOpen(fresh, {}, "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `pb unit open moves to the unit branch: ${opened.stderr}`);
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
    stages: [{ name: "intake", status: "done" }, { name: "code-config", status: "done", attempt: 1 }, { name: NET, status: "done", attempt: 1 }],
    gates: { "G:type": { source: "auto" }, "G:task-end": { source: "auto" } },
  });
};

// A repo with an open unit and an open task, optionally finished.
const unitRepo = ({ finished }) => {
  const repo = makeRepo({ openTask: false, remote: true });
  const opened = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `pb unit open: ${opened.stderr}`);
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

// unit-open-plan-cli: pb unit open --plan (scenarios.json).

// Plan markdown builders. planUnit is one "#### PR:" group: an optional Depends on line, an optional PR line with its
// branch, then its task lines. tracerPlan wraps units in a tracer under "## Tasks".
const planUnit = (name, { pr, branch, dependsOn, tasks = [] } = {}) => [
  `#### PR: ${name}`, "",
  ...(dependsOn ? [`Depends on: ${dependsOn}`, ""] : []),
  ...(pr ? [`PR: ${pr} branch: ${branch}`, ""] : []),
  ...tasks, "",
];
const tracerPlan = (title, ...units) => ["## Tasks", "", `### ${title}`, "", ...units.flat()];

// Commits the plan lines as docs/plan.md, pushes it to origin/main and returns the base tip.
const publishPlan = (repo, lines) => {
  writePlan(repo, lines.join("\n"));
  gitIn(repo, "add", "docs/plan.md");
  gitIn(repo, "commit", "-q", "-m", "add plan");
  gitIn(repo, "push", "-q", "origin", "main");
  return gitIn(repo, "rev-parse", "origin/main");
};

// Runs pb unit open --plan against a fresh gh shim. ghEnv is extra shim environment (viewEnv/viewsEnv, GH_SHIM_FAIL).
const openPlanUnit = (repo, slug, ghEnv = {}) =>
  pbUnitOpen(repo, { ...installGhShim().env(), ...ghEnv }, "--type", "feat", "--slug", slug, "--plan", "docs/plan.md");

const exitMessage = (result, expectation = "exits 0") => `${expectation}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`;

test("independent-unit-branches-from-base-with-earlier-pr-open", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const baseTip = publishPlan(repo, tracerPlan(
    "Tracer 1: Skeleton",
    planUnit("First", { pr: FAKE_PR_URL, branch: "first-branch", tasks: ["- [x] **One**"] }),
    planUnit("Second", { tasks: ["- [ ] **Two**"] }),
  ));

  const result = openPlanUnit(repo, "second", viewEnv({ head: "first-branch", state: "OPEN" }));

  assert.equal(result.code, 0, `pb unit open --plan ${exitMessage(result)}`);
  assert.equal(gitIn(repo, "rev-parse", "feat/second"), baseTip, "the branch starts at the tip of origin/main, not at the open PR's branch");
  const unit = JSON.parse(readFileSync(unitPath(repo), "utf8"));
  assert.equal(unit.base, "main", "unit.base is the default base");
  assert.equal(unit.baseSha, baseTip, "unit.baseSha is the base tip");
  assert.equal("stackedOn" in unit, false, "an independent unit has no stackedOn");
  assert.equal(unit.unit, "Second", "unit.unit is the plan unit name");
  assert.equal(unit.plan, "docs/plan.md", "unit.plan is the plan path");
  assert.equal(unit.tracer, "Tracer 1: Skeleton", "unit.tracer is the plan tracer");
});

test("dependent-unit-with-open-pr-stacks-and-records-stackedOn", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  publishPlan(repo, tracerPlan(
    "Tracer 1: Skeleton",
    planUnit("First", { pr: FAKE_PR_URL, branch: "first-branch", tasks: ["- [x] **One**"] }),
    planUnit("Second", { dependsOn: "First", tasks: ["- [ ] **Two**"] }),
  ));
  const depTip = pushFromSecondClone(repo, "first-branch", "dep.txt");

  const result = openPlanUnit(repo, "second", viewsEnv({ [FAKE_PR_URL]: { head: "first-branch", state: "OPEN" } }));

  assert.equal(result.code, 0, `pb unit open --plan ${exitMessage(result)}`);
  const unit = JSON.parse(readFileSync(unitPath(repo), "utf8"));
  assert.equal(unit.base, "first-branch", "unit.base is the dependency's head branch");
  assert.equal(unit.baseSha, depTip, "unit.baseSha is the dependency's pushed tip, as fetched from origin/first-branch");
  assert.equal(gitIn(repo, "rev-parse", "feat/second"), depTip, "the new branch starts at the dependency's tip");
  assert.deepEqual(unit.stackedOn, { unit: "First", pr: FAKE_PR_URL, branch: "first-branch" }, "unit.json records stackedOn");
  assert.equal(JSON.parse(result.stdout).base, "first-branch", "the JSON pb prints has base = the dependency branch");
});

test("merged-dependency-branches-from-fetched-base", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const planTip = publishPlan(repo, tracerPlan(
    "Tracer 1: Skeleton",
    planUnit("First", { pr: FAKE_PR_URL, branch: "first-branch", tasks: ["- [x] **One**"] }),
    planUnit("Second", { dependsOn: "First", tasks: ["- [ ] **Two**"] }),
  ));
  const movedTip = pushFromSecondClone(repo, "main", "merged.txt");
  assert.notEqual(movedTip, planTip, "main moved on origin after the plan was pushed");

  const result = openPlanUnit(repo, "second", viewsEnv({ [FAKE_PR_URL]: { head: "first-branch", state: "MERGED" } }));

  assert.equal(result.code, 0, `pb unit open --plan ${exitMessage(result)}`);
  assert.equal(gitIn(repo, "rev-parse", "feat/second"), movedTip, "the branch starts at the fetched new tip of origin/main");
  const unit = JSON.parse(readFileSync(unitPath(repo), "utf8"));
  assert.equal(unit.base, "main", "unit.base is the default base, not the merged dependency's branch");
  assert.equal(unit.baseSha, movedTip, "unit.baseSha is the fetched new base tip");
  assert.equal("stackedOn" in unit, false, "a merged dependency records no stackedOn");
});

test("depth-cap-stop-writes-nothing-and-makes-no-branch", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  publishPlan(repo, tracerPlan(
    "Tracer 1: Skeleton",
    planUnit("First", { pr: FAKE_PR_URL, branch: "first-branch", tasks: ["- [x] **One**"] }),
    planUnit("Second", { dependsOn: "First", tasks: ["- [ ] **Two**"] }),
  ));
  writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ pr: { stack_depth: 0 } }));
  const before = snapshotRepo(repo);

  const result = openPlanUnit(repo, "second", viewsEnv({ [FAKE_PR_URL]: { head: "first-branch", state: "OPEN" } }));

  assert.notEqual(result.code, 0, "an open dependency with stack_depth 0 stops");
  const message = result.stderr + result.stdout;
  assert.ok(message.includes("G:next-unit"), `the stop names G:next-unit: ${message}`);
  assert.ok(message.includes("stack-depth"), `the stop names the reason stack-depth: ${message}`);
  assert.match(message, /depth 1\b/, `the stop names the depth 1: ${message}`);
  assert.match(message, /cap 0\b/, `the stop names the cap 0: ${message}`);
  assert.match(message, /until a base merges/, `the stop says it waits until a base merges: ${message}`);
  assertUntouched(repo, before, "the depth cap stop");
});

function stackedOnOpenFirst() {
  const repo = makeRepo({ openTask: false, remote: true });
  publishPlan(repo, tracerPlan(
    "Tracer 1: Skeleton",
    planUnit("First", { pr: FAKE_PR_URL, branch: "first-branch", tasks: ["- [x] **One**"] }),
    planUnit("Second", { dependsOn: "First", tasks: ["- [ ] **Two**"] }),
  ));
  return repo;
}

function assertDeliberateRefusal(message) {
  assert.doesNotMatch(message, /unexpected failure|\n\s+at /, `the refusal is deliberate, not a crash or stack trace: ${message}`);
}

test("gh-failure-refuses-and-touches-nothing", () => {
  const repo = stackedOnOpenFirst();
  const before = snapshotRepo(repo);

  const result = openPlanUnit(repo, "second", { GH_SHIM_FAIL: "pr view" });

  assert.equal(result.code, 1, `a failing gh pr view ${exitMessage(result, "refuses with exit 1")}`);
  const message = result.stderr + result.stdout;
  assertDeliberateRefusal(message);
  assert.match(message, new RegExp(`gh pr view.*${FAKE_PR_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `the refusal names the gh pr view call and the dependency PR URL: ${message}`);
  assertUntouched(repo, before, "the gh failure");
});

test("closed-dependency-refuses-and-touches-nothing", () => {
  const repo = stackedOnOpenFirst();
  const before = snapshotRepo(repo);

  const result = openPlanUnit(repo, "second", viewsEnv({ [FAKE_PR_URL]: { head: "first-branch", state: "CLOSED" } }));

  assert.equal(result.code, 1, `a closed dependency PR ${exitMessage(result, "refuses with exit 1")}`);
  const message = result.stderr + result.stdout;
  assertDeliberateRefusal(message);
  assert.match(message, /First: its PR was closed without merging/, `the refusal names First as the dependency whose PR was closed: ${message}`);
  assert.ok(message.includes("Nothing was changed but the fetch"), `the refusal says only the fetch happened: ${message}`);
  assertUntouched(repo, before, "the closed dependency");
});

for (const [label, depth] of [["negative", -1], ["fractional", 1.5], ["string", "3"]]) {
  test(`invalid-stack-depth-refused-${label}`, () => {
    const repo = stackedOnOpenFirst();
    writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ pr: { stack_depth: depth } }));
    const before = snapshotRepo(repo);

    const result = openPlanUnit(repo, "second", viewsEnv({ [FAKE_PR_URL]: { head: "first-branch", state: "OPEN" } }));

    assert.equal(result.code, 1, `pr.stack_depth ${JSON.stringify(depth)} ${exitMessage(result, "refuses with exit 1")}`);
    const message = result.stderr + result.stdout;
    assertDeliberateRefusal(message);
    assert.ok(message.includes("pr.stack_depth"), `the refusal names pr.stack_depth: ${message}`);
    assert.match(message, /non-negative integer/, `the refusal says it must be a non-negative integer: ${message}`);
    assertUntouched(repo, before, `stack_depth ${JSON.stringify(depth)}`);
  });
}

test("plan-flag-without-a-value-is-a-usage-error", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const before = snapshotRepo(repo);

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--plan");

  assert.notEqual(result.code, 0, "--plan with no value fails");
  assert.match(result.stderr + result.stdout, /usage: pb unit open/, "the failure is the usage message");
  assertUntouched(repo, before, "--plan without a value");
});

test("plan-with-no-task-left-refuses-and-touches-nothing", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  publishPlan(repo, tracerPlan("Tracer 1: Skeleton", planUnit("Done", { pr: FAKE_PR_URL, branch: "done-branch", tasks: ["- [x] **One**"] })));
  const before = snapshotRepo(repo);

  const result = openPlanUnit(repo, "x");

  assert.notEqual(result.code, 0, "a plan with no task left refuses");
  assert.match(result.stderr + result.stdout, /no task left/, "the refusal says no task is left");
  assertUntouched(repo, before, "a plan with no task left");
});

test("plan-flag-followed-by-branch-is-a-usage-error-and-touches-nothing", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const before = snapshotRepo(repo);

  const result = pbUnitOpen(repo, {}, "--type", "feat", "--slug", "x", "--plan", "--branch", "foo");

  assert.equal(result.code, 2, "--plan swallowing --branch is a usage error with exit code 2");
  assert.match(result.stderr + result.stdout, /usage: pb unit open/, "the failure is the usage message");
  assertUntouched(repo, before, "--plan --branch foo");
});

const SECOND_PR_URL = "https://github.com/example/repo/pull/8";

test("three-unit-chain-stacks-on-the-second-and-views-both-prs", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  publishPlan(repo, tracerPlan(
    "Tracer 1: Skeleton",
    planUnit("First", { pr: FAKE_PR_URL, branch: "first-branch", tasks: ["- [x] **One**"] }),
    planUnit("Second", { pr: SECOND_PR_URL, branch: "second-branch", dependsOn: "First", tasks: ["- [x] **Two**"] }),
    planUnit("Third", { dependsOn: "Second", tasks: ["- [ ] **Three**"] }),
  ));
  const secondTip = pushFromSecondClone(repo, "second-branch", "second.txt");
  const shim = installGhShim();
  const views = viewsEnv({
    [FAKE_PR_URL]: { head: "first-branch", state: "OPEN" },
    [SECOND_PR_URL]: { head: "second-branch", state: "OPEN" },
  });

  const result = pbUnitOpen(repo, { ...shim.env(), ...views }, "--type", "feat", "--slug", "third", "--plan", "docs/plan.md");

  assert.equal(result.code, 0, `pb unit open --plan ${exitMessage(result)}`);
  const unit = JSON.parse(readFileSync(unitPath(repo), "utf8"));
  assert.equal(unit.base, "second-branch", "the third unit stacks on the second unit's branch");
  assert.equal(unit.baseSha, secondTip, "the base is the second branch's pushed tip");
  const viewed = shim.prViews().map(({ argv }) => argv[argv.length - 1]).sort();
  assert.deepEqual(viewed, [FAKE_PR_URL, SECOND_PR_URL].sort(), "gh pr view ran for both PR urls of the chain");
});

test("dependency-without-a-pr-line-opens-on-the-base-without-calling-gh-pr-view", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const baseTip = publishPlan(repo, tracerPlan(
    "Tracer 1: Skeleton",
    planUnit("First", { tasks: ["Legacy: accepted", "", "- [x] **One**"] }),
    planUnit("Second", { dependsOn: "First", tasks: ["- [ ] **Two**"] }),
  ));
  const shim = installGhShim();

  const result = pbUnitOpen(repo, shim.env(), "--type", "feat", "--slug", "second", "--plan", "docs/plan.md");

  assert.equal(result.code, 0, `pb unit open --plan ${exitMessage(result)}`);
  assert.equal(JSON.parse(readFileSync(unitPath(repo), "utf8")).baseSha, baseTip, "the unit branches from the base tip");
  assert.deepEqual(shim.prViews(), [], "no gh pr view call was made");
});

test("dependency-pr-is-viewed-with-exact-argv", () => {
  const repo = stackedOnOpenFirst();
  pushFromSecondClone(repo, "first-branch", "dep.txt");
  const shim = installGhShim();

  const result = pbUnitOpen(repo, { ...shim.env(), ...viewsEnv({ [FAKE_PR_URL]: { head: "first-branch", state: "OPEN" } }) }, "--type", "feat", "--slug", "second", "--plan", "docs/plan.md");

  assert.equal(result.code, 0, `pb unit open --plan ${exitMessage(result)}`);
  assert.deepEqual(shim.prViews().map(({ argv }) => argv), [["pr", "view", "--json", "state,headRefName", "--", FAKE_PR_URL]], "gh is called with exactly this argv, once");
});

test("gh-failure-refusal-carries-the-gh-stderr", () => {
  const repo = stackedOnOpenFirst();

  const result = openPlanUnit(repo, "second", { GH_SHIM_FAIL: "pr view" });

  assert.equal(result.code, 1, `a failing gh pr view ${exitMessage(result, "refuses with exit 1")}`);
  assert.ok((result.stderr + result.stdout).includes(GH_FAILURE), `the refusal includes gh's own stderr text: ${result.stderr + result.stdout}`);
});

test("gh-answering-non-json-refuses-with-the-parse-error", () => {
  const repo = stackedOnOpenFirst();
  const before = snapshotRepo(repo);
  const parseError = (() => {
    try {
      JSON.parse("not json\n");
    } catch (error) {
      return error.message;
    }
    return assert.fail("JSON.parse was expected to throw");
  })();

  const result = openPlanUnit(repo, "second", { GH_SHIM_VIEW: "not json" });

  assert.equal(result.code, 1, `non-JSON from gh ${exitMessage(result, "refuses with exit 1")}`);
  const message = result.stderr + result.stdout;
  assert.ok(message.includes("state is unknown"), `the refusal says the state is unknown: ${message}`);
  assert.ok(message.includes(parseError), `the refusal carries the JSON parse error "${parseError}": ${message}`);
  assertUntouched(repo, before, "non-JSON from gh");
});
