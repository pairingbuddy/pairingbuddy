#!/usr/bin/env node
// Smoke S2: `/pairingbuddy:code <bug>` end to end on a sample repo with a real test runner, on a cheap model.
//
// One capped `claude -p` session on a human-made branch, with the plugin loaded from outside its cwd and no inherited
// policy env. It asserts control flow only, never output quality: stage order, the one placeholder `test:` commit, one
// RED and one GREEN commit per test, or one `test:` commit for a test an earlier GREEN covered, tests{} exit codes and
// gate sources. Every run is recorded for T4a. An open-scope --task, one that lets the scenarios name more than one
// test, is how a covered test shows up.
//
// The sample uses pytest because pb's full-suite run passes the test directory to the runner and a `::` selector that
// matches nothing exits non-zero. `node --test <dir>` does not take a directory, and its name pattern exits 0 on no match.
//
// Run it by hand, in a separate shell, from the repo root. It spends money, so no suite collects it:
//
//     node tests/smoke/s2.mjs [--budget-usd N] [--record-dir DIR] [--recording NAME] [--task TEXT]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import { BUDGET_USD, Budget, REPO_ROOT, SmokeError, cleanEnv, runClaude } from "./claude-run.mjs";
import { RunRecorder } from "./run-recorder.mjs";

const STAGES = ["code-scenarios", "code-tdd", "code-safety-net"];
const GATES = ["G:scenarios", "G:task-end"];
const BRANCH = "discount-bug";
const RECORDINGS = join(REPO_ROOT, "tests", "smoke", "recordings");
export const TASK = "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. One regression test for exactly that case is the whole scope";

const SAMPLE_FILES = {
  ".gitignore": ".pairingbuddy/\n__pycache__/\n.pytest_cache/\n",
  "pytest.ini": "[pytest]\npythonpath = .\n",
  "discount.py": 'def apply_discount(price, percent):\n    """The price after taking off percent."""\n    return price * percent / 100\n',
  "tests/test_discount.py": "from discount import apply_discount\n\n\ndef test_zero_price_stays_zero():\n    assert apply_discount(0, 10) == 0\n",
};

const TEST_CONFIG = {
  source_directory: ".",
  runners: {
    pytest: {
      name: "pytest",
      command: "uv run --no-project --with pytest pytest",
      test_directory: "tests",
      file_pattern: "test_*.py",
      run_args: ["-q"],
      selector_template: ["{test_file}::{test_function}"],
    },
  },
  default_runner: "pytest",
};
const NO_DOCS = { in_repo_docs: [], external_docs: [], last_verified: "2026-01-01T00:00:00Z" };

const git = (repo, ...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: cleanEnv() });

function writeTree(repo, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
}

// A fresh repo on a branch a human made from main. Signing is off, so a signer cannot flake the run.
export function makeRepo(parent) {
  const repo = join(parent, "repo");
  writeTree(repo, { ...SAMPLE_FILES, ".pairingbuddy/test-config.json": JSON.stringify(TEST_CONFIG), ".pairingbuddy/doc-config.json": JSON.stringify(NO_DOCS) });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "smoke@example.invalid");
  git(repo, "config", "user.name", "smoke");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "switch", "-q", "-c", BRANCH);
  return repo;
}

function assertStageOrder({ stages }) {
  const finished = stages.filter(({ status }) => status === "done").map(({ name }) => name);
  if (!isDeepStrictEqual(finished, STAGES)) throw new SmokeError(`stage order is ${finished}, expected ${STAGES}`);
}

function placeholderSha({ checkpoints = [] }) {
  const commits = checkpoints.filter(({ step, committed }) => step === "placeholders" && committed);
  if (commits.length !== 1) throw new SmokeError(`expected one placeholder commit, the ledger has ${commits.length}`);
  return commits[0].sha;
}

// A test that passed at RED after an earlier GREEN: kept with one test commit, and its GREEN skipped.
const isCoveredRow = ({ covered }) => covered?.done === true;

function assertCoveredRow(id, { covered }, greenBefore) {
  if (!covered.sha || !isDeepStrictEqual(covered.exitCodes, [0])) throw new SmokeError(`test ${id} has no good covered pass: ${JSON.stringify(covered)}`);
  if (!greenBefore) throw new SmokeError(`test ${id} is covered, and no GREEN came before it`);
}

function assertTestRow(id, row, greenBefore) {
  if (isCoveredRow(row)) return assertCoveredRow(id, row, greenBefore);
  const { red, green } = row;
  if (!red?.done || !red.sha || !isDeepStrictEqual(red.exitCodes, [1])) throw new SmokeError(`test ${id} has no good RED: ${JSON.stringify(red)}`);
  if (!green?.done || !green.sha || !isDeepStrictEqual(green.exitCodes, [0])) throw new SmokeError(`test ${id} has no good GREEN: ${JSON.stringify(green)}`);
}

const typeOf = ({ subject }) => /^\w+/.exec(subject)?.[0];

// `log` is oldest first, with the sample's own commit left out.
function assertCommits(ledger, log) {
  const rows = Object.entries(ledger.tests.perTest ?? {});
  if (rows.length === 0) throw new SmokeError("the ledger records no test");
  rows.forEach(([id, row], i) => assertTestRow(id, row, rows.slice(0, i).some(([, earlier]) => !isCoveredRow(earlier))));
  const shasOf = (row) => (isCoveredRow(row) ? [row.covered.sha] : [row.red.sha, row.green.sha]);
  const expected = ["test", ...rows.flatMap(([, row]) => (isCoveredRow(row) ? ["test"] : ["test", "fix"]))];
  const types = log.map(typeOf);
  const cycle = types.at(-1) === "docs" ? types.slice(0, -1) : types;
  if (!isDeepStrictEqual(cycle, expected)) throw new SmokeError(`commit types are ${types}, expected ${expected}, then at most one docs`);
  const unlisted = log.filter(({ sha }) => !ledger.commits.includes(sha));
  if (unlisted.length > 0) throw new SmokeError(`commits not in the ledger: ${unlisted.map(({ subject }) => subject)}`);
  if (log[0].sha !== placeholderSha(ledger)) throw new SmokeError("the first commit is not the placeholder commit");
  const cycleShas = rows.flatMap(([id, row]) => shasOf(row).map((sha) => ({ id, sha })));
  cycleShas.forEach(({ id, sha }, i) => {
    if (log[1 + i].sha !== sha) throw new SmokeError(`test ${id}: commit ${2 + i} is not its own`);
  });
}

function assertFullSuite({ tests: { full } }) {
  if (!full?.passed || !full.runs.every(({ exitCode }) => exitCode === 0)) throw new SmokeError(`the full suite did not pass: ${JSON.stringify(full?.runs?.map(({ exitCode }) => exitCode))}`);
}

function assertGates({ gates, policy }) {
  for (const gate of GATES) {
    if (gates[gate]?.source !== "auto") throw new SmokeError(`gate source of ${gate} is ${gates[gate]?.source}, expected auto`);
  }
  if (!isDeepStrictEqual(policy, { mode: "auto", source: "permission_mode" })) throw new SmokeError(`the gate policy is ${JSON.stringify(policy)}, so the env was not clean`);
}

export function assertControlFlow(ledger, log) {
  assertStageOrder(ledger);
  placeholderSha(ledger);
  assertCommits(ledger, log);
  assertFullSuite(ledger);
  assertGates(ledger);
}

function runLog(repo) {
  const lines = git(repo, "log", "--reverse", "--format=%H %s").trim().split("\n").slice(1);
  return lines.map((line) => ({ sha: line.slice(0, 40), subject: line.slice(41) }));
}

function position(last) {
  if (last === null) return "no ledger was seen";
  const { stage, stages, stop, needsHuman } = last;
  return `last ledger: stage ${stage.name} ${stage.status} attempt ${stage.attempt}, finished ${stages.map(({ name }) => name)}, stop ${JSON.stringify(stop)}, needsHuman ${JSON.stringify(needsHuman)}`;
}

const runIsOpen = (repo) => {
  try {
    return git(repo, "status", "--porcelain", "--ignored", ".pairingbuddy/run/task").trim() !== "";
  } catch {
    return false;
  }
};

async function runS2(budget, record, recording, task) {
  const repo = makeRepo(record);
  const recorder = new RunRecorder(repo, recording, { streamPath: join(record, "stream.jsonl") }).start();
  const result = { passed: false, cause: "", tests: 0, commits: [] };
  try {
    await runClaude(repo, `/pairingbuddy:code ${task}`, budget, { onLine: (event) => recorder.line(event) });
    recorder.poll();
    if (recorder.last === null) throw new SmokeError("no run was opened, so nothing went through the gate");
    if (runIsOpen(repo)) throw new SmokeError("the run was left open");
    const log = runLog(repo);
    result.commits = log.map(({ subject }) => subject);
    assertControlFlow(recorder.last, log);
    result.tests = Object.keys(recorder.last.tests.perTest).length;
    result.passed = true;
  } catch (e) {
    if (!(e instanceof SmokeError)) throw e;
    result.commits = runLog(repo).map(({ subject }) => subject);
    result.cause = `${e.constructor.name}: ${e.message}; ${position(recorder.last)}`;
  } finally {
    recorder.stop();
  }
  return { ...result, costUsd: Number(budget.spent.toFixed(6)), costKnown: budget.costKnown, seconds: Number(recorder.seconds().toFixed(1)), agents: recorder.last?.spend?.agents ?? null };
}

export function parseOptions(argv) {
  const { values } = parseArgs({ args: argv, options: { "budget-usd": { type: "string" }, "record-dir": { type: "string" }, recording: { type: "string" }, task: { type: "string" } } });
  const budgetUsd = Math.min(Number(values["budget-usd"] ?? BUDGET_USD), BUDGET_USD);
  return { budgetUsd, recordDir: values["record-dir"], recording: values.recording, task: values.task ?? TASK };
}

async function main() {
  const { budgetUsd, recordDir, recording, task } = parseOptions(process.argv.slice(2));
  const record = recordDir ?? mkdtempSync(join(tmpdir(), "pb-smoke-s2-"));
  mkdirSync(record, { recursive: true });
  const name = recording ?? new Date().toISOString().replaceAll(":", "-");
  const result = await runS2(new Budget(budgetUsd), record, join(RECORDINGS, name), task);
  console.log(JSON.stringify(result));
  console.log(`${result.passed ? "PASS" : "FAIL"} S2, repo in ${record}, recorded in ${join(RECORDINGS, name)}`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
