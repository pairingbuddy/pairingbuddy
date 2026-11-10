#!/usr/bin/env node
// pb: deterministic workflow CLI. Verbs live in the VERBS table; later tasks add more.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { CheckpointRefused, CheckpointStopped, assertCurrentKey, assertKeyIsCurrent, branchOf, checkedPath, checkpointSteps, commitPaths, fileAtCommit, headOf, isCheckpointCall, isKey, isOnHead, parseRollbackArgs, planCommit, remainingFiles, stepRunsFor, taskTypesOfStep, testsOfStep } from "../shared-node/checkpoint.mjs";
import { PUBLISH_GATE, answeredGate, askReason, blockingGate, changedConfigs, dueGate, fileHash, gateQuestion, gatesFor, isBindingRefusal, currentBinding, publishApproval, publishBinding, publishFacts, publishLint, publishVoidReason, recordApproval, reopenedGate, voidPublish } from "../shared-node/gates.mjs";
import { KINDS, LEDGER_VERSION, isPublishRun, LedgerRefused, LedgerShaMismatch, NoHandEdit, acceptLedger, readLedger, updateLedger, writeLedger } from "../shared-node/ledger.mjs";
import { GitConfigRefused, baseBranch, defaultBranchOf, gitConfigPath, isBranchProtected, loadGitConfig, protectedBranches, readGitConfig } from "../shared-node/gitconf.mjs";
import { doctorWarnings } from "../shared-node/git-doctor.mjs";
import { outsideGlobs } from "../shared-node/glob-match.mjs";
import { PlanRefused, boxLabelsUnder, replaceFile, tickPlanBox, writePrLine } from "../shared-node/plan-boxes.mjs";
import { KEPT_LOCAL_REASON, NO_COMMITS_REASON, PR_URL, branchShapeProblem, foreignPrReason, prCreateArgv, prViewArgv, publishSteps, pushArgv, recordedTasks, targetBranch, upstreamArgv, unitRefPrefix } from "../shared-node/publish.mjs";
import { UnitRefused, newTaskRecord, newUnit, renderBranch } from "../shared-node/unit.mjs";
import { abandonRun, closeUnit, endRun } from "../shared-node/unit-files.mjs";
import { CHANGED_FILE, CORPUS_FILE, GIT_ENV, SUBJECT_DIFF_FILE, buildCorpus, changedArgv, nearestFiles, parseChanged, parseTracked, repoRelative, subjectDiffArgv, trackedFilesArgv } from "../shared-node/snapshot.mjs";
import { RollbackRefused, pathsOfCommit, rollbackCommitted, rollbackUncommitted } from "../shared-node/rollback.mjs";
import { findRunRoot } from "../shared-node/run-root.mjs";
import { buildKey, parseKey } from "../shared-node/keys.mjs";
import { nextAction, runStatus } from "../shared-node/next-action.mjs";
import { buildReport, closeStage, finishProblems, lensRecordOf, newestReturn, perTestOf, readReportOf, readReturn, returnsAt, writeReport } from "../shared-node/stage-run.mjs";
import { FAILED_STATUS, REDO_STATUS, safetyNetStages, graphFor, isStageActive, isVoidedAttempt, loadStages, needsTestSelection, nextAttempt, nextStage } from "../shared-node/stages.mjs";
import { TestRunRefused, cycleRun, fullSuitePlans, hasSelector, meetsStep, readTestConfig, runPlan, runRecord, runnersWithoutSelector, selectedPlans, testDirectoryOf, testPlan, testRows, validatedConfigHash } from "../shared-node/test-run.mjs";
import { COMMIT_FAILED, COMMIT_PLAN_UNUSABLE, MISSING_ARTIFACT, NO_SELECTOR_TEMPLATE, STAGE_STOP_REASONS } from "../shared-node/stop-codes.mjs";
import { PrLintRunRefused, prBodyPath, readDraftArtifact, readUnit, runPrLint } from "../shared-node/pr-lint-run.mjs";
import { VERB_CLASSES, humanCommand, matchVerb, pbCommand, shaMismatchRemedy, typedCommand } from "../shared-node/verbs.mjs";

export { KINDS };

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

const SCENARIOS_ROLE = "enumerate-scenarios-and-test-cases";
const TESTS_ROLE = "create-test-placeholders";

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
  if (!KINDS.includes(kind)) throw new UsageError(`usage: pb run open --kind ${KINDS.join("|")}`);
  return kind;
}

function readStateJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Refusal(`${path} is not valid JSON, so no run was opened`);
  }
}

// The old path's classify-task writes this file until T7. No file means a run opened before classification.
// A type with no stage graph is an old-path run, and an old-path run has no run state.
function classifiedTaskType(root) {
  const path = join(root, ".pairingbuddy", "task-classification.json");
  if (!existsSync(path)) return null;
  const type = readStateJson(path)?.task_type;
  if (typeof type !== "string") throw new Refusal(`${path} has no task_type string, so no run was opened`);
  if (!loadStages(PLUGIN_ROOT).migratedTypes.includes(type)) throw new Refusal(`task type ${type} is not migrated, so it stays on the old path and no run was opened`);
  return type;
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

// Any runner, since the placeholders may pick any of them. Refused here it costs nothing: refused later it costs the
// scenarios and the placeholders, and it stops the run. No template is guessed, because a wrong one can pass a test
// that never ran: a name-pattern runner exits 0 when nothing matches.
function assertTestsSelectable(root, configHash, taskType) {
  if (!needsTestSelection(loadStages(PLUGIN_ROOT), taskType)) return;
  const missing = runnersWithoutSelector(readTestConfig(root, configHash));
  if (missing.length === 0) return;
  const named = missing.length === 1 ? `runner ${missing[0]} has` : `runners ${missing.join(", ")} have`;
  throw new Refusal(`${named} no selector_template, so RED and GREEN cannot speak for one test, and no run was opened. Ask the human to add selector_template to each runner in .pairingbuddy/test-config.json: the argument words that select one test, for example ["{test_file}::{test_function}"] for pytest. Then start the task again`);
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

function runOpen(args) {
  const kind = parseKind(args);
  if (process.env.PAIRINGBUDDY_SOLO === "true") throw new Refusal("Solo stays on the old path until T10, so no run was opened");
  const root = toplevel();
  assertNotStopped(root);
  if (kind === "publish") assertPublishable(root);
  const branch = currentBranch(root);
  const gitConfig = loadGitConfigOrRefuse(root); // bootstraps git-config.json when missing; hashed below
  assertBranchNotProtected(gitConfig, root, branch, "open a run", "; start the work on a unit branch with pb unit open");

  const configHash = validatedConfigHash(root);
  const gitConfigHash = fileHash(gitConfigPath(root));
  const taskType = kind === "code" ? classifiedTaskType(root) : kind === "publish" ? "publish" : null;
  assertTestsSelectable(root, configHash, taskType);
  const task = storedTask(root);

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
      owner: { sessionId: null, lastSeen: null },
      task, plan: { path: "", title: "" }, configHash, gitConfigHash,
      policy: { mode: "", source: "" },
      stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null },
      stages: [], gates: {}, tests: {}, commits: [], retries: {},
      spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return { ok: true, kind, branch, runDir: dir };
}

const approveCommand = (root, gate) => humanCommand(root, `approve ${gate}`);

function runLedgerPath() {
  const root = findRunRoot(process.cwd());
  const path = root === null ? null : join(root, ".pairingbuddy", "run", "task", "ledger.json");
  if (path === null || !existsSync(path)) throw new Refusal("no run here");
  return { root, path };
}

const taskDirOf = (root) => join(root, ".pairingbuddy", "run", "task");
const artifactsDirOf = (root) => join(taskDirOf(root), "artifacts");
const reportPathOf = (root) => join(taskDirOf(root), "report.json");

function recordAuto(ledger, gate) {
  return { ...ledger, gates: { ...ledger.gates, [gate]: { source: "auto" } } };
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
  // The shown block is built before anything is written, so a missing body or runner leaves the ledger untouched.
  const shown = dueGate(gatesFor(contract, standing.taskType), standing)?.name === PUBLISH_GATE ? publishShown(root, standing) : null;
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
    if (reason === null) return recordAuto(open, gate);
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
  if (dueGate(gatesFor(contract, ledger.taskType), ledger)?.name !== PUBLISH_GATE) return null;
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

function publishCommits(root, unit) {
  const rows = runGit(root, ["log", "--reverse", "--format=%H%x09%s", `${unit.baseSha}..HEAD`]).split("\n").filter(Boolean);
  return rows.map((row) => {
    const [sha, ...subject] = row.split("\t");
    return { sha, subject: subject.join("\t"), inUnit: unit.commits.includes(sha) };
  });
}

// What the human sees at G:publish: the draft, its lint, the coordination text apart from the body, and what would go out.
// headSha, base and target are the facts a publish answer is held to (needsHuman.shown).
function publishShown(root, ledger) {
  const unit = readUnitOrRefuse(root);
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
    commits: publishCommits(root, unit),
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
  const gates = gatesFor(loadStages(PLUGIN_ROOT), ledger.taskType);
  const awaited = awaitedGate(ledger, gates);
  if (gate !== awaited) {
    throw new Refusal(`gate ${gate} is neither due nor pending. ${awaited === undefined ? "No gate is waiting." : `Gate ${awaited} is waiting.`}`);
  }
  // The question's shown HEAD binds the answer here as it does in the tap: a commit since then is not approved.
  const shown = ledger.needsHuman?.gate === gate ? ledger.needsHuman.shown : null;
  const binding = gate === PUBLISH_GATE ? refusing(() => publishBinding(root, ledger, shown)) : undefined;
  return recordApproval(ledger, gate, gates, binding);
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

function humanAccept(args) {
  if (args.length > 0) throw new UsageError("usage: pb human accept");
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
    throw new UsageError(`usage: pb checkpoint --step ${checkpointSteps().join("|")} --from <key>`);
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

// A step with no change runs no test. The tests run code in the repo, so what they could change is looked at again
// before the commit.
async function suiteCheckpoint(context) {
  const plan = planFor(context);
  if (plan === null) return noChange(context);
  const head = headOf(context.root);
  await requirePassingTests(context.root, context.path, context.ledger);
  return commitPlan(context, plan, head);
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

const CHECKPOINT_FLOWS = { full: suiteCheckpoint, none: placeholdersCheckpoint, selected: cycleCheckpoint, closed: refactorCheckpoint };

// Every check that costs no test run comes first.
async function checkpoint(args) {
  const { step, key } = parseCheckpoint(args);
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  assertCommitAllowed(step, key, ledger);
  if (!stepRunsFor(step, ledger.taskType)) throw new Refusal(`step ${step} runs for ${taskTypesOfStep(step).join(", ")} only, and this task is ${ledger.taskType}`);
  const branch = currentBranch(root);
  assertBranchNotProtected(loadGitConfigOrRefuse(root), root, branch, "commit");
  return CHECKPOINT_FLOWS[testsOfStep(step)]({ step, key, root, path, ledger, branch });
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
    const closed = closeStage(ledger, "done", report.spend.agents);
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
  const scenarios = newestReturn(artifactsDir, SCENARIOS_ROLE, ({ stage, attempt }) => !isVoidedAttempt(ledger, stage, attempt));
  if (scenarios === null) throw new Refusal("no scenarios return stands, so there is nothing to write tests from");
  return { ok: true, taskType: ledger.taskType, scenarios: artifactPath(scenarios), tests: artifactPath(newestReturn(artifactsDir, TESTS_ROLE)), red: doneAt(ledger.tests, "red"), green: doneAt(ledger.tests, "green"), covered: doneAt(ledger.tests, "covered"), testRunners: testRunnersOf(readTestConfig(root, ledger.configHash)) };
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
    assertStageActive(ledger, "fail");
    const clearedStop = ledger.stop?.reason ?? null;
    const closed = closeStage(ledger, FAILED_STATUS, returnsAt(artifactsDirOf(root), ledger.stage).length, clearedStop === null ? {} : { clearedStop });
    failed = { stage: name, attempt, nextAttempt: nextAttempt(closed, name), clearedStop };
    return { ...closed, stop: null };
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

function assertCleanTree(root) {
  const remaining = remainingFiles(root);
  if (remaining.length > 0) throw new Refusal(`the tree is dirty, so the task cannot end. Commit or remove these, nothing was touched: ${remaining.join(", ")}`);
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

// What taskEnd needs to record the task, read with the other refusals: the open unit and HEAD, or null with no unit.
// A corrupt unit.json, one without a tasks list, or no commit refuses here, before anything changes.
function readUnitForRecord(root, ledger) {
  const path = unitPathOf(root);
  if (!existsSync(path)) return null;
  let unit;
  try {
    unit = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Refusal(`run/unit.json is unreadable, so the task cannot end. Nothing was touched: ${e.message}`);
  }
  if (!Array.isArray(unit?.tasks)) throw new Refusal("run/unit.json has no tasks list, so the task cannot end. Nothing was touched");
  const headSha = headOf(root);
  if (headSha === null) throw new Refusal("there is no commit yet, so the task cannot end. Nothing was touched");
  return { path, unit, record: newTaskRecord({ ledger, headSha }), commits: ledger.commits };
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
  assertTaskFinished(ledger);
  assertCommitsOnHead(root, ledger);
  assertGreenRunStands(root, ledger);
  assertCleanTree(root);
  const opened = readUnitForRecord(root, ledger);
  assertConfigChangeInGlobs(root, ledger, opened);
  const plan = tickedPlan(root, ledger.plan);
  appendTaskRecord(opened);
  const dir = taskDirOf(root);
  rmSync(dir, { recursive: true });
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
    unit, runStop: ledger.stop, publishMode: mode, coordination: bound?.draft.coordination ?? null, commits, changedConfigs: changedConfigs(unit, root), approval: publishApproval(ledger), voidReason,
    taskRunOpen: !isPublishRun(ledger),
    ...(bound === null || mode === "none" ? {} : publishingFacts(root, unit, gitConfig, bound.current.headSha)),
  };
  if (voidReason !== null) updateLedger(path, (current) => voidPublish(current, voidReason));
  const plan = publishSteps(facts);
  if (plan.refusals.length > 0) throw new Refusal(`not published: ${plan.refusals.join("; ")}`);
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
      warnings = [...warnings, ...posted.warnings];
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
// PR is open never stops the publish: the file stays, and the warning has gh's reason and the one command to post it by
// hand. The unit closes either way, so a failed post is not retried by pb publish.
function postComment({ root, unit }, url, text) {
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
  try {
    writeJsonAtomic(unitPathOf(root), { ...unit, pr: { ...unit.pr, url, commented: true } });
  } catch (e) {
    warnings.push(`the coordination comment was posted on ${url}, but recording it failed (${e.message}); do not post it again`);
  }
  return { warnings };
}

// The PR gh knows for the unit branch, which must be from that branch into the target. Refuses a mismatch.
function verifiedPr(view, branch, target) {
  const wrong = foreignPrReason(view, { branch, target });
  if (wrong !== null) throw new Refusal(`not published: ${wrong}`);
  return view.url;
}

function viewPr(root, branch, context = "") {
  const text = run(root, "gh", prViewArgv(branch), { context });
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
  const snapshot = join(root, ".pairingbuddy", "run", `pr-body.${process.pid}.snapshot.md`);
  writeFileSync(snapshot, bound.body ?? "");
  try {
    url = createdPr(root, unit, target, snapshot, bound.draft, ledger.policy?.mode, opened);
  } finally {
    rmSync(snapshot, { force: true });
  }
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
function run(cwd, command, args, { context = "", input, trim = true, env } = {}) {
  try {
    const out = execFileSync(command, args, { cwd, encoding: "utf8", input, env: env === undefined ? process.env : { ...process.env, ...env }, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
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

// A plain call opens the template branch; --branch names another. The CLI reads no gate policy and asks nobody to confirm.
// The refusals come first and touch nothing, with one accepted exception: loadGitConfigOrRefuse bootstraps
// .pairingbuddy/git-config.json when it is missing, since the branch refusals need its template and protected list.
// That file is under .pairingbuddy/, so it never makes the tree dirty. Then run/unit.json is claimed exclusively before
// the branch is made, and removed again if the switch fails, so no branch is left without its record.
function unitOpen(args) {
  const type = flagValue(args, "--type");
  const slug = flagValue(args, "--slug");
  const usage = "usage: pb unit open --type <type> --slug <slug> [--branch <name>]";
  if (args.includes("--yes")) throw new UsageError(`--yes is no longer accepted: pb unit open has no confirm step. ${usage}`);
  if (!type || !slug) throw new UsageError(usage);
  const chosen = chosenBranch(args);
  const root = toplevel();
  if (existsSync(unitPathOf(root))) throw new Refusal("a unit is already open (run/unit.json exists); nothing was touched");
  const dirty = remainingFiles(root);
  if (dirty.length > 0) throw new Refusal(`the tree is dirty, so the unit cannot open. Commit or remove these, nothing was touched: ${dirty.join(", ")}`);
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
  const baseSha = git("rev-parse", `${gitConfig.remote}/${base}`);
  ensureRunRoot(root);
  writeJsonAtomic(unitPathOf(root), newUnit({ branch, base, baseSha, configHash, gitConfigHash }), { exclusive: true });
  try {
    git("switch", "-c", branch, baseSha);
  } catch (e) {
    rmSync(unitPathOf(root), { force: true });
    throw e;
  }
  return { ok: true, branch, base, baseSha, doctor: doctorReport(root) };
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
  const { stage } = readLedger(join(taskDirOf(root), "ledger.json"));
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
  if (!existsSync(unitPathOf(root))) throw new Refusal("no unit is open (run/unit.json is missing), so there is no draft to lint");
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
  const unit = readUnitOrRefuse(root);
  assertNoArgs(args, "snapshot");
  const git = (argv) => runGit(root, argv, { trim: false, env: GIT_ENV });
  const diff = git(subjectDiffArgv(unit.baseSha));
  const changed = parseChanged(git(changedArgv(unit.baseSha)));
  const nearest = nearestFiles(parseTracked(git(trackedFilesArgv())), changed.map((c) => c.path));
  const paths = buildCorpus(insideRepo(root, [...inRepoDocs(root), ...conventionPaths(root), "CLAUDE.md", ...nearest]), (p) => existsSync(join(root, p)));
  const runDir = join(root, ".pairingbuddy", "run");
  replaceFiles([[join(runDir, SUBJECT_DIFF_FILE), diff], [join(runDir, CHANGED_FILE), jsonText(changed)], [join(runDir, CORPUS_FILE), jsonText({ paths })]]);
  const ledgerPath = join(taskDirOf(root), "ledger.json");
  const taskType = existsSync(ledgerPath) ? readLedger(ledgerPath).taskType : null;
  return { ok: true, paths, taskType };
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
const noteNumber = (ledger, stage) => (ledger.fixes?.rollbacks ?? []).filter((r) => parseKey(r.key).stage === stage).length + 1;

// Add one entry to the stage's rollback notes, so the next attempt sees what went wrong.
function appendRollbackNote(root, stage, number, key, body) {
  const notes = join(taskDirOf(root), "notes");
  mkdirSync(notes, { recursive: true });
  appendFileSync(join(notes, `${stage}.md`), `## Rollback ${number}: ${key}\n\n${body}\n\n`);
}

// Record a rollback in the ledger, optionally dropping a commit that is no longer one of the run's commits.
function recordRollback(path, entry, droppedSha) {
  updateLedger(path, (current) => ({
    ...current,
    commits: droppedSha ? current.commits.filter((c) => c !== droppedSha) : current.commits,
    fixes: { ...current.fixes, rollbacks: [...(current.fixes?.rollbacks ?? []), entry] },
  }));
}

// Undo a rejected artifact fix: no git, the artifact just moves aside to rejected/ and the note keeps the checker's account.
function rollbackArtifact(root, key) {
  const rejected = join(taskDirOf(root), "rejected");
  mkdirSync(rejected, { recursive: true });
  renameSync(join(artifactsDirOf(root), `${key}.json`), join(rejected, `${key}.json`));
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
  const recorded = ledger.checkpoints.filter(({ key: k }) => isKey(k)).map(({ key: k }) => ({ pbKey: k, ...parseKey(k) }));
  const newer = [...recorded, ...onDisk].find((other) => other.stage === parts.stage && other.attempt === parts.attempt && other.round > parts.round);
  if (newer) throw new Refusal(`${key} is not the newest fix group: ${newer.pbKey} came after it, so nothing was touched`);
}

// The tree-side reasons to refuse a git rollback: the fix must be the newest commit (when committed), and nothing
// outside the group's own paths may be dirty. record is the fix's checkpoint, or undefined for an uncommitted (red) fix,
// which also needs a failed test run and at least one of its listed paths changed.
function assertTreeRollsBack(root, record, own, ledger, key) {
  if (record === undefined) {
    // Uncommitted work is only undone after a failed (red) test run: without one there is nothing to roll back.
    if (ledger.tests.checkpoint?.passed !== false) throw new Refusal(`${key} has no commit and no red test run, so there is nothing to roll back and nothing was touched`);
    // A red fix that changed none of its listed paths has nothing to undo.
    if (!remainingFiles(root).some((p) => own.includes(p))) throw new Refusal(`none of the paths ${key} lists has changed, so there is nothing to roll back and nothing was touched`);
  }
  // Only the newest commit can be undone cleanly: anything on top of the fix would be lost with it.
  if (record) {
    const head = headOf(root);
    if (record.sha !== head) throw new Refusal(`the fix commit ${record.sha} is not HEAD (${head}): only the newest commit rolls back, so nothing was touched`);
  }
  // Anything dirty outside the group's own paths is the human's work: refuse rather than touch it.
  const stray = remainingFiles(root).filter((p) => !own.includes(p));
  if (stray.length) throw new Refusal(`the tree is dirty outside the fix group, so nothing was touched: ${stray.join(", ")}`);
}

// Undo a rejected fix group. Three cases: an artifact fix, a committed fix (the ledger has a record), or an uncommitted (red) one.
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
  // A recorded checkpoint means the fix was committed; otherwise it was only in the working tree (red).
  const record = artifactForm ? undefined : ledger.checkpoints.find((c) => c.key === key);
  const kind = artifactForm ? "artifact" : record ? "commit" : "red";
  const own = kind === "artifact" ? [] : kind === "commit" ? pathsOfCommit(root, record.sha) : pathsOfArtifact(root, key);
  if (!artifactForm) assertTreeRollsBack(root, record, own, ledger, key);
  // A committed fix's or an artifact's note holds the checker's account of what went wrong; an uncommitted (red) fix's note holds the failed test runs' output.
  const wrong = kind !== "red" ? checkerAccount(root, parts) : failedRunsExcerpts(ledger.tests.checkpoint);
  const number = noteNumber(ledger, parts.stage);
  let entry = { key, kind, ref: null, sha: null, base: null };
  if (kind === "artifact") {
    rollbackArtifact(root, key);
  } else {
    const prefix = rollbackPrefix(branch, parts.stage);
    const done = kind === "commit" ? rollbackCommitted(root, { key, prefix, sha: record.sha }) : rollbackUncommitted(root, { key, prefix, paths: own });
    entry = { key, kind, ref: done.ref, sha: done.sha, base: done.base };
  }
  appendRollbackNote(root, parts.stage, number, key, wrong);
  recordRollback(path, entry, record?.sha);
  return { ok: true, key };
}

export const VERBS = {
  rollback,
  snapshot,
  "unit open": unitOpen, "git doctor": gitDoctor, "pr lint": prLint,
  "run open": runOpen, "gate eval": gateEval, "human approve": humanApprove, "human abandon": humanAbandon, "human approve-config": humanApproveConfig, "human accept": humanAccept, test: runTests, checkpoint,
  "stage finish": stageFinish, "stage stop": stageStop, "tdd state": tddState, "stage fail": stageFail, "stage report": stageReport, "artifact check": artifactCheck, status, "task end": taskEnd, publish,
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
