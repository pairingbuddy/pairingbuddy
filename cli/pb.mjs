#!/usr/bin/env node
// pb: deterministic workflow CLI. Verbs live in the VERBS table; later tasks add more.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CheckpointRefused, CheckpointStopped, assertCurrentKey, checkpointSteps, commitPaths, isCheckpointCall, isProtectedBranch, planCommit } from "../shared-node/checkpoint.mjs";
import { answeredGate, askReason, blockingGate, dueGate, fileHash, gateQuestion, gatesFor, recordApproval, reopenedGate } from "../shared-node/gates.mjs";
import { KINDS, LEDGER_VERSION, LedgerRefused, LedgerShaMismatch, acceptLedger, readLedger, updateLedger, writeLedger } from "../shared-node/ledger.mjs";
import { findRunRoot } from "../shared-node/run-root.mjs";
import { REDO_STATUS, loadStages, nextAttempt } from "../shared-node/stages.mjs";
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
  if (plan === null) return { ok: true, step, key, committed: false };
  await requirePassingTests(root, path, ledger);
  const { sha, hookRetried } = commitOrStop(root, path, plan);
  updateLedger(path, (current) => ({ ...current, commits: [...current.commits, sha] }));
  return { ok: true, step, key, committed: true, sha, message: plan.message, paths: plan.paths, hookRetried };
}

export const VERBS = { "run open": runOpen, "gate eval": gateEval, "human approve": humanApprove, "human accept": humanAccept, test: runTests, checkpoint };

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
    const expected = e instanceof Refusal || e instanceof UsageError || e instanceof LedgerRefused || e instanceof TestRunRefused || e instanceof CheckpointRefused;
    console.error(`pb: ${expected ? e.message : `unexpected failure: ${e.message}`}`);
    process.exit(e instanceof UsageError ? 2 : 1);
  }
}
