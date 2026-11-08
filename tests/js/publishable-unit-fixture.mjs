// Shared setup for the tests of pb publish: a unit that pb publish can publish (publishableUnit), a plan file the PR:
// line is written into, the unit's private refs, and the one wrapper that runs pb publish with the recording gh.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { branchOf, headOf } from "../../shared-node/checkpoint.mjs";
import { updateLedger } from "../../shared-node/ledger.mjs";
import { newTaskRecord } from "../../shared-node/unit.mjs";
import { env, pb, pbWithEnv } from "./cli-repo-fixture.mjs";
import { installGhShim } from "./gh-shim-fixture.mjs";
import { sha256 } from "./tap-fixture.mjs";
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

// The unit's plan is a file in .pairingbuddy/ (git-ignored, so the tree stays clean) with the unit's heading in it.
export function withPlan(repo, text = PLAN) {
  writeFileSync(planFile(repo), text);
  changeUnit(repo, { plan: ".pairingbuddy/plan.md", unit: "Export" });
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
