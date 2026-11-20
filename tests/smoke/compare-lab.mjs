// Compare lab: the released Pairing Buddy (old, a worktree of tag v0.7.0) and a new build on one fixture task, same
// model, unattended, side by side. See COMPARE.md. It spends money, so no suite runs it; the tests cover the pure parts.
//
//   node tests/smoke/compare-lab.mjs setup [options]            make the lab: two identical repos, the old plugin
//   node tests/smoke/compare-lab.mjs run old|new|both [--lab D]  run claude -p in one repo or both (both in parallel)
//   node tests/smoke/compare-lab.mjs judge [--lab D]             diffs, test runs, and a blind A/B judge
//   node tests/smoke/compare-lab.mjs summary [--lab D]           results.json and summary.md
//   node tests/smoke/compare-lab.mjs all [options]               setup, run both, judge, summary
//
// Nothing reaches GitHub: each repo's origin is a local bare repo and `gh` is the recording shim first on PATH.
// ANTHROPIC_API_KEY must not be set: it switches billing, so the script refuses to start and unsets it in every child.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
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
const DEFAULTS = { model: "sonnet", tiers: "same", permissionMode: "bypassPermissions", budgetUsd: 25, timeoutMin: 120, newPlugin: REPO_ROOT, oldRef: OLD_REF };

export class UsageError extends Error {}
export class LabError extends Error {}

export const USAGE = `usage: compare-lab.mjs <command> [options]
  setup [--model sonnet|opus|haiku|<id>] [--tiers same|native] [--permission-mode <mode>] [--budget-usd N]
        [--timeout-min N] [--new-plugin <dir>] [--old-ref <tag> | --old-plugin <dir>] [--root <dir>]
  run old|new|both [--lab <dir>]
  judge [--lab <dir>]
  summary [--lab <dir>]
  all   [setup options]`;

const VALUE_FLAGS = { "--model": "model", "--tiers": "tiers", "--permission-mode": "permissionMode", "--budget-usd": "budgetUsd", "--timeout-min": "timeoutMin", "--new-plugin": "newPlugin", "--old-ref": "oldRef", "--old-plugin": "oldPlugin", "--root": "root", "--lab": "lab" };
const SETUP_KEYS = ["model", "tiers", "permissionMode", "budgetUsd", "timeoutMin", "newPlugin", "oldRef", "oldPlugin", "root"];
const ALLOWED = { setup: SETUP_KEYS, all: SETUP_KEYS, run: ["lab"], judge: ["lab"], summary: ["lab"] };
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
  if (command === "run") {
    side = rest.shift();
    if (![...SIDES, "both"].includes(side)) throw new UsageError(`run takes old, new or both, not ${side ?? "nothing"}`);
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
// unattended switch: Solo mode for old, the auto gate policy for new.
export function runEnv(side, lab, inherited = process.env) {
  refuseApiKey(inherited);
  const kept = withoutDropped(inherited);
  const id = modelId(lab.model);
  const tiers = lab.tiers === "same" ? { ANTHROPIC_DEFAULT_OPUS_MODEL: id, ANTHROPIC_DEFAULT_SONNET_MODEL: id, ANTHROPIC_DEFAULT_HAIKU_MODEL: id } : {};
  const own = side === "old" ? { PAIRINGBUDDY_SOLO: "true", PAIRINGBUDDY_SOLO_MAX_RETRIES: "5" } : { PAIRINGBUDDY_GATE_POLICY: "auto" };
  const { shim } = lab.sides[side];
  return { ...kept, ...tiers, ...own, PATH: `${shim.dir}:${kept.PATH ?? ""}`, GH_SHIM_LOG: shim.log, GH_SHIM_OPENED: shim.opened };
}

export const runPrompt = (task) => `/pairingbuddy:code ${task}`;

export function runArgs(side, lab) {
  return [
    "-p", runPrompt(lab.task),
    "--output-format", "json",
    "--model", modelId(lab.model),
    "--plugin-dir", lab.sides[side].plugin.dir,
    "--setting-sources", "project,local",
    "--strict-mcp-config",
    "--permission-mode", lab.permissionMode,
    "--max-budget-usd", String(lab.budgetUsd),
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

export function transcriptUsage(where) {
  const files = transcriptFiles(where);
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
export function setupLab({ root = LABS_ROOT(), model = DEFAULTS.model, tiers = DEFAULTS.tiers, permissionMode = DEFAULTS.permissionMode, budgetUsd = DEFAULTS.budgetUsd, timeoutMin = DEFAULTS.timeoutMin, newPlugin = DEFAULTS.newPlugin, oldRef = DEFAULTS.oldRef, oldPlugin = null, fixture = FIXTURE, now = new Date() } = {}) {
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
  const lab = { dir, created: now.toISOString(), fixture, task, model, modelId: modelId(model), tiers, permissionMode, budgetUsd, timeoutMin, sides };
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

export async function runSide(lab, side, { projects } = {}) {
  const out = resultsDir(lab, side);
  const { repo } = lab.sides[side];
  const startedAt = new Date().toISOString();
  console.error(`${side}: claude -p in ${repo} (plugin ${lab.sides[side].plugin.dir})`);
  const exit = await spawnCapture("claude", runArgs(side, lab), { cwd: repo, env: runEnv(side, lab), timeoutMs: lab.timeoutMin * 60_000 });
  writeFileSync(join(out, "claude.json"), exit.stdout);
  writeFileSync(join(out, "stderr.txt"), exit.stderr);
  const result = parseRunResult(exit.stdout);
  const transcript = transcriptUsage({ sessionId: result?.sessionId ?? null, repo, projects });
  const run = { side, startedAt, wallMs: exit.wallMs, exitCode: exit.code, timedOut: exit.timedOut, result, transcript };
  writeFileSync(join(out, "run.json"), JSON.stringify(run, null, 2));
  console.error(`${side}: done in ${Math.round(exit.wallMs / 1000)}s, exit ${exit.code}${exit.timedOut ? " (timed out)" : ""}, cost ${result?.costUsd ?? "unknown"}`);
  return run;
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
    writeFileSync(join(sideOut, "outcome.json"), JSON.stringify({ stats: c.stats, commits: c.commits, branch: c.branch, tests: { ...tests, output: undefined } }, null, 2));
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

const readJsonOrNull = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

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
    row("finished", (s) => (s.run === null ? "not run" : s.run.timedOut ? "timed out" : s.run.result === null ? `no result (exit ${s.run.exitCode})` : s.run.result.isError ? `error: ${s.run.result.subtype}` : "yes")),
    row("wall time", (s) => mins(s.run?.wallMs)),
    row("claude duration", (s) => mins(s.run?.result?.durationMs)),
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
  if (command === "run" || command === "all") {
    const which = command === "all" || side === "both" ? SIDES : [side];
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

