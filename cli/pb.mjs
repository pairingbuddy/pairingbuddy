#!/usr/bin/env node
// pb: deterministic workflow CLI. Verbs live in the VERBS table; later tasks add more.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { CheckpointRefused, CheckpointStopped, assertCurrentKey, branchOf, checkpointSteps, commitPaths, fileAtCommit, headOf, isCheckpointCall, isKey, isOnHead, planCommit, remainingFiles, stepRunsFor, taskTypesOfStep, testsOfStep } from "../shared-node/checkpoint.mjs";
import { answeredGate, askReason, blockingGate, dueGate, fileHash, gateQuestion, gatesFor, recordApproval, reopenedGate } from "../shared-node/gates.mjs";
import { KINDS, LEDGER_VERSION, LedgerRefused, LedgerShaMismatch, NoHandEdit, acceptLedger, readLedger, updateLedger, writeLedger } from "../shared-node/ledger.mjs";
import { GitConfigRefused, defaultBranchOf, gitConfigPath, isBranchProtected, loadGitConfig, protectedBranches } from "../shared-node/gitconf.mjs";
import { PlanRefused, tickPlanBox } from "../shared-node/plan-boxes.mjs";
import { findRunRoot } from "../shared-node/run-root.mjs";
import { parseKey } from "../shared-node/keys.mjs";
import { nextAction, runStatus } from "../shared-node/next-action.mjs";
import { buildReport, closeStage, finishProblems, newestReturn, perTestOf, readReportOf, readReturn, returnsAt, writeReport } from "../shared-node/stage-run.mjs";
import { FAILED_STATUS, REDO_STATUS, graphFor, isStageActive, isVoidedAttempt, loadStages, needsTestSelection, nextAttempt, nextStage } from "../shared-node/stages.mjs";
import { TestRunRefused, cycleRun, fullSuitePlans, hasSelector, meetsStep, readTestConfig, runPlan, runRecord, runnersWithoutSelector, selectedPlans, testDirectoryOf, testPlan, testRows, validatedConfigHash } from "../shared-node/test-run.mjs";
import { COMMIT_FAILED, COMMIT_PLAN_UNUSABLE, MISSING_ARTIFACT, NO_SELECTOR_TEMPLATE, STAGE_STOP_REASONS } from "../shared-node/stop-codes.mjs";
import { VERB_CLASSES, humanCommand, matchVerb, shaMismatchRemedy, typedCommand } from "../shared-node/verbs.mjs";

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
function assertBranchNotProtected(gitConfig, root, branch, action) {
  const protectedSet = protectedBranches(gitConfig, defaultBranchOf(root, gitConfig.remote));
  if (isBranchProtected(protectedSet, branch)) throw new Refusal(`refusing to ${action} on protected branch ${branch}`);
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

function runOpen(args) {
  const kind = parseKind(args);
  if (process.env.PAIRINGBUDDY_SOLO === "true") throw new Refusal("Solo stays on the old path until T10, so no run was opened");
  const root = toplevel();
  assertNotStopped(root);
  const branch = currentBranch(root);
  const gitConfig = loadGitConfigOrRefuse(root); // bootstraps git-config.json when missing; hashed below
  assertBranchNotProtected(gitConfig, root, branch, "open a run");

  const configHash = validatedConfigHash(root);
  const gitConfigHash = fileHash(gitConfigPath(root));
  const taskType = kind === "code" ? classifiedTaskType(root) : null;
  assertTestsSelectable(root, configHash, taskType);
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
  let gate;
  let reason;
  updateLedger(path, (ledger) => {
    const due = dueGate(gatesFor(contract, ledger.taskType), ledger);
    if (due === undefined) throw new Refusal(noGateDue(ledger));
    gate = due.name;
    reason = askReason(contract, ledger, due, root);
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

const stepNotMet = (step, id, { exitCode, excerpt }) => `test ${id} is not ${step.toUpperCase()}: exit ${exitCode}${provesNothing(step, exitCode)}, so nothing was committed. ${excerpt.slice(-300)}`;

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
    return closeStage(ledger, "done", report.spend.agents);
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

// What the tdd stage cannot see for itself: its inputs, and how far tests{} got. A wrong relay of this costs a refusal
// or a stop, since RED, GREEN and stage finish each read the ledger again.
function tddState(args) {
  if (args.length > 0) throw new UsageError("usage: pb tdd state");
  const { root, path } = runLedgerPath();
  const ledger = readLedger(path);
  assertStageActive(ledger, "report on");
  const artifactsDir = artifactsDirOf(root);
  const scenarios = newestReturn(artifactsDir, SCENARIOS_ROLE, ({ stage, attempt }) => !isVoidedAttempt(ledger, stage, attempt));
  if (scenarios === null) throw new Refusal("no scenarios return stands, so there is nothing to write tests from");
  return { ok: true, taskType: ledger.taskType, scenarios: artifactPath(scenarios), tests: artifactPath(newestReturn(artifactsDir, TESTS_ROLE)), red: doneAt(ledger.tests, "red"), green: doneAt(ledger.tests, "green"), covered: doneAt(ledger.tests, "covered") };
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
  "stage finish": stageFinish, "stage stop": stageStop, "tdd state": tddState, "stage fail": stageFail, "stage report": stageReport, "artifact check": artifactCheck, status, "task end": taskEnd,
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
