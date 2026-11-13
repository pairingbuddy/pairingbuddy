#!/usr/bin/env node
// Smoke S2: `/pairingbuddy:code <bug or feature>` end to end on a sample repo with a real test runner, on a cheap model.
//
// One capped `claude -p` session in a unit, on a repo with a bare origin, with the gh shim first on PATH, the plugin
// loaded from outside its cwd and no inherited policy env. A publish run after the task is not part of S2's checks. It
// asserts control flow only, never output quality: the task type, stage order, the one placeholder
// `test:` commit, one RED and one GREEN commit per test, or one `test:` commit for a test an earlier GREEN covered,
// tests{} exit codes, the coverage check after the last cycle, and gate sources. A new_feature GREEN is `feat:`, and its
// cycle's refactor must commit at least one fix group, `refactor:` or `test:`, each after the CLI ran the task's closed
// tests green at that commit's parent. Every run is recorded for T4a. An open-scope --task, one that lets the scenarios
// name more than one test, is how a covered test shows up.
//
// The sample uses pytest because pb's full-suite run passes the test directory to the runner and a `::` selector that
// matches nothing exits non-zero. `node --test <dir>` does not take a directory, and its name pattern exits 0 on no match.
//
// S2 answers asking S2 gates as the human, from its own shell with `pb human approve`, at most MAX_HUMAN_APPROVALS times,
// and only for judgment reasons (the allowlist). It lists each answer in its result. It never answers a policy,
// coverage-gap, selector, retries, config-hash or unknown reason, nor G:publish, since those are what S2 exists to check.
//
// Run it by hand, in a separate shell, from the repo root. It spends money, so no suite collects it:
//
//     node tests/smoke/s2.mjs [--type bug_fix|new_feature] [--budget-usd N] [--record-dir DIR] [--recording NAME] [--task TEXT]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import { parseKey } from "../../shared-node/keys.mjs";
import { installGhShim } from "../js/gh-shim.mjs";
import { BUDGET_USD, Budget, REPO_ROOT, SmokeError, SpendCapError, cleanEnv, humanPb, readLedgerOrNull, runClaude, sessionOf } from "./claude-run.mjs";
import { RunRecorder } from "./run-recorder.mjs";

const STAGES = ["intake", "code-scenarios", "code-tdd", "code-safety-net"];
const GATES = ["G:type", "G:scenarios", "G:task-end"];
export const RECORDINGS = join(REPO_ROOT, "tests", "smoke", "recordings");
export const TASK = "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. One regression test for exactly that case is the whole scope";
export const FEATURE_TASK = "Add order_total(lines) to cart.py: it takes a list of (price, quantity) pairs and returns the sum of line_total(price, quantity) over them, so order_total([(10, 2), (4, 1)]) returns 30.0, which is 25.0 plus 5.0. One test for exactly that example is the whole scope";

const BASE_FILES = {
  ".gitignore": ".pairingbuddy/\n__pycache__/\n.pytest_cache/\n",
  "pytest.ini": "[pytest]\npythonpath = .\n",
};
// The feature sits beside code with short names, a magic rate and a reused variable, so the cycle's refactor has
// something real to fix in the file its GREEN changes.
const CART = 'def line_total(p, q):\n    """The price of q items at p each, with VAT, rounded to cents."""\n    t = p * q\n    t = t * 1.25\n    t = round(t * 100) / 100\n    return t\n';
const TYPES = {
  bug_fix: {
    branch: "discount-bug",
    task: TASK,
    green: "fix",
    files: {
      "discount.py": 'def apply_discount(price, percent):\n    """The price after taking off percent."""\n    return price * percent / 100\n',
      "tests/test_discount.py": "from discount import apply_discount\n\n\ndef test_zero_price_stays_zero():\n    assert apply_discount(0, 10) == 0\n",
    },
  },
  new_feature: {
    branch: "order-total",
    task: FEATURE_TASK,
    green: "feat",
    files: { "cart.py": CART, "tests/test_cart.py": "from cart import line_total\n\n\ndef test_line_total_adds_vat():\n    assert line_total(10, 2) == 25.0\n" },
  },
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

export const git = (repo, ...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: cleanEnv() });

function writeTree(repo, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
}

// A fresh repo on a branch a human made from main, or left on main with onMain. Signing is off, so a signer cannot flake the run.
// files adds sample files of the caller's own to the first commit.
export function makeRepo(parent, type = "bug_fix", { onMain = false, files = {} } = {}) {
  const repo = join(parent, "repo");
  writeTree(repo, { ...BASE_FILES, ...TYPES[type].files, ...files, ".pairingbuddy/test-config.json": JSON.stringify(TEST_CONFIG), ".pairingbuddy/doc-config.json": JSON.stringify(NO_DOCS) });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "smoke@example.invalid");
  git(repo, "config", "user.name", "smoke");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  if (!onMain) git(repo, "switch", "-q", "-c", TYPES[type].branch);
  return repo;
}

// S2's sample left on main, with a bare origin that has main, and origin/HEAD set to main.
// files goes to makeRepo. Returns the repo and the bare origin's path.
export function makeS2Repo(parent, type = "bug_fix", { files = {} } = {}) {
  const repo = makeRepo(parent, type, { onMain: true, files });
  const remote = join(parent, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env: cleanEnv() });
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
  return { repo, remote };
}

function assertTaskType({ taskType }, type) {
  if (taskType !== type) throw new SmokeError(`the task type is ${taskType}, expected ${type}`);
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

// A cycle's committed fix groups, in the order the CLI took them. refactor-tests may touch tests alone, so it is a test
// commit, and refactor-code is a refactor, or a test commit when it too touched only tests (D16).
function refactorsOf(ledger, id) {
  return (ledger.checkpoints ?? []).filter(({ step, committed, key }) => step === "refactor" && committed && parseKey(key).item === id).map(({ key, sha }) => ({ sha, types: parseKey(key).role === "refactor-tests" ? ["test"] : ["refactor", "test"] }));
}

// Each expected commit with the types it may have, oldest first: the placeholder, then each test's own.
function expectedCommits(ledger, rows, green) {
  const ofRow = ([id, row]) => (isCoveredRow(row) ? [{ id, sha: row.covered.sha, types: ["test"] }] : [{ id, sha: row.red.sha, types: ["test"] }, { id, sha: row.green.sha, types: [green] }, ...refactorsOf(ledger, id).map((fix) => ({ id, ...fix }))]);
  return [{ id: null, sha: placeholderSha(ledger), types: ["test"] }, ...rows.flatMap(ofRow), ...safetyNetFixes(ledger)];
}

// Fix groups follow the cycles and commit only in the code-safety-net stage. The CLI types a fix group by its paths
// (shared-node/checkpoint.mjs): a test commit when it touched tests only, else a refactor. kept() leaves out both
// uncommitted fix groups (null sha) and rolled-back ones: pb rollback takes a fix's sha out of ledger.commits but
// leaves the checkpoint committed.
function safetyNetFixes(ledger) {
  const kept = (sha) => (ledger.commits ?? []).includes(sha);
  return (ledger.checkpoints ?? []).filter(({ step, sha }) => step === "fix" && kept(sha)).map(({ key, sha }) => ({ id: key, sha, types: ["test", "refactor"] }));
}

const typesText = (expected) => expected.map(({ types }) => types.join("|"));

// `log` is oldest first, with the sample's own commit left out.
function assertCommits(ledger, log, green) {
  const rows = Object.entries(ledger.tests.perTest ?? {});
  if (rows.length === 0) throw new SmokeError("the ledger records no test");
  rows.forEach(([id, row], i) => assertTestRow(id, row, rows.slice(0, i).some(([, earlier]) => !isCoveredRow(earlier))));
  const expected = expectedCommits(ledger, rows, green);
  const types = log.map(typeOf);
  const cycle = types.at(-1) === "docs" && types.length === expected.length + 1 ? types.slice(0, -1) : types;
  if (cycle.length !== expected.length || !cycle.every((type, i) => expected[i].types.includes(type))) throw new SmokeError(`commit types are ${types}, expected ${typesText(expected)}, then at most one docs`);
  const unlisted = log.filter(({ sha }) => !ledger.commits.includes(sha));
  if (unlisted.length > 0) throw new SmokeError(`commits not in the ledger: ${unlisted.map(({ subject }) => subject)}`);
  if (log[0].sha !== expected[0].sha) throw new SmokeError("the first commit is not the placeholder commit");
  expected.slice(1).forEach(({ id, sha }, i) => {
    if (log[1 + i].sha !== sha) throw new SmokeError(`${id}: commit ${2 + i} is not its own`);
  });
}

const refactorCommits = (ledger) => (ledger.checkpoints ?? []).filter(({ step, committed }) => step === "refactor" && committed);

// The CLI runs the task's closed tests before each fix group's commit and records the run as tests.refactor, with the
// HEAD the commit goes on. Only the last such run stays in the ledger, so the recorder's snapshots are the evidence.
function assertRefactorsKeptGreen(ledger, log, snapshots) {
  for (const { sha } of refactorCommits(ledger)) {
    const parent = log[log.findIndex((entry) => entry.sha === sha) - 1]?.sha;
    const green = snapshots.some(({ tests: { refactor } = {} }) => refactor?.head === parent && refactor.passed === true && refactor.runs.length > 0 && refactor.runs.every(({ exitCode }) => exitCode === 0));
    if (!green) throw new SmokeError(`refactor commit ${sha} has no green run of the closed tests at its parent ${parent}`);
  }
}

// new_feature's sample gives the refactor something real to fix, so a run that committed no fix group did not test it.
function assertRefactors(ledger, log, snapshots, type) {
  const count = refactorCommits(ledger).length;
  if (type === "new_feature" && count === 0) throw new SmokeError("no refactor commit: the cycle's refactor fixed nothing");
  if (type !== "new_feature" && count > 0) throw new SmokeError(`a ${type} run made ${count} refactor commits, and only new_feature refactors`);
  assertRefactorsKeptGreen(ledger, log, snapshots);
}

const WORK_ROLES = ["implement-tests", "implement-code", "refactor-tests", "refactor-code", "create-test-placeholders"];
const roleOf = ({ agentType }) => agentType?.replace(/^pairingbuddy:/, "");
const lastTddAgent = (agents, roles) => agents.filter((spawn) => spawn.kind === "workflow_agent" && / code-tdd /.test(` ${spawn.name} `) && roles.includes(roleOf(spawn))).at(-1);

// The coverage loop always ends on a check, so the last check comes after every cycle. G:task-end from auto means it
// left no gap. The ledger keeps no coverage fact, so the workflow agents the recorder read are the evidence.
function assertCoverageChecked(agents) {
  const check = lastTddAgent(agents, ["verify-test-coverage"]);
  if (check === undefined) throw new SmokeError("no coverage check ran in code-tdd");
  const work = lastTddAgent(agents, WORK_ROLES);
  if (work !== undefined && work.t > check.t) throw new SmokeError(`the last coverage check, at ${check.t} s, came before ${roleOf(work)} at ${work.t} s`);
}

function assertFullSuite({ tests: { full } }) {
  if (!full?.passed || !full.runs.every(({ exitCode }) => exitCode === 0)) throw new SmokeError(`the full suite did not pass: ${JSON.stringify(full?.runs?.map(({ exitCode }) => exitCode))}`);
}

function assertGates({ gates, policy }, humanApprovals) {
  for (const gate of GATES) {
    const expected = humanApprovals.some((approval) => approval.gate === gate) ? "human-cli" : "auto";
    if (gates[gate]?.source !== expected) throw new SmokeError(`gate source of ${gate} is ${gates[gate]?.source}, expected ${expected}`);
    if (expected === "human-cli" && gates[gate].answer !== "approve") throw new SmokeError(`gate ${gate} was answered ${gates[gate].answer}, expected approve`);
  }
  if (!isDeepStrictEqual(policy, { mode: "auto", source: "permission_mode" })) throw new SmokeError(`the gate policy is ${JSON.stringify(policy)}, so the env was not clean`);
}

// snapshots are every ledger the recorder saw, and agents its spawn events.
export function assertControlFlow(ledger, log, { type = "bug_fix", snapshots = [ledger], agents = [], humanApprovals = [] } = {}) {
  assertTaskType(ledger, type);
  assertStageOrder(ledger);
  placeholderSha(ledger);
  assertCommits(ledger, log, TYPES[type].green);
  assertRefactors(ledger, log, snapshots, type);
  assertCoverageChecked(agents);
  assertFullSuite(ledger);
  assertGates(ledger, humanApprovals);
}

// The asking reasons S2 answers, as substrings of the reasons shared-node/gates.mjs gives.
// A reworded reason there makes gateToAnswer return null for that gate.
const ANSWERED_REASONS = [
  "open ambiguity",
  "the classifier does not report certain",
  "the classification lens has an open finding",
  "a decide finding survived",
  "an unrefuted high-severity finding is past the cap",
];

// A total cap on human approvals, one per S2 gate. It counts approvals, not which gate they were for.
export const MAX_HUMAN_APPROVALS = GATES.length;

// The asking gate and its reason when S2 answers it, else null.
export function gateToAnswer(ledger, humanApprovals) {
  if (humanApprovals.length >= MAX_HUMAN_APPROVALS) return null;
  if (!ledger || ledger.stop !== null || !ledger.needsHuman) return null;
  const { gate, reason } = ledger.needsHuman;
  if (!GATES.includes(gate)) return null;
  if (!ANSWERED_REASONS.some((answered) => reason.includes(answered))) return null;
  return { gate, reason };
}

// The task's own ledger: the last snapshot of the code run, which pb task end removed before the publish run opened.
export const codeSnapshots = (snapshots) => snapshots.filter(({ kind }) => kind === "code");
export const codeLedger = (snapshots) => codeSnapshots(snapshots).at(-1) ?? null;

export function runLog(repo) {
  const lines = git(repo, "log", "--reverse", "--format=%H %s").trim().split("\n").slice(1);
  return lines.map((line) => ({ sha: line.slice(0, 40), subject: line.slice(41) }));
}

export function position(last) {
  if (last === null) return "no ledger was seen";
  const { stage, stages, stop, needsHuman } = last;
  return `last ledger: stage ${stage.name} ${stage.status} attempt ${stage.attempt}, finished ${stages.map(({ name }) => name)}, stop ${JSON.stringify(stop)}, needsHuman ${JSON.stringify(needsHuman)}`;
}

// pb task end must have succeeded once. The publish run after it opens run/task again, so an open run proves nothing.
export function assertTaskEnded(taskEnds) {
  const ended = taskEnds.some(({ output }) => output.split("\n").some((line) => {
    try {
      return JSON.parse(line)?.ok === true;
    } catch {
      return false;
    }
  }));
  if (!ended) throw new SmokeError("no `pb task end` succeeded");
}

// The env a claude run gets: the clean env with the gh shim first on PATH. No Anthropic key may reach it.
export function claudeEnv(gh) {
  const env = { ...cleanEnv(), ...gh.env() };
  if (Object.hasOwn(env, "ANTHROPIC_API_KEY") || Object.hasOwn(env, "ANTHROPIC_AUTH_TOKEN")) throw new SmokeError("an Anthropic key would reach the run");
  return env;
}

async function runS2(budget, record, recording, task, type, pluginDir) {
  const { repo } = makeS2Repo(record, type);
  const gh = installGhShim({ parent: record });
  const recorder = new RunRecorder(repo, recording, { streamPath: join(record, "stream.jsonl") }).start();
  const result = { passed: false, cause: "", tests: 0, commits: [], humanApprovals: [], runNote: "" };
  let ledger = null;
  try {
    const env = claudeEnv(gh);
    let prompt = `/pairingbuddy:code ${task}`;
    let resume = null;
    for (;;) {
      try {
        await runClaude(repo, prompt, budget, { env, onLine: (event) => recorder.line(event), pluginDir, resume });
      } catch (e) {
        if (!(e instanceof SmokeError)) throw e;
        result.runNote = `${e.constructor.name}: ${e.message}`;
        if (e instanceof SpendCapError) break;
      }
      recorder.poll();
      const asking = gateToAnswer(readLedgerOrNull(repo), result.humanApprovals);
      if (asking === null) break;
      const approved = humanPb(repo, gh, pluginDir, "human", "approve", asking.gate);
      if (approved.code !== 0) throw new SmokeError(`the human's pb human approve ${asking.gate}: exit ${approved.code}, ${approved.stderr}`);
      result.humanApprovals.push({ gate: asking.gate, reason: asking.reason });
      prompt = `I ran the approve command for ${asking.gate}. Continue.`;
      resume = sessionOf(recorder.stream);
      if (resume === null) throw new SmokeError("the run's stream has no session id to resume");
    }
    recorder.poll();
    if (recorder.last === null) throw new SmokeError("no run was opened, so nothing went through the gate");
    assertTaskEnded(recorder.taskEnds);
    ledger = codeLedger(recorder.snapshots);
    if (ledger === null) throw new SmokeError("no code run was seen");
    const log = runLog(repo);
    result.commits = log.map(({ subject }) => subject);
    assertControlFlow(ledger, log, { type, snapshots: codeSnapshots(recorder.snapshots), agents: recorder.spawns(), humanApprovals: result.humanApprovals });
    result.tests = Object.keys(ledger.tests.perTest).length;
    result.passed = true;
  } catch (e) {
    if (!(e instanceof SmokeError)) throw e;
    result.commits = runLog(repo).map(({ subject }) => subject);
    result.cause = `${e.constructor.name}: ${e.message}; ${position(recorder.last)}`;
  } finally {
    recorder.stop();
  }
  return { ...result, type, taskEnd: recorder.taskEnds.map(({ output }) => output), costUsd: Number(budget.spent.toFixed(6)), costKnown: budget.costKnown, seconds: Number(recorder.seconds().toFixed(1)), agents: (ledger ?? recorder.last)?.spend?.agents ?? null };
}

export function parseOptions(argv) {
  const { values } = parseArgs({ args: argv, options: { type: { type: "string" }, "budget-usd": { type: "string" }, "record-dir": { type: "string" }, recording: { type: "string" }, task: { type: "string" }, "plugin-dir": { type: "string" } } });
  const type = values.type ?? "bug_fix";
  if (!Object.hasOwn(TYPES, type)) throw new Error(`--type is ${type}, and S2 knows ${Object.keys(TYPES).join(", ")}`);
  const budgetUsd = Math.min(Number(values["budget-usd"] ?? BUDGET_USD), BUDGET_USD);
  return { type, budgetUsd, recordDir: values["record-dir"], recording: values.recording, task: values.task ?? TYPES[type].task, pluginDir: values["plugin-dir"] ?? REPO_ROOT };
}

async function main() {
  const { type, budgetUsd, recordDir, recording, task, pluginDir } = parseOptions(process.argv.slice(2));
  const record = recordDir ?? mkdtempSync(join(tmpdir(), "pb-smoke-s2-"));
  mkdirSync(record, { recursive: true });
  const name = recording ?? new Date().toISOString().replaceAll(":", "-");
  const result = await runS2(new Budget(budgetUsd), record, join(RECORDINGS, name), task, type, pluginDir);
  console.log(JSON.stringify(result));
  console.log(`${result.passed ? "PASS" : "FAIL"} S2, repo in ${record}, recorded in ${join(RECORDINGS, name)}`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
