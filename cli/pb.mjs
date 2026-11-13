#!/usr/bin/env node
// pb: deterministic workflow CLI. Verbs live in the VERBS table; later tasks add more.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { REFACTOR_CODE_ROLE, REFACTOR_TESTS_ROLE, CheckpointRefused, CheckpointStopped, assertCurrentKey, assertKeyIsCurrent, branchOf, checkedPath, checkpointVerbSteps, commitPaths, diffOfCommit, fileAtCommit, headOf, isCheckpointCall, isKey, isOnHead, parseRollbackArgs, planCommit, remainingFiles, stepCommitType, stepRoles, stepRunsFor, taskTypesOfStep, typesByPaths, writesDiff } from "../shared-node/checkpoint.mjs";
import { repeatAfterPass, repeatingNode } from "../shared-node/repeat.mjs";
import { PUBLISH_GATE, answeredGate, approvalRecord, askReason, autoPublishPasses, blockingGate, changedConfigs, dueGate, fileHash, gateQuestion, gatesFor, isPassed, isBindingRefusal, currentBinding, publishApproval, publishBinding, publishFacts, publishLint, publishVoidReason, recordApproval, reopenedGate, voidPublish } from "../shared-node/gates.mjs";
import { KINDS, LEDGER_VERSION, UNOWNED, isPublishRun, isRefreshRun, ownerAgeMs, LedgerRefused, LedgerShaMismatch, NoHandEdit, acceptLedger, readLedger, updateLedger, writeLedger } from "../shared-node/ledger.mjs";
import { GitConfigRefused, baseBranch, defaultBranchOf, gitConfigPath, isBranchProtected, loadGitConfig, protectedBranches, readGitConfig } from "../shared-node/gitconf.mjs";
import { doctorWarnings } from "../shared-node/git-doctor.mjs";
import { outsideGlobs } from "../shared-node/glob-match.mjs";
import { PlanRefused, boxLabelsUnder, planFile, replaceFile, tickPlanBox, writePrLine } from "../shared-node/plan-boxes.mjs";
import { KEPT_LOCAL_REASON, NO_COMMITS_REASON, PR_URL, branchShapeProblem, foreignPrReason, prCreateArgv, prEditArgv, prRefreshViewArgv, prViewArgv, publishSteps, pushArgv, recordedTasks, refreshPrReason, targetBranch, upstreamArgv, unitRefPrefix } from "../shared-node/publish.mjs";
import { UnitStatusRefused, unitStatus as baseStatusOf } from "../shared-node/unit-status.mjs";
import { remapCommits } from "../shared-node/rebase-map.mjs";
import { UnitRefused, newTaskRecord, newUnit, renderBranch } from "../shared-node/unit.mjs";
import { SPIKE_SETUP_FILE, abandonRun, closeUnit, endRun } from "../shared-node/unit-files.mjs";
import { CHANGED_FILE, CORPUS_FILE, GIT_ENV, SUBJECT_DIFF_FILE, buildCorpus, changedArgv, nearestFiles, parseChanged, parseTracked, repoRelative, subjectDiffArgv, trackedFilesArgv } from "../shared-node/snapshot.mjs";
import { RollbackRefused, pathsOfCommit, rollbackCommitted, rollbackUncommitted } from "../shared-node/rollback.mjs";
import { normalizeApproach } from "../shared-node/mistake-check.mjs";
import { parseFixNotes, rollbackHeading } from "../shared-node/fix-notes.mjs";
import { StackRefused, dependencyChainOf, stackFor } from "../shared-node/stack.mjs";
import { isHumanTitle, parsePlan, planStep, unitStates } from "../shared-node/plan.mjs";
import { shellWord } from "../shared-node/shell-word.mjs";
import { findRunRoot } from "../shared-node/run-root.mjs";
import { KEY_TOKEN, buildKey, parseKey } from "../shared-node/keys.mjs";
import { nextAction, runStatus } from "../shared-node/next-action.mjs";
import { LENS_MAP, buildReport, rolledBackCount, closeStage, finishProblems, keptIntakeReturn, lensRecordOf, newestReturn, newestReturnMatching, perTestOf, readReportOf, readReturn, returnsAt, unknownSpend, writeReport } from "../shared-node/stage-run.mjs";
import { FAILED_STATUS, REDO_STATUS, safetyNetStages, graphFor, isStageActive, isVoidedAttempt, loadStages, migratedType, nextAttempt, nextStage } from "../shared-node/stages.mjs";
import { TestRunRefused, cycleRun, fullSuitePlans, hasSelector, meetsStep, readTestConfig, runPlan, runRecord, selectedPlans, testDirectoryOf, testPlan, testRows, validatedConfigHash } from "../shared-node/test-run.mjs";
import { ATTEMPT_CAP, COMMIT_FAILED, COMMIT_PLAN_UNUSABLE, MISSING_ARTIFACT, NO_SELECTOR_TEMPLATE, STAGE_STOP_REASONS } from "../shared-node/stop-codes.mjs";
import { PrLintRunRefused, prBodyPath, prLintPath, newestDraftKey, readDraftArtifact, readPrSubject, readUnit, refreshBodyPathOf, refreshPathOf, runPrLint, sha256 } from "../shared-node/pr-lint-run.mjs";
import { VERB_CLASSES, humanCommand, matchVerb, pbCommand, shaMismatchRemedy, typedCommand } from "../shared-node/verbs.mjs";

export { KINDS };
const RUN_OPEN_KINDS = KINDS.filter((k) => k !== "refresh");

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

const FIX_ROLE = "fix";
const SCENARIOS_ROLE = "enumerate-scenarios-and-test-cases";
const TESTS_ROLE = "create-test-placeholders";
const SCOPE_ROLE = "scope-refactoring";
const SCOPE_STAGE = "code-refactor-scope";
const SPIKE_UNIT_STAGE = "code-spike-unit";
const SPIKE_SETUP_PATH = `.pairingbuddy/run/task/${SPIKE_SETUP_FILE}`;

class UsageError extends Error {}
class Refusal extends Error {}

function toplevel() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    throw new Refusal("no git repository here");
  }
}

// Of the run root, which a nested repository's cwd is not.
function currentBranch(root) {
  const branch = branchOf(root);
  if (branch === null) throw new Refusal("no branch checked out (detached HEAD)");
  return branch;
}

function loadGitConfigOrRefuse(root) {
  try {
    return loadGitConfig(root);
  } catch (e) {
    if (e instanceof GitConfigRefused) throw new Refusal(e.message);
    throw e;
  }
}

// One rule for every verb that refuses a protected branch: the configured list plus the repo's default branch.
function isProtected(gitConfig, root, branch) {
  return isBranchProtected(protectedBranches(gitConfig, defaultBranchOf(root, gitConfig.remote)), branch);
}

function assertBranchNotProtected(gitConfig, root, branch, action, hint = "") {
  if (isProtected(gitConfig, root, branch)) throw new Refusal(`refusing to ${action} on protected branch ${branch}${hint}`);
}

function parseKind(args) {
  const i = args.indexOf("--kind");
  const kind = i === -1 ? undefined : args[i + 1];
  if (!RUN_OPEN_KINDS.includes(kind)) throw new UsageError(`usage: pb run open --kind ${RUN_OPEN_KINDS.join("|")}`);
  return kind;
}

const NO_RUN_OPENED = "so no run was opened";
// What the spike setup refusals say: they run from pb spike setup, after the run is open.
const SETUP_NOT_RECORDED = "so pb spike setup recorded nothing";

function refuseMissing(path, outcome = NO_RUN_OPENED) {
  throw new Refusal(`${path} is missing, ${outcome}`);
}

function readStateJson(path, outcome = NO_RUN_OPENED) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Refusal(`${path} is not valid JSON, ${outcome}`);
  }
}

// The task, so that a later turn with no memory of it can still pass it to a stage. A run opened before the skill wrote
// task.json stores none, and the text that starts a stage says so.
function storedTask(root) {
  const path = join(root, ".pairingbuddy", "task.json");
  if (!existsSync(path)) return "";
  const task = readStateJson(path);
  if (typeof task?.description !== "string" || task.description === "") throw new Refusal(`${path} has no description, so no run was opened`);
  return [task.description, task.context].filter(Boolean).join("\n\n");
}

// A task that ends removes run/task and a stopped one cannot end, so a stop stands in the way of any next open. It is
// looked for from the cwd too, because a repository nested under the run has a toplevel of its own. An unreadable
// ledger is not read as a stop: the claim in runOpen refuses that.
function assertNotStopped(root) {
  let stop;
  try {
    ({ stop } = readLedger(join(findRunRoot(process.cwd()) ?? root, ".pairingbuddy", "run", "task", "ledger.json")));
  } catch {
    return;
  }
  if (stop !== null) throw new Refusal(`the run has stopped, so no next task can open: ${stop.reason}`);
}

// Creates .pairingbuddy/run with a '*' .gitignore so nothing under it shows up as untracked. Returns the run root.
function ensureRunRoot(root) {
  const runRoot = join(root, ".pairingbuddy", "run");
  mkdirSync(runRoot, { recursive: true });
  try {
    writeFileSync(join(runRoot, ".gitignore"), "*\n", { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  return runRoot;
}

// One refusal for an existing run/task of any shape, whether or not its ledger reads. A publish open adds what it was for.
function refuseRunOpen(dir, kind) {
  const base = `a run is already active at ${dir}`;
  throw new Refusal(kind === "publish" ? `${base}, so no publish run was opened. Run ${pbCommand("status --action")} to go on; a task run is ended with ${pbCommand("task end")}` : base);
}

// A publish run needs a unit whose planned tasks all have a task record (the evidence pb publish checks) and no run in
// run/task. A stop is refused before this, by assertNotStopped.
function assertPublishable(root) {
  const runDir = join(root, ".pairingbuddy", "run");
  const unit = readUnitOrRefuse(root);
  if (!Array.isArray(unit?.tasks)) throw new Refusal(`${join(runDir, "unit.json")} has no tasks list, so no publish run was opened`);
  if (existsSync(join(runDir, "task"))) refuseRunOpen(join(runDir, "task"), "publish");
  if (unit.tasks.length === 0) throw new Refusal(`the unit has no ended task, so there is nothing to publish yet and no publish run was opened. End the task with ${pbCommand("task end")} first`);
  const unrecorded = recordedTasks({ unit, ...unitPlan(root, unit) });
  if (unrecorded !== null) throw new Refusal(`${unrecorded}, so no publish run was opened. End each task with ${pbCommand("task end")} first`);
}

// Claims run/task and writes the first ledger; a failed write removes the claim.
function claimRun({ root, kind, taskType, task, configHash, plan = { path: "", title: "" } }) {
  const runRoot = ensureRunRoot(root);
  const dir = join(runRoot, "task");
  // A non-recursive mkdir is the claim: exactly one concurrent opener wins, and an existing
  // run/task of any shape (with or without a ledger) refuses.
  try {
    mkdirSync(dir);
  } catch (e) {
    if (e.code === "EEXIST") refuseRunOpen(dir, kind);
    throw e;
  }
  try {
    mkdirSync(join(dir, "artifacts"));
    // runId is the pb run identity, set once here; stage.runId is the separate workflow run id per stage attempt.
    writeLedger(join(dir, "ledger.json"), {
      v: LEDGER_VERSION, seq: 0, sha: "0".repeat(64), kind, taskType, runId: randomUUID(),
      owner: UNOWNED,
      task, plan, configHash, gitConfigHash: fileHash(gitConfigPath(root)),
      policy: { mode: "", source: "" },
      stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null },
      stages: [], gates: {}, tests: {}, commits: [], retries: {},
      spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

// The plan's next task as the run's task (title, blank line, body) and the plan reference the ledger keeps, with the
// open unit read once here, before the claim.
function planTask(plan) {
  const { next, context } = steppedPlan(plan);
  if (!next) throw new Refusal(`the plan ${plan} has no task left, ${NO_RUN_OPENED}`);
  if (context.openUnit === null) {
    throw new Refusal(`a plan task runs inside a unit, and no unit is open, ${NO_RUN_OPENED}. Open one with ${pbCommand("unit open --type <type> --slug <slug>")}`);
  }
  assertUnitTakes(context.openUnit, next, context.plan);
  return {
    task: [next.title, next.body].filter(Boolean).join("\n\n"),
    plan: { path: context.plan, title: next.title },
    // The unit.json to write when the open unit is still unnamed; null when it already carries the planned unit.
    namedUnit: context.openUnit.unit == null ? { ...context.openUnit, unit: next.unit, plan: context.plan, tracer: next.tracer } : null,
  };
}

// Reads the plan and steps it, refusing on format problems; the stop is returned for the caller to act on.
function planStepOf(plan) {
  const { root, units, problems, context } = readPlanContext(plan);
  refusePlanProblems(problems);
  const { next, stop } = planStep(units, context);
  return { root, units, context, next, stop };
}

// planStepOf that also refuses on a stop: the shared start of run open and unit open.
function steppedPlan(plan) {
  const { root, units, context, next, stop } = planStepOf(plan);
  if (stop) throw new Refusal(planStopMessage(root, plan, stop));
  return { next, context, units };
}

// Refuses when the open unit cannot take the plan's next task: it is a different unit, or it is fresh but already holds
// a task that is not from a plan.
function assertUnitTakes(openUnit, next, planPath) {
  if (openUnit.unit != null) {
    if (openUnit.unit !== next.unit) {
      throw new Refusal(`the open unit is "${openUnit.unit}", but the plan's next task is in "${next.unit}", ${NO_RUN_OPENED}. Publish or close the open unit first`);
    }
    if (openUnit.plan !== planPath) {
      throw new Refusal(`the open unit "${openUnit.unit}" is from ${openUnit.plan}, but the plan's next task is from ${planPath}, ${NO_RUN_OPENED}. Publish or close the open unit first`);
    }
  } else if (openUnit.tasks.length > 0) {
    throw new Refusal(`the open unit already holds a task that is not from a plan, ${NO_RUN_OPENED}. Publish or close it first`);
  }
}

function runOpen(args) {
  const kind = parseKind(args);
  const planPath = flagValue(args, "--plan");
  const hasPlan = args.includes("--plan");
  if (hasPlan && (kind !== "code" || planPath === undefined || planPath.startsWith("-"))) throw new UsageError("usage: pb run open --kind code [--plan <plan.md>]");
  if (process.env.PAIRINGBUDDY_SOLO === "true") throw new Refusal("Solo stays on the old path until T10, so no run was opened");
  const root = toplevel();
  assertNotStopped(root);
  if (kind === "publish") assertPublishable(root);
  const branch = currentBranch(root);
  const gitConfig = loadGitConfigOrRefuse(root); // bootstraps git-config.json when missing; hashed below
  assertBranchNotProtected(gitConfig, root, branch, "open a run", "; start the work on a unit branch with pb unit open");

  const configHash = validatedConfigHash(root);
  const taskType = kind === "publish" ? "publish" : null;
  const planned = hasPlan ? planTask(planPath) : null;
  const task = planned ? planned.task : storedTask(root);

  const dir = claimRun({ root, kind, taskType, task, configHash, plan: planned?.plan });
  // A failed write is a disk error that leaves the run unnamed; `pb plan next` then reads its ticked box as hand-ticked
  // and stops, which is the safe side.
  if (planned?.namedUnit) writeJsonAtomic(unitPathOf(root), planned.namedUnit);
  return { ok: true, kind, branch, runDir: dir };
}

// Validates spike-config.json and spike-questions.json and trims them to what the run keeps: the config's goal, code
// location, mode and doc path, and each unit's id, name, description and execution.
function spikeSetupOf(root) {
  const read = (name) => {
    const path = join(root, ".pairingbuddy", name);
    return readStateJson(path, SETUP_NOT_RECORDED) ?? refuseMissing(path, SETUP_NOT_RECORDED);
  };
  const { goal, code_location, exploration_mode, doc_path } = read("spike-config.json");
  const rawUnits = read("spike-questions.json").units;
  assertSpikeUnits(rawUnits);
  assertRepoRelative("code_location", code_location);
  assertRepoRelative("doc_path", doc_path);
  if (!doc_path.endsWith(".md")) throw new Refusal(`doc_path ${doc_path} does not end in .md, ${SETUP_NOT_RECORDED}`);
  assertUnitsInside(code_location, rawUnits);
  const units = rawUnits.map(({ id, name, description, execution }) => ({ id, name, description, execution }));
  return { goal, code_location, exploration_mode, doc_path, units };
}

function assertRepoRelative(label, path) {
  const bad = (why) => new Refusal(`${label} ${JSON.stringify(path)} ${why}, ${SETUP_NOT_RECORDED}`);
  if (typeof path !== "string" || path === "") throw bad("is not a path");
  if (isAbsolute(path)) throw bad("is absolute");
  const parts = path.split("/");
  if (parts.includes("..")) throw bad("goes up with ..");
  const first = posix.normalize(path).split("/")[0];
  if (first === ".pairingbuddy" || first === ".git") throw bad(`is inside ${first}/`);
}

function assertUnitsInside(code_location, units) {
  const prefix = `${code_location.replace(/\/$/, "")}/`;
  for (const { execution } of units) {
    const wd = execution?.working_directory;
    assertRepoRelative("a unit working_directory", wd);
    const inside = wd === code_location || wd.startsWith(prefix);
    if (!inside) throw new Refusal(`a unit working_directory ${JSON.stringify(wd)} is not inside code_location ${code_location}, ${SETUP_NOT_RECORDED}`);
  }
}

function assertSpikeUnits(units) {
  if (!Array.isArray(units) || units.length === 0) throw new Refusal(`spike-questions.json has no unit, ${SETUP_NOT_RECORDED}`);
  const seen = new Set();
  for (const { id } of units) {
    if (typeof id !== "string" || !KEY_TOKEN.test(id)) throw new Refusal(`spike unit id ${JSON.stringify(id)} does not fit the key rule, ${SETUP_NOT_RECORDED}`);
    if (seen.has(id)) throw new Refusal(`spike unit id ${id} repeats, ${SETUP_NOT_RECORDED}`);
    seen.add(id);
  }
}

// Phase 1 of pb pr refresh: records the PR as it stands and opens a refresh run for the draft stage.
function prRefresh() {
  const root = toplevel();
  if (existsSync(unitPathOf(root))) throw new Refusal("a unit is open (run/unit.json exists); refresh a pull request once its unit has published, so nothing was touched");
  const taskDir = taskDirOf(root);
  if (existsSync(taskDir)) {
    if (isRefreshRun(readLedger(join(taskDir, "ledger.json")))) return applyRefresh(root);
    refuseRunOpen(taskDir, "refresh");
  }
  const branch = currentBranch(root);
  const gitConfig = loadGitConfigOrRefuse(root); // bootstraps git-config.json when missing; hashed by claimRun
  assertBranchNotProtected(gitConfig, root, branch, "refresh a pull request", "; refresh from the unit branch that opened it");
  assertCleanTree(root, "no refresh run was opened");
  const view = viewPr(root, branch, "", prRefreshViewArgv(branch));
  const foreign = refreshPrReason(view, { branch, head: runGit(root, ["rev-parse", "HEAD"]) });
  if (foreign !== null) throw new Refusal(`${foreign}, so no refresh run was opened and nothing was touched`);
  const remoteBase = `refs/remotes/${gitConfig.remote}/${view.baseRefName}`;
  const baseRef = tryGit(root, ["rev-parse", "--verify", "--quiet", remoteBase]) ? remoteBase : `refs/heads/${view.baseRefName}`;
  const baseSha = runGit(root, ["merge-base", "HEAD", baseRef]);
  const task = `Refresh the title and body of the pull request ${view.url} from its whole diff`;
  // Claim first: a refused opener must not overwrite an open run's refresh record.
  const runDir = claimRun({ root, kind: "refresh", taskType: "refresh", task, configHash: validatedConfigHash(root) });
  const refreshPath = refreshPathOf(root);
  const bodyPath = refreshBodyPathOf(root);
  try {
    writeJsonAtomic(refreshPath, { url: view.url, number: view.number, branch, base: view.baseRefName, baseSha, headSha: view.headRefOid, title: view.title });
    writeFileSync(bodyPath, view.body);
  } catch (e) {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(refreshPath, { force: true });
    rmSync(bodyPath, { force: true });
    throw e;
  }
  return { ok: true, result: "opened", kind: "refresh", url: view.url, runDir };
}

// Writes the approved body to a pid-named file for gh --body-file, runs fn with its path, and removes it after.
function withBodySnapshot(root, body, fn) {
  const snapshot = join(root, ".pairingbuddy", "run", `pr-body.${process.pid}.snapshot.md`);
  writeFileSync(snapshot, body ?? "");
  try {
    return fn(snapshot);
  } finally {
    rmSync(snapshot, { force: true });
  }
}

const REFRESH_KEPT_REASON = "the human answered keep local at G:publish, so the pull request was left unchanged";

function endRefreshRun(root) {
  endRun(join(root, ".pairingbuddy", "run"));
  rmSync(refreshPathOf(root), { force: true });
  rmSync(refreshBodyPathOf(root), { force: true });
}

// Phase 2 of pb pr refresh: sets the approved title and body on the PR, then ends the refresh run.
function applyRefresh(root) {
  const runRoot = join(root, ".pairingbuddy", "run");
  const ledger = readLedger(join(runRoot, "task", "ledger.json"));
  if (ledger.stop !== null) throw new Refusal(`not refreshed: the run stopped: ${ledger.stop.reason}`);
  const approval = publishApproval(ledger);
  if (approval === "keep-local") {
    endRefreshRun(root);
    return { ok: true, result: "kept-local", reason: REFRESH_KEPT_REASON };
  }
  if (approval !== "human") throw new Refusal(`not refreshed: ${PUBLISH_GATE} has no approval; run pb gate eval, and the human approves it with pb human approve ${PUBLISH_GATE}`);
  const { url } = readPrSubjectOrRefuse(root);
  const bound = readBound(root, ledger);
  const voidReason = refusing(() => publishVoidReason(ledger, root, bound.current));
  if (voidReason !== null) {
    updateLedger(join(runRoot, "task", "ledger.json"), (current) => voidPublish(current, voidReason));
    throw new Refusal(`not refreshed: ${voidReason}`);
  }
  withBodySnapshot(root, bound.body, (snapshot) => run(root, "gh", prEditArgv({ url, title: bound.draft.title, bodyFile: snapshot })));
  const posted = bound.draft.coordination === null ? { warnings: [] } : postComment({ root }, url, bound.draft.coordination);
  endRefreshRun(root);
  return { ok: true, result: "refreshed", url, warnings: posted.warnings, ...(posted.pendingComment === undefined ? {} : { pendingComment: posted.pendingComment }) };
}

const approveCommand = (root, gate) => humanCommand(root, `approve ${gate}`);

function runLedgerPath(message = "no run here") {
  const root = findRunRoot(process.cwd());
  const path = root === null ? null : ledgerPathOf(root);
  if (path === null || !existsSync(path)) throw new Refusal(message);
  return { root, path };
}

const fixDiffPathOf = (root) => join(ensureRunRoot(root), "fix.diff");
const taskDirOf = (root) => join(root, ".pairingbuddy", "run", "task");
const ledgerPathOf = (root) => join(taskDirOf(root), "ledger.json");
const artifactsDirOf = (root) => join(taskDirOf(root), "artifacts");
const notesDirOf = (root) => join(taskDirOf(root), "notes");
const reportPathOf = (root) => join(taskDirOf(root), "report.json");

function recordAuto(ledger, gate, binding = {}) {
  return { ...ledger, gates: { ...ledger.gates, [gate]: gate === PUBLISH_GATE ? approvalRecord("auto", binding) : { source: "auto" } } };
}

// Takes no arguments: the gate comes from the ledger, and the policy from what the gate hook recorded.
function gateEval(args) {
  if (args.length > 0) throw new UsageError("usage: pb gate eval");
  const { root, path } = runLedgerPath();
  const current = readLedger(path);
  const { needsHuman } = current;
  if (needsHuman !== null) {
    const { gate, reason } = needsHuman;
    return { ok: true, result: "needs-human-command", gate, reason, humanCommand: approveCommand(root, gate) };
  }
  const contract = loadStages(PLUGIN_ROOT);
  const answered = answeredGate(gatesFor(contract, current.taskType), current);
  if (answered !== undefined) return answeredResult(answered, current, root);
  const voided = refusing(() => publishVoidReason(current, root));
  const standing = voided === null ? current : voidPublish(current, voided);
  const skipped = publishSkip(contract, standing, root);
  if (skipped !== null) {
    if (voided !== null) updateLedger(path, (ledger) => voidPublish(ledger, voided));
    return skipped;
  }
  // The shown block is built before the ledger is written, so a missing body or runner leaves the ledger untouched.
  const shown = dueGate(gatesFor(contract, standing.taskType), standing)?.name === PUBLISH_GATE ? publishShown(root, standing) : null;
  // The binding re-runs the lint (it rewrites run/pr-lint.json), so it is read only when the gate will pass by itself.
  const autoBinding = shown !== null && voided === null && autoPublishPasses(standing, root) ? refusing(() => publishBinding(root, standing, shown)) : undefined;
  let gate;
  let reason;
  // One transaction: the void of a stale approval, the due gate and the question, so no state sits between them.
  updateLedger(path, (ledger) => {
    const open = voided === null ? ledger : voidPublish(ledger, voided);
    const due = dueGate(gatesFor(contract, open.taskType), open);
    if (due === undefined) throw new Refusal(noGateDue(open));
    gate = due.name;
    if (gate === PUBLISH_GATE && shown === null) throw new Refusal("the ledger changed while G:publish was being prepared; run pb gate eval again");
    reason = askReason(contract, open, due, root, voided);
    if (reason === null && gate === PUBLISH_GATE && autoBinding === undefined) throw new Refusal("the ledger changed while G:publish was being prepared; run pb gate eval again");
    if (reason === null) return repeatedAfter(contract, recordAuto(open, gate, autoBinding), gate, root);
    const facts = gate === PUBLISH_GATE ? { shown: { headSha: shown.headSha, base: shown.base, target: shown.target } } : {};
    return { ...open, needsHuman: { gate, reason, seq: open.seq + 1, ...facts } };
  });
  if (reason === null) return { ok: true, result: "auto-pass", gate, source: "auto" };
  const asked = { ok: true, result: "needs-human", gate, reason, question: gateQuestion(gate), humanCommand: approveCommand(root, gate) };
  return gate === PUBLISH_GATE ? { ...asked, shown } : asked;
}

// A unit with no commits past its base has nothing to publish (D19): the gate is skipped and no approval is recorded.
// Recording a skip so blockingGate and next-action agree is left to Task 71 (pb publish).
function publishSkip(contract, ledger, root) {
  if (dueGate(gatesFor(contract, ledger.taskType), ledger)?.name !== PUBLISH_GATE || isRefreshRun(ledger)) return null;
  if (unitCommits(root, readUnitOrRefuse(root)).length !== 0) return null;
  return { ok: true, result: "skip", gate: PUBLISH_GATE, reason: NO_COMMITS_REASON };
}

function readUnitOrRefuse(root) {
  try {
    return readUnit(root);
  } catch (e) {
    throw e instanceof PrLintRunRefused ? new Refusal(e.message) : e;
  }
}

function readPrSubjectOrRefuse(root) {
  try {
    return readPrSubject(root);
  } catch (e) {
    throw e instanceof PrLintRunRefused ? new Refusal(e.message) : e;
  }
}

function publishCommits(root, subject) {
  const rows = runGit(root, ["log", "--reverse", "--format=%H%x09%s", `${subject.baseSha}..HEAD`]).split("\n").filter(Boolean);
  return rows.map((row) => {
    const [sha, ...title] = row.split("\t");
    return { sha, subject: title.join("\t"), inUnit: (subject.commits ?? []).includes(sha) };
  });
}

// What the human sees at G:publish: the draft, its lint, the coordination text apart from the body, and what would go out.
// headSha, base and target are the facts a publish answer is held to (needsHuman.shown).
function publishShown(root, ledger) {
  const subject = readPrSubjectOrRefuse(root);
  const draft = readDraft(root, ledger.stage);
  if (!existsSync(prBodyPath(root))) throw new Refusal("run/pr-body.md is missing, so there is no draft to show");
  const lint = publishLint(root);
  const config = readTestConfig(root, ledger.configHash);
  const runner = config.runners?.[config.default_runner];
  if (runner === undefined) throw new Refusal("test-config.json has no default runner, so the test command cannot be shown");
  const { headSha, base, target } = refusing(() => publishFacts(root));
  return {
    title: draft.title,
    body: readFileSync(prBodyPath(root), "utf8"),
    lint: { ok: lint.ok, failures: lint.failures },
    coordination: draft.coordination ?? "no comment",
    base,
    target,
    headSha,
    testCommand: runner.command,
    commits: publishCommits(root, subject),
  };
}

function answeredResult({ name, answer }, { stop }, root) {
  return { ok: true, result: "answered", gate: name, answer, reason: stop?.reason ?? `the human answered ${answer}`, humanCommand: approveCommand(root, name) };
}

function noGateDue(ledger) {
  const { name, status } = ledger.stage;
  return status === REDO_STATUS ? `no gate is due: the human answered redo, so ${name} restarts at attempt ${nextAttempt(ledger, name)}` : "no gate is due";
}

// While a gate is pending it is the only one a human can pass: the next gate stays behind it. A gate answered redo
// or stop still waits, so a human always has a way out of either.
function awaitedGate(ledger, gates) {
  if (ledger.needsHuman !== null) return ledger.needsHuman.gate;
  return (blockingGate(gates, ledger) ?? reopenedGate(gates, ledger))?.name;
}

function approved(ledger, gate, root) {
  const contract = loadStages(PLUGIN_ROOT);
  const gates = gatesFor(contract, ledger.taskType);
  const awaited = awaitedGate(ledger, gates);
  if (gate !== awaited) {
    throw new Refusal(`gate ${gate} is neither due nor pending. ${awaited === undefined ? "No gate is waiting." : `Gate ${awaited} is waiting.`}`);
  }
  // The question's shown HEAD binds the answer here as it does in the tap: a commit since then is not approved.
  const shown = ledger.needsHuman?.gate === gate ? ledger.needsHuman.shown : null;
  const binding = gate === PUBLISH_GATE ? refusing(() => publishBinding(root, ledger, shown)) : undefined;
  return repeatedAfter(contract, recordApproval(ledger, gate, gates, binding), gate, root);
}

// A passed gate on a repeating node sends the stage round again while units remain; the unit ids are only read for such a node.
function repeatedAfter(contract, ledger, gate, root) {
  return repeatingNode(contract, ledger.taskType, gate) !== undefined ? repeatAfterPass(contract, ledger, gate, readSpikeSetup(root).units.map(({ id }) => id)) : ledger;
}

function humanApprove(args) {
  if (args.length !== 1) throw new UsageError("usage: pb human approve <gate>");
  const [gate] = args;
  const { root, path } = runLedgerPath();
  updateLedger(path, (ledger) => approved(ledger, gate, root));
  return { ok: true, gate, source: "human-cli" };
}

// Leaves the unit: everything under run/ goes except run/.gitignore. Commits, branch and working tree are not touched.
function humanAbandon(args) {
  if (args.length > 0) throw new UsageError("usage: pb human abandon");
  const runDir = join(findRunRoot(process.cwd()) ?? toplevel(), ".pairingbuddy", "run");
  const names = abandonRun(runDir);
  if (names.length === 0) return { ok: true, result: "nothing-to-abandon", removed: [], message: "nothing to abandon: no unit or task is open" };
  return { ok: true, result: "abandoned", removed: names.map((name) => `.pairingbuddy/run/${name}`) };
}

// An owner seen within this many minutes is presumed still working, so adopting its run needs the human to confirm.
const ADOPT_RECENT_MINUTES = 10;

const minutesSince = (lastSeen) => Math.floor(ownerAgeMs(lastSeen) / 60_000);

// Refuses when no run is open; a run with no owner has nothing to adopt, so that is an ok no-op.
function humanAdopt(args) {
  if (args.some((arg) => arg !== "--force")) throw new UsageError("usage: pb human adopt [--force]");
  const force = args.includes("--force");
  const { root, path } = runLedgerPath("no run is open: nothing to adopt");
  const { owner } = readLedger(path);
  if (owner?.sessionId == null) return { ok: true, adopted: false, message: "the run has no owner: nothing to adopt" };
  const minutesAgo = minutesSince(owner.lastSeen);
  if (!force && minutesAgo < ADOPT_RECENT_MINUTES) {
    const unit = minutesAgo === 1 ? "minute" : "minutes";
    throw new Refusal(`the run's owner session ${owner.sessionId} was active ${minutesAgo} ${unit} ago (at ${owner.lastSeen}); if that session is still working, close it first; then type the same line with --force: ${humanCommand(root, "adopt --force")}`);
  }
  let failedStage = null;
  updateLedger(path, (ledger) => {
    const result = isStageActive(ledger) ? failActiveStage(root, ledger, { keepStop: true }) : null;
    if (result) failedStage = { stage: result.failed.stage, attempt: result.failed.attempt, nextAttempt: result.failed.nextAttempt };
    return { ...(result?.ledger ?? ledger), owner: UNOWNED };
  });
  return { ok: true, adopted: true, previousOwner: owner.sessionId, failedStage };
}

// Records that the human has seen this task's config diff. It lives in the task's ledger, so it goes with the task.
function humanApproveConfig(args) {
  if (args.length > 0) throw new UsageError("usage: pb human approve-config");
  const { path } = runLedgerPath();
  const ledger = readLedger(path);
  if (ledger.taskType !== "config_change") throw new Refusal(`no approval needed: this task is ${ledger.taskType ?? "not typed"}, not a config_change`);
  if (loadGitConfigOrRefuse(toplevel()).config_globs.length > 0) throw new Refusal("no approval needed: config_globs is not empty, so a config_change is checked against it");
  updateLedger(path, (ledger) => ({ ...ledger, configApproval: { source: "human-cli" } }));
  return { ok: true, source: "human-cli" };
}

function acceptedEdit(path) {
  try {
    return acceptLedger(path);
  } catch (e) {
    if (e instanceof NoHandEdit) return null;
    throw e;
  }
}

// A human's own change to test-config. Only a config every test run can use is pinned, so this cannot strand the run.
function acceptedConfig(root, path) {
  const configPath = join(root, ".pairingbuddy", "test-config.json");
  if (!existsSync(configPath) || fileHash(configPath) === readLedger(path).configHash) return null;
  const newHash = validatedConfigHash(root);
  let accepted;
  updateLedger(path, (ledger) => {
    accepted = { oldHash: ledger.configHash, newHash, seq: ledger.seq + 1 };
    return { ...ledger, configHash: newHash, configAcceptances: [...(ledger.configAcceptances ?? []), accepted] };
  });
  return accepted;
}

// The repo toplevel, the plan's resolved path and its text, for the verbs that read a plan.
function readPlan(plan) {
  const root = toplevel();
  const realPlan = planFile(root, plan);
  return { root, realPlan, text: readFileSync(realPlan, "utf8") };
}

// The plan read under the repo toplevel with its parsed units and problems, and the context planStep and unitStates take.
function readPlanContext(plan) {
  const { root, realPlan, text } = readPlan(plan);
  const { units, problems } = parsePlan(text);
  return { root, units, problems, context: { plan: relative(realpathSync(root), realPlan), openUnit: readOpenUnit(root) } };
}

// Refuses, writing nothing, when the plan has format problems.
function refusePlanProblems(problems) {
  if (problems.length > 0) throw new Refusal(`the plan has format problems, so nothing was written: ${problems.join("; ")}`);
}

// Records Legacy: accepted directly under the unit's own heading line, found by the parser rather than by name.
function acceptLegacy(unit, plan) {
  const { realPlan, text } = readPlan(plan);
  const { units, problems } = parsePlan(text);
  refusePlanProblems(problems);
  const found = units.find((u) => u.unit === unit);
  if (!found) throw new Refusal(`no unit named "${unit}", so nothing was written`);
  if (found.pr) throw new Refusal(`unit "${unit}" is already published (it has a PR: line), so nothing was written`);
  if (found.tasks.some((t) => !t.checked)) throw new Refusal(`unit "${unit}" is not fully checked: legacy is only for a fully checked unit, so nothing was written`);
  if (found.legacy) return { ok: true, unit, plan, legacy: "already accepted" };
  const lines = text.split("\n");
  lines.splice(found.headingLine + 1, 0, "Legacy: accepted");
  replaceFile(realPlan, lines.join("\n"));
  return { ok: true, unit, plan, legacy: "accepted" };
}

function legacyArgs(args) {
  const [flag, unit, planFlag, plan] = args;
  const ok = args.length === 4 && flag === "--legacy" && planFlag === "--plan" && !unit.startsWith("-") && !plan.startsWith("-");
  if (!ok) throw new UsageError("usage: pb human accept [--legacy <unit> --plan <plan.md>]");
  return [unit, plan];
}

function humanAccept(args) {
  if (args.length > 0) return acceptLegacy(...legacyArgs(args));
  const { root, path } = runLedgerPath();
  const edit = acceptedEdit(path);
  const config = acceptedConfig(root, path);
  if (edit === null && config === null) throw new Refusal(`nothing to accept: ledger ${path} has no sha mismatch, and test-config.json has not changed`);
  return { ok: true, ...edit, ...(config === null ? {} : { config }) };
}

async function suiteRecord(plans, root, stage) {
  const runs = [];
  for (const plan of plans) runs.push(await runPlan(plan, root));
  return runRecord(plans, runs, stage);
}

function isFullRun(args) {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === "--full") return true;
  throw new UsageError("usage: pb test [--full]");
}

function testPlans(full, config, root, stage) {
  if (full) return { key: "full", plans: fullSuitePlans(config), selection: {} };
  const { plans, testIds, attribution } = selectedPlans(config, join(root, ".pairingbuddy", "run", "task", "artifacts"), stage);
  return { key: "selected", plans, selection: { tests: testIds, attribution } };
}

// Takes no selector: a model must not choose what RED is recorded for. A run that happened exits 0 whatever the
// tests did, because exit 1 here means a refusal.
async function runTests(args) {
  const full = isFullRun(args);
  const { root, path } = runLedgerPath();
  const { configHash, stage } = readLedger(path);
  const { key, plans, selection } = testPlans(full, readTestConfig(root, configHash), root, stage);
  const head = headOf(root);
  const record = { ...(await suiteRecord(plans, root, stage)), ...selection, head };
  updateLedger(path, (ledger) => ({ ...ledger, tests: { ...ledger.tests, [key]: record } }));
  return { ok: true, key, ...record };
}

function parseCheckpoint(args) {
  const [stepFlag, step, fromFlag, key] = args;
  if (args.length !== 4 || stepFlag !== "--step" || fromFlag !== "--from" || !isCheckpointCall(step, key)) {
    throw new UsageError(`usage: pb checkpoint --step ${checkpointVerbSteps().join("|")} --from <key>`);
  }
  return { step, key };
}

// A failed run is evidence, so it lands in the ledger before the refusal.
async function requirePassingTests(root, path, { configHash, stage }) {
  const plans = fullSuitePlans(readTestConfig(root, configHash));
  const record = await suiteRecord(plans, root, stage);
  updateLedger(path, (ledger) => ({ ...ledger, tests: { ...ledger.tests, checkpoint: record } }));
  if (!record.passed) throw new Refusal(`the tests failed, so nothing was committed: exit codes ${record.runs.map(({ exitCode }) => exitCode).join(", ")}`);
}

function assertCommitAllowed(step, key, ledger) {
  if (ledger.stop !== null) throw new Refusal(`the run has stopped: ${ledger.stop.reason}`);
  assertCurrentKey(step, key, ledger);
}

// A stop belongs to the attempt that raised it. A key that is no longer current is refused here, so an orphan cannot
// halt a later attempt or a finished stage.
function orStop(path, { step, key }, code, action) {
  try {
    return action();
  } catch (e) {
    if (!(e instanceof CheckpointStopped)) throw e;
    updateLedger(path, (ledger) => {
      assertCurrentKey(step, key, ledger);
      return { ...ledger, stop: { reason: e.message, seq: ledger.seq + 1, code } };
    });
    throw new Refusal(`the run stopped: ${e.message}`);
  }
}

// The evidence for stage finish, so a step with no change counts as done too. It is stamped from the key, which was
// checked against the ledger: whatever the ledger says by now is someone else's attempt.
function withCheckpoint(ledger, record) {
  const { stage, attempt } = parseKey(record.key);
  return { ...ledger, checkpoints: [...(ledger.checkpoints ?? []), { ...record, stage, attempt }] };
}

// Checked under the lock, since the attempt can end at any moment up to here. A commit exists whatever became of its
// attempt, so the ledger lists it, and only a current key makes it evidence.
function recordCheckpoint(path, record, withEvidence = (ledger) => ledger) {
  let orphaned = null;
  updateLedger(path, (ledger) => {
    const listed = record.committed ? { ...ledger, commits: [...ledger.commits, record.sha] } : ledger;
    try {
      assertCurrentKey(record.step, record.key, ledger);
      return withEvidence(withCheckpoint(listed, record));
    } catch (e) {
      if (!(e instanceof CheckpointRefused)) throw e;
      orphaned = e;
      return listed;
    }
  });
  if (orphaned !== null) throw new Refusal(`${record.committed ? `commit ${record.sha} landed, and it is no evidence: ` : ""}${orphaned.message}`);
}

function planFor({ step, key, root, path, ledger }, scope = null) {
  const alreadyCommitted = (ledger.checkpoints ?? []).some((record) => record.key === key && record.committed);
  return orStop(path, { step, key }, COMMIT_PLAN_UNUSABLE, () => planCommit(root, artifactsDirOf(root), step, key, { alreadyCommitted, taskType: ledger.taskType, scope }));
}

function noChange({ step, key, path, record }, withEvidence) {
  recordCheckpoint(path, { step, key, committed: false, sha: null, ...record }, withEvidence);
  return { ok: true, step, key, committed: false };
}

// The attempt can end while the tests run, so that is looked at again here.
function commitPlan({ step, key, root, path, branch, record }, plan, head, evidenceFor) {
  assertCommitAllowed(step, key, readLedger(path));
  const { sha, hookRetried } = orStop(path, { step, key }, COMMIT_FAILED, () => commitPaths(root, { ...plan, branch, head }));
  recordCheckpoint(path, { step, key, committed: true, sha, ...record }, evidenceFor?.(sha));
  return { ok: true, step, key, committed: true, sha, message: plan.message, paths: plan.paths, hookRetried };
}

// Only a step that types its commit by paths needs a scope: the test directories, and the key's role for a refactor scope check. The others never read the test config.
function scopeFor({ step, key, root, ledger }) {
  if (!typesByPaths(step)) return null;
  const config = readTestConfig(root, ledger.configHash);
  return { testDirectories: Object.values(config.runners).map(({ test_directory: directory }) => directory), role: parseKey(key).role };
}

// A step with no change runs no test. The tests run code in the repo, so what they could change is looked at again
// before the commit.
async function suiteCheckpoint(context) {
  const plan = planFor(context, scopeFor(context));
  if (plan === null) return noChange(context);
  const head = headOf(context.root);
  await requirePassingTests(context.root, context.path, context.ledger);
  const done = commitPlan(context, plan, head);
  if (writesDiff(context.step)) writeFileSync(fixDiffPathOf(context.root), diffOfCommit(context.root, done.sha));
  return done;
}

const SELECTOR_FIELDS = ["runner_id", "test_file", "test_function"];
const selectorOf = (row) => Object.fromEntries(SELECTOR_FIELDS.map((field) => [field, row[field]]));

// A row a step finished on is how a re-run knows what is done, so it cannot move, or a finished test would start again.
// A row with only failed runs may: a wrong name is the likeliest reason it failed.
function assertRowsKept(rows, { tests: { perTest = {} } }) {
  for (const [id, { selector, red, green }] of Object.entries(perTest)) {
    if (!red?.done && !green?.done) continue;
    const row = rows.find(({ test_id: rowId }) => rowId === id);
    if (row === undefined) throw new Refusal(`test ${id} has evidence, and the tests artifact dropped it`);
    if (!isDeepStrictEqual(selectorOf(row), selector)) throw new Refusal(`test ${id} has evidence for ${JSON.stringify(selector)}, and the tests artifact changed it`);
  }
}

// Costs nothing yet, and a test written for a runner that cannot select it could never pass RED. Only a human can fix
// that file, so it stops here and not at the first RED.
function assertSelectable(config, rows) {
  const row = rows.find((candidate) => !hasSelector(config, candidate));
  if (row !== undefined) throw new CheckpointStopped(`runner ${row.runner_id} has no selector_template in test-config.json, so RED cannot speak for one test. Tell the human, who owns that file. pb stage fail clears this`);
}

function checkedRows({ step, key, root, path, ledger }) {
  const config = readTestConfig(root, ledger.configHash);
  const rows = testRows(config, artifactsDirOf(root), ledger.stage);
  assertRowsKept(rows, ledger);
  orStop(path, { step, key }, NO_SELECTOR_TEMPLATE, () => assertSelectable(config, rows));
  return { rows, testDirectories: [...new Set(rows.map((row) => testDirectoryOf(config, row)))] };
}

// The commit before this task's first placeholders, so a re-run does not find its own placeholders there.
function placeholdersBase({ root, ledger }) {
  const first = (ledger.checkpoints ?? []).find(({ step, base }) => step === "placeholders" && typeof base === "string");
  return first?.base ?? headOf(root);
}

const escapedPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// pytest's class path names the test by its last part.
function isDefinedIn(text, testFunction) {
  const name = String(testFunction).split("::").at(-1);
  return new RegExp(`(?<![\\w$])${escapedPattern(name)}(?![\\w$])`).test(text);
}

// A test already in the file passes at its first RED, so RED could only refuse it as one that proves nothing.
function assertRowsNew(root, base, rows) {
  if (base === null) return;
  const row = rows.find(({ test_file, test_function }) => {
    const text = fileAtCommit(root, base, test_file);
    return text !== null && isDefinedIn(text, test_function);
  });
  if (row !== undefined) throw new Refusal(`${row.test_function} (test ${row.test_id}) is already in ${row.test_file} at ${base.slice(0, 12)}, the commit before the placeholders, so it passes before any GREEN and proves nothing. List only the tests you create`);
}

function placeholdersCheckpoint(context) {
  const scope = checkedRows(context);
  const base = placeholdersBase(context);
  assertRowsNew(context.root, base, scope.rows);
  const recorded = { ...context, record: { base } };
  const plan = planFor(context, scope);
  return plan === null ? noChange(recorded) : commitPlan(recorded, plan, headOf(context.root));
}

function assertCycleOrder(step, id, { red, green, covered }) {
  if (step === "red" && green?.done) throw new Refusal(`test ${id} is finished: its GREEN is done`);
  if (step === "green" && covered?.done) throw new Refusal(`test ${id} is covered: it passed at RED after an earlier GREEN, so its GREEN is skipped`);
  if (step === "green" && !red?.done) throw new Refusal(`test ${id} has no RED, so GREEN cannot stand on it`);
}

function selectedRow({ root, ledger }, config, id) {
  const row = testRows(config, artifactsDirOf(root), ledger.stage).find(({ test_id: rowId }) => rowId === id);
  if (row === undefined) throw new Refusal(`test ${id} is not in the tests artifact, so there is nothing to select`);
  return row;
}

const withPerTest = (ledger, id, entry) => {
  const { [id]: _replaced, ...others } = ledger.tests.perTest ?? {};
  return { ...ledger, tests: { ...ledger.tests, perTest: { ...others, [id]: entry } } };
};

// A failed run is evidence, so it lands before the refusal. A repeat keeps what an earlier run of this step proved.
function recordCycleRun({ step, key, path }, row, record) {
  const id = row.test_id;
  updateLedger(path, (ledger) => {
    assertCurrentKey(step, key, ledger);
    const entry = perTestOf(ledger, id);
    const earlier = entry[step];
    return withPerTest(ledger, id, { ...entry, selector: selectorOf(row), [step]: { stage: ledger.stage.name, attempt: ledger.stage.attempt, done: earlier?.done ?? false, sha: earlier?.sha ?? null, ...record } });
  });
}

const withCycleDone = (step, id, sha) => (ledger) => {
  const entry = perTestOf(ledger, id);
  return withPerTest(ledger, id, { ...entry, [step]: { ...entry[step], done: true, sha: sha ?? entry[step].sha } });
};

// Only a pass after a GREEN of this task can be one that GREEN covered. Before any GREEN, a pass proves nothing.
const provesNothing = (step, exitCode) => (step === "red" && exitCode === 0 ? ", and no GREEN in this task came before it, so it proves nothing" : "");

// How much of a run's output a refusal or a rollback note keeps: the tail, where the failure is.
const EXCERPT_TAIL = 300;
const excerptTail = (excerpt) => excerpt.slice(-EXCERPT_TAIL);

const stepNotMet = (step, id, { exitCode, excerpt }) => `test ${id} is not ${step.toUpperCase()}: exit ${exitCode}${provesNothing(step, exitCode)}, so nothing was committed. ${excerptTail(excerpt)}`;

// The first GREEN this task finished, by where its commit sits in the run's commits, or null before any.
function earliestGreen({ tests: { perTest = {} }, commits }) {
  const place = ({ sha }) => (commits.includes(sha) ? commits.indexOf(sha) : Infinity);
  const greens = Object.entries(perTest).filter(([, { green }]) => green?.done).map(([test_id, { green: { sha } }]) => ({ test_id, sha }));
  return greens.sort((a, b) => place(a) - place(b))[0] ?? null;
}

const coveredBy = (step, run, ledger) => (step === "red" && run.exitCode === 0 ? earliestGreen(ledger) : null);

const withCovered = (id, { exitCodes, timedOut, excerpt, head }, after) => (sha) => (ledger) => {
  const entry = perTestOf(ledger, id);
  const covered = { stage: ledger.stage.name, attempt: ledger.stage.attempt, done: true, exitCodes, timedOut, excerpt, head, sha: sha ?? entry.covered?.sha ?? null, after };
  return withPerTest(ledger, id, { ...entry, covered });
};

// Kept and committed as a test, with its GREEN skipped: the human sees it in the report and pb status.
function coveredCheckpoint(context, plan, head, id, record, after) {
  const evidence = withCovered(id, record, after);
  const done = plan === null ? noChange(context, evidence()) : commitPlan(context, plan, head, evidence);
  return { ...done, outcome: "covered", after };
}

// The run decides, and the key decides what runs. Nothing a caller says reaches the selection.
async function cycleCheckpoint(context) {
  const { step, key, root, ledger } = context;
  const id = parseKey(key).item;
  const config = readTestConfig(root, ledger.configHash);
  const row = selectedRow(context, config, id);
  assertCycleOrder(step, id, perTestOf(ledger, id));
  const test = testPlan(config, row);
  const plan = planFor(context, { testDirectories: [testDirectoryOf(config, row)], testFile: row.test_file });
  const head = headOf(root);
  const run = await runPlan(test, root);
  const passed = meetsStep(step, test, run);
  const record = { ...cycleRun(run, passed), head };
  recordCycleRun(context, row, record);
  const after = passed ? null : coveredBy(step, run, ledger);
  if (after !== null) return coveredCheckpoint(context, plan, head, id, record, after);
  if (!passed) throw new Refusal(stepNotMet(step, id, run));
  if (plan === null) return noChange(context, withCycleDone(step, id));
  return commitPlan(context, plan, head, (sha) => withCycleDone(step, id, sha));
}

// What a cycle closed: RED and GREEN both done, or a covered pass. A row still at its placeholder fails by design.
const isClosedCycle = ({ red, green, covered }) => covered?.done === true || (red?.done === true && green?.done === true);

// Every test of the task a cycle closed, each by its own selector: the full suite would run the placeholders still
// waiting for their RED, which fail by design. A failed run is evidence, so it lands in the ledger before the refusal.
async function requireClosedTestsPass({ root, path, ledger }, config, rows) {
  const plans = rows.filter(({ test_id: id }) => isClosedCycle(perTestOf(ledger, id))).map((row) => testPlan(config, row));
  const head = headOf(root);
  const record = { ...(await suiteRecord(plans, root, ledger.stage)), head };
  updateLedger(path, (current) => ({ ...current, tests: { ...current.tests, refactor: record } }));
  if (!record.passed) throw new Refusal(`the tests failed, so nothing was committed: exit codes ${record.runs.map(({ exitCode }) => exitCode).join(", ")}`);
}

// One fix group of a cycle's refactor. It follows the cycle's GREEN, and every test the task has closed must still pass.
async function refactorCheckpoint(context) {
  const { key, root, ledger } = context;
  const { item: id, role } = parseKey(key);
  if (!perTestOf(ledger, id).green?.done) throw new Refusal(`test ${id} has no GREEN, so its cycle has nothing to refactor yet`);
  const config = readTestConfig(root, ledger.configHash);
  const rows = testRows(config, artifactsDirOf(root), ledger.stage);
  const plan = planFor(context, { testDirectories: [...new Set(rows.map((row) => testDirectoryOf(config, row)))], role });
  if (plan === null) return noChange(context);
  const head = headOf(root);
  await requireClosedTestsPass(context, config, rows);
  return commitPlan(context, plan, head);
}

// The spike setup of the open run; it is missing until pb spike setup has run (after G:type passes).
function readSpikeSetup(root) {
  let setup;
  try {
    setup = readStateJson(join(taskDirOf(root), SPIKE_SETUP_FILE));
  } catch {
    throw new Refusal(`${SPIKE_SETUP_PATH} is not valid JSON, so this spike run cannot go on`);
  }
  if (setup === null || !Array.isArray(setup.units)) throw new Refusal(`this spike run has no usable ${SPIKE_SETUP_PATH}; run pb spike setup first (after G:type passes)`);
  return setup;
}

// A spike unit proves nothing by tests: its exploratory code is committed as it stands.
function spikeUnitCheckpoint(context) {
  const id = parseKey(context.key).item;
  const unit = readSpikeSetup(context.root).units.find((candidate) => candidate.id === id);
  if (unit === undefined) throw new Refusal(`unit ${id} is not in spike.json`);
  const plan = planFor(context, { workingDirectory: unit.execution?.working_directory });
  return plan === null ? noChange(context) : commitPlan(context, plan, headOf(context.root));
}

const SPIKE_DOCUMENT_STAGE = "code-spike-document";
const SPIKE_DOC_STEP = "spike-doc";

// The document-spike return that stands for the active attempt; later tests extend what stands.
function standingSpikeDocument(ledger, artifactsDir) {
  const { attempt } = ledger.stage;
  const found = newestDraftKey(artifactsDir, { name: SPIKE_DOCUMENT_STAGE, attempt }, null, stepRoles(SPIKE_DOC_STEP));
  if (found === null) throw new Refusal("no document-spike return stands for this attempt, so there is no document to write");
  return found.pbKey;
}

// The ledger of a spike run, for the spike verbs that need one.
function spikeLedger(verb) {
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  if (ledger.taskType !== "spike") throw new Refusal(`pb spike ${verb} runs for spike tasks only, and this task is ${ledger.taskType}`);
  return { root, ledger };
}

// Validates spike-config.json and spike-questions.json and records the trimmed setup at run/task/spike.json, once, after G:type.
function spikeSetup(args) {
  assertNoArgs(args, "spike setup");
  const { root, ledger } = spikeLedger("setup");
  if (!isPassed(ledger, "G:type")) throw new Refusal("G:type has not passed, so pb spike setup cannot run yet");
  const target = join(taskDirOf(root), SPIKE_SETUP_FILE);
  if (existsSync(target)) throw new Refusal(`the run already has its spike setup (${SPIKE_SETUP_PATH}); nothing was touched`);
  writeJsonAtomic(target, spikeSetupOf(root));
  return { ok: true, spike: SPIKE_SETUP_PATH };
}

// Writes the standing document to the spike's doc_path and commits exactly that path.
function spikeWrite(args) {
  assertNoArgs(args, "spike write");
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  const key = standingSpikeDocument(ledger, artifactsDirOf(root));
  const branch = assertMayCommit(SPIKE_DOC_STEP, key, ledger, root);
  const docPath = checkedPath(root, readSpikeSetup(root).doc_path);
  const standing = readReturn(artifactsDirOf(root), key);
  if (standing === null) throw new Refusal(`the standing document-spike return ${key} cannot be read`);
  const { document } = standing;
  if (typeof document !== "string" || document.length === 0) throw new Refusal("the standing document-spike return's document must be a non-empty string");
  // A dirty doc_path is refused unless it already holds this document (pb's own leftover write of an earlier attempt).
  if (remainingFiles(root).includes(docPath) && readFileSync(join(root, docPath), "utf8") !== document) {
    throw new Refusal(`${docPath} has uncommitted changes; commit or move them before pb spike write overwrites the file`);
  }
  mkdirSync(dirname(join(root, docPath)), { recursive: true });
  writeFileSync(join(root, docPath), document);
  const context = { step: SPIKE_DOC_STEP, key, root, path, branch, record: {} };
  if (!remainingFiles(root).includes(docPath)) return noChange(context);
  const plan = { paths: [docPath], message: `${stepCommitType(SPIKE_DOC_STEP)}: record the spike findings in ${docPath}` };
  return commitPlan(context, plan, headOf(root));
}

const CHECKPOINT_FLOWS = {
  config: suiteCheckpoint,
  docs: suiteCheckpoint,
  fix: suiteCheckpoint,
  "refactor-step": suiteCheckpoint,
  placeholders: placeholdersCheckpoint,
  red: cycleCheckpoint,
  green: cycleCheckpoint,
  refactor: refactorCheckpoint,
  "spike-unit": spikeUnitCheckpoint,
};

// The checks every commit shares, none of which costs a test run. Returns the branch the commit would land on.
function assertMayCommit(step, key, ledger, root) {
  assertCommitAllowed(step, key, ledger);
  if (!stepRunsFor(step, ledger.taskType)) throw new Refusal(`step ${step} runs for ${taskTypesOfStep(step).join(", ")} only, and this task is ${ledger.taskType}`);
  const branch = currentBranch(root);
  assertBranchNotProtected(loadGitConfigOrRefuse(root), root, branch, "commit");
  return branch;
}

// Every check that costs no test run comes first.
async function checkpoint(args) {
  const { step, key } = parseCheckpoint(args);
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  const branch = assertMayCommit(step, key, ledger, root);
  return CHECKPOINT_FLOWS[step]({ step, key, root, path, ledger, branch });
}

function assertNoArgs(args, verb) {
  if (args.length > 0) throw new UsageError(`usage: pb ${verb}`);
}

function assertStageActive(ledger, verb) {
  if (!isStageActive(ledger)) throw new Refusal(`no stage is active, so there is nothing to ${verb}`);
}

// Takes the stage from the ledger, because a model must not name what it is proving. A call on no active stage changes
// nothing, so that a runner orphaned by stage fail cannot halt the run. Missing evidence stops it, and stage fail clears that.
function stageFinish(args) {
  assertNoArgs(args, "stage finish");
  const { root, path } = runLedgerPath();
  const contract = loadStages(PLUGIN_ROOT);
  const artifactsDir = artifactsDirOf(root);
  const head = headOf(root);
  let missing = null;
  let finished;
  updateLedger(path, (ledger) => {
    assertStageActive(ledger, "finish");
    if (ledger.stop !== null) throw new Refusal(`the run has stopped: ${ledger.stop.reason}`);
    const { name, attempt } = ledger.stage;
    const problems = finishProblems(contract, ledger, artifactsDir, head, () => readTestConfig(root, ledger.configHash));
    if (problems.length > 0) {
      missing = `stage ${name} cannot finish at attempt ${attempt}: ${problems.join("; ")}`;
      return { ...ledger, stop: { reason: missing, seq: ledger.seq + 1, code: MISSING_ARTIFACT } };
    }
    const report = buildReport(ledger, artifactsDir);
    writeReport(reportPathOf(root), report);
    finished = { stage: name, attempt, agents: report.spend.agents };
    const closed = closeStage(ledger, "done", report.spend);
    if (!safetyNetStages(contract).includes(name)) return closed;
    return { ...closed, lenses: { ...closed.lenses, "safety-net": lensRecordOf(ledger, report) } };
  });
  if (missing !== null) throw new Refusal(`${missing}. The run stopped: pb stage fail clears it`);
  return { ok: true, ...finished, report: reportPathOf(root) };
}

// A stage's script stops a run this way, because it has no shell of its own. The first stop stands: it says why.
function stageStop(args) {
  if (args.length !== 1 || !Object.hasOwn(STAGE_STOP_REASONS, args[0])) throw new UsageError(`usage: pb stage stop ${Object.keys(STAGE_STOP_REASONS).join("|")}`);
  const code = args[0];
  const reason = STAGE_STOP_REASONS[code];
  let stop;
  updateLedger(runLedgerPath().path, (ledger) => {
    assertStageActive(ledger, "stop");
    stop = ledger.stop ?? { reason, seq: ledger.seq + 1, code };
    return { ...ledger, stop };
  });
  return { ok: true, stop };
}

const artifactPath = (pbKey) => (pbKey === null ? null : `.pairingbuddy/run/task/artifacts/${pbKey}.json`);

const doneAt = ({ perTest = {} }, step) => Object.keys(perTest).filter((id) => perTest[id][step]?.done);

// What the tdd stage cannot see for itself: its inputs, how far tests{} got, and where each runner's tests live
// (test_directory, file_pattern), so the workflow can scope the light review. A wrong relay of this costs a refusal
// or a stop, since RED, GREEN and stage finish each read the ledger again. It reads the pinned test config, so a changed
// config hash refuses here just as RED and GREEN do.
function tddState(args) {
  if (args.length > 0) throw new UsageError("usage: pb tdd state");
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  assertStageActive(ledger, "report on");
  const artifactsDir = artifactsDirOf(root);
  const standingScenarios = ({ role, item, stage, attempt }) => ((role === SCENARIOS_ROLE && item === null) || (role === FIX_ROLE && stage === "code-scenarios")) && !isVoidedAttempt(ledger, stage, attempt);
  const scenarios = newestReturnMatching(artifactsDir, standingScenarios);
  if (scenarios === null) throw new Refusal("no scenarios return stands, so there is nothing to write tests from");
  return { ok: true, taskType: ledger.taskType, scenarios: artifactPath(scenarios), tests: artifactPath(newestReturn(artifactsDir, TESTS_ROLE)), red: doneAt(ledger.tests, "red"), green: doneAt(ledger.tests, "green"), covered: doneAt(ledger.tests, "covered"), testRunners: testRunnersOf(readTestConfig(root, ledger.configHash)) };
}

// What the refactor-apply stage cannot see for itself: the scope's issues as numbered steps, code issues first.
function refactorState(args) {
  if (args.length > 0) throw new UsageError("usage: pb refactor state");
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  assertStageActive(ledger, "report on");
  if (!stepRunsFor("refactor-step", ledger.taskType)) throw new Refusal(`pb refactor state runs for refactoring tasks only, and this task is ${ledger.taskType}`);
  const artifactsDir = artifactsDirOf(root);
  const standingScope = ({ role, item, stage, attempt }) => role === SCOPE_ROLE && item === null && stage === SCOPE_STAGE && !isVoidedAttempt(ledger, stage, attempt);
  const scope = newestReturnMatching(artifactsDir, standingScope);
  const standing = scope === null ? null : readReturn(artifactsDir, scope);
  if (standing === null) throw new Refusal("no scope return stands, so there is nothing to refactor");
  const { code_issues = [], test_issues = [] } = standing;
  const issues = [...code_issues.map((issue) => ({ role: REFACTOR_CODE_ROLE, issue })), ...test_issues.map((issue) => ({ role: REFACTOR_TESTS_ROLE, issue }))];
  return { ok: true, taskType: ledger.taskType, scope: artifactPath(scope), steps: issues.map(({ role, issue }, index) => ({ item: `step${index + 1}`, role, issue })) };
}

// The artifact path of the newest spike-unit checkpoint for each unit that has one.
function spikeFindings(ledger, units) {
  const exploreReturns = (ledger.checkpoints ?? []).map(({ key }) => ({ key, ...parseKey(key) }));
  const newestOf = (id) => exploreReturns.filter(({ item }) => item === id).reduce((newest, found) => (newest === null || found.attempt > newest.attempt ? found : newest), null);
  return units.map(({ id }) => newestOf(id)).filter((found) => found !== null).map(({ key }) => artifactPath(key));
}

// What the spike unit stage cannot see for itself: the unit ids, which are explored, and the first unexplored unit.
function spikeState(args) {
  if (args.length > 0) throw new UsageError("usage: pb spike state");
  const { root, ledger } = spikeLedger("state");
  assertStageActive(ledger, "report on");
  const { units } = readSpikeSetup(root);
  const explored = ledger.stages.find(({ name }) => name === SPIKE_UNIT_STAGE)?.explored ?? [];
  const next = units.find(({ id }) => !explored.includes(id));
  if (next === undefined && ledger.stage.name === SPIKE_UNIT_STAGE) throw new Refusal("every unit is explored");
  const findings = spikeFindings(ledger, units);
  return { ok: true, taskType: ledger.taskType, spike: SPIKE_SETUP_PATH, units: units.map(({ id }) => id), explored, next: next ?? null, findings };
}

const testRunnersOf = ({ runners }) => Object.fromEntries(Object.entries(runners).map(([id, { test_directory, file_pattern }]) => [id, { test_directory, file_pattern }]));

// A human's stop is the human's to lift. Only a stop the run itself raised clears here.
function assertNotHumanStop(ledger, root) {
  const answered = answeredGate(gatesFor(loadStages(PLUGIN_ROOT), ledger.taskType), ledger);
  if (answered?.answer !== "stop") return;
  throw new Refusal(`the human answered stop at ${answered.name}. Only the human can go on: ask them to type ${approveCommand(root, answered.name)}`);
}

// With no attempt to fail, only the stop goes, whatever state the stage is in, so a stop always has a way out.
function withStopCleared(ledger) {
  const { name } = ledger.stage;
  const clearedStop = ledger.stop.reason;
  return { ...ledger, stop: null, stages: ledger.stages.map((entry) => (entry.name === name ? { ...entry, clearedStop } : entry)) };
}

// Closes the active stage as failed, clears any stop unless keepStop, and says which attempt failed and what the next one is.
function failActiveStage(root, ledger, { keepStop = false } = {}) {
  const { name, attempt } = ledger.stage;
  assertStageActive(ledger, "fail");
  const clearedStop = keepStop ? null : (ledger.stop?.reason ?? null);
  const closed = closeStage(ledger, FAILED_STATUS, unknownSpend(returnsAt(artifactsDirOf(root), ledger.stage).length), clearedStop === null ? {} : { clearedStop });
  return { ledger: keepStop ? closed : { ...closed, stop: null }, failed: { stage: name, attempt, nextAttempt: nextAttempt(closed, name), clearedStop } };
}

function stageFail(args) {
  assertNoArgs(args, "stage fail");
  const { root, path } = runLedgerPath();
  let failed;
  updateLedger(path, (ledger) => {
    assertNotHumanStop(ledger, root);
    const { name, attempt } = ledger.stage;
    if (!isStageActive(ledger) && ledger.stop !== null) {
      failed = { stage: name, attempt, nextAttempt: null, clearedStop: ledger.stop.reason };
      return withStopCleared(ledger);
    }
    const result = failActiveStage(root, ledger);
    failed = result.failed;
    return result.ledger;
  });
  return { ok: true, ...failed };
}

function stageReport(args) {
  assertNoArgs(args, "stage report");
  const { root, path } = runLedgerPath();
  const { stage, gates } = readLedger(path);
  const report = readReportOf(reportPathOf(root), stage);
  if (report === null) throw new Refusal(`no report for ${stage.name || "(no stage)"} at attempt ${stage.attempt}: the stage is ${stage.status || "not started"}`);
  return { ok: true, report, gates };
}

function parseArtifactKey(args) {
  if (args.length !== 1 || !isKey(args[0])) throw new UsageError("usage: pb artifact check <key>");
  return args[0];
}

function artifactCheck(args) {
  const key = parseArtifactKey(args);
  const { root, path } = runLedgerPath();
  const { stage, attempt } = parseKey(key);
  if (isVoidedAttempt(readLedger(path), stage, attempt)) throw new Refusal(`the return ${key} is void: its attempt failed or a later one replaced it`);
  const artifactsDir = artifactsDirOf(root);
  const file = join(artifactsDir, `${key}.json`);
  if (!existsSync(file)) throw new Refusal(`no return for ${key}`);
  const artifact = readReturn(artifactsDir, key);
  if (artifact === null) throw new Refusal(`the return ${file} cannot be read`);
  return { ok: true, key, path: file, artifact };
}

// The action stays behind a flag: plain status is what a stage's session reads, and an action there sends it past where
// its prompt stopped.
function status(args) {
  const withAction = args.length === 1 && args[0] === "--action";
  if (!withAction && args.length > 0) throw new UsageError("usage: pb status [--action]");
  const { root, path } = runLedgerPath();
  const contract = loadStages(PLUGIN_ROOT);
  const ledger = readLedger(path);
  const state = runStatus(contract, ledger, artifactsDirOf(root));
  return withAction ? { ok: true, ...state, action: nextAction(contract, ledger, root, PLUGIN_ROOT) } : { ok: true, ...state };
}

// The units list leaves out task bodies: only `next` carries one.
const unitSummary = ({ unit, tracer, pr, legacy, dependsOn, tasks }, state) => ({ unit, tracer, pr, legacy, dependsOn, state, tasks: tasks.map(({ body, ...task }) => task) });

// The open unit from run/unit.json, or null when none is open. A corrupt file or one without a tasks list refuses,
// saying what could not be done (the consequence) and that nothing was changed (the outcome).
function readUnitJson(root, consequence, outcome) {
  const path = unitPathOf(root);
  if (!existsSync(path)) return null;
  let unit;
  try {
    unit = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Refusal(`run/unit.json is unreadable, so ${consequence}. ${outcome}: ${e.message}`);
  }
  if (!Array.isArray(unit?.tasks)) throw new Refusal(`run/unit.json has no tasks list, so ${consequence}. ${outcome}`);
  return unit;
}

const readOpenUnit = (root) => readUnitJson(root, "the plan cannot be read", "Nothing was written");

function planStopMessage(root, plan, { reason, unit, tasks, title, body, humanLeft }) {
  const acceptCommand = humanCommand(root, `accept --legacy ${shellWord(unit)} --plan ${shellWord(plan)}`);
  if (reason === "human") return `unit "${unit}"'s next task "${title}" is a human task: only a person does it and ticks its box. Nothing was written. Its steps:\n${body}`;
  if (reason === "legacy") return `unit "${unit}" is fully checked with no PR: line. Nothing was written: ask the human to type ${acceptCommand}`;
  if (reason === "hand-ticked") {
    const message = `unit "${unit}" has ticked tasks with no task record: ${tasks.join(", ")}. A box ticked by hand earns nothing. Nothing was written`;
    if (humanLeft === undefined) return message;
    return `${message}. The only unticked tasks are human tasks (${humanLeft.join(", ")}): either do them and tick their boxes, then type ${acceptCommand}; or untick ${tasks.join(", ")} so they run again`;
  }
  return `unit "${unit}" is done but not published. Nothing was written: publish it with ${pbCommand("run open --kind publish")}`;
}

// The run open in this repo, if any: its kind and the path and task title of the plan it works on; null when no run is open.
function openRunOf(root) {
  const path = ledgerPathOf(root);
  if (!existsSync(path)) return null;
  const ledger = readLedger(path);
  return { kind: ledger.kind, title: ledger.plan?.title ?? "", planPath: ledger.plan?.path ?? "" };
}

// Refuses when a code run of this plan is open on a task other than the plan's next one.
function assertOpenRunTakes(open, next, planPath) {
  if (open?.kind === "code" && open.planPath === planPath && open.title !== next?.title) {
    throw new Refusal(`a code run of this plan is open for "${open.title}", but ${next ? `the plan's next task is "${next.title}"` : "the plan has no task left"}. Nothing was written: the open run must be finished, or the human abandons it`);
  }
}

// Reads the plan under the repo toplevel and reports its units, next task and format problems. Writes nothing.
function planNext(args) {
  const paths = args.filter((a) => !a.startsWith("-"));
  const dryRun = args.includes("--dry-run");
  if (paths.length !== 1 || args.some((a) => a.startsWith("-") && a !== "--dry-run")) throw new UsageError("usage: pb plan next <plan.md> [--dry-run]");
  const [plan] = paths;
  if (!dryRun) {
    const { root, context, next, stop } = planStepOf(plan);
    const open = openRunOf(root);
    const openRun = open && { kind: open.kind, title: open.title };
    // An open publish run on a unit that is done but unpublished is what to resume: the stop is data, not a refusal.
    if (stop?.reason === "unpublished" && open?.kind === "publish") return { ok: true, plan, next: null, stop, openRun };
    if (stop) throw new Refusal(planStopMessage(root, plan, stop));
    assertOpenRunTakes(open, next, context.plan);
    return { ok: true, plan, next, ...(openRun && { openRun }) };
  }
  const { root, units, problems, context } = readPlanContext(plan);
  const { next, stop } = planStep(units, context);
  const states = unitStates(units, context);
  const summaries = units.map((u, i) => unitSummary(u, states[i]));
  const reportedStop = stop && { ...stop, says: planStopMessage(root, plan, stop) };
  return { ok: true, dryRun: true, plan, units: summaries, stop: reportedStop, next, problems };
}

function assertTaskFinished(ledger) {
  const contract = loadStages(PLUGIN_ROOT);
  const unfinished = isStageActive(ledger) ? ledger.stage.name : nextStage(graphFor(contract, ledger.taskType), ledger);
  if (unfinished !== undefined) throw new Refusal(`stage ${unfinished} is not finished, so the task cannot end`);
  if (ledger.stop !== null) throw new Refusal(`the run has stopped: ${ledger.stop.reason}`);
  const gate = blockingGate(gatesFor(contract, ledger.taskType), ledger);
  if (gate !== undefined) throw new Refusal(`gate ${gate.name} has not passed, so the task cannot end. Run pb gate eval.`);
}

function assertCommitsOnHead(root, { commits }) {
  const missing = commits.filter((sha) => !isOnHead(root, sha));
  if (missing.length > 0) throw new Refusal(`these commits of this run are no longer on HEAD, so the task cannot end. Restore them, nothing was touched: ${missing.join(", ")}`);
}

// A later commit undoes what the green run proved. The stage is done, so a human's own run is the way to prove it again.
function assertGreenRunStands(root, { tests: { full } }) {
  if (full === undefined) return;
  const rerun = `ask the human to type ${typedCommand(root, "test --full")}`;
  if (!full.passed) throw new Refusal(`the last full suite run failed, so the task cannot end. Nothing was touched: ${rerun}`);
  const head = headOf(root);
  if (full.head !== head) throw new Refusal(`the full suite ran at ${full.head}, and HEAD is now ${head}, so the task cannot end. Nothing was touched: put HEAD back, or ${rerun}`);
}

function assertCleanTree(root, outcome = "the task cannot end") {
  const remaining = remainingFiles(root);
  if (remaining.length > 0) throw new Refusal(`the tree is dirty, so ${outcome}. Commit or remove these, nothing was touched: ${remaining.join(", ")}`);
}

function tickedPlan(root, { path, title }) {
  return path === "" ? null : { path, title, ticked: tickPlanBox(root, { path, title }) };
}

const unitPathOf = (root) => join(root, ".pairingbuddy", "run", "unit.json");

// Writes a JSON file atomically: a temp file renamed into place. With exclusive, the temp file is linked into place
// instead, which fails when the file already exists, so of two openers only one claims it.
function writeJsonAtomic(path, value, { exclusive = false } = {}) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (!exclusive) return replaceFile(path, text);
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, text);
  try {
    linkSync(temp, path);
  } catch (e) {
    if (e.code === "EEXIST") throw new Refusal("a unit is already open (run/unit.json exists); nothing was touched");
    throw e;
  } finally {
    rmSync(temp, { force: true });
  }
}

// The task's lessons: each stage's rollback notes, files by name, entries in file order.
function taskLessons(root) {
  const notesDir = notesDirOf(root);
  if (!existsSync(notesDir)) return [];
  return readdirSync(notesDir)
    .filter((file) => file.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .flatMap((file) => parseFixNotes(readFileSync(join(notesDir, file), "utf8")).map((entry) => ({ stage: basename(file, ".md"), ...entry })));
}

// What taskEnd needs to record the task, read with the other refusals: the open unit and HEAD, or null with no unit.
// A corrupt unit.json, one without a tasks list, or no commit refuses here, before anything changes.
function readUnitForRecord(root, ledger) {
  const unit = readUnitJson(root, "the task cannot end", "Nothing was touched");
  if (unit === null) return null;
  const path = unitPathOf(root);
  const headSha = headOf(root);
  if (headSha === null) throw new Refusal("there is no commit yet, so the task cannot end. Nothing was touched");
  const lessons = taskLessons(root);
  return { path, unit, record: newTaskRecord({ ledger, headSha, lessons }), commits: ledger.commits };
}

// A retry after a crash finds its own record last, and appends nothing more.
function appendTaskRecord(opened) {
  if (opened === null) return;
  const { path, unit, record, commits } = opened;
  const last = unit.tasks.at(-1);
  if (last?.title === record.title && last?.headSha === record.headSha) return;
  unit.tasks.push(record);
  unit.commits = [...new Set([...unit.commits, ...commits])];
  writeJsonAtomic(path, unit);
}

// Where the task's own commits start: the unit's last task, else the unit's base. With no unit, the parent of the run's
// first commit (the ledger records no start commit), or null when the run committed nothing.
function taskStart(root, { commits }, opened) {
  if (opened !== null) return opened.unit.tasks.at(-1)?.headSha ?? opened.unit.baseSha;
  if (commits.length === 0) return null;
  const parent = `${commits[0]}^`;
  // A root commit has no parent: diff against the empty tree instead.
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", parent], { cwd: root, stdio: "ignore" });
    return parent;
  } catch {
    return runGit(root, ["hash-object", "-t", "tree", "/dev/null"]);
  }
}

function taskDiffFiles(root, ledger, opened) {
  const start = taskStart(root, ledger, opened);
  if (start === null) return [];
  const out = runGit(root, ["diff", "--name-only", "--no-renames", start, "HEAD"]);
  return out === "" ? [] : out.split("\n");
}

// A config_change may only touch config_globs. An empty list is the human's call, once per task.
function assertConfigChangeInGlobs(root, ledger, opened) {
  if (ledger.taskType !== "config_change") return;
  const globs = loadGitConfigOrRefuse(root).config_globs;
  if (globs.length === 0) {
    if (ledger.configApproval?.source === "human-cli") return;
    throw new Refusal(`config_globs is empty, so this config_change needs the human's confirmation. Nothing was touched: ask the human to run pb human approve-config by typing ${humanCommand(root, "approve-config")}`);
  }
  const outside = outsideGlobs(globs, taskDiffFiles(root, ledger, opened));
  if (outside.length > 0) throw new Refusal(`this config_change touches files outside config_globs (${globs.join(", ")}). Nothing was touched: ${outside.join(", ")}`);
}

// Appends the unit's task record, then removes run/task. The refusals all come first, including reading the unit and HEAD, so a refused call changes nothing.
function taskEnd(args) {
  assertNoArgs(args, "task end");
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  if (isPublishRun(ledger)) throw new Refusal(`this is a publish run, which has no task to end. Nothing was touched: run ${pbCommand("publish")} once G:publish is approved`);
  if (isRefreshRun(ledger)) throw new Refusal(`a refresh run has no task to end. Nothing was touched: run ${pbCommand("pr refresh")} once G:publish is approved`);
  if (ledger.plan?.title && isHumanTitle(ledger.plan.title)) throw new Refusal(`the task "${ledger.plan.title}" is a human task: only a person ticks its box, so the task cannot end. Nothing was touched`);
  assertTaskFinished(ledger);
  assertCommitsOnHead(root, ledger);
  assertGreenRunStands(root, ledger);
  assertCleanTree(root);
  const opened = readUnitForRecord(root, ledger);
  assertConfigChangeInGlobs(root, ledger, opened);
  const plan = tickedPlan(root, ledger.plan);
  const branch = opened?.unit.branch ?? branchOf(root);
  appendTaskRecord(opened);
  const dir = taskDirOf(root);
  rmSync(dir, { recursive: true });
  if (ledger.taskType === "spike") {
    closeUnit(join(root, ".pairingbuddy", "run"));
    return { ok: true, removed: dir, plan, closed: "kept-local", reason: `a spike publishes nothing: the unit is closed and its commits stay on ${branch}` };
  }
  return { ok: true, removed: dir, plan };
}

// The commits past the unit's base, oldest first. One rule for "nothing to publish", in gate eval and in pb publish.
const unitCommits = (root, unit) => runGit(root, ["rev-list", "--reverse", `${unit.baseSha}..HEAD`]).split("\n").filter(Boolean);

// The labels of the plan boxes under the unit's heading. planBoxes is null with no plan, no heading to go by, or no such
// heading; planProblem says when the plan cannot be read.
function unitPlan(root, unit) {
  if (typeof unit.plan !== "string" || unit.plan === "" || typeof unit.unit !== "string" || unit.unit === "") return { planBoxes: null, planProblem: null };
  try {
    return { planBoxes: boxLabelsUnder(readFileSync(join(root, unit.plan), "utf8"), unit.unit), planProblem: null };
  } catch (e) {
    return { planBoxes: null, planProblem: `the plan ${unit.plan} cannot be read: ${e.code ?? e.message}` };
  }
}

// Null where git says no (or the remote is unreachable): the caller treats that as "nothing there".
function tryGit(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Why the unit branch cannot be pushed as a name: its shape in the argv, then git's own rules for a branch ref.
function branchProblemOf(root, branch) {
  return branchShapeProblem(branch) ?? (tryGit(root, ["check-ref-format", `refs/heads/${branch}`]) === null ? `git does not accept ${JSON.stringify(branch)} as a branch name` : null);
}

// What only a real publish needs: the evidence, and where the branch and the remote stand.
function publishingFacts(root, unit, gitConfig, head) {
  const branchProblem = branchProblemOf(root, unit.branch);
  const usable = branchProblem === null;
  return {
    safetyNets: safetyNetStages(loadStages(PLUGIN_ROOT)), ...unitPlan(root, unit), head, dirty: remainingFiles(root), branchProblem,
    branchIsProtected: usable && isProtected(gitConfig, root, unit.branch), currentBranch: branchOf(root),
    branchTip: usable ? tryGit(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${unit.branch}`]) : null,
    remoteSha: usable ? (tryGit(root, ["ls-remote", "--", gitConfig.remote, `refs/heads/${unit.branch}`])?.split(/\s/)[0] || null) : null,
  };
}

// Pushes the approved SHA, opens (or adopts) the PR, writes the plan line, deletes the unit's refs and closes the unit.
// The policy is only what the gate hook recorded in the ledger. Facts are read once, steps come from publishSteps.
function publish(args) {
  assertNoArgs(args, "publish");
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  if (!isPublishRun(ledger)) throw new Refusal(`pb publish needs a publish run, and the open run is a ${ledger.kind} run. Nothing was touched: end the task with ${pbCommand("task end")}, then open the publish run with ${pbCommand("run open --kind publish")}`);
  if (publishApproval(ledger) === "keep-local") return finishKeptLocal(root, ledger);
  const unit = readUnitOrRefuse(root);
  const gitConfig = loadGitConfigOrRefuse(root);
  const commits = unitCommits(root, unit);
  const mode = gitConfig.pr?.publish;
  // The body bytes and the draft are read once: what the approval is checked against is what gh gets.
  const bound = commits.length === 0 ? null : readBound(root, ledger);
  const voidReason = bound === null ? null : refusing(() => publishVoidReason(ledger, root, bound.current));
  const facts = {
    unit, runStop: ledger.stop, publishMode: mode, coordination: bound?.draft.coordination ?? null, commits, changedConfigs: changedConfigs(unit, root), approval: publishApproval(ledger), voidReason, lint: bound === null ? null : publishLint(root, bound.current.bodyHash),
    taskRunOpen: !isPublishRun(ledger),
    ...(bound === null || mode === "none" ? {} : publishingFacts(root, unit, gitConfig, bound.current.headSha)),
  };
  if (voidReason !== null) updateLedger(path, (current) => voidPublish(current, voidReason));
  const plan = publishSteps(facts);
  if (plan.refusals.length > 0) throw new Refusal(`not published: ${plan.refusals.join("; ")}`);
  // publishSteps only emits a push in a plan that also has open-pr, so open-pr alone marks a publishing plan.
  if (plan.steps.some((step) => step.do === "open-pr")) assertBaseCurrent(root, unit, gitConfig);
  return executePublish(plan.steps, { root, unit, gitConfig, ledger, bound });
}

// The human answered keep local at G:publish: nothing is pushed or opened, no unit or git state is read, and whatever the
// hook's own cleanup left (unit files, the publish run) goes. Idempotent, so a repeat after a failure finishes the job.
function finishKeptLocal(root, ledger) {
  if (ledger.stop !== null) throw new Refusal(`not published: the run stopped: ${ledger.stop.reason}`);
  const runDir = join(root, ".pairingbuddy", "run");
  closeUnit(runDir);
  if (isPublishRun(ledger)) endRun(runDir);
  return { ok: true, result: "kept-local", reason: KEPT_LOCAL_REASON };
}

// The draft artifact and the body bytes as they stand, with the binding they make.
function readBound(root, ledger) {
  const draft = readDraft(root, ledger.stage);
  const body = existsSync(prBodyPath(root)) ? readFileSync(prBodyPath(root)) : null;
  return { draft, body, current: refusing(() => currentBinding(root, draft, body)) };
}

function executePublish(steps, ctx) {
  const { root, unit, gitConfig } = ctx;
  const runDir = join(root, ".pairingbuddy", "run");
  const remote = gitConfig.remote;
  let url = null;
  let warnings = [];
  let pendingComment;
  for (const step of steps) {
    if (step.do === "push") {
      runGit(root, pushArgv(remote, step.sha, step.branch), { context: "nothing was pushed or opened; the unit is intact" });
    } else if (step.do === "set-upstream") {
      runGit(root, upstreamArgv(remote, step.branch), { context: `${step.branch} is on ${remote} but its upstream is not set; run pb publish again, the push will not repeat` });
    } else if (step.do === "open-pr") {
      url = openPr(ctx, step.recordedUrl);
    } else if (step.do === "comment") {
      const posted = postComment(ctx, url, step.text);
      warnings = [...warnings, ...posted.warnings, ...(posted.posted ? recordCommented(root, unit, url) : [])];
      pendingComment = posted.pendingComment ?? pendingComment;
    } else if (step.do === "plan-line") {
      warnings = [...warnings, ...recordPrLine(root, unit, url)];
    } else if (step.do === "delete-refs") {
      deleteUnitRefs(root, step.prefix, url);
    } else {
      closeUnit(runDir);
      if (isPublishRun(ctx.ledger)) endRun(runDir);
      return step.result === "published" ? { ok: true, result: "published", url, warnings, ...(pendingComment === undefined ? {} : { pendingComment }) } : { ok: true, result: step.result, reason: step.reason };
    }
  }
}

// Posts the coordination text on the PR from a kept per-PR file outside run/, deleted once it posts. A failure after the
// PR is open never stops the caller: the file stays, and the warning has gh's reason and the one command to post it by
// hand. A failed post is not retried.
function postComment({ root }, url, text) {
  const kept = join(root, ".pairingbuddy", "pr-comments", `${url.match(/(\d+)$/)[1]}.md`);
  try {
    mkdirSync(dirname(kept), { recursive: true });
    writeFileSync(kept, text);
  } catch (e) {
    return { warnings: [`the coordination comment was not posted on ${url} (it could not be saved: ${e.message}); post it by hand`] };
  }
  try {
    execFileSync("gh", ["pr", "comment", url, "--body-file", kept], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const why = String(e.stderr ?? "").trim() || e.message;
    return {
      warnings: [`the coordination comment was not posted on ${url} (${why}); post it by hand with: gh pr comment ${url} --body-file ${kept}`],
      pendingComment: kept,
    };
  }
  const warnings = [];
  try {
    rmSync(kept, { force: true });
  } catch (e) {
    warnings.push(`the coordination comment was posted, but ${kept} could not be removed: ${e.message}`);
  }
  return { warnings, posted: true };
}

function recordCommented(root, unit, url) {
  try {
    writeJsonAtomic(unitPathOf(root), { ...unit, pr: { ...unit.pr, url, commented: true } });
    return [];
  } catch (e) {
    return [`the coordination comment was posted on ${url}, but recording it failed (${e.message}); do not post it again`];
  }
}

// The PR gh knows for the unit branch, which must be from that branch into the target. Refuses a mismatch.
function verifiedPr(view, branch, target) {
  const wrong = foreignPrReason(view, { branch, target });
  if (wrong !== null) throw new Refusal(`not published: ${wrong}`);
  return view.url;
}

function viewPr(root, branch, context = "", argv = prViewArgv(branch)) {
  const text = run(root, "gh", argv, { context });
  try {
    return JSON.parse(text);
  } catch {
    throw new Refusal(`gh pr view gave output that is not JSON: ${text.slice(0, 200)}`);
  }
}

// Opens the PR for the approved body, title and labels, or adopts the unit's own PR when one exists already (a retry
// after a crash). Records the url in unit.json before anything else is done with it.
function openPr({ root, unit, gitConfig, ledger, bound }, recordedUrl) {
  const target = targetBranch(gitConfig, unit);
  const opened = `${unit.branch} is pushed to ${gitConfig.remote}`;
  let url;
  if (recordedUrl !== null) {
    url = verifiedPr(viewPr(root, unit.branch, `${opened}; the recorded PR ${recordedUrl} could not be checked, run pb publish again`), unit.branch, target);
    if (url !== recordedUrl) throw new Refusal(`not published: unit.json records the PR ${recordedUrl}, but the PR for ${unit.branch} is ${url}`);
    return url;
  }
  url = withBodySnapshot(root, bound.body, (snapshot) => createdPr(root, unit, target, snapshot, bound.draft, ledger.policy?.mode, opened));
  writeJsonAtomic(unitPathOf(root), { ...unit, pr: { url } });
  return url;
}

function createdPr(root, unit, target, bodyFile, draft, policyMode, opened) {
  const argv = prCreateArgv({ title: draft.title, bodyFile, base: target, branch: unit.branch, labels: draft.labels, policyMode });
  let printed;
  try {
    printed = run(root, "gh", argv, { context: `${opened}, but the PR was not opened; run pb publish again, the push will not repeat` });
  } catch (failure) {
    let view;
    try {
      view = viewPr(root, unit.branch);
    } catch {
      throw failure;
    }
    return verifiedPr(view, unit.branch, target);
  }
  const url = printed.split("\n").at(-1).trim();
  if (!PR_URL.test(url)) throw new Refusal(`gh printed ${JSON.stringify(url)}, which is not a pull request URL; the PR may be open, run pb publish again and it will be looked up`);
  return url;
}

// The refs under the unit's own prefix, deleted in one transaction. Other units' refs are not touched.
function deleteUnitRefs(root, prefix, url) {
  const refs = runGit(root, ["for-each-ref", "--format=%(refname)", prefix]).split("\n").filter(Boolean);
  if (refs.length === 0) return;
  runGit(root, ["update-ref", "--stdin"], { input: refs.map((ref) => `delete ${ref}\n`).join(""), context: `the PR is open at ${url}; run pb publish again` });
}

// Writes "PR: <url> branch: <branch>" under the unit's heading in its plan. Warnings for what is only worth reporting.
function recordPrLine(root, unit, url) {
  if (typeof unit.plan !== "string" || unit.plan === "") return [];
  try {
    const found = writePrLine(root, unit.plan, unit.unit, `PR: ${url} branch: ${unit.branch}`);
    return found ? [] : [`the plan ${unit.plan} has no heading for the unit ${JSON.stringify(unit.unit)}, so no PR: line was written`];
  } catch (e) {
    throw new Refusal(`the PR was opened (${url}) but the plan ${unit.plan} could not be written: ${e.message}; run pb publish again`);
  }
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

// One runner for git and gh. `context` says what was reached and what to do next, and is appended to the failure.
function run(cwd, command, args, { context = "", input, trim = true, env, maxBuffer } = {}) {
  try {
    const out = execFileSync(command, args, { cwd, encoding: "utf8", input, env: env === undefined ? process.env : { ...process.env, ...env }, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], ...(maxBuffer === undefined ? {} : { maxBuffer }) });
    return trim ? out.trim() : out;
  } catch (e) {
    const why = String(e.stderr ?? "").trim() || e.message;
    throw new Refusal(`${command} ${args.join(" ")} failed: ${why}${context === "" ? "" : `; ${context}`}`);
  }
}

const runGit = (cwd, args, options) => run(cwd, "git", args, options);

// --branch <name> names the branch instead of the template. A missing value, or one that looks like a flag, is a usage error.
function chosenBranch(args) {
  if (!args.includes("--branch")) return undefined;
  const name = flagValue(args, "--branch");
  if (name === undefined || name.startsWith("-")) throw new UsageError("--branch needs a branch name that does not start with '-'");
  return name;
}

// Refuses a protected branch name, and one git itself rejects, before anything changes.
function assertUsableBranch(root, gitConfig, branch) {
  if (isProtected(gitConfig, root, branch)) throw new Refusal(`branch ${branch} is protected; choose another name`);
  try {
    execFileSync("git", ["check-ref-format", "--branch", branch], { cwd: root, stdio: "ignore" });
  } catch {
    throw new Refusal(`invalid branch name: ${branch}`);
  }
}

function branchExists(root, branch) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A UnitRefused from the template (an unknown placeholder) is a refusal; nothing else in the open throws it.
function renderBranchOrRefuse(template, values) {
  try {
    return renderBranch(template, values);
  } catch (e) {
    if (e instanceof UnitRefused) throw new Refusal(e.message);
    throw e;
  }
}

// Fetches the remote, then applies the pure D18 rule to the unit's base. A failed fetch or a base gone from the remote is a refusal.
// A moved or merged base is a refusal carrying the recipe the human types. A reconciled status first remaps the unit's
// commit and task head shas onto the rebased range (refusing when that cannot be done, before anything runs), then runs
// the full suite at HEAD when the unit has tasks, and writes run/unit.json once, with the rebaseSuite record.
// A failed suite is recorded in that write and then refused.
async function unitStatus() {
  const root = toplevel();
  const unit = readUnitOrRefuse(root);
  const gitConfig = loadGitConfigOrRefuse(root);
  const result = baseStatusFor(root, unit, gitConfig);
  refuseRebaseNeeded(unit, result);
  if (result.status === "current") return { ok: true, status: "current", base: unit.base, baseSha: unit.baseSha };
  const hasTasks = unit.tasks.length > 0;
  const unitAfterRemap = hasTasks ? remappedUnit(root, unit, result) : unit;
  const suite = hasTasks ? await rebaseSuiteOf(root, unit) : null;
  const rebaseSuite = suite === null ? {} : { rebaseSuite: suite.rebaseSuite };
  writeJsonAtomic(unitPathOf(root), { ...reconciledUnit(unitAfterRemap, result), ...rebaseSuite });
  // The failed run is evidence, so it lands in the unit before the refusal.
  if (suite !== null && !suite.rebaseSuite.passed) {
    throw new Refusal(`the full suite failed at HEAD ${suite.rebaseSuite.head.slice(0, 7)} after the rebase: exit codes ${suite.exitCodes.join(", ")}. pb publish refuses until a full suite passes at HEAD; a new task in the unit can fix it`);
  }
  return { ok: true, status: "reconciled", base: result.base, baseSha: result.baseSha, unstack: result.unstack, ...rebaseSuite };
}

// The patch-id of a commit's change.
// A large diff must not hit the default 1 MB buffer, so the diff is read with a generous maxBuffer.
const DIFF_MAX_BUFFER = 1024 * 1024 * 1024;
function patchIdOf(root, sha) {
  const context = "nothing was written";
  const diff = runGit(root, ["diff-tree", "-p", "--root", sha], { trim: false, maxBuffer: DIFF_MAX_BUFFER, context });
  const out = runGit(root, ["patch-id", "--stable"], { input: diff, context });
  return out.split(/\s+/)[0];
}

// Runs a pure shared-node rule; its own refusals become Refusals.
function refusingAs(rule) {
  try {
    return rule();
  } catch (e) {
    if (e instanceof UnitStatusRefused) throw new Refusal(e.message);
    throw e;
  }
}

// The unit's commits and task head shas moved onto the rebased range; a mapping that cannot be made is a refusal.
function remappedUnit(root, unit, result) {
  const gitLines = (args) => runGit(root, args, { context: "nothing was written" }).split("\n").filter(Boolean);
  const range = `${result.baseSha}..HEAD`;
  const rangeCommits = gitLines(["rev-list", "--reverse", range]).map((sha) => ({ sha, patchId: patchIdOf(root, sha) }));
  const merges = gitLines(["rev-list", "--merges", range]);
  const recorded = unit.commits.map((sha) => ({ sha, patchId: patchIdOf(root, sha) }));
  const mapping = refusingAs(() => remapCommits({ recorded, range: rangeCommits, merges }));
  const remap = (sha) => mapping[sha] ?? (sha === unit.baseSha ? result.baseSha : sha);
  return { ...unit, commits: unit.commits.map(remap), tasks: unit.tasks.map((task) => ({ ...task, headSha: remap(task.headSha) })) };
}

// The full suite at the rebased HEAD, recorded as passed and the head it ran at.
async function rebaseSuiteOf(root, unit) {
  const plans = fullSuitePlans(readTestConfig(root, unit.configHash));
  const record = await suiteRecord(plans, root, { name: "rebase", attempt: 1 });
  return { rebaseSuite: { passed: record.passed, head: headOf(root) }, exitCodes: record.runs.map(({ exitCode }) => exitCode) };
}

// Fetches, reads the inputs and applies the pure rule; the rule's own refusals become Refusals.
function baseStatusFor(root, unit, gitConfig) {
  fetchOrRefuse(root, gitConfig.remote);
  const inputs = statusInputsOf(root, unit, gitConfig);
  return refusingAs(() => baseStatusOf({ unit, remote: gitConfig.remote, ...inputs }));
}

// Publish goes on only when the base is current; it never writes the unit, so a reconciled result is sent to pb unit status.
function assertBaseCurrent(root, unit, gitConfig) {
  const result = baseStatusFor(root, unit, gitConfig);
  if (result.status === "reconciled") throw new Refusal(`not published: the base of ${unit.branch} needs reconciling. Nothing was pushed or opened: run ${pbCommand("unit status")} first`);
  refuseRebaseNeeded(unit, result);
}

// A failed fetch leaves the remote tips untrusted, so it is a refusal.
function fetchOrRefuse(root, remote) {
  try {
    execFileSync("git", ["fetch", remote], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const why = String(e.stderr ?? e.message).trim();
    throw new Refusal(`git fetch failed for ${remote}, so the base tip cannot be trusted. Nothing was touched: ${why}`);
  }
}

// The reads the pure rule needs. The unstacked base and its tip matter only for a stacked unit, so only a stacked unit reads them.
function statusInputsOf(root, unit, gitConfig) {
  const { remote } = gitConfig;
  const tipOf = (branch) => tryGit(root, ["rev-parse", "--verify", `refs/remotes/${remote}/${branch}`]);
  const inputs = {
    baseTip: tipOf(unit.base),
    headContains: (sha) => tryGit(root, ["merge-base", "--is-ancestor", sha, "HEAD"]) !== null,
  };
  if (!unit.stackedOn) return inputs;
  const dependencyState = prViewOf(root, unit.stackedOn, "so the dependency PR could not be checked").state;
  const unstackedBase = baseBranch(gitConfig, defaultBranchOf(root, remote));
  if (unstackedBase === null) throw new Refusal("the base branch cannot be told, so the unit cannot move off its dependency. Nothing was touched");
  const unstackedTip = tipOf(unstackedBase);
  if (unstackedTip === null) throw new Refusal(`${unstackedBase} is gone from the remote, so the unit cannot move off its dependency. Nothing was touched`);
  return { ...inputs, dependencyState, unstackedBase, unstackedTip };
}

// A moved or merged result is a refusal carrying the recipe the human types; any other result passes through.
function refuseRebaseNeeded(unit, result) {
  const refuse = (lead) => {
    throw new Refusal(`${lead}. ${NOTHING_CHANGED_BUT_FETCH}. The human types:\n${result.recipe}`);
  };
  if (result.status === "moved") refuse(`the base ${result.base} moved from ${result.from} to ${result.to}`);
  if (result.status === "merged") refuse(`${unit.stackedOn.unit}'s PR merged, so the unit moves onto ${result.base} at ${result.to}`);
}

// The unit record after a reconcile: the new base and tip, and stackedOn dropped only when the unit unstacks.
function reconciledUnit(unit, result) {
  const { stackedOn, ...unstacked } = unit;
  return { ...(result.unstack ? unstacked : unit), base: result.base, baseSha: result.baseSha };
}

// A plain call opens the template branch; --branch names another. The CLI reads no gate policy and asks nobody to confirm.
// The refusals come first and touch nothing, with one accepted exception: loadGitConfigOrRefuse bootstraps
// .pairingbuddy/git-config.json when it is missing, since the branch refusals need its template and protected list.
// That file is under .pairingbuddy/, so it never makes the tree dirty. Then run/unit.json is claimed exclusively before
// the branch is made, and removed again if the switch fails, so no branch is left without its record.
function unitOpen(args) {
  const type = flagValue(args, "--type");
  const slug = flagValue(args, "--slug");
  const usage = "usage: pb unit open --type <type> --slug <slug> [--branch <name>] [--plan <plan.md>]";
  if (args.includes("--yes")) throw new UsageError(`--yes is no longer accepted: pb unit open has no confirm step. ${usage}`);
  if (!type || !slug) throw new UsageError(usage);
  const plan = args.includes("--plan") ? flagValue(args, "--plan") : null;
  if (plan !== null && (!plan || plan.startsWith("--"))) throw new UsageError(usage);
  const chosen = chosenBranch(args);
  const root = toplevel();
  if (existsSync(unitPathOf(root))) throw new Refusal("a unit is already open (run/unit.json exists); nothing was touched");
  const dirty = remainingFiles(root);
  if (dirty.length > 0) throw new Refusal(`the tree is dirty, so the unit cannot open. Commit or remove these, nothing was touched: ${dirty.join(", ")}`);
  const planned = plan === null ? null : steppedPlan(plan);
  if (planned && !planned.next) throw new Refusal(`the plan ${plan} has no task left, nothing was touched`);
  const gitConfig = loadGitConfigOrRefuse(root);
  const branch = chosen ?? renderBranchOrRefuse(gitConfig.branch_template, { type, slug });
  assertUsableBranch(root, gitConfig, branch);
  if (branchExists(root, branch)) throw new Refusal(`branch ${branch} already exists; choose another name`);
  const configHash = validatedConfigHash(root);
  const gitConfigHash = fileHash(gitConfigPath(root));
  const base = baseBranch(gitConfig, defaultBranchOf(root, gitConfig.remote));
  if (base === null) throw new Refusal("cannot tell the base branch");
  const git = (...a) => runGit(root, a);
  git("fetch", gitConfig.remote);
  const stackOn = planned ? stackOnOf(root, planned, gitConfig) : undefined;
  const parent = stackOn?.branch ?? base;
  const baseSha = git("rev-parse", `${gitConfig.remote}/${parent}`);
  ensureRunRoot(root);
  const unit = newUnit({ branch, base: parent, baseSha, configHash, gitConfigHash });
  if (stackOn) unit.stackedOn = withoutDepth(stackOn);
  if (planned) Object.assign(unit, { unit: planned.next.unit, plan: planned.context.plan, tracer: planned.next.tracer });
  writeJsonAtomic(unitPathOf(root), unit, { exclusive: true });
  try {
    git("switch", "-c", branch, baseSha);
  } catch (e) {
    rmSync(unitPathOf(root), { force: true });
    throw e;
  }
  return { ok: true, branch, base: parent, baseSha, doctor: doctorReport(root) };
}

// The stack rule's depth is for the rule's own cap; unit.json records only where the unit stacks.
function withoutDepth({ depth: _depth, ...stackedOn }) {
  return stackedOn;
}

const NOTHING_CHANGED_BUT_FETCH = "Nothing was changed but the fetch";

// What a unit refused for its stack depth tells the human; only the gh fetch has happened by then.
function stackStopMessage(stop) {
  return `unit "${stop.unit}" stops at ${stop.gate}, reason ${stop.reason}: it would stack at depth ${stop.depth}, past the cap ${stop.cap} (pr.stack_depth). ${NOTHING_CHANGED_BUT_FETCH}; it waits until a base merges`;
}

// Reads with gh the PRs on the next unit's Depends on chain and returns where the D18 rule stacks it (undefined means the base).
// Throws a Refusal when the rule refuses or stops.
function stackOnOf(root, { next, units }, gitConfig) {
  const prs = {};
  for (const dep of dependencyChainOf(units, next.unit)) if (dep.pr) prs[dep.pr] = prViewOf(root, dep, "so its state is unknown and the unit cannot open");
  let result;
  try {
    result = stackFor({ units, unit: next.unit, prs, stackDepth: gitConfig.pr?.stack_depth });
  } catch (e) {
    if (e instanceof StackRefused) throw new Refusal(`unit "${next.unit}" cannot open: ${e.message}. ${NOTHING_CHANGED_BUT_FETCH}`);
    throw e;
  }
  if (result.stop) throw new Refusal(stackStopMessage(result.stop));
  return result.stackOn;
}

// A dependency PR gh cannot show, or shows as non-JSON, leaves its state unknown, so the unit refuses; the caller says what that means for it.
function prViewOf(root, { unit, pr }, consequence) {
  try {
    return JSON.parse(gh(root, ["pr", "view", "--json", "state,headRefName", "--", pr]));
  } catch (e) {
    // A failed gh call's message carries its stderr; a parse error's carries what was wrong.
    throw new Refusal(`gh pr view could not show unit "${unit}"'s PR ${pr}, ${consequence}. ${NOTHING_CHANGED_BUT_FETCH}: ${e.message}`);
  }
}

const GH_UNAVAILABLE = "gh is unavailable: the git settings were not checked.";
const PROTECTION_UNREADABLE = "branch protection could not be read: the default branch was not checked.";
const GH_TIMEOUT_MS = 10000;

// A stalled gh is killed at the timeout, which throws and becomes the gh-unavailable note.
function gh(root, args) {
  return execFileSync("gh", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout: GH_TIMEOUT_MS, killSignal: "SIGKILL", env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  });
}

// Only the "Branch not protected" 404 means unprotected. Any other 404/403 (e.g. no admin rights) is unreadable.
// A failing gh api exits non-zero with the JSON body on stdout.
function protectionOf(root, repoPath, branch) {
  try {
    return JSON.parse(gh(root, ["api", `${repoPath}/branches/${branch}/protection`]));
  } catch (e) {
    const parsed = JSON.parse(e.stdout);
    if (parsed.message === "Branch not protected") return parsed;
    const isGithubError = typeof parsed.message === "string" || parsed.status === "404" || parsed.status === "403";
    if (isGithubError) return { unreadable: true };
    throw e;
  }
}

// Read-only gh calls. Never throws: any failure becomes the single gh-unavailable note.
function doctorReport(root) {
  try {
    const { nameWithOwner } = JSON.parse(gh(root, ["repo", "view", "--json", "nameWithOwner"]));
    const repoPath = `repos/${nameWithOwner}`;
    const repo = JSON.parse(gh(root, ["api", repoPath]));
    const protection = protectionOf(root, repoPath, repo.default_branch);
    const warnings = doctorWarnings({ repo, protection });
    return protection.unreadable ? { warnings, note: PROTECTION_UNREADABLE } : { warnings };
  } catch {
    return { warnings: [], note: GH_UNAVAILABLE };
  }
}

function gitDoctor() {
  return { ok: true, ...doctorReport(toplevel()) };
}

// The title is the one the tap filed in the draft artifact of the current pr-draft attempt, found through the ledger
// (the tap writes no separate title file).
function currentDraftTitle(root) {
  const { stage } = readLedger(ledgerPathOf(root));
  if (stage.name !== "pr-draft") throw new Refusal(`the current stage is ${stage.name || "none"}, not pr-draft, so there is no draft to lint`);
  return readDraft(root, stage).title;
}

// The draft artifact the tap filed for this attempt of pr-draft.
function readDraft(root, stage) {
  return refusing(() => readDraftArtifact(root, stage));
}

function prLint(args) {
  assertNoArgs(args, "pr lint");
  const root = toplevel();
  if (!existsSync(unitPathOf(root)) && !existsSync(refreshPathOf(root))) throw new Refusal("no unit is open (run/unit.json is missing), so there is no draft to lint");
  const title = currentDraftTitle(root);
  // Issue 1, by plan: a lint failure is recorded here (exit 0) and goes to the human at G:publish, not stopped here.
  return refusing(() => runPrLint(root, title));
}

// The shared lint and binding code throws its own refusals; the CLI reports them as its own.
function refusing(fn) {
  try {
    return fn();
  } catch (e) {
    if (isBindingRefusal(e)) throw new Refusal(e.message);
    throw e;
  }
}

function inRepoDocs(root) {
  try {
    const docs = JSON.parse(readFileSync(join(root, ".pairingbuddy", "doc-config.json"), "utf8")).in_repo_docs;
    return Array.isArray(docs) ? docs : [];
  } catch {
    return [];
  }
}

// All three files are written to temps first and only then renamed into place, so a failed write leaves the last snapshot whole.
function replaceFiles(files) {
  const temps = [];
  try {
    for (const [path, text] of files) {
      const temp = `${path}.${randomUUID()}.tmp`;
      temps.push(temp);
      writeFileSync(temp, text);
    }
  } catch (e) {
    for (const temp of temps) rmSync(temp, { force: true });
    throw e;
  }
  files.forEach(([path], i) => renameSync(temps[i], path));
}

const jsonText = (value) => JSON.stringify(value, null, 2) + "\n";

function snapshot(args) {
  const root = toplevel();
  const subject = readPrSubjectOrRefuse(root);
  assertNoArgs(args, "snapshot");
  const git = (argv) => runGit(root, argv, { trim: false, env: GIT_ENV });
  const diff = git(subjectDiffArgv(subject.baseSha));
  const changed = parseChanged(git(changedArgv(subject.baseSha)));
  const nearest = nearestFiles(parseTracked(git(trackedFilesArgv())), changed.map((c) => c.path));
  const paths = buildCorpus(insideRepo(root, [...inRepoDocs(root), ...conventionPaths(root), "CLAUDE.md", ...nearest]), (p) => existsSync(join(root, p)));
  const runDir = join(root, ".pairingbuddy", "run");
  replaceFiles([[join(runDir, SUBJECT_DIFF_FILE), diff], [join(runDir, CHANGED_FILE), jsonText(changed)], [join(runDir, CORPUS_FILE), jsonText({ paths })]]);
  const ledgerPath = ledgerPathOf(root);
  const ledger = existsSync(ledgerPath) ? readLedger(ledgerPath) : null;
  const taskType = ledger === null ? null : ledger.taskType;
  return { ok: true, paths, taskType, rolledBack: ledger === null ? 0 : rolledBackCount(ledger, ledger.stage.name) };
}

function insideRepo(root, candidates) {
  const realRoot = realpathSync(root);
  return candidates.map((c) => {
    try {
      const inside = repoRelative(realRoot, realpathSync(resolve(root, c)));
      return inside === null ? null : repoRelative(realRoot, resolve(realRoot, c)) ?? inside;
    } catch {
      return null;
    }
  }).filter((p) => p !== null);
}

function conventionPaths(root) {
  try {
    const config = readGitConfig(root);
    return [...(config.commit?.conventions ?? []), ...(config.pr?.conventions ?? [])];
  } catch {
    return [];
  }
}

const readArtifact = (root, key) => JSON.parse(readFileSync(join(artifactsDirOf(root), `${key}.json`), "utf8"));

// The paths a fix's artifact lists, checked and de-duplicated.
function pathsOfArtifact(root, key) {
  const artifact = readArtifact(root, key);
  return [...new Set(artifact.files_changed.map((listed) => checkedPath(root, listed)))];
}

// Where this stage's rollback refs live, under the unit's own ref prefix.
const rollbackPrefix = (branch, stage) => `${unitRefPrefix(branch)}rollback/${stage}/`;

// A pr-draft fix is undone for its failed lint: the failures, one `rule: text` each.
// It counts only when the lint failed and was run on this fix's own body; a lint of another body says nothing about this fix.
function failedLintAccount(root, key) {
  const lint = readLintResult(root);
  if (lint?.ok !== false || !Array.isArray(lint.failures)) return null;
  const body = String(readArtifact(root, key).body ?? "");
  if (lint.bodyHash !== sha256(body)) return null;
  return `The PR lint failed: ${lint.failures.map(({ rule, text }) => `${rule}: ${text}`).join("; ")}`;
}

// Whatever lint result is on disk, passed or failed, or null when there is none or it cannot be read.
function readLintResult(root) {
  try {
    return JSON.parse(readFileSync(prLintPath(root), "utf8"));
  } catch {
    return null;
  }
}

// The newest standing draft of this attempt other than the one being rolled back: the body the PR keeps after the rollback.
function remainingDraftBody(root, stage, key) {
  const newest = newestDraftKey(artifactsDirOf(root), stage, key);
  if (!newest) throw new Refusal(`no draft is left once ${key} is rolled back, so there is no PR body to restore and nothing was touched`);
  return String(readArtifact(root, newest.pbKey).body ?? "");
}

// Put a body back as the PR body, whole or not at all, like the tap writes it.
function writePrBody(root, body) {
  const path = prBodyPath(root);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, body);
  renameSync(temp, path);
}

// A rolled-back pr-draft fix also takes its body off the PR, so the newest draft left stands again.
// The body is read first, so a refusal leaves the artifact where it was.
function rollbackArtifactStep(root, key, parts, ledger, none) {
  const restored = parts.stage === "pr-draft" ? remainingDraftBody(root, ledger.stage, key) : null;
  rollbackArtifact(root, key);
  if (restored !== null) writePrBody(root, restored);
  return none;
}

// The account for a rolled-back artifact: the failed lint for a pr-draft fix, else the course checker's.
function artifactAccount(root, parts, key) {
  return (parts.stage === "pr-draft" && failedLintAccount(root, key)) || checkerAccount(root, parts);
}

// The course-checker's account of what went wrong, one entry per rollback, so the next attempt sees it.
function checkerAccount(root, parts) {
  const checkerKey = buildKey({ ...parts, role: "course-checker" });
  const verdict = readReturn(artifactsDirOf(root), checkerKey);
  if (verdict === null) throw new Refusal(`no course checker verdict for ${buildKey(parts)} (${checkerKey}), so nothing was touched`);
  if (verdict.verdict === "better") throw new Refusal(`the course checker said better for ${buildKey(parts)}: a better verdict keeps the commit, so nothing was touched`);
  return verdict.what_went_wrong;
}

// The tail of each failed run's output, like the refusal for a step that is not met.
const failedRunsExcerpts = ({ runs }) => runs.filter(({ exitCode }) => exitCode !== 0).map(({ excerpt }) => excerptTail(excerpt)).join("\n");

// The note's entry number: one sequence per stage within this task, for all three kinds of rollback.
// It is not the git ref number, which is the next free ref and can be higher because refs outlive the task.
// Counts this rollback too, so it is both the failed-attempt count and the note entry number.
const failedAttemptsOf = (ledger, stage) => rolledBackCount(ledger, stage) + 1;

// Add one entry to the stage's rollback notes, so the next attempt sees what went wrong.
function appendRollbackNote(root, stage, number, key, body) {
  const notes = notesDirOf(root);
  mkdirSync(notes, { recursive: true });
  appendFileSync(join(notes, `${stage}.md`), `${rollbackHeading(number, key)}\n\n${body}\n\n`);
}

// Record a rollback in the ledger, optionally dropping a commit that is no longer one of the run's commits.
// When `capReason` is given it becomes the run's stop in the same update, so the rollback and the stop land together.
// `restoredType` is only given for an intake rollback, where null clears the type; leave the key out to keep it as is.
function recordRollback(path, entry, { droppedSha, capReason, ...restored }) {
  updateLedger(path, (current) => ({
    ...current,
    ...("restoredType" in restored ? { taskType: restored.restoredType } : {}),
    commits: droppedSha ? current.commits.filter((c) => c !== droppedSha) : current.commits,
    fixes: { ...current.fixes, rollbacks: [...(current.fixes?.rollbacks ?? []), entry] },
    ...(capReason ? { stop: { reason: capReason, seq: current.seq + 1, code: ATTEMPT_CAP } } : {}),
  }));
}

// Undo a rejected artifact fix: no git, the artifact just moves aside to rejected/ and the note keeps the checker's account.
function rollbackArtifact(root, key) {
  const rejected = join(taskDirOf(root), "rejected");
  mkdirSync(rejected, { recursive: true });
  renameSync(join(artifactsDirOf(root), `${key}.json`), join(rejected, `${key}.json`));
}

// A fix's approach as its artifact states it.
function approachOf(root, key) {
  return String(readArtifact(root, key).approach ?? "");
}

// A fix repeats when its approach, normalized, equals one an earlier rolled-back fix of the same stage and item tried.
function repeatedApproach(root, ledger, key) {
  const { stage, item } = parseKey(key);
  const approach = approachOf(root, key);
  const target = normalizeApproach(approach);
  if (target === "") return null;
  const earlier = (ledger.fixes?.rollbacks ?? []).some((r) => {
    const p = parseKey(r.key);
    return p.stage === stage && p.item === item && normalizeApproach(approachOf(root, r.key)) === target;
  });
  return earlier ? approach : null;
}

// The ledger-and-disk reasons to refuse a rollback, checked before anything is touched so a refusal changes nothing.
function assertRollbackAllowed(key, parts, ledger, root) {
  if (parts.role !== "fix") throw new Refusal(`only a fix group rolls back: ${key} is from role ${parts.role}. RED, GREEN and refactor-step commits never do, so nothing was touched`);
  // A stop reverts nothing: while the run is stopped, no fix group is rolled back either.
  if (ledger.stop !== null) throw new Refusal(`the run has stopped, so nothing is rolled back: ${ledger.stop.reason}`);
  assertKeyIsCurrent(key, ledger.stage);
  // A group is undone once: a second rollback of the same key would undo nothing new.
  if (ledger.fixes?.rollbacks?.some((r) => r.key === key)) throw new Refusal(`${key} was already rolled back, so nothing was touched`);
  // Only the newest fix group of an attempt can be undone: an older one sits under a later group (a fix or its course checker).
  const artifactsDir = artifactsDirOf(root);
  const onDisk = existsSync(artifactsDir) ? returnsAt(artifactsDir, { name: parts.stage, attempt: parts.attempt }) : [];
  const recorded = (ledger.checkpoints ?? []).filter(({ key: k }) => isKey(k)).map(({ key: k }) => ({ pbKey: k, ...parseKey(k) }));
  const newer = [...recorded, ...onDisk].find((other) => other.stage === parts.stage && other.attempt === parts.attempt && other.round > parts.round);
  if (newer) throw new Refusal(`${key} is not the newest fix group: ${newer.pbKey} came after it, so nothing was touched`);
}

// The tree-side reasons to refuse a git rollback: the fix must be the newest commit (when committed), and nothing
// outside the group's own paths may be dirty (dirty is the tree's dirty paths, read once by the caller). record is the fix's checkpoint, or undefined for an uncommitted (red) fix,
// which also needs a failed test run and at least one of its listed paths changed. A repeated fix (repeated true) skips
// both checks, because the repeated approach is itself the reason to roll it back.
function assertTreeRollsBack(root, record, own, ledger, key, repeated, dirty) {
  if (record === undefined && !repeated) {
    // Uncommitted work is only undone after a failed (red) test run: without one there is nothing to roll back.
    if (ledger.tests.checkpoint?.passed !== false) throw new Refusal(`${key} has no commit and no red test run, so there is nothing to roll back and nothing was touched`);
    // A red fix that changed none of its listed paths has nothing to undo.
    if (!dirty.some((p) => own.includes(p))) throw new Refusal(`none of the paths ${key} lists has changed, so there is nothing to roll back and nothing was touched`);
  }
  // Only the newest commit can be undone cleanly: anything on top of the fix would be lost with it.
  if (record) {
    const head = headOf(root);
    if (record.sha !== head) throw new Refusal(`the fix commit ${record.sha} is not HEAD (${head}): only the newest commit rolls back, so nothing was touched`);
  }
  // Anything dirty outside the group's own paths is the human's work: refuse rather than touch it.
  const stray = dirty.filter((p) => !own.includes(p));
  if (stray.length) throw new Refusal(`the tree is dirty outside the fix group, so nothing was touched: ${stray.join(", ")}`);
}

// Undo a rejected fix group. Four kinds: an artifact fix, a committed fix (the ledger has a record), an uncommitted (red) one, or a repeated
// approach, which is record-only (no git work) when none of its own paths is dirty.
// The inputs are all read and every refusal is checked before anything moves, so a refusal or a missing checker artifact changes nothing.
function rollback(args) {
  const usage = "usage: pb rollback --from <key> | pb rollback --artifact --from <key>";
  const parsed = parseRollbackArgs(args);
  if (parsed === null) throw new UsageError(usage);
  const { artifactForm, key } = parsed;
  const root = toplevel();
  // Same guard as a commit: never undo work on a detached HEAD or a protected branch.
  const branch = currentBranch(root);
  assertBranchNotProtected(loadGitConfigOrRefuse(root), root, branch, "roll back");
  const { path } = runLedgerPath();
  const ledger = readLedger(path);
  const parts = parseKey(key);
  assertRollbackAllowed(key, parts, ledger, root);
  if (artifactForm && readReturn(artifactsDirOf(root), key) === null) throw new Refusal(`the fix artifact ${key} is missing, so there is nothing to set aside and nothing was touched`);
  // A recorded checkpoint means the fix was committed; otherwise it was only in the working tree (red).
  const record = artifactForm ? undefined : (ledger.checkpoints ?? []).find((c) => c.key === key);
  const repeated = artifactForm || record ? null : repeatedApproach(root, ledger, key);
  const kind = artifactForm ? "artifact" : record ? "commit" : repeated !== null ? "repeated" : "red";
  const own = kind === "artifact" ? [] : kind === "commit" ? pathsOfCommit(root, record.sha) : pathsOfArtifact(root, key);
  const dirty = artifactForm ? [] : remainingFiles(root);
  const ownChanged = dirty.some((p) => own.includes(p));
  if (!artifactForm) assertTreeRollsBack(root, record, own, ledger, key, repeated !== null, dirty);
  const failedAttempts = failedAttemptsOf(ledger, parts.stage);
  const prefix = rollbackPrefix(branch, parts.stage);
  // Per kind: the note's account of what went wrong, and how the work is undone (the ledger entry it leaves).
  // A committed fix's or an artifact's note holds the checker's account; a red fix's holds the failed test runs' output.
  const none = { ref: null, sha: null, base: null };
  const steps = {
    artifact: { wrong: () => artifactAccount(root, parts, key), undo: () => rollbackArtifactStep(root, key, parts, ledger, none) },
    commit: { wrong: () => checkerAccount(root, parts), undo: () => rollbackCommitted(root, { key, prefix, sha: record.sha }) },
    red: { wrong: () => failedRunsExcerpts(ledger.tests.checkpoint), undo: () => rollbackUncommitted(root, { key, prefix, paths: own }) },
    repeated: {
      wrong: () => `The fix repeated an approach already rolled back for this group: ${repeated}`,
      // Nothing of its own is dirty: record only, with the base at HEAD.
      undo: () => (ownChanged ? rollbackUncommitted(root, { key, prefix, paths: own }) : { ...none, base: headOf(root) }),
    },
  };
  const wrong = steps[kind].wrong();
  const done = steps[kind].undo();
  const entry = { key, kind, ref: done.ref, sha: done.sha, base: done.base };
  appendRollbackNote(root, parts.stage, failedAttempts, key, wrong);
  // The lenses contract test pins maxAttempts at 5, so it is always present here.
  const maxAttempts = LENS_MAP.maxAttempts;
  const stopped = failedAttempts >= maxAttempts;
  const capReason = stopped ? `${ATTEMPT_CAP}: stage ${parts.stage} rolled back ${failedAttempts} fix attempts, its cap of ${maxAttempts}` : null;
  const restored = parts.stage === "intake" ? { restoredType: keptTypeOf(root, parts.attempt) } : {};
  recordRollback(path, entry, { droppedSha: record?.sha, capReason, ...restored });
  if (stopped) writeReport(reportPathOf(root), buildReport(readLedger(path), artifactsDirOf(root)));
  return { ok: true, key, note: wrong, failedAttempts, maxAttempts, stopped };
}

function keptTypeOf(root, attempt) {
  return migratedType(loadStages(PLUGIN_ROOT), keptIntakeReturn(artifactsDirOf(root), attempt)?.content?.task_type);
}

export const VERBS = {
  rollback,
  snapshot,
  "unit open": unitOpen, "unit status": unitStatus, "git doctor": gitDoctor, "pr lint": prLint,
  "run open": runOpen, "pr refresh": prRefresh, "gate eval": gateEval, "human approve": humanApprove, "human abandon": humanAbandon, "human adopt": humanAdopt, "human approve-config": humanApproveConfig, "human accept": humanAccept, test: runTests, checkpoint,
  "plan next": planNext, "stage finish": stageFinish, "stage stop": stageStop, "tdd state": tddState, "refactor state": refactorState, "spike state": spikeState, "spike write": spikeWrite, "spike setup": spikeSetup, "stage fail": stageFail, "stage report": stageReport, "artifact check": artifactCheck, status, "task end": taskEnd, publish,
};

async function runVerb(name, args) {
  try {
    return await VERBS[name](args);
  } catch (e) {
    if (e instanceof LedgerShaMismatch) throw new Refusal(shaMismatchRemedy(e.message, findRunRoot(process.cwd())));
    throw e;
  }
}

async function main(argv) {
  const name = matchVerb(argv);
  if (!Object.hasOwn(VERBS, name)) {
    const known = Object.keys(VERBS).filter((verb) => !VERB_CLASSES.human.includes(verb));
    throw new UsageError(`unknown verb: ${argv.slice(0, 2).join(" ") || "(none)"}. Known: ${known.join(", ")}`);
  }
  console.log(JSON.stringify(await runVerb(name, argv.slice(name.split(" ").length))));
}

function isEntryPoint() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    await main(process.argv.slice(2));
  } catch (e) {
    const expected = e instanceof Refusal || e instanceof UsageError || e instanceof LedgerRefused || e instanceof TestRunRefused || e instanceof CheckpointRefused || e instanceof PlanRefused || e instanceof RollbackRefused;
    console.error(`pb: ${expected ? e.message : `unexpected failure: ${e.message}`}`);
    process.exit(e instanceof UsageError ? 2 : 1);
  }
}
