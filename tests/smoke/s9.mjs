#!/usr/bin/env node
// Smoke S9: Solo (scripts/solo-buddy.sh) on a two-unit plan, on a cheap model, with a clean env and the recording gh,
// under one spend cap. Phase 1 lets Solo finish: two draft PRs on the shim, the exit summary lists each PR link, and
// the remote holds both pushed branches. Phase 2 forces a stop: the sample's test command goes red on every safety-net
// fix (force-red.mjs --always), the fix loop reaches its attempt cap, and Solo must report the stop as a failure while
// every commit stays local. Run by hand (`node tests/smoke/s9.mjs`), never by a suite; the unit tests in
// tests/js/smoke-s9.test.mjs exercise the pure helpers above the live run.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { installGhShim } from "../js/gh-shim.mjs";
import { Budget, REPO_ROOT, SmokeError, cleanEnv, clampBudget } from "./claude-run.mjs";
import { git } from "./s2.mjs";
import { makeS3Repo } from "./s3.mjs";
import { RUN_TIMEOUT_MS, assertCleanEnv } from "./s4.mjs";

export const S9_BUDGET_USD = 6;

const HEAD_FLAG = "--head";
const DRAFT_FLAG = "--draft";
const COMPLETE_MARKER = "Session complete";
const STOPPED_MARKER = "Session stopped";

function headOf({ argv }) {
  const at = argv.indexOf(HEAD_FLAG);
  return at === -1 ? undefined : argv[at + 1];
}

export function summarizeDraftPrs({ creates, units }) {
  if (creates.length !== units.length) {
    throw new Error(`expected ${units.length} pr creates, saw ${creates.length}`);
  }
  for (const u of units) {
    const create = creates.find((c) => headOf(c) === u.branch);
    if (!create) {
      throw new Error(`${u.unit}: no pr create for ${u.branch}`);
    }
    if (!create.argv.includes(DRAFT_FLAG)) {
      throw new Error(`${u.unit}: pr create for ${u.branch} is not a draft`);
    }
  }
  const heads = units.map((u) => u.branch);
  return { count: heads.length, heads };
}

export function assertForcedStopLocal({ remote, local, creates }) {
  if (remote.after.length !== remote.before.length || remote.after.some((ref) => !remote.before.includes(ref))) {
    throw new Error("forced stop pushed a ref to the remote");
  }
  if (local.aheadOfRemote < 1) {
    throw new Error(`${local.branch} has no commits ahead of the remote`);
  }
  if (creates.length !== 0) {
    throw new Error(`forced stop opened ${creates.length} pr creates`);
  }
}

export function assertForcedStopSummary({ summary }) {
  if (summary.includes(COMPLETE_MARKER)) {
    throw new Error("forced stop summary says Session complete");
  }
  if (!summary.includes(STOPPED_MARKER)) {
    throw new Error("forced stop summary does not say Session stopped");
  }
}

export function assertReportHasPrLinks({ report, urls }) {
  for (const url of urls) {
    if (!report.includes(url)) {
      throw new Error(`report is missing PR link ${url}`);
    }
  }
}

export function parseOptions(argv) {
  const { values } = parseArgs({ args: argv, options: { "budget-usd": { type: "string" }, "record-dir": { type: "string" }, "plugin-dir": { type: "string" } } });
  return { budgetUsd: clampBudget(values["budget-usd"], S9_BUDGET_USD), recordDir: values["record-dir"], pluginDir: values["plugin-dir"] ?? REPO_ROOT };
}

// ---------- the live run ----------

export const PLAN_PATH = "docs/plans/discounts.md";
const SOLO_BRANCH = "solo/s9";
const SOLO_SCRIPT = ["scripts", "solo-buddy.sh"];
const STREAM_PATH = [".pairingbuddy", "solo-stream.jsonl"];
// The share of the cap the finishing phase may spend; the forced stop gets what is left.
const FINISH_SHARE = 2 / 3;
const EXIT_UNFINISHED = 1;
const FORCE_RED = join(REPO_ROOT, "tests", "smoke", "force-red.mjs");
const PR_LINE = /^PR: (\S+) branch: (\S+)$/gm;

const SAMPLE_FILES = {
  ".gitignore": ".pairingbuddy/\n__pycache__/\n.pytest_cache/\ndocs/plans/\n",
  [PLAN_PATH]: `# Discounts

## Tasks

### T1: Discounts — Prices come out right

#### PR: Discount fix

- [ ] **Task 1: Fix apply_discount**

  **What to build:** Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. One regression test for exactly that case is the whole scope.

#### PR: Line totals

- [ ] **Task 2: Add line_total**

  **What to build:** Add line_total(price, quantity) to discount.py: it returns price times quantity, so line_total(100, 2) returns 200. One test for exactly that example is the whole scope.
`,
};

function check(condition, message) {
  if (!condition) throw new SmokeError(message);
}

// The units the plan names after the run: each "PR: <url> branch: <name>" line, in plan order.
export const prLinesOf = (plan) => [...plan.matchAll(PR_LINE)].map(([, url, branch], i) => ({ unit: `unit ${i + 1}`, url, branch }));

function runEnv(gh) {
  const env = { ...cleanEnv(), ...gh.env() };
  if (Object.hasOwn(env, "ANTHROPIC_API_KEY") || Object.hasOwn(env, "ANTHROPIC_AUTH_TOKEN")) throw new SmokeError("an Anthropic key would reach the run");
  return assertCleanEnv(env);
}

// Solo runs with no terminal of its own (a new session), so its summary goes to stdout and is captured.
function runSolo(repo, pluginDir, capUsd, env) {
  return new Promise((resolve, reject) => {
    const args = [join(pluginDir, ...SOLO_SCRIPT), "--plugin-dir", pluginDir, "--max-budget-usd", String(capUsd), PLAN_PATH];
    const child = spawn("bash", args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr = (stderr + chunk).slice(-500)));
    const timer = setTimeout(() => {
      timedOut = true;
      process.kill(-child.pid, "SIGKILL");
    }, RUN_TIMEOUT_MS);
    child.once("error", (e) => reject(new SmokeError(`cannot run solo-buddy.sh: ${e.code ?? e.message}`)));
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

// Solo's captured stream holds one result event per claude run; the cost is the highest total it reports. A run that
// reports none is charged its cap, so the spend stays an upper bound.
function chargeFromStream(repo, budget, capUsd) {
  let costs = [];
  try {
    costs = readFileSync(join(repo, ...STREAM_PATH), "utf8").split("\n").filter(Boolean).flatMap((line) => {
      try {
        const { total_cost_usd: cost } = JSON.parse(line);
        return typeof cost === "number" ? [cost] : [];
      } catch {
        return [];
      }
    });
  } catch {
    // no stream file: nothing was captured
  }
  if (costs.length > 0) budget.charge(Math.max(...costs));
  else {
    budget.charge(capUsd);
    budget.upperBound = true;
  }
}

const readPlan = (repo) => readFileSync(join(repo, PLAN_PATH), "utf8");
const bare = (remote, ...args) => execFileSync("git", ["--git-dir", remote, ...args], { encoding: "utf8", env: cleanEnv() }).trim();
const remoteRefs = (remote) => bare(remote, "for-each-ref", "--format=%(refname) %(objectname)").split("\n").filter(Boolean);

function makeSoloRepo(record) {
  const { repo, remote } = makeS3Repo(record, "bug_fix", SAMPLE_FILES);
  git(repo, "checkout", "-q", "-b", SOLO_BRANCH);
  return { repo, remote };
}

// The sample's test command, behind force-red.mjs --always: every safety-net fix goes red until the attempt cap.
function forceEveryFixRed(repo, marker) {
  const path = join(repo, ".pairingbuddy", "test-config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  const runner = config.runners[config.default_runner];
  runner.command = `node ${FORCE_RED} --always ${marker} ${runner.command}`;
  writeFileSync(path, JSON.stringify(config));
}

async function finishPhase(budget, record, pluginDir) {
  const { repo, remote } = makeSoloRepo(join(record, "finish"));
  const gh = installGhShim({ parent: record });
  const capUsd = Number((budget.total * FINISH_SHARE).toFixed(2));
  const run = await runSolo(repo, pluginDir, capUsd, runEnv(gh));
  chargeFromStream(repo, budget, capUsd);
  check(!run.timedOut, "Solo timed out in the finishing phase");
  check(run.code === 0, `Solo exited ${run.code} in the finishing phase: ${run.stderr.trim()}`);
  check(run.stdout.includes(COMPLETE_MARKER), "the finishing phase summary does not say Session complete");
  const units = prLinesOf(readPlan(repo));
  const drafts = summarizeDraftPrs({ creates: gh.prCreates(), units });
  const urls = units.map(({ url }) => url);
  assertReportHasPrLinks({ report: run.stdout, urls });
  const listed = run.stdout.split("\n").filter((line) => urls.some((url) => line === `- ${url}`)).length;
  check(listed === units.length, `the exit summary lists ${listed} PR link lines, expected ${units.length}`);
  const pushed = remoteRefs(remote).filter((ref) => units.some(({ branch }) => ref.startsWith(`refs/heads/${branch} `))).length;
  check(pushed === units.length, `the remote holds ${pushed} of the ${units.length} unit branches`);
  return { ...drafts, urls };
}

async function forcedStopPhase(budget, record, pluginDir) {
  const { repo, remote } = makeSoloRepo(join(record, "forced"));
  forceEveryFixRed(repo, join(record, "forced", "force-red.marker"));
  const gh = installGhShim({ parent: record });
  const before = remoteRefs(remote);
  const capUsd = Number(budget.remaining.toFixed(2));
  check(capUsd > 0, "no spend is left for the forced stop");
  const run = await runSolo(repo, pluginDir, capUsd, runEnv(gh));
  chargeFromStream(repo, budget, capUsd);
  check(!run.timedOut, "Solo timed out in the forced stop phase");
  check(run.code === EXIT_UNFINISHED, `Solo exited ${run.code} after a forced stop, expected ${EXIT_UNFINISHED}`);
  assertForcedStopSummary({ summary: run.stdout });
  const branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim();
  const ahead = Number(git(repo, "rev-list", "--count", "HEAD", "--not", "--remotes").trim());
  assertForcedStopLocal({ remote: { before, after: remoteRefs(remote) }, local: { branch, aheadOfRemote: ahead }, creates: gh.prCreates() });
  return { branch, aheadOfRemote: ahead };
}

async function runS9(budget, record, pluginDir) {
  const result = { passed: false, cause: "", phases: {} };
  try {
    result.phases.finish = await finishPhase(budget, record, pluginDir);
    result.phases.forcedStop = await forcedStopPhase(budget, record, pluginDir);
    check(budget.spent <= budget.total, `S9 spent $${budget.spent.toFixed(4)}, over the $${budget.total} cap`);
    result.passed = true;
  } catch (e) {
    if (!(e instanceof SmokeError)) throw e;
    result.cause = e.message;
  }
  return { ...result, costUsd: Number(budget.spent.toFixed(6)), costUpperBound: budget.upperBound };
}

async function main() {
  runEnv(installGhShim({ parent: tmpdir() }));
  const { budgetUsd, recordDir, pluginDir } = parseOptions(process.argv.slice(2));
  const record = recordDir ?? mkdtempSync(join(tmpdir(), "pb-smoke-s9-"));
  mkdirSync(record, { recursive: true });
  const result = await runS9(new Budget(budgetUsd), record, pluginDir);
  console.log(JSON.stringify(result));
  console.log(`${result.passed ? "PASS" : "FAIL"} S9, $${result.costUsd}${result.costUpperBound ? " at most" : ""}, repos in ${record}`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
