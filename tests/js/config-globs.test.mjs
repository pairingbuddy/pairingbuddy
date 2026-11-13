// Scenario: task-end-config-globs. pb task end checks a config_change diff against git-config config_globs (D13).
// The diff is the task's own commits: the files changed from the previous task's headSha in the unit (or the unit's
// baseSha for its first task) up to HEAD. An empty list needs `pb human approve-config`, recorded for that task only.
// Never use { skip } here: the JS suite treats skipped tests as failures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeLedger } from "../../shared-node/ledger.mjs";
import { ROOT, env, makeRepo, pb } from "./cli-repo-fixture.mjs";
import { fixture, runGate } from "./gate-harness.mjs";

const CLI = join(ROOT, "cli", "pb.mjs");
const NET = "code-safety-net";
const gitIn = (repo, ...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), encoding: "utf8" }).trim();
const unitPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "unit.json");
const taskPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "task");
const ledgerPath = (repo) => join(taskPath(repo), "ledger.json");

const STAGES = {
  config_change: { stages: ["intake", "code-config", NET], gates: ["G:type", "G:task-end"] },
  bug_fix: { stages: ["intake", "code-scenarios", "code-tdd", NET], gates: ["G:type", "G:scenarios", "G:task-end"] },
};

// Marks the open run/task ledger as finished for its task type, the way unit-open.test.mjs does.
const finishLedger = (repo, task, taskType = "config_change") => {
  const configText = readFileSync(join(repo.dir, ".pairingbuddy", "test-config.json"), "utf8");
  const { stages, gates } = STAGES[taskType];
  writeLedger(ledgerPath(repo), {
    ...repo.ledger(),
    task,
    taskType,
    configHash: createHash("sha256").update(configText).digest("hex"),
    stage: { name: NET, status: "done", runId: "wf_2", attempt: 1, startedAt: null },
    stages: stages.map((name) => ({ name, status: "done", attempt: 1 })),
    gates: Object.fromEntries(gates.map((gate) => [gate, { source: "auto" }])),
  });
};

const commitFile = (repo, file, message) => {
  mkdirSync(join(repo.dir, file, ".."), { recursive: true });
  writeFileSync(join(repo.dir, file), `${file}\n`);
  gitIn(repo, "add", file);
  gitIn(repo, "commit", "-q", "-m", message);
};

// A repo with git-config.json written (config_globs as given), an open unit, one commit per file, and a finished task.
// baseFiles are committed before the unit opens, so they are part of the unit's base.
function finishedRepo({ globs, files, baseFiles = [], taskType = "config_change" }) {
  const repo = makeRepo({ openTask: false, remote: true, configGlobs: globs });
  for (const file of baseFiles) commitFile(repo, file, `base ${file}`);
  if (baseFiles.length > 0) gitIn(repo, "push", "-q", "origin", "main");
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);
  const run = pb(repo, "run", "open", "--kind", "code");
  assert.equal(run.code, 0, `setup: pb run open, stderr: ${run.stderr}`);
  for (const file of files) commitFile(repo, file, `change ${file}`);
  finishLedger(repo, "Task A", taskType);
  return repo;
}

const bytes = (repo) => ({ unit: readFileSync(unitPath(repo)), ledger: readFileSync(ledgerPath(repo)) });

test("task-end-refuses-diff-outside-globs", () => {
  const repo = finishedRepo({ globs: ["*.json"], files: ["settings.json", "src/app.mjs"] });
  const before = bytes(repo);

  const result = pb(repo, "task", "end");

  assert.equal(result.code, 1, `pb task end refuses with exit 1; stdout: ${result.stdout}`);
  assert.match(result.stderr, /src\/app\.mjs/, "the refusal names the offending file");
  assert.doesNotMatch(result.stderr, /settings\.json/, "the file inside the globs is not blamed");
  assert.deepEqual(readFileSync(unitPath(repo)), before.unit, "nothing was appended to the unit");
  assert.deepEqual(JSON.parse(before.unit.toString()).tasks, [], "setup: the unit had no task records");
  assert.ok(existsSync(taskPath(repo)), "run/task stays");
  assert.deepEqual(readFileSync(ledgerPath(repo)), before.ledger, "the ledger is unchanged");
});

test("task-end-accepts-diff-inside-globs", () => {
  const inside = finishedRepo({ globs: ["*.json"], files: ["settings.json", "conf/other.json"] });

  const result = pb(inside, "task", "end");

  assert.equal(result.code, 0, `a diff entirely inside config_globs ends the task: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).ok, true, "prints ok: true");
  assert.equal(JSON.parse(readFileSync(unitPath(inside), "utf8")).tasks.length, 1, "the task record was appended");
  assert.equal(existsSync(taskPath(inside)), false, "run/task is removed");
});

test("non-config-change-task-not-held-to-globs", () => {
  const repo = finishedRepo({ globs: ["*.json"], files: ["src/app.mjs"], taskType: "bug_fix" });

  const result = pb(repo, "task", "end");

  assert.equal(result.code, 0, `a bug_fix touching src/app.mjs is not checked against config_globs: ${result.stderr}`);
});

test("rename-into-config-path-refuses", () => {
  const repo = finishedRepo({ globs: ["config/**"], files: [], baseFiles: ["src/app.js"] });
  mkdirSync(join(repo.dir, "config"), { recursive: true });
  gitIn(repo, "mv", "src/app.js", "config/app.js");
  gitIn(repo, "commit", "-q", "-m", "move app.js into config");

  const result = pb(repo, "task", "end");

  assert.equal(result.code, 1, `a rename out of src/ is a change to src/app.js; stdout: ${result.stdout}`);
  assert.match(result.stderr, /src\/app\.js/, "the refusal names the rename source");
  assert.ok(existsSync(taskPath(repo)), "run/task stays");
});

test("approve-config-refuses-when-not-needed", () => {
  const repo = finishedRepo({ globs: ["*.json"], files: ["settings.json"] });

  const result = pb(repo, "human", "approve-config");

  assert.notEqual(result.code, 0, `approval is refused when config_globs is not empty; stdout: ${result.stdout}`);
  assert.match(result.stderr + result.stdout, /no approval needed/i, "it says no approval is needed");
});

test("approve-config-refuses-for-non-config-change-task", () => {
  const repo = finishedRepo({ files: ["src/app.mjs"], taskType: "bug_fix" });

  const result = pb(repo, "human", "approve-config");

  assert.notEqual(result.code, 0, `approval is refused for a task that is not a config_change; stdout: ${result.stdout}`);
  assert.match(result.stderr + result.stdout, /no approval needed/i, "it says no approval is needed");
});

test("task-end-empty-globs-refuses-and-tells-human", () => {
  const repo = finishedRepo({ files: ["settings.json"] });
  const before = bytes(repo);

  const result = pb(repo, "task", "end");

  assert.equal(result.code, 1, `with empty config_globs the config_change is refused; stdout: ${result.stdout}`);
  assert.match(result.stderr + result.stdout, /pb human approve-config/, "the output names the typed command pb human approve-config");
  assert.deepEqual(readFileSync(unitPath(repo)), before.unit, "unit.json is unchanged");
  assert.deepEqual(readFileSync(ledgerPath(repo)), before.ledger, "the ledger is unchanged");
  assert.ok(existsSync(taskPath(repo)), "run/task stays");
});

test("approve-config-then-task-end-passes", () => {
  const repo = finishedRepo({ files: ["settings.json"] });
  assert.equal(pb(repo, "task", "end").code, 1, "setup: empty globs refuse before the approval");

  const approved = pb(repo, "human", "approve-config");

  assert.equal(approved.code, 0, `pb human approve-config exits 0: ${approved.stderr}`);
  assert.equal(JSON.parse(approved.stdout).source, "human-cli", "the confirmation is recorded with source human-cli");
  const ended = pb(repo, "task", "end");
  assert.equal(ended.code, 0, `the next pb task end passes: ${ended.stderr}`);
  const unit = JSON.parse(readFileSync(unitPath(repo), "utf8"));
  assert.equal(unit.tasks.length, 1, "the task record was appended");

  // The confirmation applies only to that task: the next config_change is refused again.
  const run = pb(repo, "run", "open", "--kind", "code");
  assert.equal(run.code, 0, `setup: second pb run open: ${run.stderr}`);
  commitFile(repo, "other.json", "change other.json");
  finishLedger(repo, "Task B");
  const second = pb(repo, "task", "end");
  assert.equal(second.code, 1, `the second task needs its own confirmation; stdout: ${second.stdout}`);
  assert.match(second.stderr + second.stdout, /pb human approve-config/, "it names the typed command again");
  assert.equal(JSON.parse(readFileSync(unitPath(repo), "utf8")).tasks.length, 1, "no second record was appended");
});

test("approve-config-denied-from-every-tool-call", async () => {
  const repo = finishedRepo({ files: ["settings.json"] });
  const callers = { "the main context": fixture("pretooluse-workflow.json"), "a subagent": fixture("pretooluse-workflow-agent-bash.json") };

  for (const [caller, base] of Object.entries(callers)) {
    const payload = { ...base, cwd: repo.dir, permission_mode: "default", tool_name: "Bash", tool_input: { command: `node ${CLI} human approve-config`, description: "confirm the config diff" } };

    const result = await runGate(payload);

    assert.equal(result.code, 0, `${caller}: the JSON deny form needs exit 0; stderr: ${result.stderr}`);
    const decision = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(decision.permissionDecision, "deny", `${caller}: denied`);
    assert.match(decision.permissionDecisionReason, /\btype\b/i, `${caller}: the deny tells the human to type it`);
    assert.match(decision.permissionDecisionReason, /!/, `${caller}: the deny names the !`);
  }
});
