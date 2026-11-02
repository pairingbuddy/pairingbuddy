#!/usr/bin/env node
// pb: deterministic workflow CLI. Verbs live in the VERBS table; later tasks add more.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { KINDS, LEDGER_VERSION, writeLedger } from "../shared-node/ledger.mjs";
import { VERB_CLASSES, matchVerb } from "../shared-node/verbs.mjs";

export { KINDS };

const PROTECTED_BRANCHES = ["main", "master"];

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
  const configHash = createHash("sha256").update(readFileSync(configPath)).digest("hex");

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

export const VERBS = { "run open": runOpen };

function main(argv) {
  const name = matchVerb(argv);
  if (!Object.hasOwn(VERBS, name)) {
    const known = Object.keys(VERBS).filter((verb) => !VERB_CLASSES.human.includes(verb));
    throw new UsageError(`unknown verb: ${argv.slice(0, 2).join(" ") || "(none)"}. Known: ${known.join(", ")}`);
  }
  console.log(JSON.stringify(VERBS[name](argv.slice(name.split(" ").length))));
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
    console.error(`pb: ${e instanceof Refusal || e instanceof UsageError ? e.message : `unexpected failure: ${e.message}`}`);
    process.exit(e instanceof UsageError ? 2 : 1);
  }
}
