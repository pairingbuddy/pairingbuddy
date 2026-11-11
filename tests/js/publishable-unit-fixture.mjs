// Shared setup for the tests of pb publish: a unit that pb publish can publish (publishableUnit), a plan file the PR:
// line is written into, the unit's private refs, and the one wrapper that runs pb publish with the recording gh.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { branchOf, headOf } from "../../shared-node/checkpoint.mjs";
import { buildKey } from "../../shared-node/keys.mjs";
import { updateLedger } from "../../shared-node/ledger.mjs";
import { newTaskRecord } from "../../shared-node/unit.mjs";
import { env, makeRepo, pb, pbWithEnv, ROOT } from "./cli-repo-fixture.mjs";
import { FAKE_PR_URL, installGhShim } from "./gh-shim-fixture.mjs";
import { writeCleanLensReturn } from "./lens-return-fixture.mjs";
import { SESSION, fixture, runTap, sha256 } from "./tap-fixture.mjs";
import {
  DRAFT_KEY, GATE,
  approvedThroughTap, commitMore, evalGate, git, gitConfigPath, publishRepo, readUnitRecord, unitFile,
} from "./publish-fixture.mjs";

export const SAFETY_NET = "code-safety-net";
export const ledgerFile = (repo) => join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json");

export function changeUnit(repo, change) {
  writeFileSync(unitFile(repo), JSON.stringify({ ...readUnitRecord(repo), ...change }, null, 2));
}

export const changeLedger = (repo, change) => updateLedger(ledgerFile(repo), (ledger) => ({ ...ledger, ...change(ledger) }));

const remoteGit = (repo, ...args) => execFileSync("git", ["--git-dir", repo.remoteDir, ...args], { env: env(), encoding: "utf8" }).trim();

export function remoteRef(repo, ref) {
  try {
    return remoteGit(repo, "rev-parse", "--verify", "--quiet", ref);
  } catch {
    return null;
  }
}

const refNames = (output) => output.split("\n").filter(Boolean);
export const remoteRefs = (repo) => refNames(remoteGit(repo, "for-each-ref", "--format=%(refname)", "refs/pairingbuddy/"));
export const localRefs = (repo) => refNames(git(repo, "for-each-ref", "--format=%(refname)", "refs/pairingbuddy/"));

// The unit's own refs live under refs/pairingbuddy/<branch>/; another unit's refs sit beside them.
export const privateRefsOf = (branch) => [`refs/pairingbuddy/${branch}/red/1`, `refs/pairingbuddy/${branch}/checkpoint`];
export const OTHER_UNIT_REF = "refs/pairingbuddy/other-unit/checkpoint";
export const makePrivateRefs = (repo, branch) => privateRefsOf(branch).forEach((ref) => git(repo, "update-ref", ref, "HEAD"));

// A bare-remote commit on the unit branch that the local branch lacks.
export function divergeRemote(repo, branch) {
  const sha = git(repo, "commit-tree", "-p", "main", "-m", "remote only", "main^{tree}");
  git(repo, "push", "-q", "origin", `${sha}:refs/heads/${branch}`);
  return sha;
}

export const RUN_FILES = ["unit.json", "pr-body.md", "pr-lint.json"];
export const runFile = (repo, name) => join(repo.dir, ".pairingbuddy", "run", name);

// A sequenced plan: the unit is a level-4 "PR: <title>" heading under a higher-level one, with its task boxes below.
export const PLAN = "# Plan\n\n## Phase one\n\n#### PR: Export\n\n- [x] Task A\n\n#### PR: Other\n\n- [ ] Task C\n";
export const planFile = (repo) => join(repo.dir, ".pairingbuddy", "plan.md");

// The PR: line pb publish writes into the plan for a unit on this branch.
export const prLinePattern = (branch) => new RegExp(`^PR: ${FAKE_PR_URL.replace(/\./g, "\\.")} branch: ${branch}$`, "m");

// A pre-push hook in the repo that runs the shell command, so a test can change things between the checks and the push.
export function installPrePushHook(repo, command) {
  const hooks = join(repo.dir, git(repo, "rev-parse", "--git-path", "hooks"));
  const hook = join(hooks, "pre-push");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(hook, `#!/bin/sh\n${command}\n`);
  chmodSync(hook, 0o755);
}

// The plan is readable when publish checks it and a directory by the time the PR: line is written, for any user, root
// included, so pb publish stops after opening the PR (and commenting) with the unit still open.
export const planBecomesDirectoryAtPush = (repo) => installPrePushHook(repo, `rm "${planFile(repo)}" && mkdir "${planFile(repo)}"`);

// The unit's plan is a file in .pairingbuddy/ (git-ignored, so the tree stays clean) with the unit's heading in it.
export function withPlan(repo, text = PLAN) {
  writeFileSync(planFile(repo), text);
  changeUnit(repo, { plan: ".pairingbuddy/plan.md", unit: "Export" });
}

// A unit that crashed after opening the PR: pushed, its url recorded (pr.url, plus extraPr), with a plan and private refs.
export function unitWithRecordedPr(extraPr = {}) {
  const unit = publishableUnit();
  withPlan(unit.repo);
  makePrivateRefs(unit.repo, unit.branch);
  git(unit.repo, "push", "-q", "-u", "origin", unit.branch);
  changeUnit(unit.repo, { pr: { url: FAKE_PR_URL, ...extraPr } });
  return unit;
}

// A task record as pb task end appends it, built by the real writer from a ledger with a finished safety-net, valid
// gate sources and a green full suite at head. over replaces fields.
export const taskRecord = (head, over = {}) => ({
  ...newTaskRecord({
    ledger: {
      task: "Task A",
      stages: [{ name: "code-config", attempt: 1 }, { name: SAFETY_NET, attempt: 1 }],
      gates: { "G:task-end": { source: "auto" } },
      tests: { full: { passed: true, head } },
    },
    headSha: head,
  }),
  ...over,
});

// Writes git-config.json (merging into what is there) and makes the unit's git-config hash the file's, as it would
// have been when the unit was set up.
function configureGit(repo, pr) {
  const path = gitConfigPath(repo);
  let current = {};
  try {
    current = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // no git-config.json yet
  }
  writeFileSync(path, JSON.stringify({ ...current, pr: { ...current.pr, ...pr } }));
  changeUnit(repo, { gitConfigHash: sha256(readFileSync(path, "utf8")) });
}

// publishRepo plus everything pb publish asks for, so it should succeed on it. Each option breaks one item:
//   tasks         the task records (default: one record at HEAD); each is taskRecord(head, entry), entry overriding fields
//   fullSuite     undefined = {passed:true, head: HEAD} on the last task; null = none; an object replaces it (its head defaults to HEAD)
//   approval      "tap" (default; the real tap), "cli" (pb human approve G:publish), "none"
//   baseBranch    pr.base_branch in git-config.json (also pushed to the remote as a branch, so it exists there)
//   publishMode   pr.publish in git-config.json ("none" closes the unit without a push)
//   labels        the draft's labels (the draft artifact is rewritten and pb pr lint run again)
//   unrecordedCommit  a commit past baseSha that unit.commits does not list (made before the approval)
//   dirty         an untracked source file after the approval
// mode is the policy the gate hook records ("default" | "auto" | ...). Returns publishRepo's value plus head and branch.
export function publishableUnit({ tasks, fullSuite, approval = "tap", baseBranch, publishMode, labels, unrecordedCommit = false, dirty = false, ...rest } = {}) {
  const made = publishRepo(rest);
  const { repo, runDir } = made;
  if (unrecordedCommit) commitMore(repo, "unrecorded");
  if (baseBranch !== undefined) {
    configureGit(repo, { base_branch: baseBranch });
    git(repo, "push", "-q", "origin", `main:refs/heads/${baseBranch}`);
  }
  if (publishMode !== undefined) configureGit(repo, { publish: publishMode });
  if (labels !== undefined) {
    const file = join(runDir, "task", "artifacts", `${DRAFT_KEY}.json`);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), labels }));
  }
  if (labels !== undefined || baseBranch !== undefined || unrecordedCommit) {
    const lint = pb(repo, "pr", "lint");
    assert.equal(lint.code, 0, `pr lint: ${lint.stderr}`);
  }
  const head = headOf(repo.dir);
  const records = (tasks ?? [{}]).map((entry) => taskRecord(head, entry));
  const last = records.at(-1);
  if (last !== undefined && fullSuite !== undefined) {
    if (fullSuite === null) delete last.fullSuite;
    else last.fullSuite = { ...fullSuite, head: fullSuite.head ?? head };
  }
  changeUnit(repo, { tasks: records });
  if (approval === "tap") approvedThroughTap(repo);
  if (approval === "cli") {
    evalGate(repo);
    const approved = pb(repo, "human", "approve", GATE);
    assert.equal(approved.code, 0, approved.stderr);
  }
  if (dirty) writeFileSync(join(repo.dir, "uncommitted.txt"), "dirty\n");
  return { ...made, head, branch: branchOf(repo.dir) };
}

// Runs pb publish on the unit with a fresh recording gh first on PATH. The gate policy variable is cleared unless
// extraEnv sets it. Returns the gh shim and pb's result.
export function publishUnit(unit, extraEnv = {}) {
  const gh = installGhShim();
  const result = pbWithEnv(unit.repo, gh.env({ PAIRINGBUDDY_GATE_POLICY: undefined, ...extraEnv }), "publish");
  return { gh, result };
}

// ---------- the publish run ----------

export const TASK = "Add an export button";
export const CONTEXT = "Readers want the table as CSV.";
export const taskDirOf = (repo) => join(repo.dir, ".pairingbuddy", "run", "task");
export const runDirOf = (repo) => join(repo.dir, ".pairingbuddy", "run");

export function writeTaskJson(repo, task = { description: TASK, context: CONTEXT }) {
  writeFileSync(join(repo.dir, ".pairingbuddy", "task.json"), JSON.stringify(task));
}

// A repo with a unit open (the real pb unit open), one commit on its branch, and `tasks` task records in unit.json
// (none for an empty list), with .pairingbuddy/task.json written. No run/task. The task records are seeded: pb task end
// appends them in a real run, and it needs a finished code run (see publishableUnit).
export function endedTaskUnit({ tasks = [{}] } = {}) {
  const repo = makeRepo({ openTask: false, remote: true });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "export");
  assert.equal(opened.code, 0, `unit open: ${opened.stderr}`);
  writeFileSync(join(repo.dir, "export-1.txt"), "export 1\n");
  git(repo, "add", "export-1.txt");
  git(repo, "commit", "-q", "-m", "feat: add export 1");
  const head = headOf(repo.dir);
  changeUnit(repo, { tasks: tasks.map((entry) => taskRecord(head, entry)), commits: [head] });
  writeTaskJson(repo);
  return repo;
}

export function openRun(repo, kind) {
  const opened = pb(repo, "run", "open", "--kind", kind);
  assert.equal(opened.code, 0, `run open --kind ${kind}: ${opened.stderr}`);
  return JSON.parse(opened.stdout);
}

export function statusAction(repo) {
  const result = pb(repo, "status", "--action");
  assert.equal(result.code, 0, `pb status --action: ${result.stderr}`);
  return JSON.parse(result.stdout).action;
}

const hookPayload = (repo, base, over) => ({ ...base, session_id: SESSION, cwd: repo.dir, ...over });

function startWorkflow(repo, mode) {
  const args = JSON.parse(/with the args (\{.*\})\./.exec(statusAction(repo))[1]);
  const { agent_id: _id, agent_type: _type, ...base } = fixture("pretooluse-workflow.json");
  const toolInput = { name: "pairingbuddy:pr-draft", args };
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(ROOT, "hooks", "gate-boot.mjs")], {
    cwd: repo.dir, input: JSON.stringify(hookPayload(repo, base, { permission_mode: mode, tool_name: "Workflow", tool_input: toolInput })),
    env: env({ PAIRINGBUDDY_GATE_POLICY: undefined }), encoding: "utf8",
  });
  assert.equal(status, 0, `the gate hook: ${stderr}`);
  assert.equal(stdout, "", "the gate hook lets the pr-draft workflow start");
  const posted = { ...base, tool_name: "Workflow", tool_input: toolInput, tool_response: { runId: "wf_pr_draft" } };
  runTap(repo, hookPayload(repo, posted, { hook_event_name: "PostToolUse" }));
}

// What the pr-draft workflow's agent returns, filed by the tap under the key the workflow builds.
function fileDraft(repo, draft) {
  const { pb_key: _drafted, ...fields } = draft;
  const pbKey = buildKey({ stage: "pr-draft", role: "draft-pull-request", item: null, round: 1, attempt: 1 });
  const payload = {
    ...fixture("pretooluse-workflow-agent-bash.json"), hook_event_name: "PostToolUse", tool_name: "StructuredOutput",
    agent_type: "pairingbuddy:draft-pull-request", tool_input: { pb_key: pbKey, ...fields }, tool_response: "ok",
  };
  runTap(repo, hookPayload(repo, payload, {}));
}

// A publish run reached the way a real one is: pb run open --kind publish, the pr-draft workflow started through the
// gate hook (which records the policy and the stage), its draft-pull-request return filed by the tap, then the
// runner's two commands, pb pr lint and pb stage finish. Only the unit around it is built by publishableUnit (its task
// records are seeded, see there), and that unit's own hand-written run/task is thrown away; the draft's fields are
// carried over as the agent's answer. approve false leaves G:publish unanswered; other options go to publishableUnit.
// Files a clean return for every lens of the pr-draft row, so stage finish finds no uncovered lens by itself.
function fileCleanPrDraftLenses(repo) {
  const { rows } = JSON.parse(readFileSync(join(ROOT, "contracts", "lenses.json"), "utf8"));
  const row = rows.find((r) => r.row === "pr-draft");
  for (const { name } of row.lenses) writeCleanLensReturn(join(taskDirOf(repo), "artifacts"), "pr-draft", name, 1);
}

export function publishRun({ approve = true, mode = "default", cleanLenses = false, ...options } = {}) {
  const unit = publishableUnit({ approval: "none", mode, ...options });
  const { repo } = unit;
  const draft = JSON.parse(readFileSync(join(taskDirOf(repo), "artifacts", `${DRAFT_KEY}.json`), "utf8"));
  rmSync(taskDirOf(repo), { recursive: true });
  writeTaskJson(repo);
  openRun(repo, "publish");
  startWorkflow(repo, mode);
  fileDraft(repo, draft);
  if (cleanLenses) fileCleanPrDraftLenses(repo);
  const lint = pb(repo, "pr", "lint");
  assert.equal(lint.code, 0, `pr lint: ${lint.stderr}`);
  const finished = pb(repo, "stage", "finish");
  assert.equal(finished.code, 0, `stage finish: ${finished.stderr}`);
  if (approve) approvedThroughTap(repo);
  return unit;
}
