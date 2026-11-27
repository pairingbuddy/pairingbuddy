#!/usr/bin/env node
// pb: deterministic workflow CLI. Verbs live in the VERBS table; later tasks add more.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { REFACTOR_CODE_ROLE, REFACTOR_TESTS_ROLE, CheckpointRefused, isRetype, CheckpointStopped, CommitHookRefused, assertCurrentKey, assertKeyIsCurrent, branchOf, checkedPath, checkpointVerbSteps, commitPaths, diffOfCommit, fileAtCommit, headOf, isCheckpointCall, isKey, isOnHead, parseRollbackArgs, planCommit, remainingFiles, stepCommitType, stepRoles, stepRunsFor, taskTypesOfStep, typesByPaths, untrackedFiles, writesDiff } from "../shared-node/checkpoint.mjs";
import { repeatAfterPass, repeatingNode } from "../shared-node/repeat.mjs";
import { gateFacts } from "../shared-node/gate-facts.mjs";
import { baselineFailures, judgedRecord } from "../shared-node/baseline.mjs";
import { GO_ON_WAIT, PUBLISH_GATE, answeredGate, goOnQuestion, approvalRecord, askReason, autoPublishPasses, blockingGate, changedConfigs, defersDoubts, finalChecksDoubt, unitQuestionDoubts, dueGate, fileHash, fullQuestion, gateQuestion, gatesFor, isPassed, isBindingRefusal, currentBinding, defersScope, redoDraft, scopeDoubts, publishApproval, publishBinding, publishFacts, publishLint, publishVoidReason, questionDoubts, recordApproval, reopenedGate, statedTypeOf, typePassedOn, voidPublish } from "../shared-node/gates.mjs";
import { KINDS, LEDGER_VERSION, UNOWNED, isPublishRun, isRefreshRun, ownerAgeMs, seenRecently, LedgerRefused, LedgerShaMismatch, NoHandEdit, acceptLedger, readLedger, updateLedger, writeLedger } from "../shared-node/ledger.mjs";
import { GitConfigRefused, baseBranch, defaultBranchOf, gitConfigPath, isBranchProtected, loadGitConfig, protectedBranches, readGitConfig, validateGitConfig } from "../shared-node/gitconf.mjs";
import { doctorWarnings } from "../shared-node/git-doctor.mjs";
import { outsideGlobs } from "../shared-node/glob-match.mjs";
import { PlanRefused, boxesUnder, planFile, replaceFile, tickPlanBox, writePrLine } from "../shared-node/plan-boxes.mjs";
import { humanTasksLeft } from "../shared-node/plan-text.mjs";
import { KEPT_LOCAL_REASON, NO_COMMITS_REASON, PR_URL, branchShapeProblem, foreignPrReason, prCreateArgv, prEditArgv, prRefreshViewArgv, prViewArgv, publishSteps, pushArgv, recordedSuites, recordedTasks, refreshPrReason, targetBranch, untickedTasks, upstreamArgv, unitRefPrefix } from "../shared-node/publish.mjs";
import { UnitStatusRefused, unitStatus as baseStatusOf } from "../shared-node/unit-status.mjs";
import { remapCommits } from "../shared-node/rebase-map.mjs";
import { UnitRefused, newTaskRecord, newUnit, renderBranch } from "../shared-node/unit.mjs";
import { QuestionRefused, addQuestions, answeredQuestions } from "../shared-node/questions.mjs";
import { SPIKE_SETUP_FILE, UnitConfigRefused, abandonRun, acceptConfigInUnit, pinGitConfigInUnit, answerQuestionInUnit, clearQuestionsInUnit, settleQuestionInUnit, closeUnit, deferQuestionsInUnit, endRun, keepRun, KEPT_RUNS, keptAcceptedConfigHash, unitIsOpen } from "../shared-node/unit-files.mjs";
import { OUTPUT_MAX_BUFFER } from "../shared-node/output-buffer.mjs";
import { CHANGED_FILE, CORPUS_FILE, GIT_ENV, SUBJECT_DIFF_FILE, boundDiff, buildCorpus, changedArgv, namedFiles, nearestFiles, parseChanged, parseTracked, repoRelative, subjectDiffArgv, subjectStatArgv, trackedFilesArgv } from "../shared-node/snapshot.mjs";
import { RollbackRefused, pathsOfCommit, removeCreated, rollbackCommitted, rollbackUncommitted } from "../shared-node/rollback.mjs";
import { normalizeApproach } from "../shared-node/mistake-check.mjs";
import { parseFixNotes, rollbackHeading } from "../shared-node/fix-notes.mjs";
import { StackRefused, dependencyChainOf, stackFor } from "../shared-node/stack.mjs";
import { isHumanTitle, parsePlan, planStep, unitStates } from "../shared-node/plan.mjs";
import { shellWord } from "../shared-node/shell-word.mjs";
import { findRunRoot } from "../shared-node/run-root.mjs";
import { HUMAN_WAIT_FILE, humanLinesIn } from "../shared-node/human-wait.mjs";
import { KEY_TOKEN, buildKey, parseKey } from "../shared-node/keys.mjs";
import { nextAction, runStatus, statusText } from "../shared-node/next-action.mjs";
import { stageRun } from "../shared-node/plain-names.mjs";
import { needsTestSelection } from "../shared-node/stage-graph.mjs";
import { LENS_MAP, buildReport, rolledBackCount, closeStage, finishProblems, keptIntakeReturn, lensRecordOf, newestReturn, newestReturnMatching, perTestOf, readReportOf, readReturn, returnsAt, standingScenariosKey, unknownSpend, writeReport } from "../shared-node/stage-run.mjs";
import { FAILED_STATUS, REDO_STATUS, safetyNetStages, graphFor, isStageActive, isStageUnstarted, isVoidedAttempt, loadStages, nextAttempt, runTypeOf, nextStage } from "../shared-node/stages.mjs";
import { declaredRenames, splitId } from "../shared-node/test-renames.mjs";
import { ConfigHashChanged, TestRunRefused, collectedNoTest, cycleRun, failedRunsText, ranNoTest, fullSuitePlans, hasSelector, lintNote, meetsStep, readTestConfig, selectorAdvice, runPlan, runRecord, selectedPlans, testDirectoryOf, testPlan, testRows, validatedConfigHash } from "../shared-node/test-run.mjs";
import { missingLabels, missingLabelText } from "../shared-node/pr-labels.mjs";
import { ATTEMPT_CAP, COMMIT_FAILED, COMMIT_PLAN_UNUSABLE, MISSING_ARTIFACT, NO_SELECTOR_TEMPLATE, PR_LABEL_MISSING, RED_PASSES, STAGE_STOP_REASONS } from "../shared-node/stop-codes.mjs";
import { refusalSummary, runSummary } from "../shared-node/run-summary.mjs";
import { PrLintRunRefused, listRepoLabels, prBodyPath, prLintPath, newestDraftKey, readDraftArtifact, readPrSubject, readUnit, refreshBodyPathOf, refreshPathOf, runPrLint, sha256 } from "../shared-node/pr-lint-run.mjs";
import { PROPOSABLE, ProposalRefused, parsedValue, readProposals, valueAt, withValue, writeProposals } from "../shared-node/config-propose.mjs";
import { APPROVAL_GATE, CONFIG_GATE, CONFIG_WAIT_LINE, TYPED_FALLBACKS, approvalQuestion, configQuestion } from "../shared-node/config-wait.mjs";
import { VERB_CLASSES, ensureShim, humanCommand, matchVerb, pbCommand, shaMismatchRemedy, typedCommand } from "../shared-node/verbs.mjs";

export { KINDS };
const RUN_OPEN_KINDS = KINDS.filter((k) => k !== "refresh");

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

const FIX_ROLE = "fix";
const TESTS_ROLE = "create-test-placeholders";
const SCOPE_ROLE = "scope-refactoring";
const SCOPE_STAGE = "code-refactor-scope";
const SPIKE_UNIT_STAGE = "code-spike-unit";
const SPIKE_SETUP_PATH = `.pairingbuddy/run/task/${SPIKE_SETUP_FILE}`;
// A publish may be attempted twice: the first try and one retry.
const PUBLISH_ATTEMPTS = 2;

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
  const facts = unitPlan(root, unit);
  const unrecorded = recordedTasks({ unit, ...facts });
  if (unrecorded !== null) throw new Refusal(`${unrecorded}, so no publish run was opened. End each task with ${pbCommand("task end")} first`);
  const unticked = untickedTasks(facts);
  if (unticked !== null) throw new Refusal(`${unticked}, so no publish run was opened`);
}

// Claims run/task and writes the first ledger; a failed write removes the claim.
function claimRun({ root, kind, taskType, task, configHash, plan = { path: "", title: "" }, guidance = null }) {
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
      ...(guidance ? { guidance } : {}),
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

// The task type each branch type of pb unit open guesses. Intake decides the run's type later, but the guess is the only
// one there is before any agent runs.
const GUESSED_TYPES = { feat: "new_feature", fix: "bug_fix", chore: "config_change", refactor: "refactoring", spike: "spike" };

// A feature or a fix is built one test at a time, so a runner that cannot run one test would stop it at its first RED,
// after every stage before has spent its agents. It refuses here, before any of them, and says what to add.
function assertSelectorsFor(root, branchType) {
  const taskType = GUESSED_TYPES[branchType];
  if (taskType === undefined || !needsTestSelection(loadStages(PLUGIN_ROOT), taskType)) return;
  const advice = selectorAdvice(readTestConfig(root, validatedConfigHash(root)));
  if (advice !== null) throw new Refusal(`${advice}. No run was opened`);
}

function runOpen(args) {
  const kind = parseKind(args);
  const planPath = flagValue(args, "--plan");
  const hasPlan = args.includes("--plan");
  if (hasPlan && (kind !== "code" || planPath === undefined || planPath.startsWith("-"))) throw new UsageError("usage: pb run open --kind code [--plan <plan.md>]");
  const root = toplevel();
  assertNotStopped(root);
  if (kind === "publish") assertPublishable(root);
  const branch = currentBranch(root);
  const gitConfig = loadGitConfigOrRefuse(root); // bootstraps git-config.json when missing; hashed below
  assertBranchNotProtected(gitConfig, root, branch, "open a run", "; start the work on a unit branch with pb unit open");

  const configHash = validatedConfigHash(root);
  if (kind === "code") assertSelectorsFor(root, readOpenUnit(root)?.type);
  const taskType = kind === "publish" ? "publish" : null;
  const planned = hasPlan ? planTask(planPath) : null;
  const task = planned ? planned.task : storedTask(root);

  const curated = kind === "code" ? curatedGuidance(root) : null;
  const dir = claimRun({ root, kind, taskType, task, configHash, plan: planned?.plan, guidance: curated && { mode: curated.mode, kept: curated.kept, dropped: curated.dropped } });
  // A failed write is a disk error that leaves the run unnamed; `pb plan next` then reads its ticked box as hand-ticked
  // and stops, which is the safe side.
  if (planned?.namedUnit) writeJsonAtomic(unitPathOf(root), planned.namedUnit);
  if (curated) takeCurated(root, curated, task);
  if (kind === "publish") writeRepoLabels(dir);
  // The short pb a human's ! line names from here on.
  ensureShim(root);
  return { ok: true, kind, branch, runDir: dir };
}

// The labels the repo has, for the pull request draft to choose from (run/task/repo-labels.json, so it ends with the run;
// null when gh cannot list them). gh refuses a PR with a label the repo lacks, and only after the push, so the draft picks
// from these.
function writeRepoLabels(runDir) {
  writeJsonAtomic(join(runDir, "repo-labels.json"), { labels: listRepoLabels(runDir) });
}

// What the curating-guidance skill recorded on the open unit (pb guidance record) before this run opened, or null when there
// is no usable record. A bad record is ignored, never a refusal: the guidance itself is untouched.
function curatedGuidance(root) {
  try {
    const curated = JSON.parse(readFileSync(unitPathOf(root), "utf8"))?.curated;
    const count = (x) => Number.isInteger(x) && x >= 0;
    return (curated?.mode === "auto" || curated?.mode === "human") && count(curated.kept) && count(curated.dropped) ? curated : null;
  } catch {
    return null;
  }
}

// The run now holds the record, so the unit gives it up, and a doubt in it waits with the gates' doubts as a question for
// the human, so the run goes on. The next task's run never reads this one's record.
function takeCurated(root, curated, task) {
  const unit = JSON.parse(readFileSync(unitPathOf(root), "utf8"));
  const { curated: _taken, ...rest } = unit;
  const doubt = typeof curated.doubt === "string" ? curated.doubt.trim() : "";
  writeJsonAtomic(unitPathOf(root), doubt === "" ? rest : addQuestions(rest, { gate: "guidance", task, doubts: [{ step: "guidance carried over", ambiguity: doubt }] }));
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

// The unit's open questions, shown at G:publish as its doubts; none leaves the facts as they were. A refresh run has no
// unit record, so no questions.
function publishQuestions(root) {
  if (!unitIsOpen(root)) return {};
  const doubts = unitQuestionDoubts(root);
  const handled = (readUnit(root).questions ?? []).filter(({ answer }) => typeof answer === "string").map(({ task, ambiguity, answer }) => ({ task, ambiguity, answer }));
  return { ...(doubts.length === 0 ? {} : { doubts }), ...(handled.length === 0 ? {} : { handled }) };
}

// An auto pass that deferred the gate's doubts keeps them on its record: passed by the policy, not approved by a human.
function recordDeferred(ledger, gate, doubts) {
  return { ...ledger, gates: { ...ledger.gates, [gate]: { source: "auto", deferred: doubts } } };
}

// confidence: a G:type pass on a likely type keeps it, so the report says the type was not certain.
const TYPE_GATE = "G:type";

function recordAuto(ledger, gate, binding = {}, confidence = null, stated = null) {
  const record = gate === PUBLISH_GATE ? approvalRecord("auto", binding) : { source: "auto", ...(stated !== null ? { stated } : confidence === null ? {} : { confidence }) };
  return { ...ledger, gates: { ...ledger.gates, [gate]: record } };
}

// A file written whole or not at all, so a reader never sees half of it.
function writeWhole(path, text) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

// Takes no arguments: the gate comes from the ledger, and the policy from what the gate hook recorded.
function gateEval(args) {
  if (args.length > 0) throw new UsageError("usage: pb gate eval");
  const { root, path } = runLedgerPath();
  const current = readLedger(path);
  const { needsHuman } = current;
  if (needsHuman !== null) {
    const { gate, reason } = needsHuman;
    return { ok: true, result: "needs-human-command", gate, reason, humanCommand: Object.hasOwn(TYPED_FALLBACKS, gate) ? humanCommand(root, TYPED_FALLBACKS[gate]) : approveCommand(root, gate) };
  }
  const contract = loadStages(PLUGIN_ROOT);
  const answered = answeredGate(gatesFor(contract, current.taskType), current);
  if (answered !== undefined && answered.answer === "stop") return askGoOn(path, answered, root);
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
  let question;
  let full;
  let deferred = null;
  let stated = null;
  const fullAt = join(ensureRunRoot(root), "question.md");
  // One transaction: the void of a stale approval, the due gate and the question, so no state sits between them.
  updateLedger(path, (ledger) => {
    const open = voided === null ? ledger : voidPublish(ledger, voided);
    const due = dueGate(gatesFor(contract, open.taskType), open);
    if (due === undefined) throw new Refusal(noGateDue(open));
    gate = due.name;
    if (gate === PUBLISH_GATE && shown === null) throw new Refusal("the ledger changed while G:publish was being prepared; run pb gate eval again");
    reason = askReason(contract, open, due, root, voided);
    if (reason === null && gate === PUBLISH_GATE && autoBinding === undefined) throw new Refusal("the ledger changed while G:publish was being prepared; run pb gate eval again");
    if (reason === null && gate === TYPE_GATE) stated = statedTypeOf(contract, open);
    if (reason === null) return repeatedAfter(contract, recordAuto(open, gate, autoBinding, typePassedOn(root, open, gate), stated), gate, root);
    // Under auto with a unit open, doubts alone do not stop the run: they wait on the unit's questions for G:publish.
    const unitOpen = unitIsOpen(root);
    if (unitOpen && defersDoubts(contract, open, due, root, reason)) deferred = gateFacts(gate, root, open, contract).doubts ?? null;
    else if (unitOpen && defersScope(contract, open, due, root, reason)) deferred = scopeDoubts(root, open);
    if (deferred !== null) {
      reason = null;
      return repeatedAfter(contract, recordDeferred(open, gate, deferred), gate, root);
    }
    const facts = gate === PUBLISH_GATE ? { shown: { headSha: shown.headSha, base: shown.base, target: shown.target } } : {};
    // The facts go into the stored text, so the session cannot change or misreport what the human judges by.
    // The body is named by its file, the exact bytes that go out, since a real body does not fit the question box.
    const asked = gate === PUBLISH_GATE ? { title: shown.title, body: shown.body, bodyAt: resolve(prBodyPath(root)), ...gateFacts(gate, root, open, contract), ...publishQuestions(root) } : gateFacts(gate, root, open, contract);
    const shape = { reason, taskType: open.taskType, refresh: isRefreshRun(open), facts: asked };
    question = gateQuestion(gate, { ...shape, fullAt });
    full = fullQuestion(gate, shape);
    // The question folds long lists into the full question file; the ledger keeps the doubts in full for the report.
    const doubts = questionDoubts(reason, asked);
    // askedAt: the wait on the human starts here, and is no working time (the answer records when it ended).
    return { ...open, needsHuman: { gate, reason, seq: open.seq + 1, askedAt: new Date().toISOString(), question, ...facts, ...(doubts === null ? {} : { doubts }) } };
  });
  if (deferred !== null) {
    deferQuestionsInUnit(root, { gate, task: readLedger(path).task, doubts: deferred });
    return { ok: true, result: "auto-pass", gate, source: "auto", deferred: deferred.length };
  }
  if (reason === null) return { ok: true, result: "auto-pass", gate, source: "auto", ...(stated === null ? {} : { stated }), ...deferFinalChecks(root, gate, path, contract) };
  writeWhole(fullAt, full);
  const asked = { ok: true, result: "needs-human", gate, reason, question, humanCommand: approveCommand(root, gate) };
  return gate === PUBLISH_GATE ? { ...asked, shown } : asked;
}

// Under auto with a unit open, G:scenarios passing leaves its final checks on the unit's questions: they need a live, paid or
// manual run, which auto mode never starts and never waits for. Gives { finalChecks: n } when it left the question, else {}.
function deferFinalChecks(root, gate, path, contract) {
  if (gate !== "G:scenarios" || !unitIsOpen(root)) return {};
  const ledger = readLedger(path);
  const { finalChecks } = gateFacts(gate, root, ledger, contract);
  if (!Array.isArray(finalChecks) || finalChecks.length === 0) return {};
  deferQuestionsInUnit(root, { gate, task: ledger.task, doubts: [finalChecksDoubt(finalChecks)] });
  return { finalChecks: finalChecks.length };
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

// The human stopped the run at this gate: ask them in the session whether to go on, rather than send them to a ! line.
function askGoOn(path, { name }, root) {
  const question = goOnQuestion(name);
  let reason;
  updateLedger(path, (ledger) => {
    reason = ledger.stop?.reason ?? `the human answered stop at ${name}`;
    return { ...ledger, needsHuman: { gate: name, wait: GO_ON_WAIT, reason, seq: ledger.seq + 1, askedAt: new Date().toISOString(), question } };
  });
  return { ok: true, result: "needs-human", gate: name, reason, question, humanCommand: approveCommand(root, name) };
}

function answeredResult({ name, answer }, { stop }, root) {
  return { ok: true, result: "answered", gate: name, answer, reason: stop?.reason ?? `the human answered ${answer}`, humanCommand: approveCommand(root, name) };
}

function noGateDue(ledger) {
  const { name, status } = ledger.stage;
  return status === REDO_STATUS ? `no gate is due: the human answered redo, so ${name} starts again on ${stageRun(nextAttempt(ledger, name))}` : "no gate is due";
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
  if (gate === PUBLISH_GATE) clearQuestionsInUnit(root);
  return { ok: true, gate, source: "human-cli" };
}

// The spike runs pb kept under reports/runs, each with its ledger and the unit key ("<branch> <baseSha>") it ran in.
function keptSpikeRuns(root) {
  const runsDir = join(root, ".pairingbuddy", ...KEPT_RUNS);
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir).flatMap((runId) => {
    try {
      const kept = JSON.parse(readFileSync(join(runsDir, runId, "kept.json"), "utf8"));
      const ledger = readLedger(join(runsDir, runId, "ledger.json"));
      const [branch, baseSha] = String(kept.unit ?? "").split(" ");
      return ledger.taskType === "spike" && branch && baseSha ? [{ ledger, branch, baseSha }] : [];
    } catch {
      return [];
    }
  });
}

// The kept spike run of each ticked task, on the checked-out branch, for this plan, with all its commits on HEAD: what tells
// a tick pb made from a hand tick. Refuses, naming the first task it cannot vouch for.
function spikeRunsFor(root, plan, titles) {
  const branch = branchOf(root);
  const kept = keptSpikeRuns(root).filter((run) => run.branch === branch && posix.normalize(run.ledger.plan?.path ?? "") === posix.normalize(plan));
  return titles.map((title) => {
    const run = kept.find(({ ledger }) => ledger.plan.title === title);
    if (!run) throw new Refusal(`"${title}" has no spike run kept for branch ${branch}, so its tick cannot be told from a hand tick; nothing was touched`);
    const missing = run.ledger.commits.filter((sha) => !isOnHead(root, sha));
    if (missing.length > 0) throw new Refusal(`"${title}"'s commits are not on HEAD (${missing.join(", ")}); nothing was touched`);
    return run;
  });
}

// Whether pb human reopen would rebuild the unit: every ticked task without a record is a spike pb kept on this branch.
function reopenable(root, plan, titles) {
  try {
    return spikeRunsFor(root, relative(realpathSync(root), realpathSync(resolve(plan))), titles).length > 0;
  } catch {
    return false;
  }
}

// Every test any tests artifact of this task planned, newest attempt and round first, so a test a later artifact already dropped still has
// its selector. Unreadable files plan nothing.
function plannedRows(root) {
  const dir = artifactsDirOf(root);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((name) => /\.create-test-placeholders\..*\.json$/.test(name));
  const order = (name) => { const [, round, attempt] = name.match(/\.r(\d+)\.a(\d+)\.json$/) ?? [, 0, 0]; return Number(attempt) * 1000 + Number(round); };
  const byAge = files.sort((a, b) => order(b) - order(a)).map((name) => join(dir, name));
  return byAge.flatMap((file) => {
    try {
      const tests = JSON.parse(readFileSync(file, "utf8")).tests;
      return Array.isArray(tests) ? tests.filter((row) => typeof row?.test_id === "string") : [];
    } catch {
      return [];
    }
  });
}

// pb human cut-test <id>... --reason '<why>': the human takes tests off a code run's list, evidence and all, which nothing
// else may do (assertRowsKept refuses an artifact that drops one). Each cut keeps its reason and evidence shas in
// ledger.tests.cut, and becomes a final check: something a person still runs, which the report lists.
function humanCutTest(args) {
  const reasonAt = args.indexOf("--reason");
  const reason = reasonAt === -1 ? undefined : args[reasonAt + 1];
  const ids = reasonAt === -1 ? args : args.slice(0, reasonAt);
  if (ids.length === 0 || !reason?.trim() || reason.startsWith("--") || args.length !== ids.length + 2) throw new UsageError("usage: pb human cut-test <test_id>... --reason '<why>'");
  const { root, path } = runLedgerPath("no run here, so there is no test to cut");
  const ledger = readLedger(path);
  if (isPublishRun(ledger) || isRefreshRun(ledger)) throw new Refusal("this run publishes, so it has no tests to cut. Nothing was touched");
  const perTest = ledger.tests?.perTest ?? {};
  const planned = plannedRows(root);
  const known = new Set([...Object.keys(perTest), ...planned.map(({ test_id: id }) => id)]);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Refusal(`no test ${unknown.join(", ")} in this run (it has ${[...known].join(", ") || "none"}). Nothing was touched`);
  const at = new Date().toISOString();
  const selectorFor = (id) => perTest[id]?.selector ?? selectorOf(planned.find(({ test_id: rowId }) => rowId === id));
  const shas = (id) => ({ ...(perTest[id]?.red?.sha ? { red: perTest[id].red.sha } : {}), ...(perTest[id]?.green?.sha ? { green: perTest[id].green.sha } : {}) });
  const cuts = ids.map((id) => ({ id, reason: reason.trim(), at, selector: selectorFor(id), ...shas(id) }));
  updateLedger(path, (current) => {
    const kept = Object.fromEntries(Object.entries(current.tests?.perTest ?? {}).filter(([id]) => !ids.includes(id)));
    return { ...current, tests: { ...current.tests, perTest: kept, cut: [...(current.tests?.cut ?? []), ...cuts] } };
  });
  return { ok: true, cut: cuts.map(({ id }) => id), reason: reason.trim() };
}

// Rebuilds a plan unit that a spike closed while the unit still had tasks to run: its ticked tasks have no record, so pb plan
// next reads them as hand-ticked. Each such task must be a spike pb ran on the checked-out branch, kept under reports/runs,
// with all its commits on HEAD; then run/unit.json is written again with those records, as the unit had before the close.
function humanReopen(args) {
  const plan = flagValue(args, "--plan");
  if (!plan || plan.startsWith("--") || args.length !== 2) throw new UsageError("usage: pb human reopen --plan <plan.md>");
  const root = toplevel();
  if (existsSync(unitPathOf(root))) throw new Refusal("a unit is already open (run/unit.json exists); nothing was touched");
  if (existsSync(taskDirOf(root))) throw new Refusal("a task is in flight (run/task exists), so no unit can be reopened; nothing was touched");
  const { units, context } = readPlanContext(plan);
  const { stop } = planStep(units, context);
  if (stop?.reason !== "hand-ticked") throw new Refusal(`the plan has no unit with ticked tasks missing their record, so there is nothing to reopen; nothing was touched`);
  const unit = units.find((u) => u.unit === stop.unit);
  const branch = branchOf(root);
  const runs = spikeRunsFor(root, context.plan, stop.tasks);
  const baseShas = [...new Set(runs.map(({ baseSha }) => baseSha))];
  if (baseShas.length !== 1) throw new Refusal(`the kept runs name different bases (${baseShas.join(", ")}); nothing was touched`);
  const gitConfig = loadGitConfigOrRefuse(root);
  const base = baseBranch(gitConfig, defaultBranchOf(root, gitConfig.remote));
  if (base === null) throw new Refusal(unknownBaseMessage(root, gitConfig.remote));
  const record = { ...newUnit({ branch, base, baseSha: baseShas[0], configHash: validatedConfigHash(root), gitConfigHash: fileHash(gitConfigPath(root)) }), type: branch.split("/")[0] };
  Object.assign(record, {
    unit: unit.unit,
    plan: context.plan,
    tracer: unit.tracer,
    tasks: runs.map(({ ledger }) => newTaskRecord({ ledger, headSha: ledger.commits.at(-1) ?? baseShas[0], lessons: [] })),
    commits: runs.flatMap(({ ledger }) => ledger.commits),
  });
  ensureRunRoot(root);
  writeJsonAtomic(unitPathOf(root), record, { exclusive: true });
  return { ok: true, reopened: unit.unit, branch, base, baseSha: baseShas[0], tasks: stop.tasks };
}

// Leaves the unit: everything under run/ goes except run/.gitignore. Commits, branch and working tree are not touched.
function humanAbandon(args) {
  if (args.length > 0) throw new UsageError("usage: pb human abandon");
  const runDir = join(findRunRoot(process.cwd()) ?? toplevel(), ".pairingbuddy", "run");
  const names = abandonRun(runDir);
  if (names.length === 0) return { ok: true, result: "nothing-to-abandon", removed: [], message: "nothing to abandon: no unit or task is open" };
  return { ok: true, result: "abandoned", removed: names.map((name) => `.pairingbuddy/run/${name}`) };
}

const minutesSince = (lastSeen) => Math.floor(ownerAgeMs(lastSeen) / 60_000);

// Refuses when no run is open; a run with no owner has nothing to adopt, so that is an ok no-op.
function humanAdopt(args) {
  if (args.some((arg) => arg !== "--force")) throw new UsageError("usage: pb human adopt [--force]");
  const force = args.includes("--force");
  const { root, path } = runLedgerPath("no run is open: nothing to adopt");
  const { owner } = readLedger(path);
  if (owner?.sessionId == null) return { ok: true, adopted: false, message: "the run has no owner: nothing to adopt" };
  const minutesAgo = minutesSince(owner.lastSeen);
  if (!force && seenRecently(owner.lastSeen)) {
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
  updateLedger(path, (ledger) => ({ ...ledger, configApproval: { source: "human-cli" }, ...(ledger.needsHuman?.gate === APPROVAL_GATE ? { needsHuman: null } : {}) }));
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
// The open unit pins it too, so pb publish, which checks the unit's hash after this run has ended, sees the acceptance.
function acceptedConfig(root, path) {
  const configPath = join(root, ".pairingbuddy", "test-config.json");
  if (!existsSync(configPath) || fileHash(configPath) === readLedger(path).configHash) return null;
  const newHash = validatedConfigHash(root);
  let accepted;
  updateLedger(path, (ledger) => {
    accepted = { oldHash: ledger.configHash, newHash, seq: ledger.seq + 1 };
    return { ...ledger, configHash: newHash, configAcceptances: [...(ledger.configAcceptances ?? []), accepted] };
  });
  try {
    acceptConfigInUnit(root, accepted);
  } catch (e) {
    if (e instanceof UnitConfigRefused) throw new Refusal(e.message);
    throw e;
  }
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

// The wait a changed test-config raised is over once the human accepts, even when they put the file back as it was. Its
// time moves to gateWaits, so it stays waiting and never reads as work.
function answeredConfigWait(path) {
  if (readLedger(path).needsHuman?.gate !== CONFIG_GATE) return false;
  updateLedger(path, (ledger) => {
    if (ledger.needsHuman?.gate !== CONFIG_GATE) return ledger;
    const { askedAt } = ledger.needsHuman;
    const waits = typeof askedAt === "string" ? { gateWaits: [...(ledger.gateWaits ?? []), { gate: CONFIG_GATE, askedAt, answeredAt: new Date().toISOString() }] } : {};
    return { ...ledger, ...waits, needsHuman: null };
  });
  return true;
}

// The human's answer to question n of the unit's questions for you, typed or sent from /pb-questions. Only a person runs it:
// the gate refuses pb human from a model.
function humanAnswer(args) {
  const [number, ...words] = args;
  if (!/^\d+$/.test(number ?? "") || words.length === 0) throw new UsageError("usage: pb human answer <question number> <your answer>");
  const n = Number(number);
  try {
    const { open } = answerQuestionInUnit(toplevel(), n, words.join(" "));
    return { ok: true, n, open };
  } catch (e) {
    if (e instanceof QuestionRefused) throw new Refusal(`${e.message}. Nothing was recorded.`);
    throw e;
  }
}

// The session settles the human's answer to question n between tasks, as pb plan next asks: --rework adds a rework task
// to the plan, --keep only records it.
function questionSettle(args) {
  const [number, flag] = args;
  if (!/^\d+$/.test(number ?? "") || !["--rework", "--keep"].includes(flag) || args.length !== 2) throw new UsageError("usage: pb question settle <n> --rework | --keep");
  const root = toplevel();
  if (openRunOf(root) !== null) throw new Refusal("a task's run is open, so the answer waits: answers are settled between tasks, when pb plan next asks. Nothing was touched");
  const n = Number(number);
  try {
    return { ok: true, n, ...settleQuestionInUnit(root, n, flag.slice(2)) };
  } catch (e) {
    if (e instanceof QuestionRefused) throw new Refusal(`${e.message}. Nothing was touched`);
    throw e;
  }
}

// pb question add --text <words>: a doubt the session has, inside or between tasks. Under auto the session never asks the
// human itself: the doubt joins the open unit's questions (/pb-questions), the run keeps going, and the answer is weighed at
// the next task boundary like any other.
// The task a ledger runs, by its plan title, else the first line of its description.
const taskTitleOf = (ledger) => ledger.plan?.title || String(ledger.task?.description ?? ledger.task ?? "").split("\n")[0];

function questionAdd(args) {
  const usage = "usage: pb question add --text <words>";
  const at = args.indexOf("--text");
  const text = at === -1 ? "" : args.slice(at + 1).join(" ").trim();
  if (at !== 0 || text === "") throw new UsageError(usage);
  const root = toplevel();
  if (!existsSync(unitPathOf(root))) throw new Refusal("no unit is open, so there is no list of questions to add it to. Nothing was touched");
  const path = ledgerPathOf(root);
  const task = existsSync(path) ? taskTitleOf(readLedger(path)) : "between tasks";
  deferQuestionsInUnit(root, { gate: "session", task, doubts: [{ step: "the session", ambiguity: text }] });
  const unit = JSON.parse(readFileSync(unitPathOf(root), "utf8"));
  return { ok: true, added: true, open: (unit.questions?.length ?? 0) + (unit.questionsMore ?? 0) };
}

// The config file's own object with the change made, checked as pb checks the file when it loads it. Throws a Refusal.
function proposedFile(root, file, key, value) {
  const path = join(root, ".pairingbuddy", file);
  const own = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  try {
    const changed = withValue(own, key, value);
    if (file === "git-config.json") validateGitConfig(changed);
    else fullSuitePlans(changed, root);
    return changed;
  } catch (e) {
    if (e instanceof ProposalRefused || e instanceof GitConfigRefused || e instanceof TestRunRefused) throw new Refusal(`${e.message}. Nothing was proposed`);
    throw e;
  }
}

// pb config propose <file> <key> <value> --reason <words>: a change to a config file a run protects, kept pending until
// the human types pb human config apply. Nothing is written to the file here.
function configPropose(args) {
  const usage = "usage: pb config propose <test-config.json|git-config.json> <key> <value> --reason <words>";
  const [file, key, value, flag, ...reasonWords] = args;
  const reason = reasonWords.join(" ").trim();
  if (!PROPOSABLE.includes(file) || !key || value === undefined || flag !== "--reason" || reason === "") throw new UsageError(usage);
  const root = toplevel();
  if (!existsSync(join(root, ".pairingbuddy", "run"))) throw new Refusal(`no run or unit is open, so ${file} is not pinned: edit .pairingbuddy/${file} directly`);
  // git-config's old value is the one in force, a default included; test-config has no defaults.
  const current = file === "git-config.json" ? loadGitConfigOrRefuse(root) : JSON.parse(readFileSync(join(root, ".pairingbuddy", file), "utf8"));
  const proposed = parsedValue(value);
  proposedFile(root, file, key, proposed); // refuses a change the file would not accept
  const proposals = readProposals(root);
  const n = proposals.length + 1;
  const typed = (action) => humanCommand(root, `config ${action} ${n}`);
  // The lines and the time ride on the record, so the views show the wait and what to type while it stands.
  const proposal = { n, file, key, old: valueAt(current, key) ?? null, new: proposed, reason, status: "pending", at: new Date().toISOString(), lines: { apply: typed("apply"), refuse: typed("refuse") } };
  writeProposals(root, [...proposals, proposal]);
  return { ok: true, proposal, apply: typed("apply"), refuse: typed("refuse"), next: "Show the human the file, key, old and new value and the reason, with both lines, and wait for their answer" };
}

// pb human config apply|refuse <n>: the human's answer to proposal n. Apply writes the change and pins the new file in
// the open unit and run, so neither reads it as a change since they opened; refuse writes nothing.
function humanConfig(args) {
  const [action, number] = args;
  const n = Number(number);
  if (!["apply", "refuse"].includes(action) || !Number.isInteger(n) || args.length !== 2) throw new UsageError("usage: pb human config apply|refuse <n>");
  const root = toplevel();
  const proposals = readProposals(root);
  const proposal = proposals[n - 1];
  if (proposal === undefined) throw new Refusal(`there is no config proposal ${n}. Nothing was touched`);
  if (proposal.status !== "pending") throw new Refusal(`config proposal ${n} is already ${proposal.status}. Nothing was touched`);
  const at = new Date().toISOString();
  if (action === "refuse") return finishProposal(root, proposals, n, { status: "refused", at });
  const changed = proposedFile(root, proposal.file, proposal.key, proposal.new);
  const path = join(root, ".pairingbuddy", proposal.file);
  writeFileSync(path, `${JSON.stringify(changed, null, 2)}\n`);
  const pinned = proposal.file === "git-config.json" ? pinGitConfig(root, fileHash(path)) : pinTestConfig(root);
  return { ...finishProposal(root, proposals, n, { status: "applied", at }), ...pinned };
}

function finishProposal(root, proposals, n, outcome) {
  const done = proposals.map((proposal, i) => (i === n - 1 ? { ...proposal, ...outcome } : proposal));
  writeProposals(root, done);
  return { ok: true, proposal: done[n - 1] };
}

function pinGitConfig(root, newHash) {
  pinGitConfigInUnit(root, newHash);
  const path = ledgerPathOf(root);
  if (existsSync(path) && readLedger(path).gitConfigHash !== undefined) updateLedger(path, (ledger) => ({ ...ledger, gitConfigHash: newHash }));
  return { gitConfigHash: newHash };
}

// test-config goes the way a human's own edit of it goes: the run's ledger and the unit accept it.
function pinTestConfig(root) {
  const path = ledgerPathOf(root);
  if (existsSync(path)) return { config: acceptedConfig(root, path) };
  const newHash = validatedConfigHash(root);
  acceptConfigInUnit(root, { newHash, seq: 0 });
  return { config: { newHash } };
}

// pb final-check <id> --pass|--fail --note <words>: the result of a final check the session ran itself (a live, paid or manual
// run no test covers), kept on the run's ledger, newest last. A failed one is no doubt for the inbox: G:task-end asks the
// human while it stands, under auto too, and the report shows each result.
function finalCheck(args) {
  const usage = "usage: pb final-check <id> --pass|--fail --note <what happened>";
  const [id, verdict] = args;
  const at = args.indexOf("--note");
  const note = at === -1 ? "" : args.slice(at + 1).join(" ").trim();
  if (!id || id.startsWith("--") || !["--pass", "--fail"].includes(verdict) || at !== 2 || note === "") throw new UsageError(usage);
  const { path } = runLedgerPath("no run here, so there is no task to record a final check on");
  const check = { id, result: verdict.slice(2), note, at: new Date().toISOString() };
  updateLedger(path, (ledger) => ({ ...ledger, finalChecks: [...(ledger.finalChecks ?? []), check] }));
  return { ok: true, recorded: id, result: check.result };
}

// pb guidance record --mode auto|human --kept N --dropped M [--doubt <words>]: the curating-guidance skill's record of how it
// carried the guidance over, kept on the open unit until pb run open moves it onto the task's run.
function guidanceRecord(args) {
  const usage = "usage: pb guidance record --mode auto|human --kept <n> --dropped <n> [--doubt <words>]";
  const mode = flagValue(args, "--mode");
  const [kept, dropped] = ["--kept", "--dropped"].map((flag) => flagValue(args, flag));
  if (!["auto", "human"].includes(mode) || ![kept, dropped].every((n) => /^\d+$/.test(n ?? ""))) throw new UsageError(usage);
  const root = toplevel();
  // The doubt's words run to the next flag, so an unquoted question still arrives whole.
  const at = args.indexOf("--doubt");
  const after = at === -1 ? [] : args.slice(at + 1);
  const end = after.findIndex((arg) => arg.startsWith("--"));
  const words = end === -1 ? after : after.slice(0, end);
  const doubt = words.join(" ").trim();
  if (at !== -1 && doubt === "") throw new UsageError(usage);
  const curated = { mode, kept: Number(kept), dropped: Number(dropped), ...(doubt ? { doubt } : {}) };
  if (!existsSync(unitPathOf(root))) return { ok: true, recorded: false, reason: "no unit is open, so there is no run to report it on" };
  const unit = JSON.parse(readFileSync(unitPathOf(root), "utf8"));
  writeJsonAtomic(unitPathOf(root), { ...unit, curated });
  return { ok: true, recorded: true };
}

function humanAccept(args) {
  if (args.length > 0) return acceptLegacy(...legacyArgs(args));
  const { root, path } = runLedgerPath();
  const edit = acceptedEdit(path);
  const config = acceptedConfig(root, path);
  const answered = answeredConfigWait(path);
  if (edit === null && config === null && !answered) throw new Refusal(`nothing to accept: ledger ${path} has no sha mismatch, and test-config.json has not changed`);
  return { ok: true, ...edit, ...(config === null ? {} : { config }), ...(answered ? { answered: CONFIG_GATE } : {}) };
}

async function suiteRecord(plans, root, stage) {
  const runs = [];
  for (const plan of plans) runs.push(await runPlan(plan, root));
  return runRecord(plans, runs, stage);
}

// Which run: null for the selected tests, "full" for the full suite, "baseline" for the full suite before the task changed anything.
function runKind(args) {
  if (args.length === 0) return null;
  if (args.length === 1 && args[0] === "--full") return "full";
  if (args.length === 1 && args[0] === "--baseline") return "baseline";
  throw new UsageError("usage: pb test [--full | --baseline]");
}

function testPlans(kind, config, root, stage) {
  if (kind !== null) return { key: kind, plans: fullSuitePlans(config, root), selection: lintNote(config, root) };
  const { plans, testIds, attribution } = selectedPlans(config, join(root, ".pairingbuddy", "run", "task", "artifacts"), stage);
  return { key: "selected", plans, selection: { tests: testIds, attribution } };
}

// Takes no selector: a model must not choose what RED is recorded for. A run that happened exits 0 whatever the
// tests did, because exit 1 here means a refusal.
async function runTests(args) {
  const kind = runKind(args);
  const { root, path } = runLedgerPath();
  const { configHash, stage, tests } = readLedger(path);
  const { key, plans, selection } = testPlans(kind, readTestConfig(root, configHash), root, stage);
  const head = headOf(root);
  const run = { ...(await suiteRecord(plans, root, stage)), ...selection, head };
  const record = kind === "full" ? judgedRecord(run, tests?.baseline) : run;
  updateLedger(path, (ledger) => ({ ...ledger, tests: { ...ledger.tests, [key]: record } }));
  // The baseline says up front what already fails, a runner that could not start named broken, so it is seen once at task start.
  return { ok: true, key, ...record, ...(kind === "baseline" ? { alreadyFailing: baselineFailures(record) } : {}) };
}

function parseCheckpoint(args) {
  const [stepFlag, step, fromFlag, key] = args;
  if (args.length !== 4 || stepFlag !== "--step" || fromFlag !== "--from" || !isCheckpointCall(step, key)) {
    throw new UsageError(`usage: pb checkpoint --step ${checkpointVerbSteps().join("|")} --from <key>`);
  }
  return { step, key };
}

// A failed run is evidence, so it lands in the ledger before the refusal.
// Failures the task's baseline already had are excused (judgedRecord), so they never refuse a commit or roll a fix back.
async function requirePassingTests(root, path, { configHash, stage, tests }) {
  const plans = fullSuitePlans(readTestConfig(root, configHash), root);
  const record = judgedRecord(await suiteRecord(plans, root, stage), tests?.baseline);
  updateLedger(path, (ledger) => ({ ...ledger, tests: { ...ledger.tests, checkpoint: record } }));
  if (!record.passed) throw new Refusal(`the tests failed, so nothing was committed. ${cutTestsCause(root, { tests })}${failedRunsText(record.runs)}`);
}

// A cut test left in its file is the likeliest cause of a red suite no change of the step's own explains, so it comes first.
function cutTestsCause(root, ledger) {
  const present = cutTestsPresent(root, ledger);
  return present.length === 0 ? "" : `The likely cause is not this change: the human cut ${present.length === 1 ? "a test" : "tests"} whose code is still there, ${cutTestsText(present)}. `;
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

// A test that passes at RED before any code: no retry can change that, so the run stops at once and says what happened
// and what the human can do. Only a current key raises it, as in orStop.
function stopRedPasses({ step, key, path, root }, id, run) {
  const detail = `test ${id} already passes, before any code was written, so its RED proves nothing, and no retry can change that: what it checks is already there. Its run: ${runSummary(run.excerpt, run.exitCode)}.`;
  const options = [
    `Cut it, if the code already does what it checks: type ${humanCommand(root, `cut-test ${id} --reason '<why>'`)}, then tell the session to go on.`,
    "Keep it as a regression guard: tell the session to run it after a test that fails first, so it passes as covered.",
    "Or the test is wrong: tell the session what it should check, so it fails before the code.",
  ];
  updateLedger(path, (ledger) => {
    assertCurrentKey(step, key, ledger);
    return { ...ledger, stop: { reason: detail, seq: ledger.seq + 1, code: RED_PASSES, why: `${id} passed before any code`, detail, options, output: excerptTail(run.excerpt).trim() } };
  });
  throw new Refusal(`the run stopped: ${detail}`);
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

// A fix the commit hook refused is the fixer's mistake, as a red suite is: nothing stays staged, the change stays in the
// tree for pb rollback, and the run goes on.
function hookRefusalOfFix(root, path, key, commit) {
  try {
    return commit();
  } catch (e) {
    if (!(e instanceof CommitHookRefused)) throw e;
    execFileSync("git", ["reset", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    updateLedger(path, (ledger) => ({ ...ledger, fixes: { rollbacks: [], ...ledger.fixes, hookRefusals: [...(ledger.fixes?.hookRefusals ?? []), { key, output: e.output }] } }));
    throw new Refusal(`the commit hook refused the fix, so nothing was committed: ${e.output}`);
  }
}

// A fix whose return pb cannot commit from (an empty subject, say) is the fixer's mistake, as a hook refusal is: nothing
// stays staged, the change stays in the tree for pb rollback, and the fix loop retries with pb's words.
function returnRefusalOfFix({ root, path, key }, plan) {
  try {
    return plan();
  } catch (e) {
    if (!(e instanceof CheckpointRefused)) throw e;
    execFileSync("git", ["reset", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    updateLedger(path, (ledger) => ({ ...ledger, fixes: { rollbacks: [], ...ledger.fixes, hookRefusals: [...(ledger.fixes?.hookRefusals ?? []), { key, output: e.message, source: "return" }] } }));
    throw new Refusal(`the fix's return was refused, so nothing was committed: ${e.message}`);
  }
}

// The attempt can end while the tests run, so that is looked at again here.
function commitPlan({ step, key, root, path, branch, record }, plan, head, evidenceFor) {
  assertCommitAllowed(step, key, readLedger(path));
  const commit = () => (step === "fix" ? hookRefusalOfFix(root, path, key, () => commitPaths(root, { ...plan, branch, head })) : commitPaths(root, { ...plan, branch, head }));
  const { sha, hookRetried } = orStop(path, { step, key }, COMMIT_FAILED, commit);
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
  const plan = context.step === "fix" ? returnRefusalOfFix(context, () => planFor(context, scopeFor(context))) : planFor(context, scopeFor(context));
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
// Only the human may take a test with evidence off the list: the refusal names their pb human cut-test line, with every
// dropped id, so the session can show it.
function assertRowsKept(rows, { tests: { perTest = {} } }, root) {
  const finished = Object.entries(perTest).filter(([, { red, green }]) => red?.done || green?.done);
  const dropped = finished.map(([id]) => id).filter((id) => !rows.some(({ test_id: rowId }) => rowId === id));
  if (dropped.length > 0) {
    const line = humanCommand(root, `cut-test ${dropped.join(" ")} --reason '<why>'`);
    throw new Refusal(`${dropped.length === 1 ? `test ${dropped[0]} has` : `tests ${dropped.join(", ")} have`} evidence, and the tests artifact dropped ${dropped.length === 1 ? "it" : "them"}. Only the human can cut a test with evidence: they type ${line}`);
  }
  for (const [id, { selector }] of finished) {
    const row = rows.find(({ test_id: rowId }) => rowId === id);
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
  const rows = testRows(config, artifactsDirOf(root), ledger.stage, ledger.tests?.renamed);
  assertRowsKept(rows, ledger, root);
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

// The tests the human cut whose code is still in the working tree: a placeholder left behind fails the full suite later,
// where the fix that meets it is refused for a failure it did not cause. pb finds each by name in its file, as it does a
// test already there (isDefinedIn): a file or name that is gone selects nothing.
function cutTestsPresent(root, ledger) {
  const cuts = Array.isArray(ledger.tests?.cut) ? ledger.tests.cut : [];
  return cuts.filter(({ selector }) => {
    if (typeof selector?.test_file !== "string" || typeof selector?.test_function !== "string") return false;
    try {
      return isDefinedIn(readFileSync(join(root, selector.test_file), "utf8"), selector.test_function);
    } catch {
      return false;
    }
  });
}

// What a stage hands the agent that takes a cut test out: the test and where it is.
const cutTestRows = (root, ledger) => cutTestsPresent(root, ledger).map(({ id, selector }) => ({ id, test_file: selector.test_file, test_function: selector.test_function }));

const cutTestsText = (present) => present.map(({ id, selector }) => `test ${id} (${selector.test_function}) is still in ${selector.test_file}`).join("; ");

function assertCutTestsGone(root, ledger) {
  const present = cutTestsPresent(root, ledger);
  if (present.length > 0) throw new Refusal(`the human cut ${present.length === 1 ? "a test" : "tests"} whose code is still there: ${cutTestsText(present)}. Remove ${present.length === 1 ? "its" : "their"} code from the file, and nothing else, and list the file as changed: a placeholder left there fails the full suite later`);
}

// Every cut whose code is gone carries the commit that took it out, or null when it was never in the tree.
const withCutsRemoved = (root, sha) => (ledger) => {
  const present = new Set(cutTestsPresent(root, ledger).map(({ id }) => id));
  const at = new Date().toISOString();
  const cut = (ledger.tests?.cut ?? []).map((entry) => (present.has(entry.id) || entry.removed ? entry : { ...entry, removed: { sha: sha ?? null, at } }));
  return { ...ledger, tests: { ...ledger.tests, cut } };
};

// A cut test left in its file, taken out by a tests fixer: no test runs, since the full suite after it proves the rest.
function cutCheckpoint(context) {
  assertCutTestsGone(context.root, context.ledger);
  const config = readTestConfig(context.root, context.ledger.configHash);
  const plan = planFor(context, { testDirectories: Object.values(config.runners).map(({ test_directory: directory }) => directory) });
  if (plan === null) return noChange(context, withCutsRemoved(context.root, null));
  return commitPlan(context, plan, headOf(context.root), (sha) => withCutsRemoved(context.root, sha));
}

function placeholdersCheckpoint(context) {
  assertCutTestsGone(context.root, context.ledger);
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

const cutIdsOf = (ledger) => (Array.isArray(ledger.tests?.cut) ? ledger.tests.cut.map(({ id }) => id) : []);

// A test the human cut is off the list for good: the stage skips it, so a step that names it is pb's own bug.
const cutTestOf = (ledger, id) => (Array.isArray(ledger.tests?.cut) ? ledger.tests.cut.find((cut) => cut.id === id) : undefined);

function assertNotCut(ledger, id) {
  const cut = cutTestOf(ledger, id);
  if (cut !== undefined) throw new Refusal(`test ${id} was cut by the human (${cut.reason}), so it gets no step. The stage should have skipped it: this is a pb bug, so report it, and do not ask the human to cut it again`);
}

function selectedRow({ root, ledger }, config, id) {
  assertNotCut(ledger, id);
  const row = testRows(config, artifactsDirOf(root), ledger.stage, ledger.tests?.renamed).find(({ test_id: rowId }) => rowId === id);
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
const excerptTail = (excerpt, chars = EXCERPT_TAIL) => excerpt.slice(-chars);

const noTestCollected = (run) => (collectedNoTest(run) ? ", which is pytest collecting no test: its selector names none" : "");
const stepNotMet = (step, id, run) => `test ${id} is not ${step.toUpperCase()}: exit ${run.exitCode}${provesNothing(step, run.exitCode)}${noTestCollected(run)}, so nothing was committed. Its output:\n${excerptTail(run.excerpt)}`;

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
  const none = ranNoTest(test, run, row);
  if (none !== null) {
    recordCycleRun(context, row, { ...cycleRun(run, false), head });
    throw new Refusal(`test ${id} ran no test: ${none}, so nothing was committed. Check its test_function and test_file in the tests artifact against the test as written`);
  }
  const passed = meetsStep(step, test, run);
  const record = { ...cycleRun(run, passed), head };
  recordCycleRun(context, row, record);
  const after = passed ? null : coveredBy(step, run, ledger);
  if (after !== null) return coveredCheckpoint(context, plan, head, id, record, after);
  if (step === "red" && run.exitCode === 0) stopRedPasses(context, id, run);
  if (!passed) throw new Refusal(stepNotMet(step, id, run));
  if (step === "green") await requireEarlierTestsPass(context, config, id);
  if (plan === null) return noChange(context, withCycleDone(step, id));
  return commitPlan(context, plan, head, (sha) => withCycleDone(step, id, sha));
}

// What a cycle closed: RED and GREEN both done, or a covered pass. A row still at its placeholder fails by design.
const isClosedCycle = ({ red, green, covered }) => covered?.done === true || (red?.done === true && green?.done === true);

// Every test of the task a cycle closed, each by its own selector: the full suite would run the placeholders still
// waiting for their RED, which fail by design. A failed run is evidence, so it lands in the ledger before the refusal.
// key: where the run lands in ledger.tests (refactor, or closed for a GREEN's check of the earlier tests).
async function requireClosedTestsPass({ root, path, ledger }, config, rows, key = "refactor") {
  const closedRows = rows.filter(({ test_id: id }) => isClosedCycle(perTestOf(ledger, id)));
  if (closedRows.length === 0) return;
  const plans = closedRows.map((row) => testPlan(config, row));
  const head = headOf(root);
  const ran = { ...(await suiteRecord(plans, root, ledger.stage)), head };
  // A run that passed without running its test proves nothing: it counts as failed, and the refusal says why.
  const empty = ran.runs.map((run, i) => ranNoTest(plans[i], run, closedRows[i]));
  const record = empty.some((why) => why !== null) ? { ...ran, passed: false } : ran;
  updateLedger(path, (current) => ({ ...current, tests: { ...current.tests, [key]: record } }));
  const none = empty.map((why, i) => (why === null ? null : `test ${closedRows[i].test_id} (${closedRows[i].test_function} in ${closedRows[i].test_file}) ran no test: ${why}`)).filter(Boolean);
  if (!record.passed) throw new Refusal(`the tests failed, so nothing was committed. ${[failedRunsText(record.runs, closedRows), ...none].filter(Boolean).join("\n\n")}`);
}


// A GREEN must not break a test an earlier cycle closed: its own test passing says nothing of theirs. They run as a
// refactor's do, each by its own selector, and a failure names the test, so implement-code fixes it in its next try.
async function requireEarlierTestsPass(context, config, id) {
  const rows = testRows(config, artifactsDirOf(context.root), context.ledger.stage, context.ledger.tests?.renamed).filter(({ test_id: rowId }) => rowId !== id);
  try {
    await requireClosedTestsPass(context, config, rows, "closed");
  } catch (e) {
    if (e instanceof Refusal) throw new Refusal(`test ${id} passes, but its GREEN broke an earlier test of this task. ${e.message.replace(/^the tests failed, so /, "So ")}`);
    throw e;
  }
}

// One fix group of a cycle's refactor. It follows the cycle's GREEN, and every test the task has closed must still pass.
async function refactorCheckpoint(context) {
  const { key, root, ledger } = context;
  const { item: id, role } = parseKey(key);
  if (!perTestOf(ledger, id).green?.done) throw new Refusal(`test ${id} has no GREEN, so its cycle has nothing to refactor yet`);
  const config = readTestConfig(root, ledger.configHash);
  const declared = role === REFACTOR_TESTS_ROLE ? declaredRenames(readReturnOf(root, key)) : {};
  const unknown = Object.keys(declared).find((renamedId) => !isClosedCycle(perTestOf(ledger, renamedId)));
  if (unknown !== undefined) throw new Refusal(`the fix renames test ${unknown}, which is no closed test of this task, so nothing was committed. Only a test whose cycle closed can be renamed`);
  const renamed = { ...ledger.tests?.renamed, ...declared };
  const rows = testRows(config, artifactsDirOf(root), ledger.stage, renamed);
  const plan = planFor(context, { testDirectories: [...new Set(rows.map((row) => testDirectoryOf(config, row)))], role });
  if (plan === null) return noChange(context);
  const head = headOf(root);
  const withRenames = (current) => renamedLedger(current, declared, rows);
  try {
    await requireClosedTestsPass({ ...context, ledger: withRenames(ledger) }, config, rows);
  } catch (e) {
    if (e instanceof Refusal && role === REFACTOR_TESTS_ROLE) throw new Refusal(`${e.message}\n\n${UNDECLARED_RENAME}`);
    throw e;
  }
  return commitPlan(context, plan, head, () => withRenames);
}

// pb selects each test by the name it recorded, so a test the fix renamed selects nothing until the return says so.
const UNDECLARED_RENAME = "If this fix renamed or split a test, declare it in `renamed` in your return: the test_id and each new test_function (and test_file, when it moved), so pb selects it by its new name.";

// A fix's own return, which planCommit has already read and checked.
const readReturnOf = (root, key) => JSON.parse(readFileSync(join(artifactsDirOf(root), `${key}.json`), "utf8"));

// The ledger once a fix's renames hold: each renamed test keeps its evidence under its new selector, and each extra name
// of a split gets a copy of it, so the task's closed tests are still every test it closed.
function renamedLedger(ledger, declared, rows) {
  if (Object.keys(declared).length === 0) return ledger;
  const perTest = { ...ledger.tests?.perTest };
  for (const [id, to] of Object.entries(declared)) {
    const entry = perTest[id];
    for (const newId of to.map((_, n) => splitId(id, n))) perTest[newId] = { ...entry, selector: selectorOf(rows.find(({ test_id: rowId }) => rowId === newId)) };
  }
  return { ...ledger, tests: { ...ledger.tests, perTest, renamed: { ...ledger.tests?.renamed, ...declared } } };
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
  cut: cutCheckpoint,
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
  try {
    const done = await CHECKPOINT_FLOWS[step]({ step, key, root, path, ledger, branch });
    noteRefusal(path, step, key, null);
    return done;
  } catch (e) {
    if (e instanceof Refusal || e instanceof CheckpointRefused) noteRefusal(path, step, key, e.message);
    throw e;
  }
}

// How much of a refusal the stop keeps: enough to say what failed, bounded because the main context reads it.
const REFUSAL_TEXT = 600;
// The stage's newest checkpoint refusal, beside the ledger so a refusal still leaves the ledger alone.
const lastRefusalPath = (ledgerPath) => join(dirname(ledgerPath), "last-refusal.json");

function readLastRefusal(ledgerPath, { name, attempt }) {
  try {
    const last = JSON.parse(readFileSync(lastRefusalPath(ledgerPath), "utf8"));
    return last?.stage === name && last?.attempt === attempt ? last : undefined;
  } catch {
    return undefined;
  }
}

// Counted per step and item, or cleared by an accepted step. A key no longer current, or a run already stopped, notes
// nothing: the stop it would explain is someone else's.
function noteRefusal(path, step, key, text) {
  const ledger = readLedger(path);
  if (ledger.stop !== null || !isStageActive(ledger)) return;
  try {
    assertCurrentKey(step, key, ledger);
  } catch {
    return;
  }
  if (text === null) {
    rmSync(lastRefusalPath(path), { force: true });
    return;
  }
  const item = parseKey(key).item;
  const last = readLastRefusal(path, ledger.stage);
  const count = last?.step === step && last?.item === item ? last.count + 1 : 1;
  // The summary reads the whole text, since a run's failing tests come at the end of its output, past what text keeps.
  const record = { stage: ledger.stage.name, attempt: ledger.stage.attempt, step, item, count, text: text.slice(0, REFUSAL_TEXT), summary: refusalSummary(text) };
  writeFileSync(lastRefusalPath(path), `${JSON.stringify(record, null, 2)}\n`);
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
    const retype = configRetype(artifactsDir, ledger.stage);
    const closed = closeStage(ledger, "done", report.spend, retype === null ? {} : { retypedTo: retype });
    if (retype !== null) return { ...closed, taskType: retype };
    if (!safetyNetStages(contract).includes(name)) return closed;
    return { ...closed, lenses: { ...closed.lenses, "safety-net": lensRecordOf(ledger, report) } };
  });
  if (missing !== null) throw new Refusal(`${missing}. The run stopped: pb stage fail clears it`);
  return { ok: true, ...finished, report: reportPathOf(root) };
}

// The type a code-config return re-routed its task to, or null: a config step that found the task is no config change
// names the type it is, and the run goes on as that type.
function configRetype(artifactsDir, { name, attempt }) {
  if (name !== "code-config") return null;
  const type = readReturn(artifactsDir, buildKey({ stage: name, role: "apply-config-change", item: null, round: 1, attempt }))?.retype;
  return isRetype(type) ? type : null;
}

// A stage's script stops a run this way, because it has no shell of its own. The first stop stands: it says why.
function stageStop(args) {
  if (args.length !== 1 || !Object.hasOwn(STAGE_STOP_REASONS, args[0])) throw new UsageError(`usage: pb stage stop ${Object.keys(STAGE_STOP_REASONS).join("|")}`);
  const code = args[0];
  const reason = STAGE_STOP_REASONS[code];
  let stop;
  const { path } = runLedgerPath();
  updateLedger(path, (ledger) => {
    assertStageActive(ledger, "stop");
    stop = ledger.stop ?? { reason, seq: ledger.seq + 1, code, ...(code === "step-failed" ? stepFailedWhy(readLastRefusal(path, ledger.stage)) : {}) };
    return { ...ledger, stop };
  });
  return { ok: true, stop };
}

const STEP_NAMES = { red: "RED", green: "GREEN", refactor: "the refactor", placeholders: "the test list", fix: "the fix", cut: "taking out a cut test" };
const timesText = (count) => (count === 1 ? "once" : `${count} times`);

// What a step-failed stop can say from the CLI's own record: the step whose tries ran out and its last refusal. With no
// refusal recorded, the step's agent or runner never came back with anything the CLI could judge.
function stepFailedWhy(last) {
  const options = [
    "Read the refusal: it names what the step got wrong. Tell the session what to change, or that the step cannot be done as asked, and it reruns the stage, which keeps every test already done.",
  ];
  if (last === undefined) {
    return { why: "a step came back with nothing usable", detail: "An agent or a test runner of the stage came back with nothing the CLI could judge, on every try. Its transcript is in /pb-report.", options };
  }
  const stepName = STEP_NAMES[last.step] ?? last.step;
  const subject = last.item === null ? stepName : `${stepName} for ${last.item}`;
  const summary = typeof last.summary === "string" ? last.summary : refusalSummary(last.text);
  return { why: `${subject} was refused ${timesText(last.count)}`, detail: `${subject} was refused ${timesText(last.count)}, so the stage stopped. The last refusal: ${summary}`, options, output: last.text };
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
  const scenarios = standingScenariosKey(artifactsDir, ledger);
  if (scenarios === null) throw new Refusal("no scenarios return stands, so there is nothing to write tests from");
  return { ok: true, taskType: ledger.taskType, scenarios: artifactPath(scenarios), tests: artifactPath(newestReturn(artifactsDir, TESTS_ROLE)), red: doneAt(ledger.tests, "red"), green: doneAt(ledger.tests, "green"), covered: doneAt(ledger.tests, "covered"), cut: cutIdsOf(ledger), cutPresent: cutTestRows(root, ledger), testRunners: testRunnersOf(readTestConfig(root, ledger.configHash)) };
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
  updateLedger(path, (current) => {
    assertNotHumanStop(current, root);
    const ledger = current.stop === null ? current : withHumanCommits(root, current);
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

// A human may commit while the run is stopped, say to clear what stopped it. When the stop is cleared, those commits
// join the run's commits, marked as the human's, so the unit records them at task end. They are the commits on HEAD past
// the run's last commit, else past where the unit stood; with neither known nothing is adopted.
function withHumanCommits(root, ledger) {
  const start = ledger.commits.at(-1) ?? (unitIsOpen(root) ? (readUnit(root).tasks.at(-1)?.headSha ?? readUnit(root).baseSha) : null);
  if (!start) return ledger;
  const since = tryGit(root, ["rev-list", "--reverse", `${start}..HEAD`]);
  const adopted = (since ?? "").split("\n").filter((sha) => sha && !ledger.commits.includes(sha));
  if (adopted.length === 0) return ledger;
  return { ...ledger, commits: [...ledger.commits, ...adopted], humanCommits: [...(ledger.humanCommits ?? []), ...adopted] };
}

// A start the gate marked but no run took up: the human declined the Workflow prompt, or the call failed before it began.
// Its lease guards a run that may still be starting, and once the call has returned the tap would have recorded that
// run, so a start with no run is free to go at once. The stage stays active at its attempt, so it restarts there.
function stageRelease(args) {
  assertNoArgs(args, "stage release");
  const { path } = runLedgerPath();
  let released;
  updateLedger(path, (ledger) => {
    assertStageActive(ledger, "release");
    const { name, attempt, runId } = ledger.stage;
    if (!isStageUnstarted(ledger)) throw new Refusal(`stage ${name} has the recorded run ${runId}, so its start is no longer free to release`);
    released = { stage: name, attempt };
    return { ...ledger, stage: { ...ledger.stage, startedAt: null } };
  });
  return { ok: true, ...released };
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
// A human at a terminal reads plain lines (statusText); a pipe, as a model's Bash call is, and --json get the JSON.
const NO_RUN_ACTION = "No run is open: no run here, so go on to the workflow.";

// pb unit open refuses a dirty tree, and the session asks the human about guidance before it gets there. So with no unit
// open, the dirty files come first: the human is asked nothing only to be stopped after.
function noRunAnswer() {
  let root;
  try {
    root = toplevel();
  } catch {
    return { ok: true, run: null, action: NO_RUN_ACTION };
  }
  const dirty = existsSync(unitPathOf(root)) ? [] : remainingFiles(root);
  if (dirty.length === 0) return { ok: true, run: null, action: NO_RUN_ACTION };
  const action = `No run is open (no run here), but the tree is dirty, so pb unit open would refuse: ${dirty.join(", ")}. Show the human these files and ask them to commit or remove them before you ask the human anything else, then go no further.`;
  return { ok: true, run: null, dirty, action };
}

function hasRun() {
  const root = findRunRoot(process.cwd());
  return root !== null && existsSync(ledgerPathOf(root));
}

function status(args) {
  if (args.some((arg) => arg !== "--action" && arg !== "--json") || new Set(args).size !== args.length) throw new UsageError("usage: pb status [--action] [--json]");
  const withAction = args.includes("--action");
  // No run yet is a normal answer for the one asking what to do next, so it is no refusal, which a session shows as an error.
  if (withAction && !hasRun()) return noRunAnswer();
  const { root, path } = runLedgerPath();
  const contract = loadStages(PLUGIN_ROOT);
  const ledger = readLedger(path);
  const state = runStatus(contract, ledger, artifactsDirOf(root));
  const result = withAction ? { ok: true, ...state, action: nextAction(contract, ledger, root, PLUGIN_ROOT) } : { ok: true, ...state };
  if (args.includes("--json") || !process.stdout.isTTY) return result;
  return new PlainText(statusText(state, { owner: ledger.owner.sessionId, lastSeen: ledger.owner.lastSeen, action: result.action }));
}

// A verb's answer printed as it stands, not as JSON.
class PlainText {
  constructor(text) {
    this.text = text;
  }
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
    const ticked = `unit "${unit}" has ticked tasks with no task record: ${tasks.join(", ")}. A box ticked by hand earns nothing. Nothing was written`;
    // A spike that closed its unit early left these ticks: pb kept its runs, so the human can rebuild the unit from them.
    const message = reopenable(root, plan, tasks) ? `${ticked}. A spike pb ran closed this unit before its other tasks, and its runs are kept: the human types ${humanCommand(root, `reopen --plan ${shellWord(plan)}`)}` : ticked;
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
const SETTLE_WORDS = "The human answered questions set aside for them. Before the next task, settle each answer: run pb question settle <n> --rework when the answer means work already done must change (pb adds a rework task that runs next), else pb question settle <n> --keep (the answer already guides the steps from now on). Then run pb plan next again.";

// The human's answers the session has not settled yet, at a task boundary with a unit open: what pb plan next asks it to
// settle before the next task.
function answersToSettle(root) {
  if (!unitIsOpen(root)) return [];
  return answeredQuestions(readUnit(root)).map(({ n, task, ambiguity, answer }) => ({ n, task, question: ambiguity, answer }));
}

function planNext(args) {
  const paths = args.filter((a) => !a.startsWith("-"));
  const dryRun = args.includes("--dry-run");
  if (paths.length !== 1 || args.some((a) => a.startsWith("-") && a !== "--dry-run")) throw new UsageError("usage: pb plan next <plan.md> [--dry-run]");
  const [plan] = paths;
  if (!dryRun) {
    const { root, context, next, stop } = planStepOf(plan);
    const open = openRunOf(root);
    const openRun = open && { kind: open.kind, title: open.title };
    const answered = open ? [] : answersToSettle(root);
    if (answered.length > 0) return { ok: true, plan, next: null, answered, settle: SETTLE_WORDS };
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
  return { path, unit, record: newTaskRecord({ ledger, headSha, lessons }), commits: ledger.commits, humanCommits: ledger.humanCommits ?? [] };
}

// A retry after a crash finds its own record last, and appends nothing more.
function appendTaskRecord(opened) {
  if (opened === null) return;
  const { path, unit, record, commits, humanCommits } = opened;
  const last = unit.tasks.at(-1);
  if (last?.title === record.title && last?.headSha === record.headSha) return;
  unit.tasks.push(record);
  unit.commits = [...new Set([...unit.commits, ...commits])];
  if (humanCommits.length > 0) unit.humanCommits = [...new Set([...(unit.humanCommits ?? []), ...humanCommits])];
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
// With no question waiting, the refusal also sets the run waiting on the human's OK, which the session asks in the session.
function assertConfigChangeInGlobs(root, path, ledger, opened) {
  if (ledger.taskType !== "config_change") return;
  const globs = loadGitConfigOrRefuse(root).config_globs;
  if (globs.length === 0) {
    if (ledger.configApproval !== undefined) return;
    const typed = humanCommand(root, "approve-config");
    if (ledger.needsHuman === null) {
      updateLedger(path, (current) => (current.needsHuman !== null ? current : { ...current, needsHuman: { gate: APPROVAL_GATE, reason: "config_globs is empty, so this config_change needs the human's confirmation", seq: current.seq + 1, askedAt: new Date().toISOString(), question: approvalQuestion(), fix: `answer the question in the session, or type ${typed}` } }));
    }
    throw new Refusal(`config_globs is empty, so this config_change needs the human's confirmation. The task was not ended: run ${pbCommand("status --action")}, which gives the question that asks them. If it cannot be asked, they run pb human approve-config by typing ${typed}`);
  }
  const outside = outsideGlobs(globs, taskDiffFiles(root, ledger, opened));
  if (outside.length > 0) throw new Refusal(`this config_change touches files outside config_globs (${globs.join(", ")}). Nothing was touched: ${outside.join(", ")}`);
}

// Whether the plan unit holding this task still has unticked tasks after it was ticked: a spike there is one task of the
// unit, whose commits ride the unit's PR, so it does not close the unit. With no plan, or a plan with no unit around the
// task, the spike is a unit of its own.
function unitHasTasksLeft(root, { path, title }) {
  if (path === "") return false;
  const { units } = parsePlan(readFileSync(join(root, path), "utf8"));
  const unit = units.find(({ tasks }) => tasks.some((task) => task.title === title));
  return unit !== undefined && unit.tasks.some((task) => !task.checked);
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
  assertConfigChangeInGlobs(root, path, ledger, opened);
  const plan = tickedPlan(root, ledger.plan);
  const branch = opened?.unit.branch ?? branchOf(root);
  // Tests the human cut are left to a person: the end names them, with the human's reasons.
  const cut = (Array.isArray(ledger.tests?.cut) ? ledger.tests.cut : []).map(({ id, reason }) => ({ id, reason }));
  appendTaskRecord(opened);
  const dir = taskDirOf(root);
  keepRun(join(root, ".pairingbuddy", "run"));
  rmSync(dir, { recursive: true });
  if (ledger.taskType === "spike" && !unitHasTasksLeft(root, ledger.plan)) {
    closeUnit(join(root, ".pairingbuddy", "run"));
    // In a plan the close is expected: the loop goes on, and the next unit opens from its own base, never from the spike's.
    return { ok: true, removed: dir, plan, closed: "kept-local", reason: `a spike publishes nothing: the unit is closed and its commits stay on ${branch}`, ...(plan ? { continue: true } : {}) };
  }
  return { ok: true, removed: dir, plan, ...(cut.length > 0 ? { cut } : {}) };
}

// The commits past the unit's base, oldest first. One rule for "nothing to publish", in gate eval and in pb publish.
const unitCommits = (root, unit) => runGit(root, ["rev-list", "--reverse", `${unit.baseSha}..HEAD`]).split("\n").filter(Boolean);

// The labels of the plan boxes under the unit's heading, and planUnticked, the unticked [HUMAN] ones (pb task end ticks
// an agent box, a person ticks a human one). Both are null with no plan, no heading to go by, or no such heading;
// planProblem says when the plan cannot be read.
function unitPlan(root, unit) {
  if (typeof unit.plan !== "string" || unit.plan === "" || typeof unit.unit !== "string" || unit.unit === "") return { planBoxes: null, planUnticked: null, planProblem: null };
  try {
    const boxes = boxesUnder(readFileSync(join(root, unit.plan), "utf8"), unit.unit);
    return { planBoxes: boxes?.map(({ label }) => label) ?? null, planUnticked: boxes ? humanTasksLeft(boxes) : null, planProblem: null };
  } catch (e) {
    return { planBoxes: null, planUnticked: null, planProblem: `the plan ${unit.plan} cannot be read: ${e.code ?? e.message}` };
  }
}

// Null where git says no (or the remote is unreachable): the caller treats that as "nothing there".
function tryGit(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: OUTPUT_MAX_BUFFER }).trim();
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
  const remoteSha = usable ? (tryGit(root, ["ls-remote", "--", gitConfig.remote, `refs/heads/${unit.branch}`])?.split(/\s/)[0] || null) : null;
  return {
    safetyNets: safetyNetStages(loadStages(PLUGIN_ROOT)), ...unitPlan(root, unit), head, dirty: remainingFiles(root), branchProblem,
    branchIsProtected: usable && isProtected(gitConfig, root, unit.branch), currentBranch: branchOf(root),
    branchTip: usable ? tryGit(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${unit.branch}`]) : null,
    remoteSha, remoteRebased: remoteSha !== null && remoteIsRebasedCopy(root, unit, remoteSha, head),
  };
}

// HEAD's tree and the tree of each head a full suite was recorded at, so a suite on a reworded commit still counts.
function suiteTreesOf(root, facts) {
  if (facts.head === undefined) return {};
  const treeOf = (sha) => tryGit(root, ["rev-parse", "--verify", "--quiet", `${sha}^{tree}`]);
  return { headTree: treeOf(facts.head), suiteTrees: Object.fromEntries(recordedSuites(facts).map(({ head }) => [head, treeOf(head)])) };
}

// The remote branch holds an earlier copy of the unit from before a rebase: it is not behind HEAD, yet every commit only
// it has makes a change some unit commit makes. Then the push may replace it, leased on that tip. Work only the remote
// has, or a tip whose objects were never fetched, keeps the plain push, which git rejects.
function remoteIsRebasedCopy(root, unit, remoteSha, head) {
  if (tryGit(root, ["merge-base", "--is-ancestor", remoteSha, head]) !== null) return false;
  const onlyRemote = tryGit(root, ["rev-list", `${head}..${remoteSha}`]);
  if (onlyRemote === null) return false;
  const ours = new Set(unitCommits(root, unit).map((sha) => patchIdOf(root, sha)));
  return onlyRemote.split("\n").filter(Boolean).every((sha) => {
    const id = patchIdOf(root, sha);
    return id !== "" && ours.has(id);
  });
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
    unit, runStop: ledger.stop, publishMode: mode, coordination: bound?.draft.coordination ?? null, commits, changedConfigs: changedConfigs({ ...unit, acceptedConfigHash: keptAcceptedConfigHash(root, unit) }, root), approval: publishApproval(ledger), voidReason, lint: bound === null ? null : publishLint(root, bound.current.bodyHash),
    taskRunOpen: !isPublishRun(ledger), runSuite: ledger.tests?.full === undefined ? null : { passed: ledger.tests.full.passed, head: ledger.tests.full.head },
    ...(bound === null || mode === "none" ? {} : publishingFacts(root, unit, gitConfig, bound.current.headSha)),
  };
  Object.assign(facts, suiteTreesOf(root, facts));
  if (voidReason !== null) updateLedger(path, (current) => voidPublish(current, voidReason));
  const plan = publishSteps(facts);
  if (plan.refusals.length > 0) throw new Refusal(`not published: ${plan.refusals.join("; ")}`);
  // publishSteps only emits a push in a plan that also has open-pr, so open-pr alone marks a publishing plan.
  if (plan.steps.some((step) => step.do === "open-pr")) assertBaseCurrent(root, unit, gitConfig);
  const missing = missingDraftLabels(root, unit, gitConfig, plan.steps, bound);
  if (missing.length > 0) stopForMissingLabels(path, missing, "nothing was pushed or opened");
  try {
    return executePublish(plan.steps, { root, unit, gitConfig, ledger, bound });
  } catch (e) {
    if (e instanceof LabelRefused) stopForMissingLabels(path, missingLabels([e.label], listRepoLabels(root) ?? []), `${unit.branch} is pushed to ${gitConfig.remote}, but no PR was opened; the push will not repeat`);
    if (e instanceof Refusal) updateLedger(path, recordPublishFailure);
    throw e;
  }
}

// Refuses, before the push, a draft label the repo does not have: gh would refuse to open the PR after the push, and
// every retry with the same approved draft would fail the same way. Skipped when the PR is already recorded, when the
// draft has no labels, or when the repo's labels cannot be listed. An open PR on the branch (opened by hand) is adopted
// by the open-pr step whatever its labels, so it is not refused here either.
function missingDraftLabels(root, unit, gitConfig, steps, bound) {
  const open = steps.find((step) => step.do === "open-pr");
  const labels = bound?.draft.labels ?? [];
  if (open === undefined || open.recordedUrl !== null || labels.length === 0) return [];
  const missing = missingLabels(labels, listRepoLabels(root));
  if (missing.length === 0 || openPrOnBranch(root, unit.branch, targetBranch(gitConfig, unit))) return [];
  return missing;
}

// A missing label stops the run at once, with no publish attempt used: a retry with the same approved draft can only fail
// the same way. The approval is voided and the draft stage set to run again, so going on writes a draft with the repo's
// labels (the lint checks them) and asks the human again.
function stopForMissingLabels(path, missing, reached) {
  const named = missing.map(missingLabelText).join("; ");
  const detail = `the approved pull request draft asks for labels the repo does not have: ${named}. gh refuses to open a PR with them, so ${reached}, and retrying the same draft cannot work.`;
  const options = [
    "Tell the session to go on: it clears the stop, rewrites the pull request draft with labels the repo has, and asks you to approve it again.",
    `Or create the label in the repo first (gh label create ${missing[0].label}), then tell the session to go on.`,
  ];
  const why = `label ${missing.map(({ label }) => label).join(", ")} is not in the repo`;
  updateLedger(path, (ledger) => ({
    ...redoDraft(ledger, gatesFor(loadStages(PLUGIN_ROOT), ledger.taskType), `the draft's labels are not all in the repo: ${named}`),
    stop: { reason: detail, seq: ledger.seq + 1, code: PR_LABEL_MISSING, why, detail, options },
  }));
  throw new Refusal(`not published: ${detail} The run has stopped: tell the human what happened and what they can do: ${options.map((option, i) => `${i + 1}. ${option}`).join(" ")}`);
}

// Whether gh knows a PR from the unit branch into the target.
function openPrOnBranch(root, branch, target) {
  try {
    verifiedPr(viewPr(root, branch), branch, target);
    return true;
  } catch {
    return false;
  }
}

// The ledger with one more failed publish counted against the attempts.
function recordPublishFailure(ledger) {
  const used = (ledger.retries?.publish?.used ?? 0) + 1;
  const recorded = { ...ledger, retries: { ...ledger.retries, publish: { used, max: PUBLISH_ATTEMPTS } } };
  if (used < PUBLISH_ATTEMPTS) return recorded;
  const reason = `${ATTEMPT_CAP}: pb publish failed ${used} times, its cap of ${PUBLISH_ATTEMPTS} attempts`;
  return { ...recorded, stop: { reason, seq: ledger.seq + 1, code: ATTEMPT_CAP } };
}

// The human answered keep local at G:publish: nothing is pushed or opened, no unit or git state is read, and whatever the
// hook's own cleanup left (unit files, the publish run) goes. Idempotent, so a repeat after a failure finishes the job.
function finishKeptLocal(root, ledger) {
  if (ledger.stop !== null) throw new Refusal(`not published: the run stopped: ${ledger.stop.reason}`);
  const runDir = join(root, ".pairingbuddy", "run");
  if (isPublishRun(ledger)) keepRun(runDir);
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
      runGit(root, pushArgv(remote, step.sha, step.branch, step.leaseFrom), { context: "nothing was pushed or opened; the unit is intact" });
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
      if (isPublishRun(ctx.ledger)) keepRun(runDir, url === null ? {} : { prUrl: url });
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

// gh's refusal of a label the repo does not have: no retry with the same draft can open the PR.
class LabelRefused extends Refusal {
  constructor(message, label) {
    super(message);
    this.label = label;
  }
}

const REFUSED_LABEL = /could not add label: '([^']+)' not found/;

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
      const label = REFUSED_LABEL.exec(failure.message)?.[1];
      throw label === undefined ? failure : new LabelRefused(failure.message, label);
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
function run(cwd, command, args, { context = "", input, trim = true, env, maxBuffer = OUTPUT_MAX_BUFFER } = {}) {
  try {
    const out = execFileSync(command, args, { cwd, encoding: "utf8", input, env: env === undefined ? process.env : { ...process.env, ...env }, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], maxBuffer });
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

// Refuses a name that breaks the repo's branch convention (git-config branch_convention.pattern), saying what it expects.
function assertFollowsConvention(gitConfig, branch) {
  const convention = gitConfig.branch_convention;
  if (typeof convention?.pattern !== "string") return;
  let pattern;
  try {
    pattern = new RegExp(convention.pattern);
  } catch {
    throw new Refusal(`branch_convention.pattern is not a valid regular expression: ${convention.pattern}. Nothing was touched: fix it in .pairingbuddy/git-config.json`);
  }
  if (pattern.test(branch)) return;
  const expects = typeof convention.description === "string" ? `: ${convention.description}` : "";
  const examples = Array.isArray(convention.examples) && convention.examples.length ? ` (for example ${convention.examples.join(", ")})` : "";
  throw new Refusal(`branch ${branch} does not follow this repo's branch convention${expects}${examples}. Nothing was touched: name the branch by the convention and pass it with --branch <name>`);
}

// Refuses a protected branch name, one that breaks the repo's convention, and one git itself rejects, before anything changes.
function assertUsableBranch(root, gitConfig, branch) {
  if (isProtected(gitConfig, root, branch)) throw new Refusal(`branch ${branch} is protected; choose another name`);
  assertFollowsConvention(gitConfig, branch);
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
  const result = rebasedWhenItCan(root, unit, gitConfig, baseStatusFor(root, unit, gitConfig));
  refuseRebaseNeeded(unit, result);
  if (result.status === "current") {
    const adopted = adoptHumanCommits(root, unit);
    return { ok: true, status: "current", base: unit.base, baseSha: unit.baseSha, ...(adopted.length > 0 && { adopted }) };
  }
  const hasTasks = unit.tasks.length > 0;
  const { unit: unitAfterRemap, adopted } = hasTasks ? remappedUnit(root, unit, result) : { unit, adopted: [] };
  const suite = hasTasks ? await rebaseSuiteOf(root, unit) : null;
  const rebaseSuite = suite === null ? {} : { rebaseSuite: suite.rebaseSuite };
  writeJsonAtomic(unitPathOf(root), { ...reconciledUnit(unitAfterRemap, result), ...rebaseSuite });
  // The failed run is evidence, so it lands in the unit before the refusal.
  if (suite !== null && !suite.rebaseSuite.passed) {
    throw new Refusal(`the full suite failed at HEAD ${suite.rebaseSuite.head.slice(0, 7)} after the rebase: exit codes ${suite.exitCodes.join(", ")}. pb publish refuses until a full suite passes at HEAD; a new task in the unit can fix it`);
  }
  return { ok: true, status: "reconciled", base: result.base, baseSha: result.baseSha, unstack: result.unstack, ...rebaseSuite, ...(adopted.length > 0 && { adopted }) };
}

// With no run open, the commits past the base the unit has not recorded were made by a human between runs: they join the
// unit's commits, in order, and are marked in humanCommits. A run's own commits join at task end, so a run open adopts nothing.
function adoptHumanCommits(root, unit) {
  if (openRunOf(root) !== null) return [];
  const adopted = runGit(root, ["rev-list", "--reverse", `${unit.baseSha}..HEAD`], { context: "nothing was written" }).split("\n").filter((sha) => sha && !unit.commits.includes(sha));
  if (adopted.length > 0) writeJsonAtomic(unitPathOf(root), { ...unit, commits: [...unit.commits, ...adopted], humanCommits: [...(unit.humanCommits ?? []), ...adopted] });
  return adopted;
}

// Rebases the open unit's branch onto its moved base, then reconciles as pb unit status does. Refused while a run is open,
// on a dirty tree, or off the unit's branch; a rebase that stops on a conflict is aborted, so the branch is as it was.
// Pushing the rebased branch, when it was pushed before, stays the human's.
async function unitRebase() {
  const root = toplevel();
  const unit = readUnitOrRefuse(root);
  const open = openRunOf(root);
  if (open !== null) throw new Refusal(`a ${open.kind} run is open, so the unit's branch stays where it is. Nothing was touched: finish the run first`);
  const branch = currentBranch(root);
  if (branch !== unit.branch) throw new Refusal(`HEAD is on ${branch ?? "a detached HEAD"}, not the unit's branch ${unit.branch}. Nothing was touched`);
  const dirty = remainingFiles(root);
  if (dirty.length > 0) throw new Refusal(`the tree is dirty, so nothing was rebased. Commit or remove these first: ${dirty.join(", ")}`);
  const gitConfig = loadGitConfigOrRefuse(root);
  const result = baseStatusFor(root, unit, gitConfig);
  if (result.status === "moved" || result.status === "merged") rebaseOntoBase(root, unit, gitConfig, result);
  return unitStatus();
}

// A moved or merged base is rebased onto at once when nothing stands in the way: no run open, HEAD on the unit's branch
// and a clean tree. Teams merge to the base all the time, so this is routine, not a human step. Otherwise the result
// passes through and pb unit status refuses with the recipe.
function rebasedWhenItCan(root, unit, gitConfig, result) {
  if (result.status !== "moved" && result.status !== "merged") return result;
  if (openRunOf(root) !== null || currentBranch(root) !== unit.branch || remainingFiles(root).length > 0) return result;
  rebaseOntoBase(root, unit, gitConfig, result);
  return baseStatusFor(root, unit, gitConfig);
}

// git rebase --onto the base's remote tip. A rebase that stops on a conflict is aborted, so the branch is as it was, and
// the refusal names the conflicting files.
function rebaseOntoBase(root, unit, gitConfig, result) {
  const rebase = spawnSync("git", ["rebase", "--onto", `${gitConfig.remote}/${result.base}`, result.from, unit.branch], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (rebase.status === 0) return;
  const conflicts = (tryGit(root, ["diff", "--name-only", "--diff-filter=U"]) ?? "").split("\n").filter(Boolean);
  spawnSync("git", ["rebase", "--abort"], { cwd: root, stdio: "ignore" });
  const where = conflicts.length > 0 ? `these files conflict: ${conflicts.join(", ")}` : (rebase.stderr || rebase.stdout).trim().split("\n").at(-1);
  throw new Refusal(`the rebase of ${unit.branch} onto ${gitConfig.remote}/${result.base} stopped on a conflict, so it was aborted and the branch is as it was. A human resolves it, ${where}`);
}

// The patch-id of a commit's change. run reads the diff with the shared output limit, past the default 1 MB.
function patchIdOf(root, sha) {
  const context = "nothing was written";
  const diff = runGit(root, ["diff-tree", "-p", "--root", sha], { trim: false, context });
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

// The unit's commits and task head shas moved onto the rebased range; a mapping that cannot be made is a refusal. A range
// commit no recorded one matched was made by a human between runs: it is adopted into commits and marked in humanCommits.
function remappedUnit(root, unit, result) {
  const gitLines = (args) => runGit(root, args, { context: "nothing was written" }).split("\n").filter(Boolean);
  const range = `${result.baseSha}..HEAD`;
  const rangeCommits = gitLines(["rev-list", "--reverse", range]).map((sha) => ({ sha, patchId: patchIdOf(root, sha) }));
  const merges = gitLines(["rev-list", "--merges", range]);
  const recorded = unit.commits.map((sha) => ({ sha, patchId: patchIdOf(root, sha) }));
  const { mapping, adopted } = refusingAs(() => remapCommits({ recorded, range: rangeCommits, merges }));
  const remap = (sha) => mapping[sha] ?? (sha === unit.baseSha ? result.baseSha : sha);
  const humanCommits = [...(unit.humanCommits ?? []).map(remap), ...adopted];
  const remapped = { ...unit, commits: [...unit.commits.map(remap), ...adopted], tasks: unit.tasks.map((task) => ({ ...task, headSha: remap(task.headSha) })) };
  return { unit: humanCommits.length === 0 ? remapped : { ...remapped, humanCommits }, adopted };
}

// The full suite at the rebased HEAD, recorded as passed and the head it ran at.
async function rebaseSuiteOf(root, unit) {
  const plans = fullSuitePlans(readTestConfig(root, unit.configHash), root);
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
    throw new Refusal(`${lead}. ${NOTHING_CHANGED_BUT_FETCH}. Next:\n${result.recipe}`);
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
  // The branch already checked out, cut from the base with no commits of its own (a worktree made for this work), is adopted.
  const adopting = branchExists(root, branch) && currentBranch(root) === branch;
  if (branchExists(root, branch) && !adopting) throw new Refusal(`branch ${branch} already exists; choose another name`);
  const configHash = validatedConfigHash(root);
  const gitConfigHash = fileHash(gitConfigPath(root));
  const base = baseBranch(gitConfig, defaultBranchOf(root, gitConfig.remote));
  if (base === null) throw new Refusal(unknownBaseMessage(root, gitConfig.remote));
  const git = (...a) => runGit(root, a);
  git("fetch", gitConfig.remote);
  const stackOn = planned ? stackOnOf(root, planned, gitConfig) : undefined;
  const parent = stackOn?.branch ?? base;
  const baseSha = git("rev-parse", `${gitConfig.remote}/${parent}`);
  if (adopting && git("rev-list", `${baseSha}..HEAD`) !== "") throw new Refusal(`branch ${branch} already exists and has commits of its own; choose another name. ${NOTHING_CHANGED_BUT_FETCH}`);
  ensureRunRoot(root);
  const unit = { ...newUnit({ branch, base: parent, baseSha, configHash, gitConfigHash }), type };
  if (stackOn) unit.stackedOn = withoutDepth(stackOn);
  if (planned) Object.assign(unit, { unit: planned.next.unit, plan: planned.context.plan, tracer: planned.next.tracer });
  writeJsonAtomic(unitPathOf(root), unit, { exclusive: true });
  try {
    if (adopting) git("merge", "--ff-only", "-q", baseSha);
    else git("switch", "-c", branch, baseSha);
  } catch (e) {
    rmSync(unitPathOf(root), { force: true });
    throw e;
  }
  return { ok: true, branch, base: parent, baseSha, doctor: doctorReport(root) };
}

// Names both places the base is looked for, and the two fixes: the setting, or the `!` line that sets <remote>/HEAD.
function unknownBaseMessage(root, remote) {
  return `cannot tell the base branch: .pairingbuddy/git-config.json sets no pr.base_branch, and ${remote}/HEAD is not set. Nothing was touched. Set pr.base_branch there to the branch PRs go to, or let git learn ${remote}'s default branch. The human types:\n!git -C ${shellWord(root)} remote set-head ${shellWord(remote)} --auto`;
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
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: OUTPUT_MAX_BUFFER,
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
function currentDraft(root) {
  const { stage } = readLedger(ledgerPathOf(root));
  if (stage.name !== "pr-draft") throw new Refusal(`the current stage is ${stage.name || "none"}, not pr-draft, so there is no draft to lint`);
  return readDraft(root, stage);
}

// The draft artifact the tap filed for this attempt of pr-draft.
function readDraft(root, stage) {
  return refusing(() => readDraftArtifact(root, stage));
}

function prLint(args) {
  assertNoArgs(args, "pr lint");
  const root = toplevel();
  if (!existsSync(unitPathOf(root)) && !existsSync(refreshPathOf(root))) throw new Refusal("no unit is open (run/unit.json is missing), so there is no draft to lint");
  const { title, labels } = currentDraft(root);
  // Issue 1, by plan: a lint failure is recorded here (exit 0) and goes to the human at G:publish, not stopped here.
  return refusing(() => runPrLint(root, title, labels ?? []));
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
  const diff = boundDiff(git(subjectDiffArgv(subject.baseSha)), git(subjectStatArgv(subject.baseSha)), subject.baseSha);
  const changed = parseChanged(git(changedArgv(subject.baseSha)));
  const ledgerPath = ledgerPathOf(root);
  const ledger = existsSync(ledgerPath) ? readLedger(ledgerPath) : null;
  const tracked = parseTracked(git(trackedFilesArgv()));
  const nearest = nearestFiles(tracked, changed.map((c) => c.path));
  const named = namedFiles(tracked, ledger?.task);
  const paths = buildCorpus(insideRepo(root, [...inRepoDocs(root), ...conventionPaths(root), "CLAUDE.md", ...named, ...nearest]), (p) => existsSync(join(root, p)));
  const runDir = join(root, ".pairingbuddy", "run");
  replaceFiles([[join(runDir, SUBJECT_DIFF_FILE), diff], [join(runDir, CHANGED_FILE), jsonText(changed)], [join(runDir, CORPUS_FILE), jsonText({ paths })]]);
  if (ledger !== null && ledger.stage.name !== "") recordUntrackedAtStart(ledgerPath, root, ledger.stage);
  const taskType = ledger === null ? null : ledger.taskType;
  return { ok: true, paths, taskType, rolledBack: ledger === null ? 0 : rolledBackCount(ledger, ledger.stage.name), cutPresent: ledger === null ? [] : cutTestRows(root, ledger) };
}

// More untracked files than this and none is recorded, so no untracked file counts as a fix's: a rollback then refuses
// over them, as it did before the record existed, rather than keep an unbounded list in the ledger.
const MAX_UNTRACKED_BASELINE = 1000;

// The untracked files present as the stage starts, so a rollback can remove the ones a fix creates and leave these be.
function recordUntrackedAtStart(ledgerPath, root, { name, attempt }) {
  const paths = untrackedFiles(root);
  updateLedger(ledgerPath, (current) => {
    const { untrackedAtStart: _old, ...fixes } = current.fixes ?? { rollbacks: [] };
    const record = paths.length <= MAX_UNTRACKED_BASELINE ? { untrackedAtStart: { stage: name, attempt, paths } } : {};
    return { ...current, fixes: { ...fixes, ...record } };
  });
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
const failedRunsExcerpts = ({ runs }) => failedRunsText(runs);

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
function assertTreeRollsBack(root, record, own, ledger, key, repeated, dirty, hookRefused = false) {
  if (record === undefined && !repeated && !hookRefused) {
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
  const refusal = artifactForm || record ? undefined : (ledger.fixes?.hookRefusals ?? []).findLast((r) => r.key === key);
  const kind = artifactForm ? "artifact" : record ? "commit" : repeated !== null ? "repeated" : refusal !== undefined ? "hook" : "red";
  const own = kind === "artifact" ? [] : kind === "commit" ? pathsOfCommit(root, record.sha) : pathsOfArtifact(root, key);
  const { created, kept } = artifactForm ? { created: [], kept: [] } : untrackedSinceStart(root, ledger, parts);
  const dirty = artifactForm ? [] : remainingFiles(root).filter((p) => !created.includes(p) && !kept.includes(p));
  const ownChanged = dirty.some((p) => own.includes(p));
  if (!artifactForm) assertTreeRollsBack(root, record, own, ledger, key, repeated !== null, dirty, refusal !== undefined);
  const failedAttempts = failedAttemptsOf(ledger, parts.stage);
  const prefix = rollbackPrefix(branch, parts.stage);
  // Per kind: the note's account of what went wrong, and how the work is undone (the ledger entry it leaves).
  // A committed fix's or an artifact's note holds the checker's account; a red fix's holds the failed test runs' output.
  const none = { ref: null, sha: null, base: null };
  const steps = {
    artifact: { wrong: () => artifactAccount(root, parts, key), undo: () => rollbackArtifactStep(root, key, parts, ledger, none) },
    commit: { wrong: () => checkerAccount(root, parts), undo: () => rollbackCommitted(root, { key, prefix, sha: record.sha }) },
    red: { wrong: () => failedRunsExcerpts(ledger.tests.checkpoint), undo: () => rollbackUncommitted(root, { key, prefix, paths: own }) },
    // The hook's own words tell the next fixer what to change, as the failing runs do for a red fix.
    hook: { wrong: () => `${refusal.source === "return" ? "pb refused the fix's return" : "The commit hook refused the fix"}:\n${refusal.output}`, undo: () => rollbackUncommitted(root, { key, prefix, paths: own }) },
    repeated: {
      wrong: () => `The fix repeated an approach already rolled back for this group: ${repeated}`,
      // Nothing of its own is dirty: record only, with the base at HEAD.
      undo: () => (ownChanged ? rollbackUncommitted(root, { key, prefix, paths: own }) : { ...none, base: headOf(root) }),
    },
  };
  const account = steps[kind].wrong();
  const done = steps[kind].undo();
  const removed = removeCreated(root, { key, prefix, paths: created.filter((p) => !own.includes(p)) });
  const entry = { key, kind, ref: done.ref, sha: done.sha, base: done.base, ...(removed ? { removed } : {}) };
  const wrong = removed ? `${account}\n\nThe fix also left files it did not list, now removed (kept under ${removed.ref}): ${removed.paths.join(", ")}. Edit files with the Edit tool, never sed -i.` : account;
  appendRollbackNote(root, parts.stage, failedAttempts, key, wrong);
  // The lenses contract test pins maxAttempts at 5, so it is always present here.
  const maxAttempts = LENS_MAP.maxAttempts;
  const stopped = failedAttempts >= maxAttempts;
  const capReason = stopped ? `${ATTEMPT_CAP}: stage ${parts.stage} rolled back ${failedAttempts} fix attempts, its cap of ${maxAttempts}` : null;
  const restored = parts.stage === "intake" ? { restoredType: keptTypeOf(root, parts.attempt, ledger.task) } : {};
  recordRollback(path, entry, { droppedSha: record?.sha, capReason, ...restored });
  if (stopped) writeReport(reportPathOf(root), buildReport(readLedger(path), artifactsDirOf(root)));
  return { ok: true, key, note: wrong, failedAttempts, maxAttempts, stopped };
}

// The untracked files that appeared since this stage attempt's snapshot (created: the fix's, removed on rollback) and the
// ones already there (kept: never touched). With no snapshot record for this stage and attempt, neither list has
// anything, so every untracked file counts as the human's and a rollback refuses over it.
function untrackedSinceStart(root, ledger, { stage, attempt }) {
  const start = ledger.fixes?.untrackedAtStart;
  if (!start || start.stage !== stage || start.attempt !== attempt) return { created: [], kept: [] };
  const now = untrackedFiles(root);
  return { created: now.filter((p) => !start.paths.includes(p)), kept: now.filter((p) => start.paths.includes(p)) };
}

function keptTypeOf(root, attempt, task) {
  return runTypeOf(loadStages(PLUGIN_ROOT), task, keptIntakeReturn(artifactsDirOf(root), attempt)?.content?.task_type);
}

export const VERBS = {
  rollback,
  snapshot,
  "unit open": unitOpen, "unit status": unitStatus, "unit rebase": unitRebase, "git doctor": gitDoctor, "pr lint": prLint,
  "run open": runOpen, "pr refresh": prRefresh, "gate eval": gateEval, "human approve": humanApprove, "human abandon": humanAbandon, "human reopen": humanReopen, "human cut-test": humanCutTest, "human adopt": humanAdopt, "human approve-config": humanApproveConfig, "human accept": humanAccept, "human answer": humanAnswer, "human config": humanConfig, test: runTests, checkpoint,
  "plan next": planNext, "question settle": questionSettle, "question add": questionAdd, "config propose": configPropose, "final-check": finalCheck, "guidance record": guidanceRecord, "stage finish": stageFinish, "stage stop": stageStop, "tdd state": tddState, "refactor state": refactorState, "spike state": spikeState, "spike write": spikeWrite, "spike setup": spikeSetup, "stage fail": stageFail, "stage release": stageRelease, "stage report": stageReport, "artifact check": artifactCheck, status, "task end": taskEnd, publish,
};

// The human changed test-config.json while a stage ran: the attempt ends and the run waits on the human, with no stop, so
// pb human accept is all it takes to go on. The refusal's first words are the ones a stage script halts on, with no retry.
// Outside a stage the refusal stands as it is.
function configWait(e) {
  const root = findRunRoot(process.cwd());
  const path = root === null ? null : ledgerPathOf(root);
  const waitable = (ledger) => isStageActive(ledger) && ledger.stop === null && ledger.needsHuman === null;
  if (path === null || !existsSync(path) || !waitable(readLedger(path))) return e;
  let waits = false;
  updateLedger(path, (ledger) => {
    if (!waitable(ledger)) return ledger;
    waits = true;
    const { ledger: closed } = failActiveStage(root, ledger, { keepStop: true });
    return { ...closed, needsHuman: { gate: CONFIG_GATE, reason: e.message, seq: closed.seq + 1, askedAt: new Date().toISOString(), question: configQuestion(), fix: `answer the question in the session, or type ${humanCommand(root, "accept")}` } };
  });
  return waits ? new Refusal(`the run stopped for the human: ${CONFIG_WAIT_LINE}. ${e.message}`) : e;
}

// Where pb keeps the last refusal whose way through is a line only the human types (shared-node/human-wait.mjs), at the
// run root, else the repo's top. Undefined outside a repo, or where no run or unit is open (.pairingbuddy/run is absent).
function humanWaitPath() {
  let root = findRunRoot(process.cwd());
  if (root === null) {
    try {
      root = toplevel();
    } catch {
      return undefined;
    }
  }
  const run = join(root, ".pairingbuddy", "run");
  return existsSync(run) ? { root, path: join(run, HUMAN_WAIT_FILE) } : undefined;
}

// A refusal that hands the human a typed line is kept, so the views say WAITING FOR YOU with that line. Never throws: a
// refusal must reach the session whatever happens here.
function keepHumanWait(name, e) {
  try {
    const where = humanWaitPath();
    if (where === undefined) return;
    const lines = humanLinesIn(e.message, typedCommand(where.root, ""));
    if (lines.length === 0) return;
    writeFileSync(where.path, `${JSON.stringify({ verb: name, message: e.message, lines, at: new Date().toISOString() }, null, 2)}\n`);
  } catch {
    // The refusal stands as it is.
  }
}

// The human's own verb, or the refused verb going through, ends the wait.
function clearHumanWait(name) {
  try {
    const where = humanWaitPath();
    if (where === undefined || !existsSync(where.path)) return;
    const { verb } = JSON.parse(readFileSync(where.path, "utf8"));
    if (name.startsWith("human ") || name === verb) rmSync(where.path, { force: true });
  } catch {
    // A wait that does not read clears on the next human verb's write.
  }
}

const REFUSALS = [Refusal, LedgerRefused, TestRunRefused, CheckpointRefused, PlanRefused, RollbackRefused];

async function runVerb(name, args) {
  try {
    const result = await VERBS[name](args);
    clearHumanWait(name);
    return result;
  } catch (e) {
    if (e instanceof LedgerShaMismatch) throw keptWait(name, new Refusal(shaMismatchRemedy(e.message, findRunRoot(process.cwd()))));
    if (e instanceof ConfigHashChanged) throw keptWait(name, configWait(e));
    throw REFUSALS.some((kind) => e instanceof kind) ? keptWait(name, e) : e;
  }
}

function keptWait(name, e) {
  keepHumanWait(name, e);
  return e;
}

async function main(argv) {
  const name = matchVerb(argv);
  if (!Object.hasOwn(VERBS, name)) {
    const known = Object.keys(VERBS).filter((verb) => !VERB_CLASSES.human.includes(verb));
    throw new UsageError(`unknown verb: ${argv.slice(0, 2).join(" ") || "(none)"}. Known: ${known.join(", ")}`);
  }
  const result = await runVerb(name, argv.slice(name.split(" ").length));
  console.log(result instanceof PlainText ? result.text : JSON.stringify(result));
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
