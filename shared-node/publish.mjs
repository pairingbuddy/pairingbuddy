// Pure planning for pb publish: which evidence refuses, which steps run in which order, and the argv of the commands.
// No I/O here; the CLI gathers the facts and executes what this plans.

const GATE_SOURCES = ["auto", "human", "human-cli"];
const short = (sha) => String(sha).slice(0, 7);
const list = (items) => items.join(", ");

// Plan boxes under the unit's heading with no task record. With no boxes to go by, the unit must have a record at all.
export const recordedTasks = ({ unit, planBoxes, planProblem }) => {
  if (planProblem) return planProblem;
  if (planBoxes === null || planBoxes.length === 0) return unit.tasks.length > 0 ? null : "the unit has no task records";
  const titles = new Set(unit.tasks.map((task) => task.title));
  const missing = planBoxes.filter((label) => !titles.has(label));
  return missing.length === 0 ? null : `the plan has tasks with no task record: ${list(missing)}`;
};

const withoutSafetyNet = ({ unit, safetyNets }) => {
  const unfinished = unit.tasks.filter((task) => !task.stages.some((name) => safetyNets.includes(name)));
  return unfinished.length === 0 ? null : `${list(safetyNets)} did not finish for ${list(unfinished.map((task) => task.title))}`;
};

// The lens-record rule the auto policy and the publish evidence share: a task has a safety-net lens record when it is not empty.
export const taskHasLensRecord = ({ lenses }) => Object.keys(lenses?.["safety-net"] ?? {}).length > 0;

// Defence in depth: an auto approval stands only if every task has its safety-net lens record.
const autoWithoutLensRecord = ({ unit, approval }) => {
  if (approval !== "auto") return null;
  const lacking = unit.tasks.filter((task) => !taskHasLensRecord(task));
  return lacking.length === 0 ? null : `G:publish was passed by the auto policy, but these tasks have no safety-net lens record: ${list(lacking.map((task) => task.title))}`;
};

// Defence in depth: an auto approval stands only if the PR lint passes at the body as it is now.
const autoWithFailingLint = ({ approval, lint }) => {
  if (approval !== "auto" || lint?.ok === true) return null;
  const detail = lint?.status === "failed" && lint.failures.length > 0 ? lint.failures.map(({ rule }) => rule).join(", ") : (lint?.status ?? "missing");
  return `G:publish was passed by the auto policy, but the PR lint does not pass at the current body: ${detail}`;
};

const invalidGateSources = ({ unit }) => {
  const bad = unit.tasks.flatMap((task) => Object.entries(task.gateSources).filter(([, source]) => !GATE_SOURCES.includes(source)).map(([gate, source]) => `${gate} from ${task.title} has source ${JSON.stringify(source)}`));
  return bad.length === 0 ? null : `invalid gate sources: ${list(bad)}`;
};

// Only the last task's suite can be at HEAD, so only that one is read.
const staleFullSuite = ({ unit, head }) => {
  if (unit.tasks.length === 0) return null;
  const suite = unit.tasks.at(-1).fullSuite;
  if (!suite || suite.passed !== true) return "the last task has no passing full-suite result; run pb test --full";
  if (!suite.head) return "the last task has no full-suite result at HEAD; run pb test --full";
  return suite.head === head ? null : `the full suite passed at ${short(suite.head)} but HEAD is ${short(head)}; run pb test --full`;
};

const dirtyTree = ({ dirty }) => (dirty.length === 0 ? null : `the tree has uncommitted files: ${list(dirty)}`);

const openBlocking = ({ unit }) => {
  const open = unit.tasks.flatMap((task) => task.blocking);
  return open.length === 0 ? null : `blocking findings are open: ${list(open)}`;
};

const changedConfig = ({ changedConfigs }) => (changedConfigs.length === 0 ? null : `these files changed since the unit opened: ${list(changedConfigs)}`);

const stopped = ({ runStop }) => (runStop === null ? null : `the run stopped: ${runStop.reason}`);

// A stale approval is reported by its own reason; the checks after it cover only what is not an approval at all.
const staleApproval = ({ voidReason }) => voidReason ?? null;

const UNAPPROVED = {
  none: "G:publish has no approval; run pb gate eval, and the human approves it with pb human approve G:publish",
  "keep-local": "the human answered keep local at G:publish, so the unit is kept local and is not published",
};

const unapproved = ({ voidReason, approval }) => (voidReason !== null || approval === "human" || approval === "auto" ? null : UNAPPROVED[approval]);

const unrecordedCommits = ({ unit, commits }) => {
  const missing = commits.filter((sha) => !unit.commits.includes(sha));
  return missing.length === 0 ? null : `commits not in the unit record: ${list(missing.map(short))}`;
};

const branchUnusable = ({ branchProblem }) => branchProblem ?? null;
const branchProtected = ({ branchIsProtected, unit }) => (branchIsProtected ? `the unit branch ${unit.branch} is protected` : null);
const notOnUnitBranch = ({ unit, currentBranch }) => (currentBranch === unit.branch ? null : `the checked-out branch is ${currentBranch ?? "none (detached HEAD)"}, not the unit branch ${unit.branch}`);
const tipNotHead = ({ unit, branchTip, head }) => (branchTip === head ? null : `the unit branch ${unit.branch} is at ${branchTip === null ? "nothing" : short(branchTip)} but HEAD is ${short(head)}`);

// The checks that let the branch be pushed, in the order they are reported. Each takes the gathered facts and returns a
// refusal reason or null.
export const BRANCH_CHECKS = [branchUnusable, branchProtected, notOnUnitBranch, tipNotHead];

// The evidence checks, in the order they are reported.
export const EVIDENCE_CHECKS = [
  recordedTasks, withoutSafetyNet, invalidGateSources, staleFullSuite, dirtyTree, openBlocking, changedConfig,
  staleApproval, unapproved, autoWithoutLensRecord, autoWithFailingLint, unrecordedCommits,
];

// What closing in place of a push needs: the same fresh approval and unchanged config files as a publish.
const LOCAL_CHECKS = [changedConfig, staleApproval, unapproved];

const reasonsOf = (checks, facts) => checks.map((check) => check(facts)).filter((reason) => reason !== null);

// Every reason that the evidence refuses the publish; empty when it stands.
export const evidenceRefusals = (facts) => reasonsOf(EVIDENCE_CHECKS, facts);

// The target branch: the configured pr.base_branch, else where the unit started.
export const targetBranch = (gitConfig, unit) => gitConfig.pr?.base_branch ?? unit.base;

// A unit branch the argv can carry: not a flag, and neither a forced (+) nor a split (:) refspec. git's own
// check-ref-format is the CLI's second half of this.
export function branchShapeProblem(branch) {
  if (typeof branch !== "string" || branch === "") return "the unit branch is empty";
  if (branch.startsWith("-")) return `the unit branch ${JSON.stringify(branch)} starts with '-', so it would be read as an option`;
  if (/[+:]/.test(branch)) return `the unit branch ${JSON.stringify(branch)} has a '+' or ':', which would make it a forced or split refspec`;
  return null;
}

// The refs the unit keeps for itself live under this prefix, so publishing one unit cannot touch another's.
export const unitRefPrefix = (branch) => `refs/pairingbuddy/${branch}/`;

export const NO_COMMITS_REASON = "the unit has no commits past its base, so there is nothing to publish";
export const KEPT_LOCAL_REASON = "the human answered keep local at G:publish, so the unit is closed and nothing was published";
export const LOCAL_REASON = "pr.publish is none, so the commits, branch and refs stay local";

// Never --force, never a merge: exactly the approved SHA goes to the unit branch on the remote, as a plain push.
export const pushArgv = (remote, sha, branch) => ["push", "--", remote, `${sha}:refs/heads/${branch}`];
export const upstreamArgv = (remote, branch) => ["branch", `--set-upstream-to=${remote}/${branch}`, branch];

// What `gh pr view` has to say about the unit branch's PR, and the shape of a PR URL.
export const prViewArgv = (branch) => ["pr", "view", "--json", "url,headRefName,baseRefName", "--", branch];
export const prRefreshViewArgv = (branch) => ["pr", "view", "--json", "url,number,title,body,headRefName,baseRefName,headRefOid,state", "--", branch];
export const PR_URL = /^https:\/\/[^\s/]+\/[^\s]+\/pull\/\d+$/;

// Why a PR found by `gh pr view` is not this unit's, or null when it is.
export function foreignPrReason(view, { branch, target }) {
  if (typeof view?.url !== "string" || !PR_URL.test(view.url)) return `gh gave ${JSON.stringify(view?.url)}, which is not a pull request URL`;
  if (view.headRefName !== branch) return `the pull request ${view.url} is from ${view.headRefName}, not the unit branch ${branch}`;
  if (view.baseRefName !== target) return `the pull request ${view.url} is into ${view.baseRefName}, not the target ${target}`;
  return null;
}

// A refresh only rewrites the pull request the current branch opened.
export function refreshPrReason(view, { branch, head }) {
  if (view.headRefName !== branch) return `the pull request ${view.url} is from ${view.headRefName}, not the current branch ${branch}`;
  if (view.state !== "OPEN") return `the pull request ${view.url} is ${view.state}, not OPEN`;
  if (view.headRefOid !== head) return `the pull request ${view.url} is at ${String(view.headRefOid).slice(0, 7)}, which differs from HEAD (${String(head).slice(0, 7)}): push the review fixes first, since pb pr refresh pushes nothing`;
  return null;
}

// --draft iff the policy the gate hook recorded in the ledger is auto.
export function prCreateArgv({ title, bodyFile, base, branch, labels = [], policyMode }) {
  return [
    "pr", "create", "--title", title, "--body-file", bodyFile, "--base", base, "--head", branch,
    ...(policyMode === "auto" ? ["--draft"] : []),
    ...labels.flatMap((label) => ["--label", label]),
  ];
}

export const prEditArgv = ({ url, title, bodyFile }) => ["pr", "edit", url, "--title", title, "--body-file", bodyFile];

const refused = (refusals) => ({ refusals, steps: [] });

// The whole sequence of pb publish, decided from the gathered facts. Returns { refusals, steps }: either reasons and no
// steps, or the steps in the order to run them. Facts:
//   runStop, publishMode, commits (SHAs past the base), taskRunOpen (a run other than the publish run is open),
//   changedConfigs, approval ("human" | "keep-local" | "auto" | "none"), voidReason, head (the approved SHA),
//   remoteSha (null when absent or unreadable), unit, plus what the checks above read.
export function publishSteps(facts) {
  if (facts.runStop !== null && facts.runStop !== undefined) return refused([stopped(facts)]);
  if (facts.commits.length === 0) {
    const open = facts.taskRunOpen ? ["a task run is open, so the unit is not finished"] : [];
    const reasons = [...open, ...reasonsOf([changedConfig], facts)];
    return reasons.length > 0 ? refused(reasons) : { refusals: [], steps: [{ do: "close", result: "skip", reason: NO_COMMITS_REASON }] };
  }
  if (facts.publishMode === "none") {
    const reasons = reasonsOf(LOCAL_CHECKS, facts);
    return reasons.length > 0 ? refused(reasons) : { refusals: [], steps: [{ do: "close", result: "local", reason: LOCAL_REASON }] };
  }
  const reasons = [...evidenceRefusals(facts), ...reasonsOf(BRANCH_CHECKS, facts)];
  if (reasons.length > 0) return refused(reasons);
  const { branch, pr } = facts.unit;
  return {
    refusals: [],
    steps: [
      ...(facts.remoteSha === facts.head ? [] : [{ do: "push", sha: facts.head, branch }]),
      { do: "set-upstream", branch },
      { do: "open-pr", recordedUrl: pr?.url ?? null },
      ...(facts.coordination === null || pr?.commented === true ? [] : [{ do: "comment", text: facts.coordination }]),
      { do: "plan-line" },
      { do: "delete-refs", prefix: unitRefPrefix(branch) },
      { do: "close", result: "published" },
    ],
  };
}
