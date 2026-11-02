#!/usr/bin/env node
// pb: deterministic workflow CLI. Verbs live in the VERBS table; later tasks add more.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { answeredGate, askReason, blockingGate, dueGate, fileHash, gateQuestion, gatesFor, recordApproval, reopenedGate } from "../shared-node/gates.mjs";
import { KINDS, LEDGER_VERSION, LedgerRefused, LedgerShaMismatch, acceptLedger, readLedger, updateLedger, writeLedger } from "../shared-node/ledger.mjs";
import { findRunRoot } from "../shared-node/run-root.mjs";
import { REDO_STATUS, loadStages, nextAttempt } from "../shared-node/stages.mjs";
import { VERB_CLASSES, humanCommand, matchVerb, shaMismatchRemedy } from "../shared-node/verbs.mjs";

export { KINDS };

const PROTECTED_BRANCHES = ["main", "master"];
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
  if (PROTECTED_BRANCHES.includes(branch.toLowerCase())) throw new Refusal(`refusing to open a run on protected branch ${branch}`);

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

export const VERBS = { "run open": runOpen, "gate eval": gateEval, "human approve": humanApprove, "human accept": humanAccept };

function runVerb(name, args) {
  try {
    return VERBS[name](args);
  } catch (e) {
    if (e instanceof LedgerShaMismatch) throw new Refusal(shaMismatchRemedy(e.message, findRunRoot(process.cwd())));
    throw e;
  }
}

function main(argv) {
  const name = matchVerb(argv);
  if (!Object.hasOwn(VERBS, name)) {
    const known = Object.keys(VERBS).filter((verb) => !VERB_CLASSES.human.includes(verb));
    throw new UsageError(`unknown verb: ${argv.slice(0, 2).join(" ") || "(none)"}. Known: ${known.join(", ")}`);
  }
  console.log(JSON.stringify(runVerb(name, argv.slice(name.split(" ").length))));
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
    main(process.argv.slice(2));
  } catch (e) {
    const expected = e instanceof Refusal || e instanceof UsageError || e instanceof LedgerRefused;
    console.error(`pb: ${expected ? e.message : `unexpected failure: ${e.message}`}`);
    process.exit(e instanceof UsageError ? 2 : 1);
  }
}
