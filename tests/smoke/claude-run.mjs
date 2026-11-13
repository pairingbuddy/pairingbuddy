// One capped `claude -p` run against this worktree's plugin, for smoke. The Node side of runner.py, with the same rules:
// `--plugin-dir` applies to the spawned run alone, `--setting-sources project,local` keeps user settings and installed
// plugins out, and the cheap model comes through P16's env, because `--model` does not override an agent's pin.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
export const BUDGET_USD = 3;
const RUN_TIMEOUT_MS = 1_200_000;
export const CHEAP_MODEL = "claude-haiku-5-5";
export const DROPPED_PREFIXES = ["PAIRINGBUDDY", "PB_", "CLAUDE", "ANTHROPIC_", "GIT_"];

export class SmokeError extends Error {}
export class SpendCapError extends SmokeError {}
// The harness killed the run on purpose, through its abort signal.
export class KilledError extends SmokeError {}

export class Budget {
  constructor(total = BUDGET_USD) {
    this.total = total;
    this.spent = 0;
    this.costKnown = true;
    // True once a run was charged its cap for want of a reported cost: spent is then an upper bound.
    this.upperBound = false;
  }

  get remaining() {
    return this.total - this.spent;
  }

  charge(usd) {
    this.spent += usd;
  }
}

export function cleanEnv(inherited = process.env) {
  const kept = Object.entries(inherited).filter(([name]) => !DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix)));
  return { ...Object.fromEntries(kept), ANTHROPIC_DEFAULT_OPUS_MODEL: CHEAP_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL: CHEAP_MODEL };
}

// resume is a session id from an earlier run's stream: the run goes on in that conversation.
export const claudeCommand = (prompt, budgetUsd, pluginDir = REPO_ROOT, resume = null) => [
  "-p", prompt,
  ...(resume === null ? [] : ["--resume", resume]),
  "--plugin-dir", pluginDir,
  "--model", "haiku",
  "--effort", "low",
  "--setting-sources", "project,local",
  "--strict-mcp-config",
  "--permission-mode", "auto",
  "--max-budget-usd", String(budgetUsd),
  "--output-format", "stream-json",
  "--verbose",
  "--include-hook-events",
];

// Auto mode fails an in-repo Write with no verdict when the cwd is inside `--plugin-dir`.
export function refuseRepoInsidePlugin(repo) {
  const path = (() => {
    try {
      return realpathSync(repo);
    } catch {
      return repo;
    }
  })();
  if (path === REPO_ROOT || path.startsWith(REPO_ROOT + sep)) throw new SmokeError(`${repo} is inside the --plugin-dir ${REPO_ROOT}: use a directory outside it`);
}

function parsedLine(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function eachLine(stream, onLine) {
  let held = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (held + chunk).split("\n");
    held = lines.pop();
    for (const line of lines) onLine(line);
  });
  stream.on("end", () => {
    if (held !== "") onLine(held);
  });
}

const killGroup = (child) => {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // the group has gone already
  }
};

// A process forked while its group is being killed can miss the signal, so the kill repeats until the run closes.
const KILL_REPEAT_MS = 100;

function runOnce(repo, args, env, onEvent, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stderr = "";
    let timedOut = false;
    let killed = false;
    let repeat = null;
    const killUntilClosed = () => {
      killGroup(child);
      repeat ??= setInterval(() => killGroup(child), KILL_REPEAT_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killUntilClosed();
    }, timeoutMs);
    const kill = () => {
      killed = true;
      killUntilClosed();
    };
    if (signal?.aborted) kill();
    else signal?.addEventListener("abort", kill, { once: true });
    eachLine(child.stdout, (line) => {
      const event = parsedLine(line);
      if (event !== null) onEvent(event);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-500);
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      clearInterval(repeat);
      reject(new SmokeError(`cannot run claude: ${e.code ?? e.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearInterval(repeat);
      signal?.removeEventListener("abort", kill);
      resolve({ code, stderr, timedOut, killed });
    });
  });
}

const isCapResult = (event) => event.subtype === "error_max_budget_usd" || event.terminal_reason === "budget_exhausted";

function checkFinished(results, { code, stderr, timedOut }, timeoutMs) {
  if (timedOut) throw new SmokeError(`claude timed out after ${timeoutMs / 1000}s`);
  if (results.some(isCapResult)) throw new SpendCapError(`the spend cap ended the run: ${JSON.stringify(results.at(-1).errors)}`);
  if (code !== 0) throw new SmokeError(`claude exit ${code}: ${stderr}`);
  if (results.length === 0) throw new SmokeError("no result event in the stream");
  if (results.at(-1).is_error) throw new SmokeError(`result error ${results.at(-1).subtype}`);
}

// Charges `budget` first, so spend is known to the caller even when this throws. timeoutMs is the wall-clock limit of this one run.
// capUsd lowers this run's own spend cap below what is left of the budget. Aborting `signal` kills the run's whole
// process group: a killed run reports no cost, so it is charged its whole cap, the spend becomes an upper bound, and
// runClaude throws KilledError.
export async function runClaude(repo, prompt, budget, { env = cleanEnv(), onLine = () => {}, pluginDir = REPO_ROOT, resume = null, timeoutMs = RUN_TIMEOUT_MS, capUsd = Infinity, signal = null } = {}) {
  if (budget.remaining <= 0) throw new SpendCapError(`the spend cap is used up at $${budget.spent.toFixed(4)}`);
  refuseRepoInsidePlugin(repo);
  const results = [];
  const costs = [];
  const cap = Number(Math.min(budget.remaining, capUsd).toFixed(6));
  const exit = await runOnce(repo, claudeCommand(prompt, cap, pluginDir, resume), env, (event) => {
    if (event.type === "result") results.push(event);
    if ("total_cost_usd" in event) costs.push(event.total_cost_usd);
    onLine(event);
  }, timeoutMs, signal);
  if (costs.length > 0) budget.charge(Math.max(...costs));
  else if (exit.killed) {
    budget.charge(cap);
    budget.upperBound = true;
  } else budget.costKnown = false;
  if (exit.killed) throw new KilledError(`the run was killed on purpose, and charged its cap of $${cap}`);
  checkFinished(results, exit, timeoutMs);
  if (budget.remaining <= 0) throw new SpendCapError(`the run ended at the spend cap, $${budget.spent.toFixed(4)} of $${budget.total}`);
}

// The human's own pb call, from this shell: no claude, no policy env, the shim first on PATH.
export function humanPb(repo, gh, pluginDir, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(pluginDir, "cli", "pb.mjs"), ...args], { cwd: repo, env: { ...cleanEnv(), ...gh.env() }, encoding: "utf8" });
  return { code: status, stdout, stderr };
}

export const sessionOf = (stream) => stream.map(({ event }) => event.session_id).find((id) => typeof id === "string") ?? null;

export function readLedgerOrNull(repo) {
  try {
    return JSON.parse(readFileSync(join(repo, ".pairingbuddy", "run", "task", "ledger.json"), "utf8"));
  } catch {
    return null;
  }
}
