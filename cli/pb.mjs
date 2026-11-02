#!/usr/bin/env node
// pb: deterministic workflow CLI. Verbs live in the VERBS table; later tasks add more.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CheckpointRefused, CheckpointStopped, assertCurrentKey, checkpointSteps, commitPaths, isCheckpointCall, isKey, isProtectedBranch, planCommit, remainingFiles } from "../shared-node/checkpoint.mjs";
import { answeredGate, askReason, blockingGate, dueGate, fileHash, gateQuestion, gatesFor, recordApproval, reopenedGate } from "../shared-node/gates.mjs";
import { KINDS, LEDGER_VERSION, LedgerRefused, LedgerShaMismatch, acceptLedger, readLedger, updateLedger, writeLedger } from "../shared-node/ledger.mjs";
import { PlanRefused, tickPlanBox } from "../shared-node/plan-boxes.mjs";
import { findRunRoot } from "../shared-node/run-root.mjs";
import { parseKey } from "../shared-node/keys.mjs";
import { buildReport, closeStage, finishProblems, readReportOf, readReturn, returnsAt, spendTotals, writeReport } from "../shared-node/stage-run.mjs";
import { FAILED_STATUS, REDO_STATUS, graphFor, isStageActive, isVoidedAttempt, loadStages, nextAttempt, nextStage } from "../shared-node/stages.mjs";
import { TestRunRefused, fullSuitePlans, readTestConfig, runPlan, runRecord, selectedPlans } from "../shared-node/test-run.mjs";
import { VERB_CLASSES, humanCommand, matchVerb, shaMismatchRemedy } from "../shared-node/verbs.mjs";

export { KINDS };

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));

class UsageError extends Error {}
class Refusal extends Error {}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function toplevel() {
  try {
    return git("rev-parse", "--show-toplevel");
  } catch {
    throw new Refusal("no git repository here");
  }
}

function currentBranch() {
  try {
    return git("symbolic-ref", "-q", "HEAD").replace(/^refs\/heads\//, "");
  } catch {
    throw new Refusal("no branch checked out (detached HEAD)");
  }
}

function parseKind(args) {
  const i = args.indexOf("--kind");
  const kind = i === -1 ? undefined : args[i + 1];
  if (!KINDS.includes(kind)) throw new UsageError(`usage: pb run open --kind ${KINDS.join("|")}`);
  return kind;
}

function runOpen(args) {
  const kind = parseKind(args);
  const root = toplevel();
  const branch = currentBranch();
  if (isProtectedBranch(branch)) throw new Refusal(`refusing to open a run on protected branch ${branch}`);

  const configPath = join(root, ".pairingbuddy", "test-config.json");
  if (!existsSync(configPath)) throw new Refusal(`missing ${configPath}`);
  const configHash = fileHash(configPath);

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
      v: LEDGER_VERSION, seq: 0, sha: "0".repeat(64), kind, taskType: null,
      owner: { sessionId: null, lastSeen: null },
      task: "", plan: { path: "", title: "" }, configHash,
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

function humanAccept(args) {
  if (args.length > 0) throw new UsageError("usage: pb human accept");
  return { ok: true, ...acceptLedger(runLedgerPath().path) };
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
  const record = { ...(await suiteRecord(plans, root, stage)), ...selection };
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

function commitOrStop(root, path, plan) {
  try {
    return commitPaths(root, plan);
  } catch (e) {
    if (!(e instanceof CheckpointStopped)) throw e;
    updateLedger(path, (ledger) => ({ ...ledger, stop: { reason: e.message, seq: ledger.seq + 1 } }));
    throw new Refusal(`the run stopped: ${e.message}`);
  }
}

// The evidence for stage finish, so a step with no change counts as done too.
function withCheckpoint(ledger, record) {
  const { name: stage, attempt } = ledger.stage;
  return { ...ledger, checkpoints: [...(ledger.checkpoints ?? []), { ...record, stage, attempt }] };
}

// Every check comes before the tests, and a step with no change runs none.
async function checkpoint(args) {
  const { step, key } = parseCheckpoint(args);
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  if (ledger.stop !== null) throw new Refusal(`the run has stopped: ${ledger.stop.reason}`);
  assertCurrentKey(step, key, ledger);
  const branch = currentBranch();
  if (isProtectedBranch(branch)) throw new Refusal(`refusing to commit on protected branch ${branch}`);
  const plan = planCommit(root, join(root, ".pairingbuddy", "run", "task", "artifacts"), step, key);
  if (plan === null) {
    updateLedger(path, (current) => withCheckpoint(current, { step, key, committed: false, sha: null }));
    return { ok: true, step, key, committed: false };
  }
  await requirePassingTests(root, path, ledger);
  const { sha, hookRetried } = commitOrStop(root, path, plan);
  updateLedger(path, (current) => withCheckpoint({ ...current, commits: [...current.commits, sha] }, { step, key, committed: true, sha }));
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
  let missing = null;
  let finished;
  updateLedger(path, (ledger) => {
    assertStageActive(ledger, "finish");
    if (ledger.stop !== null) throw new Refusal(`the run has stopped: ${ledger.stop.reason}`);
    const { name, attempt } = ledger.stage;
    const problems = finishProblems(contract, ledger, artifactsDir);
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

function stageFail(args) {
  assertNoArgs(args, "stage fail");
  const { root, path } = runLedgerPath();
  let failed;
  updateLedger(path, (ledger) => {
    assertStageActive(ledger, "fail");
    assertNotHumanStop(ledger, root);
    const { name, attempt } = ledger.stage;
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

function nextStep(contract, ledger) {
  if (isStageActive(ledger)) return null;
  const stage = nextStage(graphFor(contract, ledger.taskType), ledger);
  return stage === undefined ? null : { stage, attempt: nextAttempt(ledger, stage) };
}

function status(args) {
  assertNoArgs(args, "status");
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  const contract = loadStages(PLUGIN_ROOT);
  const { stage, stop, needsHuman } = ledger;
  return { ok: true, stage, next: nextStep(contract, ledger), stop, needsHuman, spend: spendTotals(ledger, artifactsDirOf(root), contract.maxAgents) };
}

function assertTaskFinished(ledger) {
  const contract = loadStages(PLUGIN_ROOT);
  const unfinished = isStageActive(ledger) ? ledger.stage.name : nextStage(graphFor(contract, ledger.taskType), ledger);
  if (unfinished !== undefined) throw new Refusal(`stage ${unfinished} is not finished, so the task cannot end`);
  if (ledger.stop !== null) throw new Refusal(`the run has stopped: ${ledger.stop.reason}`);
  const gate = blockingGate(gatesFor(contract, ledger.taskType), ledger);
  if (gate !== undefined) throw new Refusal(`gate ${gate.name} has not passed, so the task cannot end. Run pb gate eval.`);
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
