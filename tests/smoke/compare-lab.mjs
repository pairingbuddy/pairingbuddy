// Compare lab: the released Pairing Buddy (old, a worktree of tag v0.7.0) and a new build on one fixture task, same
// model, unattended, side by side. See COMPARE.md. It spends money, so no suite runs it; the tests cover the pure parts.
//
//   node tests/smoke/compare-lab.mjs setup [options]            make the lab: two identical repos, the old plugin
//   node tests/smoke/compare-lab.mjs run old|new|both [--lab D]  run claude -p in one repo or both (both in parallel);
//                                                                new resumes its session until its run ends
//   node tests/smoke/compare-lab.mjs reset old|new|both [--lab D] put a side's repo back at the start, its results gone
//   node tests/smoke/compare-lab.mjs judge [--lab D]             diffs, test runs, and a blind A/B judge
//   node tests/smoke/compare-lab.mjs summary [--lab D]           results.json and summary.md
//   node tests/smoke/compare-lab.mjs all [options]               setup, run both, judge, summary
//
// Nothing reaches GitHub: each repo's origin is a local bare repo and `gh` is the recording shim first on PATH.
// ANTHROPIC_API_KEY must not be set: it switches billing, so the script refuses to start and unsets it in every child.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { installGhShim } from "../js/gh-shim.mjs";
import { DROPPED_PREFIXES, REPO_ROOT } from "./claude-run.mjs";

export const SIDES = ["old", "new"];
export const OLD_REF = "v0.7.0";
export const FIXTURE = join(REPO_ROOT, "tests", "smoke", "fixtures", "compare-schedule");
export const MODEL_IDS = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5", haiku: "claude-haiku-5-5" };
export const CRITERIA = ["correctness", "test_quality", "readability", "scope_discipline"];
const TIERS = ["same", "native"];
const DEFAULTS = { model: "sonnet", tiers: "same", permissionMode: "bypassPermissions", budgetUsd: 25, timeoutMin: 120, maxResumes: 30, newPlugin: REPO_ROOT, oldRef: OLD_REF };

export class UsageError extends Error {}
export class LabError extends Error {}

export const USAGE = `usage: compare-lab.mjs <command> [options]
  setup [--model sonnet|opus|haiku|<id>] [--tiers same|native] [--permission-mode <mode>] [--budget-usd N]
        [--timeout-min N] [--max-resumes N] [--new-plugin <dir>] [--old-ref <tag> | --old-plugin <dir>] [--root <dir>]
  run old|new|both [--lab <dir>]
  reset old|new|both [--lab <dir>]
  judge [--lab <dir>]
  summary [--lab <dir>]
  all   [setup options]`;

const VALUE_FLAGS = { "--model": "model", "--tiers": "tiers", "--permission-mode": "permissionMode", "--budget-usd": "budgetUsd", "--timeout-min": "timeoutMin", "--max-resumes": "maxResumes", "--new-plugin": "newPlugin", "--old-ref": "oldRef", "--old-plugin": "oldPlugin", "--root": "root", "--lab": "lab" };
const SETUP_KEYS = ["model", "tiers", "permissionMode", "budgetUsd", "timeoutMin", "maxResumes", "newPlugin", "oldRef", "oldPlugin", "root"];
const ALLOWED = { setup: SETUP_KEYS, all: SETUP_KEYS, run: ["lab"], reset: ["lab"], judge: ["lab"], summary: ["lab"] };
const PERMISSION_MODES = ["bypassPermissions", "acceptEdits", "auto", "default", "dontAsk"];

const positive = (name, text) => {
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${name} takes a positive number, not ${text}`);
  return n;
};

// argv after the script name. Returns { command, side, options }; options holds the defaults for setup and all.
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!(command in ALLOWED)) throw new UsageError(command === undefined ? "no command" : `unknown command ${command}`);
  let side = null;
  if (command === "run" || command === "reset") {
    side = rest.shift();
    if (![...SIDES, "both"].includes(side)) throw new UsageError(`${command} takes old, new or both, not ${side ?? "nothing"}`);
  }
  const options = ALLOWED[command] === SETUP_KEYS ? { ...DEFAULTS } : {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = VALUE_FLAGS[rest[i]];
    if (key === undefined || !ALLOWED[command].includes(key)) throw new UsageError(`${command} does not take ${rest[i]}`);
    if (rest[i + 1] === undefined || rest[i + 1].startsWith("--")) throw new UsageError(`${rest[i]} needs a value`);
    options[key] = rest[i + 1];
  }
  if ("budgetUsd" in options) options.budgetUsd = positive("--budget-usd", options.budgetUsd);
  if ("timeoutMin" in options) options.timeoutMin = positive("--timeout-min", options.timeoutMin);
  if ("maxResumes" in options) {
    options.maxResumes = Number(options.maxResumes);
    if (!Number.isInteger(options.maxResumes) || options.maxResumes < 0) throw new UsageError("--max-resumes takes a whole number, 0 or more");
  }
  if ("tiers" in options && !TIERS.includes(options.tiers)) throw new UsageError(`--tiers takes same or native, not ${options.tiers}`);
  if ("permissionMode" in options && !PERMISSION_MODES.includes(options.permissionMode)) throw new UsageError(`--permission-mode takes one of ${PERMISSION_MODES.join(", ")}`);
  return { command, side, options };
}

export const modelId = (model) => MODEL_IDS[model] ?? model;

// The environment without any PAIRINGBUDDY, PB_, CLAUDE, ANTHROPIC_ (so no ANTHROPIC_API_KEY) or GIT_ variable.
export const withoutDropped = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([name]) => !DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix))));

export function refuseApiKey(env = process.env) {
  if (env.ANTHROPIC_API_KEY !== undefined) throw new LabError("ANTHROPIC_API_KEY is set. It switches claude to API billing, so the lab will not run. Unset it and try again.");
}

// The child environment for one side: the inherited one without any PAIRINGBUDDY, PB_, CLAUDE, ANTHROPIC_ or GIT_
// variable, the gh shim first on PATH, every model tier on the one model when tiers is same, and the side's own
// unattended switch: Solo mode for old, the auto gate policy for new. claude -p waits for background tasks (the new
// build's stage Workflows) and takes each one's notification as a new turn, but by default it stops them 10 minutes
// after the last turn; 0 makes it wait for them, so the side's own timeout is the only limit.
export function runEnv(side, lab, inherited = process.env) {
  refuseApiKey(inherited);
  const kept = withoutDropped(inherited);
  const id = modelId(lab.model);
  const tiers = lab.tiers === "same" ? { ANTHROPIC_DEFAULT_OPUS_MODEL: id, ANTHROPIC_DEFAULT_SONNET_MODEL: id, ANTHROPIC_DEFAULT_HAIKU_MODEL: id } : {};
  const own = side === "old" ? { PAIRINGBUDDY_SOLO: "true", PAIRINGBUDDY_SOLO_MAX_RETRIES: "5" } : { PAIRINGBUDDY_GATE_POLICY: "auto" };
  const { shim } = lab.sides[side];
  return { ...kept, ...tiers, ...own, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0", PATH: `${shim.dir}:${kept.PATH ?? ""}`, GH_SHIM_LOG: shim.log, GH_SHIM_OPENED: shim.opened };
}

export const runPrompt = (task) => `/pairingbuddy:code ${task}`;

// A resume goes on in that session with its own prompt; budgetUsd is what is left of the side's cap.
export function runArgs(side, lab, { prompt = runPrompt(lab.task), resume = null, budgetUsd = lab.budgetUsd } = {}) {
  return [
    "-p", prompt,
    ...(resume === null ? [] : ["--resume", resume]),
    "--output-format", "json",
    "--model", modelId(lab.model),
    "--plugin-dir", lab.sides[side].plugin.dir,
    "--setting-sources", "project,local",
    "--strict-mcp-config",
    "--permission-mode", lab.permissionMode,
    "--max-budget-usd", String(budgetUsd),
  ];
}

// stdout of `claude -p --output-format json`: one result object, maybe after other lines. null when there is none.
export function parseRunResult(stdout) {
  const candidates = [stdout.trim(), ...stdout.trim().split("\n").reverse()];
  for (const text of candidates) {
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      continue;
    }
    if (event?.type !== "result") continue;
    return {
      subtype: event.subtype ?? null,
      isError: event.is_error === true,
      durationMs: event.duration_ms ?? null,
      durationApiMs: event.duration_api_ms ?? null,
      numTurns: event.num_turns ?? null,
      costUsd: event.total_cost_usd ?? null,
      sessionId: event.session_id ?? null,
      usage: event.usage ?? null,
      modelUsage: event.modelUsage ?? null,
      permissionDenials: Array.isArray(event.permission_denials) ? event.permission_denials.length : null,
      resultText: typeof event.result === "string" ? event.result.slice(-2000) : null,
      structuredOutput: event.structured_output ?? null,
    };
  }
  return null;
}

// ---------- transcripts ----------

const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, messages: 0 });
const addTokens = (into, usage) => {
  into.input += usage.input_tokens ?? 0;
  into.output += usage.output_tokens ?? 0;
  into.cacheRead += usage.cache_read_input_tokens ?? 0;
  into.cacheCreation += usage.cache_creation_input_tokens ?? 0;
  into.messages += 1;
};

// Sums assistant usage over transcript texts (JSONL). A message split over several lines repeats its usage under one
// message id, so each id counts once, with the last usage seen. Synthetic messages carry no real usage.
export function sumTranscripts(texts) {
  const byId = new Map();
  for (const text of texts) {
    for (const line of text.split("\n")) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const message = entry?.type === "assistant" ? entry.message : null;
      if (!message?.usage || message.model === "<synthetic>") continue;
      byId.set(message.id ?? `${entry.uuid}`, { model: message.model ?? "unknown", usage: message.usage });
    }
  }
  const total = emptyTokens();
  const byModel = {};
  for (const { model, usage } of byId.values()) {
    addTokens(total, usage);
    addTokens((byModel[model] ??= emptyTokens()), usage);
  }
  return { total, byModel };
}

const walkJsonl = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return walkJsonl(path);
    return d.name.endsWith(".jsonl") && d.name !== "journal.jsonl" ? [path] : [];
  });

// Claude Code names a project's transcript folder after its cwd, every character but letters and digits made "-".
export const projectFolderName = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

// The session's own transcript and everything under its folder (Agent subagents, workflow agents), found by session id;
// with no id, every session in the repo's project folder. projects is ~/.claude/projects.
export function transcriptFiles({ sessionId, repo, projects = join(homedir(), ".claude", "projects") }) {
  if (!existsSync(projects)) return [];
  if (sessionId) {
    for (const folder of readdirSync(projects)) {
      const main = join(projects, folder, `${sessionId}.jsonl`);
      if (!existsSync(main)) continue;
      const sub = join(projects, folder, sessionId);
      return [main, ...(existsSync(sub) ? walkJsonl(sub) : [])];
    }
    return [];
  }
  let real = repo;
  try {
    real = realpathSync(repo);
  } catch {}
  const folder = join(projects, projectFolderName(real));
  return existsSync(folder) ? walkJsonl(folder) : [];
}

export const transcriptUsage = (where) => transcriptUsageOf(transcriptFiles(where));

// Over several sessions' files (a resume that got a new session id); a file or message seen twice counts once.
export function transcriptUsageOf(found) {
  const files = [...new Set(found)];
  const sum = sumTranscripts(files.map((f) => readFileSync(f, "utf8")));
  return { files: files.length, agentFiles: files.filter((f) => /agent-[^/]+\.jsonl$/.test(f)).length, ...sum };
}

// ---------- setup ----------

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
// The start commit is made with a fixed date, so both repos start from the same sha.
const FIXED_COMMIT_ENV = { GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
const pad = (n) => String(n).padStart(2, "0");
export const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
export const LABS_ROOT = () => process.env.PB_COMPARE_LABS ?? join(tmpdir(), "pb-compare-labs");

const PYTEST = "uv run --no-project --with pytest pytest";
const BASE_FILES = { ".gitignore": ".pairingbuddy/\n__pycache__/\n.pytest_cache/\n", "pytest.ini": "[pytest]\npythonpath = .\n" };
// v0.7.0's test-config schema allows no selector_template; the new build uses it to run one test.
export function testConfig(side) {
  const runner = { name: "pytest", command: PYTEST, test_directory: "tests", file_pattern: "test_*.py", run_args: ["-q"], ...(side === "new" ? { selector_template: ["{test_file}::{test_function}"] } : {}) };
  return { source_directory: ".", runners: { pytest: runner }, default_runner: "pytest" };
}
const NO_DOCS = { in_repo_docs: [], external_docs: [], last_verified: "2026-01-01T00:00:00Z" };

// One side's repo on main with a bare origin holding main. The committed tree is the fixture alone, the same for both
// sides; the gitignored .pairingbuddy/ configs are each build's own.
function makeSideRepo(dir, side, fixture) {
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  cpSync(join(fixture, "files"), repo, { recursive: true });
  for (const [path, text] of Object.entries(BASE_FILES)) writeFileSync(join(repo, path), text);
  mkdirSync(join(repo, ".pairingbuddy"));
  writeFileSync(join(repo, ".pairingbuddy", "test-config.json"), JSON.stringify(testConfig(side), null, 2));
  writeFileSync(join(repo, ".pairingbuddy", "doc-config.json"), JSON.stringify(NO_DOCS, null, 2));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "lab@example.invalid");
  git(repo, "config", "user.name", "lab");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "tag.gpgsign", "false");
  git(repo, "add", "-A");
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo, stdio: "ignore", env: { ...withoutDropped(), ...FIXED_COMMIT_ENV } });
  const origin = join(dir, "origin.git");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
  return { repo, origin, startCommit: git(repo, "rev-parse", "HEAD"), tree: git(repo, "rev-parse", "HEAD^{tree}") };
}

const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

// The old plugin is a detached worktree of oldRef, made inside the lab; oldPlugin skips that (tests pass a dir).
export function setupLab({ root = LABS_ROOT(), model = DEFAULTS.model, tiers = DEFAULTS.tiers, permissionMode = DEFAULTS.permissionMode, budgetUsd = DEFAULTS.budgetUsd, timeoutMin = DEFAULTS.timeoutMin, maxResumes = DEFAULTS.maxResumes, newPlugin = DEFAULTS.newPlugin, oldRef = DEFAULTS.oldRef, oldPlugin = null, fixture = FIXTURE, now = new Date() } = {}) {
  mkdirSync(root, { recursive: true });
  const dir = join(realpathSync(root), stamp(now));
  if (existsSync(dir)) throw new LabError(`${dir} exists already`);
  const newDir = realpathSync(newPlugin);
  for (const plugin of [newDir, ...(oldPlugin === null ? [] : [realpathSync(oldPlugin)])]) {
    if (inside(dir, plugin)) throw new LabError(`the lab ${dir} is inside the plugin ${plugin}: use another --root`);
  }
  mkdirSync(dir);
  let old;
  if (oldPlugin === null) {
    const path = join(dir, `plugin-${oldRef}`);
    git(REPO_ROOT, "worktree", "add", "-q", "--detach", path, oldRef);
    old = { dir: path, ref: oldRef, sha: git(path, "rev-parse", "HEAD"), worktree: true };
  } else {
    const path = realpathSync(oldPlugin);
    let sha = null;
    try {
      sha = git(path, "rev-parse", "HEAD");
    } catch {}
    old = { dir: path, ref: null, sha, worktree: false };
  }
  const task = readFileSync(join(fixture, "task.txt"), "utf8").trim();
  writeFileSync(join(dir, "task.txt"), `${task}\n`);
  let newSha = null;
  let newDirty = null;
  try {
    newSha = git(newDir, "rev-parse", "HEAD");
    newDirty = git(newDir, "status", "--porcelain").split("\n").filter(Boolean).length;
  } catch {}
  const sides = {};
  for (const side of SIDES) {
    const sideDir = join(dir, side);
    mkdirSync(sideDir);
    const made = makeSideRepo(sideDir, side, fixture);
    const gh = installGhShim({ parent: sideDir, remember: true });
    const env = gh.env();
    sides[side] = { ...made, plugin: side === "old" ? old : { dir: newDir, ref: null, sha: newSha, dirtyFiles: newDirty }, shim: { dir: gh.dir, log: env.GH_SHIM_LOG, opened: env.GH_SHIM_OPENED } };
  }
  if (sides.old.startCommit !== sides.new.startCommit) throw new LabError("the two repos do not start from the same commit");
  const lab = { dir, created: now.toISOString(), fixture, task, model, modelId: modelId(model), tiers, permissionMode, budgetUsd, timeoutMin, maxResumes, sides };
  writeFileSync(join(dir, "lab.json"), JSON.stringify(lab, null, 2));
  return lab;
}

export const readLab = (dir) => JSON.parse(readFileSync(join(dir, "lab.json"), "utf8"));

export function latestLab(root = LABS_ROOT()) {
  let names = [];
  try {
    names = readdirSync(root).filter((name) => existsSync(join(root, name, "lab.json")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const name = names.sort().at(-1);
  if (name === undefined) throw new LabError(`no lab under ${root}: run setup first`);
  return join(root, name);
}

// ---------- run ----------

const resultsDir = (lab, ...parts) => {
  const path = join(lab.dir, "results", ...parts);
  mkdirSync(path, { recursive: true });
  return path;
};

// Runs a command in its own process group; kills the group at timeoutMs. Resolves with what it printed.
export function spawnCapture(command, args, { cwd, env, input = null, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env, stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (c) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c) => (stderr += c));
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(new LabError(`cannot run ${command}: ${e.code ?? e.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, wallMs: Date.now() - started });
    });
    if (input !== null) child.stdin.end(input);
  });
}

// ---------- end state ----------
//
// Where a side's run really ended, read from its repo, not from claude's exit code. Every end state has the same shape:
// { state, finished, waitingForHuman, reason, ...more }.

const readJsonOr = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

// The runs the new build kept under .pairingbuddy/reports/runs/ as each ended: its kind and the PR a publish opened.
export function keptRuns(repo) {
  const runs = join(repo, ".pairingbuddy", "reports", "runs");
  if (!existsSync(runs)) return [];
  return readdirSync(runs)
    .filter((runId) => existsSync(join(runs, runId, "kept.json")))
    .sort()
    .map((runId) => {
      const kept = readJsonOr(join(runs, runId, "kept.json"), {});
      return { runId, kind: readJsonOr(join(runs, runId, "ledger.json"), {}).kind ?? null, prUrl: typeof kept.prUrl === "string" ? kept.prUrl : null };
    });
}

const end = (state, over = {}) => ({ state, finished: false, waitingForHuman: false, reason: null, ...over });

// status is what `pb status --action` gave ({ code, stdout, stderr }); kept is keptRuns. With no run open, a kept publish
// run means the task ended and its publish ran: finished when it opened a PR. pb's next action says when only a human
// can go on (the same order the build's own nextAction checks).
export function newEndState({ status, kept }) {
  if (status.code !== 0) {
    const said = `${status.stderr}${status.stdout}`.trim();
    if (!/no run here/.test(said)) return end("unreadable", { reason: `pb status failed (exit ${status.code}): ${said.slice(0, 500)}` });
    const publish = kept.filter((run) => run.kind === "publish").at(-1);
    if (publish?.prUrl) return end("ended", { finished: true, pr: publish.prUrl, reason: `the task ended and the PR was opened: ${publish.prUrl}` });
    if (publish) return end("ended-no-pr", { reason: "the task ended and its publish run closed, but it opened no PR" });
    if (kept.length > 0) return end("task-ended", { reason: "the task ended, and its publish run has not run" });
    return end("not-started", { reason: "no run was opened" });
  }
  let s;
  try {
    s = JSON.parse(status.stdout);
  } catch {
    return end("unreadable", { reason: `pb status gave output that is not JSON: ${status.stdout.slice(0, 300)}` });
  }
  const stage = { stage: s.stage?.name || null, stageStatus: s.stage?.status || null, action: s.action ?? null };
  if (typeof s.action === "string" && s.action.startsWith("The human answered")) return end("needs-human", { ...stage, waitingForHuman: true, reason: s.action });
  if (s.stop) return end("stopped", { ...stage, waitingForHuman: true, reason: s.stop.reason ?? "the run stopped" });
  if (s.stage?.status !== "active" && s.needsHuman) return end("needs-human", { ...stage, waitingForHuman: true, reason: `${s.needsHuman.gate}: ${s.needsHuman.reason}` });
  return end("running", { ...stage, reason: s.stage?.status === "active" ? `stage ${s.stage.name} is still active` : `next: ${s.next?.stage ?? "a gate or the task end"}` });
}

// The new build's own read of its run: `pb status --action` in the repo, which writes nothing.
export function readNewEnd(lab, side = "new") {
  const { repo, plugin } = lab.sides[side];
  const r = spawnSync(process.execPath, [join(plugin.dir, "cli", "pb.mjs"), "status", "--action"], { cwd: repo, env: withoutDropped(), encoding: "utf8" });
  return newEndState({ status: { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? r.error?.message ?? "" }, kept: keptRuns(repo) });
}

// v0.7.0 under Solo mode writes .pairingbuddy/SOLO_BUDDY_REPORT.md when it runs a plan. A single /code task writes
// none, so its last step, the commit agent's commit-result.json, stands in.
export function oldEndState(repo) {
  const state = join(repo, ".pairingbuddy");
  const report = existsSync(join(state, "SOLO_BUDDY_REPORT.md")) ? readFileSync(join(state, "SOLO_BUDDY_REPORT.md"), "utf8") : null;
  if (report !== null) {
    const status = [...report.matchAll(/\*\*Status:\*\*\s*(\S+)/g)].at(-1)?.[1] ?? "unknown";
    const stopped = report.includes("## Stopped") ? /## Stopped[\s\S]*?\*\*Reason:\*\*\s*(.+)/.exec(report)?.[1]?.trim() ?? "the Solo report says it stopped" : null;
    if (stopped !== null || status === "stopped") return end("stopped", { waitingForHuman: true, reason: stopped ?? "the Solo report says it stopped" });
    return end(status, { finished: status === "completed", reason: `the Solo report's status is ${status}` });
  }
  const commit = readJsonOr(join(state, "commit-result.json"), null);
  if (commit?.status === "success") return end("committed", { finished: true, reason: `no Solo report (one task, no plan); the final commit ${String(commit.commit_sha ?? "").slice(0, 7)} succeeded` });
  return end("unknown", { reason: "no Solo report and no successful final commit" });
}

export const sideEnd = (lab, side) => (side === "new" ? readNewEnd(lab, side) : oldEndState(lab.sides[side].repo));

// ---------- the resume loop ----------

// Why the loop stops after an invocation, or null to resume. Only the new build's run is resumed.
export function resumeStop({ end: e, result, exit, resumes, maxResumes, elapsedMs, timeoutMs, spentUsd, budgetUsd }) {
  if (e.finished || e.state === "ended" || e.state === "ended-no-pr") return `the run ended: ${e.reason ?? e.state}`;
  if (e.waitingForHuman) return `waiting for a human: ${e.reason}`;
  if (e.state === "unreadable") return e.reason;
  if (exit.timedOut || elapsedMs >= timeoutMs) return "the wall time limit was reached";
  if (result?.subtype === "error_max_budget_usd" || spentUsd >= budgetUsd) return "the budget is spent";
  if (!result?.sessionId) return `no session to resume (exit ${exit.code})`;
  if (resumes >= maxResumes) return `the resume cap (${maxResumes}) was reached`;
  return null;
}

// What the resumed session is told. A stage left active when claude exited lost its workflow with the process.
export function continuePrompt(e, pluginDir) {
  const lost = e.stageStatus === "active" ? ` The last claude process ended while stage ${e.stage} was active, so its workflow was stopped with it.` : "";
  return `Continue the Pairing Buddy run in this repo. No human is available.${lost} Run node ${join(pluginDir, "cli", "pb.mjs")} status --action and do what it says, until the task has ended and its publish has run.`;
}

const sumOf = (results, key) => (results.some((r) => typeof r[key] === "number") ? results.reduce((sum, r) => sum + (r[key] ?? 0), 0) : null);

// A resumed session's total_cost_usd (and the API time saved with it) goes on from the total its transcript saved, so
// each result carries the running total. What one invocation added is the rise from the one before; a total that fell
// started over (nothing was saved), so all of it is new.
export const spendSteps = (totals) => totals.map((total, i) => (i > 0 && total >= totals[i - 1] ? total - totals[i - 1] : total));
const totalOf = (results, key) => {
  const totals = results.map((r) => r[key]).filter((v) => typeof v === "number");
  return totals.length === 0 ? null : Number(spendSteps(totals).reduce((sum, v) => sum + v, 0).toFixed(6));
};

// One result for all invocations: cost and API time as running totals, turns and durations summed (each result counts
// its own), the last one's subtype and text.
export function combineResults(results) {
  const got = results.filter((r) => r !== null);
  if (got.length === 0) return null;
  const last = got.at(-1);
  return { ...last, invocations: results.length, costUsd: totalOf(got, "costUsd"), numTurns: sumOf(got, "numTurns"), durationMs: sumOf(got, "durationMs"), durationApiMs: totalOf(got, "durationApiMs"), isError: last.isError, permissionDenials: sumOf(got, "permissionDenials"), sessionIds: [...new Set(got.map((r) => r.sessionId).filter(Boolean))] };
}

// claude.json for the first invocation, claude.<n>.json for the nth; stderr likewise.
const invocationFile = (name, ext, n) => (n === 1 ? `${name}.${ext}` : `${name}.${n}.${ext}`);

// The new side resumes its session (same flags, what is left of the budget and the wall time) until its run ends,
// waits for a human, or a cap is reached. Old runs once. claude is the executable, inherited the parent environment.
export async function runSide(lab, side, { projects, claude = "claude", inherited = process.env } = {}) {
  const out = resultsDir(lab, side);
  const { repo, plugin } = lab.sides[side];
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const timeoutMs = lab.timeoutMin * 60_000;
  const maxResumes = lab.maxResumes ?? DEFAULTS.maxResumes;
  const env = runEnv(side, lab, inherited);
  const results = [];
  const exits = [];
  let args = runArgs(side, lab);
  let e;
  let stoppedBecause;
  for (let n = 1; ; n++) {
    console.error(`${side}: claude -p in ${repo} (plugin ${plugin.dir})${n > 1 ? `, resume ${n - 1}` : ""}`);
    const exit = await spawnCapture(claude, args, { cwd: repo, env, timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)) });
    writeFileSync(join(out, invocationFile("claude", "json", n)), exit.stdout);
    writeFileSync(join(out, invocationFile("stderr", "txt", n)), exit.stderr);
    const result = parseRunResult(exit.stdout);
    results.push(result);
    exits.push({ exitCode: exit.code, timedOut: exit.timedOut, wallMs: exit.wallMs });
    e = sideEnd(lab, side);
    const spentUsd = combineResults(results)?.costUsd ?? 0;
    stoppedBecause = side === "new" ? resumeStop({ end: e, result, exit, resumes: n - 1, maxResumes, elapsedMs: Date.now() - started, timeoutMs, spentUsd, budgetUsd: lab.budgetUsd }) : "old runs once";
    console.error(`${side}: invocation ${n} done in ${Math.round(exit.wallMs / 1000)}s, exit ${exit.code}${exit.timedOut ? " (timed out)" : ""}, cost ${result?.costUsd ?? "unknown"}, run ${e.state}`);
    if (stoppedBecause !== null) break;
    args = runArgs(side, lab, { prompt: continuePrompt(e, plugin.dir), resume: result.sessionId, budgetUsd: Number((lab.budgetUsd - spentUsd).toFixed(6)) });
  }
  const result = combineResults(results);
  const sessionIds = result?.sessionIds ?? [];
  const transcript = sessionIds.length <= 1 ? transcriptUsage({ sessionId: sessionIds[0] ?? null, repo, projects }) : transcriptUsageOf(sessionIds.flatMap((sessionId) => transcriptFiles({ sessionId, repo, projects })));
  const lastExit = exits.at(-1);
  const run = { side, startedAt, wallMs: Date.now() - started, exitCode: lastExit.exitCode, timedOut: exits.some((x) => x.timedOut), result, transcript, end: e, loop: { invocations: results.length, resumes: results.length - 1, maxResumes, stoppedBecause, exits } };
  writeFileSync(join(out, "run.json"), JSON.stringify(run, null, 2));
  console.error(`${side}: done in ${Math.round(run.wallMs / 1000)}s over ${results.length} invocation(s), cost ${result?.costUsd ?? "unknown"}, ${e.finished ? "finished" : `not finished: ${stoppedBecause}`}`);
  return run;
}

// A side runs once per lab: a second run would start in the repo the first one left.
export function assertFresh(lab, side) {
  if (existsSync(join(lab.dir, "results", side, "run.json"))) throw new LabError(`${side} has run in ${lab.dir} already. To run it again from the start: node tests/smoke/compare-lab.mjs reset ${side} --lab ${lab.dir}`);
}

// Puts one side's repo back where setup left it (same start commit, fresh origin, the build's configs), empties its gh
// shim log and removes its results, so the side can run again in the same lab. The other side is not touched.
export function resetSide(lab, side) {
  const s = lab.sides[side];
  const sideDir = join(lab.dir, side);
  rmSync(s.repo, { recursive: true, force: true });
  rmSync(s.origin, { recursive: true, force: true });
  const made = makeSideRepo(sideDir, side, lab.fixture);
  if (made.startCommit !== s.startCommit) throw new LabError(`the remade ${side} repo starts at ${made.startCommit}, not ${s.startCommit}: the fixture changed since setup`);
  writeFileSync(s.shim.log, "");
  rmSync(s.shim.opened, { force: true });
  rmSync(join(lab.dir, "results", side), { recursive: true, force: true });
}

// ---------- judge ----------

// pytest's last summary line, "3 passed, 1 failed in 0.12s", as counts.
export function parsePytestSummary(text) {
  const counts = { passed: 0, failed: 0, errors: 0, skipped: 0 };
  const line = text.split("\n").reverse().find((l) => /\b(passed|failed|error|errors|no tests ran)\b/.test(l) && /\bin [\d.]+s\b/.test(l));
  if (line === undefined) return { ...counts, parsed: false };
  for (const [, n, word] of line.matchAll(/(\d+) (passed|failed|errors?|skipped)/g)) counts[word.startsWith("error") ? "errors" : word] += Number(n);
  return { ...counts, parsed: true };
}

// What one side left: its diff from the start commit, untracked files included, and its commits.
export function collectSide(lab, side) {
  const { repo, startCommit } = lab.sides[side];
  git(repo, "add", "-A", "--intent-to-add");
  const diff = execFileSync("git", ["diff", startCommit], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const numstat = git(repo, "diff", "--numstat", startCommit).split("\n").filter(Boolean).map((l) => l.split("\t"));
  const commits = git(repo, "log", "--format=%h %s", `${startCommit}..HEAD`).split("\n").filter(Boolean).reverse();
  return {
    diff,
    stats: { files: numstat.map(([, , f]) => f), insertions: numstat.reduce((s, [a]) => s + (Number(a) || 0), 0), deletions: numstat.reduce((s, [, d]) => s + (Number(d) || 0), 0) },
    commits,
    branch: git(repo, "branch", "--show-current"),
  };
}

export async function runTests(lab, side, { command = [...PYTEST.split(" "), "-q"], timeoutMs = 300_000 } = {}) {
  const { repo } = lab.sides[side];
  const exit = await spawnCapture(command[0], command.slice(1), { cwd: repo, env: withoutDropped(), timeoutMs });
  return { exitCode: exit.code, timedOut: exit.timedOut, ...parsePytestSummary(exit.stdout), output: exit.stdout.slice(-4000) };
}

// The A/B labels, in random order. rand is Math.random's shape.
export function blindMapping(rand = Math.random) {
  return rand() < 0.5 ? { A: "old", B: "new" } : { A: "new", B: "old" };
}

const scoreSchema = { type: "object", required: ["score", "reason"], additionalProperties: false, properties: { score: { type: "integer", minimum: 1, maximum: 10 }, reason: { type: "string" } } };
const sideSchema = { type: "object", required: CRITERIA, additionalProperties: false, properties: Object.fromEntries(CRITERIA.map((c) => [c, scoreSchema])) };
export const JUDGE_SCHEMA = { type: "object", required: ["A", "B", "preferred", "summary"], additionalProperties: false, properties: { A: sideSchema, B: sideSchema, preferred: { enum: ["A", "B", "tie"] }, summary: { type: "string" } } };

export function judgePrompt({ task, baseFiles, diffA, diffB, testsA, testsB }) {
  const files = Object.entries(baseFiles).map(([path, text]) => `--- ${path}\n${text}`).join("\n");
  const tests = (t) => (t.parsed ? `${t.passed} passed, ${t.failed} failed, ${t.errors} errors (exit ${t.exitCode})` : `no pytest summary (exit ${t.exitCode})`);
  return `You are reviewing two independent solutions, A and B, to the same coding task in the same Python repo. Judge them on their merits only. Do not guess how they were made.

Score each solution from 1 to 10 on each criterion, with a short concrete reason that names code or tests:
- correctness: does the code do what the task says, including every edge case and validation it names? Look for bugs.
- test_quality: do the tests pin the behaviour the task names, one behaviour each, with clear names and no redundancy or gaps?
- readability: is the code and the test code clear, well named and simple?
- scope_discipline: does it do the task and nothing more: no unrequested features, no unrelated edits?
Then say which you prefer overall (A, B or tie) and why, in a few sentences.

<task>
${task}
</task>

<starting_files>
${files}
</starting_files>

<solution_A tests="${tests(testsA)}">
${diffA || "(no changes)"}
</solution_A>

<solution_B tests="${tests(testsB)}">
${diffB || "(no changes)"}
</solution_B>

Answer with JSON only, in this shape: {"A": {${CRITERIA.map((c) => `"${c}": {"score": n, "reason": "..."}`).join(", ")}}, "B": {...same...}, "preferred": "A"|"B"|"tie", "summary": "..."}`;
}

// The judge's verdict from its parsed run: structured output first, else JSON in the result text (fences allowed).
export function parseVerdict(result) {
  let verdict = result?.structuredOutput ?? null;
  if (verdict === null && typeof result?.resultText === "string") {
    const text = result.resultText;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        verdict = JSON.parse(text.slice(start, end + 1));
      } catch {}
    }
  }
  const ok = verdict && ["A", "B"].every((k) => CRITERIA.every((c) => Number.isInteger(verdict[k]?.[c]?.score))) && ["A", "B", "tie"].includes(verdict.preferred);
  if (!ok) throw new LabError(`the judge gave no verdict in the expected shape: ${JSON.stringify(verdict ?? result?.resultText ?? null).slice(0, 300)}`);
  return verdict;
}

// A/B scores back to old/new.
export function unblind(verdict, mapping) {
  const total = (s) => CRITERIA.reduce((sum, c) => sum + s[c].score, 0);
  const scores = Object.fromEntries(["A", "B"].map((label) => [mapping[label], { label, ...verdict[label], total: total(verdict[label]) }]));
  return { scores, preferred: verdict.preferred === "tie" ? "tie" : mapping[verdict.preferred], summary: verdict.summary };
}

export function judgeArgs(lab) {
  return ["-p", "--output-format", "json", "--model", modelId(lab.model), "--tools", "", "--json-schema", JSON.stringify(JUDGE_SCHEMA), "--setting-sources", "project,local", "--strict-mcp-config", "--no-session-persistence"];
}

export function baseFiles(fixture) {
  const root = join(fixture, "files");
  const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
  return Object.fromEntries(walk(root).sort().map((path) => [path.slice(root.length + 1), readFileSync(path, "utf8")]));
}

export async function judge(lab, { rand = Math.random } = {}) {
  const out = resultsDir(lab, "judge");
  const collected = {};
  for (const side of SIDES) {
    const sideOut = resultsDir(lab, side);
    const c = collectSide(lab, side);
    writeFileSync(join(sideOut, "diff.patch"), c.diff);
    const tests = await runTests(lab, side);
    writeFileSync(join(sideOut, "tests.txt"), tests.output);
    collected[side] = { ...c, tests };
    const run = readJsonOr(join(sideOut, "run.json"), null);
    const outcome = { end: sideEnd(lab, side), loop: run?.loop ?? null, stats: c.stats, commits: c.commits, branch: c.branch, tests: { ...tests, output: undefined } };
    writeFileSync(join(sideOut, "outcome.json"), JSON.stringify(outcome, null, 2));
  }
  const mapping = blindMapping(rand);
  writeFileSync(join(out, "mapping.json"), JSON.stringify(mapping, null, 2));
  const prompt = judgePrompt({ task: lab.task, baseFiles: baseFiles(lab.fixture), diffA: collected[mapping.A].diff, diffB: collected[mapping.B].diff, testsA: collected[mapping.A].tests, testsB: collected[mapping.B].tests });
  writeFileSync(join(out, "prompt.txt"), prompt);
  refuseApiKey();
  const env = withoutDropped();
  console.error(`judge: claude -p on the blind A/B diffs`);
  const exit = await spawnCapture("claude", judgeArgs(lab), { cwd: out, env, input: prompt, timeoutMs: 30 * 60_000 });
  writeFileSync(join(out, "claude.json"), exit.stdout);
  writeFileSync(join(out, "stderr.txt"), exit.stderr);
  const result = parseRunResult(exit.stdout);
  const verdict = parseVerdict(result);
  const judged = { mapping, verdict, ...unblind(verdict, mapping), costUsd: result?.costUsd ?? null, wallMs: exit.wallMs };
  writeFileSync(join(out, "judge.json"), JSON.stringify(judged, null, 2));
  return judged;
}

// ---------- summary ----------

const readJsonOrNull = (path) => readJsonOr(path, null);

export function gatherResults(lab) {
  const sides = Object.fromEntries(
    SIDES.map((side) => {
      const { plugin, startCommit } = lab.sides[side];
      return [side, { plugin, startCommit, run: readJsonOrNull(join(lab.dir, "results", side, "run.json")), outcome: readJsonOrNull(join(lab.dir, "results", side, "outcome.json")) }];
    }),
  );
  return { lab: lab.dir, created: lab.created, task: lab.task, model: lab.modelId, tiers: lab.tiers, permissionMode: lab.permissionMode, budgetUsd: lab.budgetUsd, sides, judge: readJsonOrNull(join(lab.dir, "results", "judge", "judge.json")) };
}

const dash = "-";
const mins = (ms) => (typeof ms === "number" ? `${(ms / 60_000).toFixed(1)} min` : dash);
const usd = (n) => (typeof n === "number" ? `$${n.toFixed(2)}` : dash);
const num = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : dash);
const cell = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");

// The side's end as its repo shows it: the judge's read (outcome.json) first, then the run's (run.json). A run from
// before end states were read has only its exit code, which says nothing about where the run got to.
function finishedText(s) {
  if (s.run === null) return "not run";
  const e = s.outcome?.end ?? s.run.end;
  if (!e) return s.run.timedOut ? "timed out" : s.run.result === null ? `no result (exit ${s.run.exitCode})` : s.run.result.isError ? `error: ${s.run.result.subtype}` : `exit ${s.run.exitCode}, end not read`;
  if (e.finished) return `yes: ${e.reason ?? e.state}`;
  if (e.waitingForHuman) return `no, waiting for a human: ${e.reason}`;
  const stopped = s.outcome?.loop?.stoppedBecause ?? s.run.loop?.stoppedBecause;
  return `no: ${[stopped, e.reason ?? e.state].filter(Boolean).join("; ")}`;
}

export function renderSummary(results) {
  const row = (name, f) => `| ${name} | ${SIDES.map((s) => cell(f(results.sides[s]))).join(" | ")} |`;
  const t = (s) => s.run?.transcript?.total;
  const lines = [
    "# Pairing Buddy: old vs new",
    "",
    `Model ${results.model} (tiers: ${results.tiers}), permission mode ${results.permissionMode}, cap ${usd(results.budgetUsd)} per side.`,
    `Lab: \`${results.lab}\``,
    "",
    `Task: ${results.task}`,
    "",
    "| | old | new |",
    "|---|---|---|",
    row("plugin", (s) => `${s.plugin?.ref ?? s.plugin?.dir ?? dash}${s.plugin?.sha ? ` @ ${s.plugin.sha.slice(0, 7)}` : ""}`),
    row("finished", finishedText),
    row("claude -p invocations", (s) => (s.run ? num(s.run.loop?.invocations ?? 1) : dash)),
    row("wall time", (s) => mins(s.run?.wallMs)),
    row("API time (claude)", (s) => mins(s.run?.result?.durationApiMs)),
    row("turns (main)", (s) => num(s.run?.result?.numTurns)),
    row("cost (claude)", (s) => usd(s.run?.result?.costUsd)),
    row("output tokens", (s) => num(t(s)?.output)),
    row("input tokens (uncached)", (s) => num(t(s)?.input)),
    row("cache read tokens", (s) => num(t(s)?.cacheRead)),
    row("cache write tokens", (s) => num(t(s)?.cacheCreation)),
    row("API messages", (s) => num(t(s)?.messages)),
    row("agent transcripts", (s) => num(s.run?.transcript?.agentFiles)),
    row("commits", (s) => num(s.outcome?.commits?.length)),
    row("files changed", (s) => (s.outcome ? s.outcome.stats.files.length : dash)),
    row("lines +/-", (s) => (s.outcome ? `+${s.outcome.stats.insertions} / -${s.outcome.stats.deletions}` : dash)),
    row("tests after", (s) => (s.outcome ? (s.outcome.tests.parsed ? `${s.outcome.tests.passed} passed, ${s.outcome.tests.failed} failed, ${s.outcome.tests.errors} errors` : `exit ${s.outcome.tests.exitCode}`) : dash)),
  ];
  const j = results.judge;
  if (j) {
    lines.push(...CRITERIA.map((c) => row(`judge: ${c.replace("_", " ")}`, (s) => j.scores[sideName(results, s)]?.[c]?.score ?? dash)));
    lines.push(row("judge: total (of 40)", (s) => j.scores[sideName(results, s)]?.total ?? dash));
    lines.push("", `Judge cost ${usd(j.costUsd)}.`, "", "## Blind judge", "");
    for (const label of ["A", "B"]) {
      lines.push(`### ${label}`, "", ...CRITERIA.map((c) => `- ${c.replace("_", " ")} ${j.verdict[label][c].score}: ${j.verdict[label][c].reason}`), "");
    }
    lines.push(`Preferred: ${j.verdict.preferred}. ${j.verdict.summary}`, "", "## Unblinded", "", `A was ${j.mapping.A}, B was ${j.mapping.B}. Preferred: ${j.preferred}.`);
  } else lines.push("", "No judge verdict yet.");
  lines.push("", "## Commits", "");
  for (const side of SIDES) lines.push(`${side}: ${results.sides[side].outcome?.commits?.join("; ") || "none"}`, "");
  return `${lines.join("\n")}\n`;
}

const sideName = (results, s) => SIDES.find((name) => results.sides[name] === s);

export function writeSummary(lab) {
  const results = gatherResults(lab);
  writeFileSync(join(lab.dir, "results", "results.json"), JSON.stringify(results, null, 2));
  const md = join(lab.dir, "results", "summary.md");
  writeFileSync(md, renderSummary(results));
  return md;
}

// ---------- main ----------

async function main(argv) {
  const { command, side, options } = parseArgs(argv);
  refuseApiKey();
  if (command === "setup" || command === "all") {
    const lab = setupLab(options);
    console.log(lab.dir);
    if (command === "setup") return;
    options.lab = lab.dir;
  }
  const lab = readLab(options.lab ?? latestLab());
  mkdirSync(join(lab.dir, "results"), { recursive: true });
  if (command === "reset") {
    for (const s of side === "both" ? SIDES : [side]) {
      resetSide(lab, s);
      console.error(`${s}: reset to ${lab.sides[s].startCommit.slice(0, 7)} in ${lab.sides[s].repo}`);
    }
    return;
  }
  if (command === "run" || command === "all") {
    const which = command === "all" || side === "both" ? SIDES : [side];
    for (const s of which) assertFresh(lab, s);
    await Promise.all(which.map((s) => runSide(lab, s)));
  }
  if (command === "judge" || command === "all") {
    try {
      await judge(lab);
    } catch (error) {
      console.error(`judge: ${error.message}`);
      process.exitCode = 1;
    }
  }
  if (command === "summary" || command === "judge" || command === "all") console.log(writeSummary(lab));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof UsageError ? `${error.message}\n${USAGE}` : error.message);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}

