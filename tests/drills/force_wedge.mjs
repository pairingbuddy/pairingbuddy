#!/usr/bin/env node
// Forces one wedged run on demand, for the recovery drill. Only ever touches a throwaway clone it made itself, so that
// a human can recover with the recipe in CONTRIBUTING.md without risking a real worktree.
// The session works in the clone and loads the plugin from a checkout beside it, because Claude Code treats every path
// inside an inline --plugin-dir as sensitive, and auto mode then fails an in-repo Write with no verdict.
// The run state comes from that checkout's own hooks and CLI, so a wedge is the state those really leave.
// Node built-ins only.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { shellWord } from "../../shared-node/shell-word.mjs";

const SOURCE = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));
const MARKER = join(".git", "pb-drill-clone");
const DROPPED_ENV = ["GIT_", "PAIRINGBUDDY", "CLAUDE"];
const STAGE = "code-config";
const SYNTAX_ERROR = "\n)drill: forced parse failure(\n";
const LEFTOVER = "drill-half-done.txt";
const TEST_CONFIG = { runners: { drill: { name: "drill", command: "node --version", test_directory: ".", file_pattern: "*", run_args: [] } }, default_runner: "drill" };

class Refused extends Error {}
class Usage extends Error {}

const isWithin = (path, dir) => path === dir || path.startsWith(`${dir}${sep}`);
const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !DROPPED_ENV.some((prefix) => key.startsWith(prefix))));

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: childEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// ---------- the throwaway clone ----------

const pluginOf = (clone) => join(dirname(clone), "plugin");

function readMarker(clone) {
  try {
    return readFileSync(join(clone, MARKER), "utf8");
  } catch {
    return null;
  }
}

function realDirectory(path) {
  try {
    return realpathSync(path);
  } catch {
    throw new Refused(`refusing ${path}: it does not exist`);
  }
}

// The marker names the clone's own path, so a copy of a clone is not a clone. A linked worktree has a .git file.
function assertThrowaway(path) {
  const clone = realDirectory(path);
  if (isWithin(clone, SOURCE) || isWithin(SOURCE, clone)) throw new Refused(`refusing ${clone}: it is the repo this script belongs to, or overlaps it`);
  if (!statSync(join(clone, ".git"), { throwIfNoEntry: false })?.isDirectory()) throw new Refused(`refusing ${clone}: it is not a clone this script made`);
  if (readMarker(clone) !== clone) throw new Refused(`refusing ${clone}: it is not a clone this script made`);
  return clone;
}

// With no remote, nothing the drill does can reach the repo it came from.
function makeClone() {
  const temp = realpathSync(tmpdir());
  if (isWithin(temp, SOURCE)) throw new Refused(`refusing to make a clone at ${temp}: it is inside the repo this script belongs to`);
  const parent = mkdtempSync(join(temp, "pb-drill-"));
  const clone = join(parent, "repo");
  git(parent, "clone", "--quiet", "--no-hardlinks", SOURCE, clone);
  git(clone, "remote", "remove", "origin");
  git(clone, "checkout", "--quiet", "-b", "drill");
  writeFileSync(join(clone, MARKER), clone);
  git(clone, "worktree", "add", "--quiet", "--detach", pluginOf(clone));
  return clone;
}

function resetClone(path) {
  const clone = assertThrowaway(path);
  git(clone, "reset", "--quiet", "--hard");
  git(clone, "clean", "-fdxq");
  git(pluginOf(clone), "reset", "--quiet", "--hard");
  git(pluginOf(clone), "clean", "-fdxq");
  return clone;
}

// ---------- driving the clone's own hooks and CLI ----------

const ledgerPathOf = (clone) => join(clone, ".pairingbuddy", "run", "task", "ledger.json");
const sessionOf = (clone, name) => `${basename(clone)}-${name}`;

function hook(clone, name, payload) {
  const result = spawnSync("node", [join(pluginOf(clone), "hooks", name)], { input: JSON.stringify(payload), cwd: clone, env: { ...childEnv(), CLAUDE_PLUGIN_ROOT: pluginOf(clone) }, encoding: "utf8" });
  if (result.status !== 0 || result.stdout.includes('"deny"')) throw new Error(`${name} refused the drill's setup: ${result.stdout}${result.stderr}`);
}

function gateCall(clone, session, tool, toolInput) {
  hook(clone, "gate-boot.mjs", { session_id: sessionOf(clone, session), cwd: clone, tool_name: tool, permission_mode: "default", tool_input: toolInput });
}

function pb(clone, ...args) {
  const result = spawnSync("node", [join(pluginOf(clone), "cli", "pb.mjs"), ...args], { cwd: clone, env: childEnv(), encoding: "utf8" });
  if (result.status !== 0) throw new Error(`pb ${args.join(" ")} failed in the drill's setup: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function openRun(clone) {
  mkdirSync(join(clone, ".pairingbuddy"));
  writeFileSync(join(clone, ".pairingbuddy", "test-config.json"), `${JSON.stringify(TEST_CONFIG, null, 2)}\n`);
  pb(clone, "run", "open", "--kind", "code");
  gateCall(clone, "first", "Bash", { command: "git status" });
}

// As far as the tap recording a run: from here only the stage itself would finish it.
function startStage(clone) {
  openRun(clone);
  const toolInput = { name: `pairingbuddy:${STAGE}`, args: { pluginRoot: pluginOf(clone), attempt: 1 } };
  gateCall(clone, "first", "Workflow", toolInput);
  hook(clone, "tap.mjs", { session_id: sessionOf(clone, "first"), cwd: clone, tool_name: "Workflow", tool_input: toolInput, tool_response: { runId: "wf_drill" } });
}

const importLedger = (clone) => import(pathToFileURL(join(pluginOf(clone), "shared-node", "ledger.mjs")).href);

// ---------- what each wedge does ----------

function insertBefore(path, anchor, text) {
  const source = readFileSync(path, "utf8");
  if (!source.includes(anchor)) throw new Error(`${path} no longer has the line this drill breaks: ${anchor}`);
  writeFileSync(path, source.replace(anchor, () => `${text}${anchor}`));
}

function forceGateThrow(clone) {
  startStage(clone);
  insertBefore(join(pluginOf(clone), "hooks", "gate.mjs"), "  if (runRoots.size > 0) {\n", '  if (runRoots.size > 0) throw new Error("drill: forced gate throw");\n');
}

function forceGateParse(clone) {
  startStage(clone);
  appendFileSync(join(pluginOf(clone), "hooks", "gate.mjs"), SYNTAX_ERROR);
}

function forceGateBootParse(clone) {
  startStage(clone);
  appendFileSync(join(pluginOf(clone), "hooks", "gate-boot.mjs"), SYNTAX_ERROR);
}

// A ledger writer killed under the lock, as a session killed mid-write leaves it. The lock is stale after STALE_LOCK_MS.
function killLockHolder(clone) {
  const moduleUrl = pathToFileURL(join(pluginOf(clone), "shared-node", "ledger.mjs")).href;
  const hold = `import(${JSON.stringify(moduleUrl)}).then(({ updateLedger }) => updateLedger(${JSON.stringify(ledgerPathOf(clone))}, () => {
    require("node:fs").writeSync(1, "held\\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }));`;
  const holder = spawn("node", ["-e", hold], { cwd: clone, env: childEnv(), stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((done, failed) => {
    holder.stdout.once("data", () => holder.kill("SIGKILL"));
    holder.once("error", failed);
    holder.once("close", (code, signal) => (signal === "SIGKILL" ? done() : failed(new Error(`the lock holder exited with ${code}`))));
  });
}

async function forceKilledSession(clone) {
  startStage(clone);
  writeFileSync(join(clone, LEFTOVER), "the stage was killed before it could commit this\n");
  await killLockHolder(clone);
}

async function forceKilledAtGate(clone) {
  openRun(clone);
  const { updateLedger } = await importLedger(clone);
  const stage = (name) => ({ name, status: "done", attempt: 1 });
  updateLedger(ledgerPathOf(clone), (ledger) => ({
    ...ledger,
    stage: { name: "code-safety-net", status: "done", runId: "wf_drill", attempt: 1, startedAt: null },
    stages: [stage(STAGE), stage("code-safety-net")],
  }));
  pb(clone, "gate", "eval");
}

function forceShaMismatch(clone) {
  startStage(clone);
  const path = ledgerPathOf(clone);
  writeFileSync(path, `${JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), task: "edited by hand" }, null, 2)}\n`);
}

function forceBrokenCli(clone) {
  startStage(clone);
  appendFileSync(join(pluginOf(clone), "shared-node", "run-root.mjs"), SYNTAX_ERROR);
}

const WEDGES = {
  "gate-throw": {
    recipe: "gate.mjs crash or throw",
    force: forceGateThrow,
    sees: "every Write, Edit, Bash and Workflow call is denied with 'Gate error during a run'.",
  },
  "gate-parse": {
    recipe: "gate.mjs parse failure",
    force: forceGateParse,
    sees: "every Write, Edit, Bash and Workflow call is denied with 'The gate could not load'.",
  },
  "gate-boot-parse": {
    recipe: "gate-boot.mjs parse failure",
    force: forceGateBootParse,
    sees: "the hook exits 1 with a SyntaxError and no decision, so nothing is being gated.",
  },
  "stranded-stage": {
    recipe: "Stranded active stage",
    force: startStage,
    sees: `stage ${STAGE} is active at attempt 1 with a recorded run that will never finish.`,
  },
  "killed-session": {
    recipe: "Killed session mid-stage",
    force: forceKilledSession,
    sees: `a fresh ledger lock, ${STAGE} active, and ${LEFTOVER} left in the tree.`,
  },
  "killed-at-gate": {
    recipe: "Killed session at a gate",
    force: forceKilledAtGate,
    sees: "G:task-end is waiting for a human, and the session that asked is gone.",
  },
  "sha-mismatch": {
    recipe: "Ledger SHA mismatch",
    force: forceShaMismatch,
    sees: "pb refuses with 'sha mismatch', and the gate denies Write, Edit and Workflow.",
  },
  "second-session": {
    recipe: "Second session in the same worktree",
    force: startStage,
    sees: `one session owns the run mid-${STAGE}. Start a second one: nothing warns, and it cannot move the run.`,
  },
  "no-unit": {
    recipe: "A run with no unit",
    force: openRun,
    sees: "pb task end refuses, and pb human abandon does not exist yet.",
  },
  "broken-cli": {
    recipe: "Broken CLI",
    force: forceBrokenCli,
    sees: "every pb call dies with a SyntaxError, and the gate denies every call.",
  },
};

// ---------- entry ----------

function parseArgs(argv) {
  const args = [...argv];
  const at = args.indexOf("--clone");
  const clone = at === -1 ? null : args.splice(at, 2)[1];
  if (at !== -1 && clone === undefined) throw new Usage("--clone needs a path");
  if (args.length === 1 && args[0] === "--list") return { list: true };
  const wedge = args[0]?.replace(/^--/, "");
  if (args.length !== 1 || !Object.hasOwn(WEDGES, wedge)) throw new Usage(`usage: force_wedge.mjs <one wedge> [--clone <a clone this script made>]\nwedges: ${Object.keys(WEDGES).map((name) => `--${name}`).join(" ")}`);
  return { wedge, clone };
}

function report(clone, wedge) {
  const word = shellWord(clone);
  const plugin = shellWord(pluginOf(clone));
  const { recipe, sees } = WEDGES[wedge];
  console.log(`Drill clone: ${clone}
Plugin: ${pluginOf(clone)}
Subject: ${git(clone, "rev-parse", "HEAD")} (committed code only)
Forced wedge: ${wedge}
What you see: ${sees}
Recipe: CONTRIBUTING.md, "${recipe}"

Start the session with:
cd ${word} && claude --plugin-dir ${plugin}

For the recipe's commands, in a separate terminal:
export ROOT=${word} PLUGIN=${plugin}

Delete the clone when you are done:
rm -rf ${shellWord(dirname(clone))}`);
}

async function main(argv) {
  const { list, wedge, clone: given } = parseArgs(argv);
  if (list) {
    console.log(Object.keys(WEDGES).map((name) => `--${name}`).join("\n"));
    return;
  }
  const clone = given === null ? assertThrowaway(makeClone()) : resetClone(given);
  await WEDGES[wedge].force(clone);
  report(clone, wedge);
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  console.error(`force_wedge: ${e.message}`);
  process.exit(e instanceof Usage ? 2 : 1);
}
