#!/usr/bin/env node
// pb: deterministic workflow CLI. Verbs live in the VERBS table; later tasks add more.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CheckpointRefused, CheckpointStopped, assertCurrentKey, branchOf, checkpointSteps, commitPaths, headOf, isCheckpointCall, isKey, isOnHead, isProtectedBranch, planCommit, remainingFiles } from "../shared-node/checkpoint.mjs";
import { answeredGate, askReason, blockingGate, dueGate, fileHash, gateQuestion, gatesFor, recordApproval, reopenedGate } from "../shared-node/gates.mjs";
import { KINDS, LEDGER_VERSION, LedgerRefused, LedgerShaMismatch, NoHandEdit, acceptLedger, readLedger, updateLedger, writeLedger } from "../shared-node/ledger.mjs";
import { PlanRefused, tickPlanBox } from "../shared-node/plan-boxes.mjs";
import { findRunRoot } from "../shared-node/run-root.mjs";
import { parseKey } from "../shared-node/keys.mjs";
import { nextAction, runStatus } from "../shared-node/next-action.mjs";
import { buildReport, closeStage, finishProblems, readReportOf, readReturn, returnsAt, writeReport } from "../shared-node/stage-run.mjs";
import { FAILED_STATUS, REDO_STATUS, graphFor, isStageActive, isVoidedAttempt, loadStages, nextAttempt, nextStage } from "../shared-node/stages.mjs";
import { TestRunRefused, fullSuitePlans, readTestConfig, runPlan, runRecord, selectedPlans, validatedConfigHash } from "../shared-node/test-run.mjs";
import { VERB_CLASSES, humanCommand, matchVerb, shaMismatchRemedy, typedCommand } from "../shared-node/verbs.mjs";

export { KINDS };

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

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

function runOpen(args) {
  const kind = parseKind(args);
  if (process.env.PAIRINGBUDDY_SOLO === "true") throw new Refusal("Solo stays on the old path until T10, so no run was opened");
  const root = toplevel();
  assertNotStopped(root);
  const branch = currentBranch(root);
  if (isProtectedBranch(branch)) throw new Refusal(`refusing to open a run on protected branch ${branch}`);

  const configHash = validatedConfigHash(root);
  const taskType = kind === "code" ? classifiedTaskType(root) : null;
  const task = storedTask(root);

  const runRoot = join(root, ".pairingbuddy", "run");
  const dir = join(runRoot, "task");
  mkdirSync(runRoot, { recursive: true });
  try {
    writeFileSync(join(runRoot, ".gitignore"), "*\n", { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  // A non-recursive mkdir is the claim: exactly one concurrent opener wins, and an existing
  // run/task of any shape (with or without a ledger) refuses.
  try {
    mkdirSync(dir);
  } catch (e) {
    if (e.code === "EEXIST") throw new Refusal(`a run is already active at ${dir}`);
    throw e;
  }
  try {
    mkdirSync(join(dir, "artifacts"));
    writeLedger(join(dir, "ledger.json"), {
      v: LEDGER_VERSION, seq: 0, sha: "0".repeat(64), kind, taskType,
      owner: { sessionId: null, lastSeen: null },
      task, plan: { path: "", title: "" }, configHash,
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
  let gate;
  let reason;
  updateLedger(path, (ledger) => {
    const due = dueGate(gatesFor(contract, ledger.taskType), ledger);
    if (due === undefined) throw new Refusal(noGateDue(ledger));
    gate = due.name;
    reason = askReason(ledger, due, root);
    return reason === null ? recordAuto(ledger, gate) : { ...ledger, needsHuman: { gate, reason, seq: ledger.seq + 1 } };
  });
  if (reason === null) return { ok: true, result: "auto-pass", gate, source: "auto" };
  return { ok: true, result: "needs-human", gate, reason, question: gateQuestion(gate), humanCommand: approveCommand(root, gate) };
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

function approved(ledger, gate) {
  const gates = gatesFor(loadStages(PLUGIN_ROOT), ledger.taskType);
  const awaited = awaitedGate(ledger, gates);
  if (gate !== awaited) {
    throw new Refusal(`gate ${gate} is neither due nor pending. ${awaited === undefined ? "No gate is waiting." : `Gate ${awaited} is waiting.`}`);
  }
  return recordApproval(ledger, gate, gates);
}

function humanApprove(args) {
  if (args.length !== 1) throw new UsageError("usage: pb human approve <gate>");
  const [gate] = args;
  updateLedger(runLedgerPath().path, (ledger) => approved(ledger, gate));
  return { ok: true, gate, source: "human-cli" };
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
  const { plans, testIds } = selectedPlans(config, join(root, ".pairingbuddy", "run", "task", "artifacts"), stage);
  return { key: "selected", plans, selection: { tests: testIds } };
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
function orStop(path, { step, key }, action) {
  try {
    return action();
  } catch (e) {
    if (!(e instanceof CheckpointStopped)) throw e;
    updateLedger(path, (ledger) => {
      assertCurrentKey(step, key, ledger);
      return { ...ledger, stop: { reason: e.message, seq: ledger.seq + 1 } };
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
function recordCheckpoint(path, record) {
  let orphaned = null;
  updateLedger(path, (ledger) => {
    const listed = record.committed ? { ...ledger, commits: [...ledger.commits, record.sha] } : ledger;
    try {
      assertCurrentKey(record.step, record.key, ledger);
      return withCheckpoint(listed, record);
    } catch (e) {
      if (!(e instanceof CheckpointRefused)) throw e;
      orphaned = e;
      return listed;
    }
  });
  if (orphaned !== null) throw new Refusal(`${record.committed ? `commit ${record.sha} landed, and it is no evidence: ` : ""}${orphaned.message}`);
}

// Every check that costs no test run comes first, and a step with no change runs none. The tests run code in the repo,
// and the attempt can end while they do, so what they could change is looked at again before the commit.
async function checkpoint(args) {
  const { step, key } = parseCheckpoint(args);
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  assertCommitAllowed(step, key, ledger);
  const branch = currentBranch(root);
  if (isProtectedBranch(branch)) throw new Refusal(`refusing to commit on protected branch ${branch}`);
  const alreadyCommitted = (ledger.checkpoints ?? []).some((record) => record.key === key && record.committed);
  const plan = orStop(path, { step, key }, () => planCommit(root, join(root, ".pairingbuddy", "run", "task", "artifacts"), step, key, alreadyCommitted));
  if (plan === null) {
    recordCheckpoint(path, { step, key, committed: false, sha: null });
    return { ok: true, step, key, committed: false };
  }
  const head = headOf(root);
  await requirePassingTests(root, path, ledger);
  assertCommitAllowed(step, key, readLedger(path));
  const { sha, hookRetried } = orStop(path, { step, key }, () => commitPaths(root, { ...plan, branch, head }));
  recordCheckpoint(path, { step, key, committed: true, sha });
  return { ok: true, step, key, committed: true, sha, message: plan.message, paths: plan.paths, hookRetried };
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
    const problems = finishProblems(contract, ledger, artifactsDir, head);
    if (problems.length > 0) {
      missing = `stage ${name} cannot finish at attempt ${attempt}: ${problems.join("; ")}`;
      return { ...ledger, stop: { reason: missing, seq: ledger.seq + 1 } };
    }
    const report = buildReport(ledger, artifactsDir);
    writeReport(reportPathOf(root), report);
    finished = { stage: name, attempt, agents: report.spend.agents };
    return closeStage(ledger, "done", report.spend.agents);
  });
  if (missing !== null) throw new Refusal(`${missing}. The run stopped: pb stage fail clears it`);
  return { ok: true, ...finished, report: reportPathOf(root) };
}

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

// Removes run/task only. The refusals all come first, so a refused call changes nothing.
function taskEnd(args) {
  assertNoArgs(args, "task end");
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  assertTaskFinished(ledger);
  assertCommitsOnHead(root, ledger);
  assertGreenRunStands(root, ledger);
  assertCleanTree(root);
  const plan = tickedPlan(root, ledger.plan);
  const dir = taskDirOf(root);
  rmSync(dir, { recursive: true });
  return { ok: true, removed: dir, plan };
}

export const VERBS = {
  "run open": runOpen, "gate eval": gateEval, "human approve": humanApprove, "human accept": humanAccept, test: runTests, checkpoint,
  "stage finish": stageFinish, "stage fail": stageFail, "stage report": stageReport, "artifact check": artifactCheck, status, "task end": taskEnd,
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
    const expected = e instanceof Refusal || e instanceof UsageError || e instanceof LedgerRefused || e instanceof TestRunRefused || e instanceof CheckpointRefused || e instanceof PlanRefused;
    console.error(`pb: ${expected ? e.message : `unexpected failure: ${e.message}`}`);
    process.exit(e instanceof UsageError ? 2 : 1);
  }
}
