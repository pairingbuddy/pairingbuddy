// pb test: what to run, from the human-owned test-config and the tests artifact, and how to run it. The command is
// split into words here and spawned with no shell, in a process group of its own. Node built-ins only.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { constants } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";

import { isOutside } from "./checkpoint.mjs";
import { matchesGlob } from "./glob-match.mjs";
import { returnFileKey } from "./stages.mjs";
import { humanCommand } from "./verbs.mjs";

// Under the Bash tool's 10-minute cap, so pb gets to record the timeout before the tool kills it.
const DEFAULT_TIMEOUT_SECONDS = 540;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const DEFAULT_FAILURE_EXIT_CODES = [1];
const EXCERPT_BYTES = 8192;
// The tail of a run kept per test: enough for the failure line. The ledger holds two per test, and the main context
// reads one per test in the report.
const CYCLE_EXCERPT_CHARS = 1024;
// How long a finished process's output may keep arriving, when something it left behind holds the pipes open.
const DRAIN_MS = 1000;
const FORWARDED_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
const TESTS_ROLE = "create-test-placeholders";
// What a test command reads as an option rather than a file: a flag, or pytest's @file of more arguments.
const NOT_A_FILE_NAME = /^[-@]/;
// create-test-placeholders-result.schema.json holds both. A model's return may not have met the schema, so they hold
// here too. A selector word is built from these, so `::` may only ever walk down inside the one file: a class path.
const TEST_FILE = /^(?![/@-])(?!.*::)[^\r\n]+$/;
const TEST_FUNCTION = /^(?![-@])(?:(?!.*::)[^\r\n]+|[A-Za-z_]\w*(?:::[A-Za-z_]\w*)+)$/;
const TEST_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SELECTOR_FIELDS = ["test_file", "test_function"];
const SELECTOR_FIELD = /\{([^{}]*)\}/g;

export class TestRunRefused extends Error {}
// The human changed test-config.json after the run pinned it: a wait on the human, not a broken step.
export class ConfigHashChanged extends TestRunRefused {}

// ---------- test-config ----------

// Whitespace separates words, and single or double quotes group them. Nothing else means anything.
export function tokenize(command) {
  const words = [];
  let word = null;
  let quote = null;
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= "";
    } else if (/\s/.test(ch)) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? "") + ch;
  }
  if (quote !== null) throw new TestRunRefused(`the test command has an unterminated quote: ${command}`);
  if (word !== null) words.push(word);
  return words;
}

const configPathOf = (root) => join(root, ".pairingbuddy", "test-config.json");

function configBytes(path) {
  if (!existsSync(path)) throw new TestRunRefused(`missing ${path}`);
  return readFileSync(path);
}

const hashOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

function parsedConfig(path, bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new TestRunRefused(`${path} is not valid JSON`);
  }
}

// The hash covers the bytes that are parsed, so the file cannot change between the two.
export function readTestConfig(root, configHash) {
  const path = configPathOf(root);
  const bytes = configBytes(path);
  if (hashOf(bytes) !== configHash) {
    throw new ConfigHashChanged(`the config hash changed: ${path} is not the file this run opened with. Stop here and tell the human, who can check the file and type ${humanCommand(root, "accept")}`);
  }
  return parsedConfig(path, bytes);
}

// The hash a run may pin: only that of a config every test run can use, since a run cannot change what it pinned.
export function validatedConfigHash(root) {
  const path = configPathOf(root);
  const bytes = configBytes(path);
  fullSuitePlans(parsedConfig(path, bytes));
  return hashOf(bytes);
}

function commandWords(id, { command }) {
  const words = typeof command === "string" ? tokenize(command) : [];
  if (!words[0]) throw new TestRunRefused(`runner ${id} has no command`);
  return words;
}

function failureCodes(id, { failure_exit_codes: codes = DEFAULT_FAILURE_EXIT_CODES }) {
  if (!Array.isArray(codes) || codes.length === 0 || !codes.every((code) => Number.isInteger(code) && code > 0)) {
    throw new TestRunRefused(`runner ${id} needs failure_exit_codes to be a list of positive integers`);
  }
  return codes;
}

function timeoutMs(id, { timeout_seconds: seconds = DEFAULT_TIMEOUT_SECONDS }) {
  if (typeof seconds !== "number" || !(seconds > 0) || seconds * 1000 > MAX_TIMEOUT_MS) {
    throw new TestRunRefused(`runner ${id} needs timeout_seconds to be a positive number of seconds`);
  }
  return seconds * 1000;
}

function selectorTemplate(id, { selector_template: template }) {
  if (template === undefined) return null;
  const words = Array.isArray(template) ? template : [];
  const fields = words.filter((word) => typeof word === "string").flatMap((word) => [...word.matchAll(SELECTOR_FIELD)].map(([, field]) => field));
  const usable = words.length > 0 && words.every((word) => typeof word === "string") && fields.every((field) => SELECTOR_FIELDS.includes(field)) && fields.includes("test_function");
  if (!usable) throw new TestRunRefused(`runner ${id} needs selector_template to be a list of words that name {test_function}, and may name {test_file}`);
  return words;
}

function checkedRunner(config, id) {
  const runners = config?.runners ?? {};
  if (!Object.hasOwn(runners, id)) throw new TestRunRefused(`runner ${id} is not in test-config.json`);
  const runner = runners[id];
  const { run_args: runArgs, test_directory: testDirectory } = runner;
  if (!Array.isArray(runArgs) || !runArgs.every((arg) => typeof arg === "string")) throw new TestRunRefused(`runner ${id} needs run_args to be a list of strings`);
  if (typeof testDirectory !== "string" || testDirectory === "") throw new TestRunRefused(`runner ${id} needs a test_directory`);
  return { id, command: commandWords(id, runner), runArgs, testDirectory, failureCodes: failureCodes(id, runner), timeoutMs: timeoutMs(id, runner), template: selectorTemplate(id, runner) };
}

// One pass over each word, so a name that holds a field's own spelling stays that name. A row cannot start a word with
// a flag: checkRow refused it.
const filledWord = (word, row) => word.replace(SELECTOR_FIELD, (_, field) => row[field]);

const selectorWords = ({ template }, row) => template.map((word) => filledWord(word, row));

const planFor = (runner, paths) => ({ runner: runner.id, argv: [...runner.command, ...paths, ...runner.runArgs], failureCodes: runner.failureCodes, timeoutMs: runner.timeoutMs });

// node --test, given a folder, runs every .mjs and .js file in it, helpers that wait on stdin included, so a full run can
// hang until its timeout. Each runner whose command takes plain files and file names gets the files its file_pattern
// matches; pytest and the rest pick their own tests from the folder.
const takesFiles = ({ command }) => basename(command[0]) === "node" && command.includes("--test");

function filesUnder(root, directory) {
  const at = join(root, directory);
  if (!existsSync(at)) return [];
  return readdirSync(at, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath ?? entry.path, entry.name)).split("\\").join("/"))
    .sort();
}

// The words a full run names its tests by. A pattern that matches nothing keeps the folder, as before: no file list is no run.
function suitePaths(runner, filePattern, root) {
  if (!takesFiles(runner) || typeof filePattern !== "string" || filePattern === "" || root === undefined) return [runner.testDirectory];
  const files = filesUnder(root, runner.testDirectory).filter((file) => matchesGlob(filePattern, file));
  return files.length > 0 ? files : [runner.testDirectory];
}

// Every configured runner, so the evidence for the whole suite covers the whole suite. root: where the run's files are,
// for a runner that is given its test files by name.
export function fullSuitePlans(config, root) {
  checkedRunner(config, config?.default_runner);
  return Object.keys(config.runners).map((id) => {
    const runner = checkedRunner(config, id);
    return planFor(runner, suitePaths(runner, config.runners[id].file_pattern, root));
  });
}

// ---------- the tests artifact ----------

// The latest return of this attempt's own stage, so a redo cannot run a list from before it.
function latestTestsFile(dir, { name, attempt }) {
  const found = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ file, key: returnFileKey(file) }))
    .filter(({ key }) => key?.stage === name && key.attempt === attempt && key.role === TESTS_ROLE && key.item === null)
    .sort((a, b) => b.key.round - a.key.round);
  if (found.length === 0) throw new TestRunRefused(`no tests artifact for stage ${name || "(none)"} at attempt ${attempt}, so there is nothing to select`);
  return join(dir, found[0].file);
}

function readTests(path) {
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new TestRunRefused(`the tests artifact ${path} cannot be read`);
  }
  const tests = artifact?.tests;
  if (!Array.isArray(tests) || tests.length === 0) throw new TestRunRefused(`the tests artifact ${path} selects no tests`);
  if (artifact.pb_key !== basename(path, ".json")) throw new TestRunRefused(`the tests artifact ${path} has pb_key ${JSON.stringify(artifact.pb_key)}, so it is no return of that key`);
  return tests;
}

// A model wrote these rows: a test_file that reads as an option would change what the human's command does.
function checkRow({ test_id: id, test_file: file, test_function: name }) {
  if (typeof id !== "string" || !TEST_ID.test(id)) throw new TestRunRefused(`a row in the tests artifact has no usable test_id: ${JSON.stringify(id)}`);
  if (typeof file !== "string" || file === "") throw new TestRunRefused(`test ${id} has no test_file`);
  if (NOT_A_FILE_NAME.test(file)) throw new TestRunRefused(`test ${id} has a test_file that reads as a flag or an args file: ${file}`);
  if (isAbsolute(file) === false && !TEST_FILE.test(file)) throw new TestRunRefused(`test ${id} has a test_file that is more than a file name: ${JSON.stringify(file)}`);
  if (typeof name !== "string" || !TEST_FUNCTION.test(name)) throw new TestRunRefused(`test ${id} has a test_function that is more than a test name: ${JSON.stringify(name)}`);
}

function assertUnderTestDirectory({ test_id: id, test_file: file }, { id: runner, testDirectory }) {
  const inside = isAbsolute(file) ? file : relative(testDirectory, file);
  if (inside === "" || isOutside(inside)) throw new TestRunRefused(`test ${id} has test_file ${file}, which is outside the test_directory ${testDirectory} of runner ${runner}`);
}

// Every row of this attempt's tests artifact, each one checked, since a model wrote them.
export function testRows(config, artifactsDir, stage) {
  const rows = readTests(latestTestsFile(artifactsDir, stage));
  const seen = new Set();
  for (const row of rows) {
    checkRow(row);
    assertUnderTestDirectory(row, checkedRunner(config, row.runner_id));
    if (seen.has(row.test_id)) throw new TestRunRefused(`test ${row.test_id} is in the tests artifact twice`);
    seen.add(row.test_id);
  }
  return rows;
}

function runnerRows(rows) {
  const byRunner = new Map();
  for (const row of rows) byRunner.set(row.runner_id, [...(byRunner.get(row.runner_id) ?? []), row]);
  return byRunner;
}

// A runner with no template can only name files, so a file's other tests decide its run.
const selection = (runner, rows) => (runner.template === null ? [...new Set(rows.map((row) => row.test_file))] : rows.flatMap((row) => selectorWords(runner, row)));

// One plan per runner, plus every test id they cover and whether the run speaks for each test or only for its file.
export function selectedPlans(config, artifactsDir, stage) {
  const rows = testRows(config, artifactsDir, stage);
  const runners = [...runnerRows(rows)].map(([id, own]) => ({ runner: checkedRunner(config, id), own }));
  const plans = runners.map(({ runner, own }) => planFor(runner, selection(runner, own)));
  const attribution = runners.every(({ runner }) => runner.template !== null) ? "test" : "file";
  return { plans, testIds: rows.map((row) => row.test_id), attribution };
}

export const hasSelector = (config, { runner_id: id }) => checkedRunner(config, id).template !== null;

export const runnersWithoutSelector = (config) => Object.keys(config.runners).filter((id) => checkedRunner(config, id).template === null);

// The selector_template to add, by what the runner's command runs, or null when the command is not one pb knows.
const SELECTOR_EXAMPLES = [
  [/\bpytest\b/, ["{test_file}::{test_function}"]],
  [/\bmod-test-one\.mjs\b/, ["{test_file}", "{test_function}"]],
  [/\bnode\b.*--test\b/, ["--test-name-pattern=^{test_function}$", "{test_file}"]],
];

const exampleFor = (command) => SELECTOR_EXAMPLES.find(([pattern]) => pattern.test(String(command ?? "")))?.[1] ?? null;

function selectorLine(id, { command }) {
  const example = exampleFor(command);
  const what = example === null ? "a list of the words that run one test, naming {test_function} and, if it needs it, {test_file}" : JSON.stringify(example).replaceAll(",", ", ");
  return `runner ${id}: "selector_template": ${what}`;
}

// What a human adds to test-config.json so every runner can run one test on its own, in plain words, or null when each
// already can. RED and GREEN need it, so a bug fix or a feature cannot be built without it.
export function selectorAdvice(config) {
  const missing = runnersWithoutSelector(config);
  if (missing.length === 0) return null;
  const [noun, verb] = missing.length === 1 ? ["runner", "has"] : ["runners", "have"];
  const lines = missing.map((id) => selectorLine(id, config.runners[id]));
  return `${noun} ${missing.join(", ")} ${verb} no selector_template, so pb cannot run one test on its own, and RED and GREEN need that. Add to .pairingbuddy/test-config.json: ${lines.join("; ")}`;
}

export const testDirectoryOf = (config, { runner_id: id }) => checkedRunner(config, id).testDirectory;

// What RED and GREEN run: this test and no other, or a refusal, since a run of its file says nothing about it.
export function testPlan(config, row) {
  const runner = checkedRunner(config, row.runner_id);
  if (runner.template === null) throw new TestRunRefused(`runner ${runner.id} has no selector_template in test-config.json, so a run cannot speak for test ${row.test_id} alone. Stop here and tell the human, who owns that file`);
  return planFor(runner, selectorWords(runner, row));
}

// ---------- running ----------

// Keeps only the end of the output, since that is where a test runner reports, and the memory this takes is bounded.
function outputTail() {
  let kept = Buffer.alloc(0);
  let truncated = false;
  return {
    add(chunk) {
      const joined = Buffer.concat([kept, chunk]);
      truncated ||= joined.length > EXCERPT_BYTES;
      kept = joined.subarray(-EXCERPT_BYTES);
    },
    // A replacement character is three bytes, so bytes that are not text could otherwise triple past the bound.
    text: () => kept.toString("utf8").replaceAll("�", "?"),
    truncated: () => truncated,
  };
}

function killGroup(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
}

function forwardSignals(pid) {
  const handlers = FORWARDED_SIGNALS.map((signal) => [signal, () => {
    killGroup(pid);
    process.exit(128 + constants.signals[signal]);
  }]);
  for (const [signal, handler] of handlers) process.once(signal, handler);
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

export function runPlan({ runner, argv, timeoutMs: limit }, cwd) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    // A pb started under node --test inherits NODE_TEST_CONTEXT, which turns a node --test child's report into data for a
    // parent runner, so its output would name no test. The suite runs as it would at a prompt.
    const { NODE_TEST_CONTEXT: _parent, ...env } = process.env;
    const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const tail = outputTail();
    let timedOut = false;
    let drain;
    let stopForwarding = () => {};
    child.stdout.on("data", tail.add);
    child.stderr.on("data", tail.add);
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, limit);
    const finish = (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(drain);
      stopForwarding();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ runner, argv, exitCode, signal, timedOut, durationMs: Date.now() - started, excerpt: tail.text(), excerptTruncated: tail.truncated() });
    };
    child.once("spawn", () => {
      stopForwarding = forwardSignals(child.pid);
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(new TestRunRefused(`cannot run ${argv[0]}: ${e.code ?? e.message}`));
    });
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timer);
      child.once("close", () => finish(exitCode, signal));
      drain = setTimeout(() => {
        killGroup(child.pid);
        finish(exitCode, signal);
      }, DRAIN_MS);
    });
  });
}

// What counts for one test at each step. RED needs a configured failure code: 5 is pytest's "no tests", and a timeout
// has no code at all.
const STEP_PASSES = {
  red: ({ failureCodes: codes }, { exitCode }) => codes.includes(exitCode),
  green: (_plan, { exitCode }) => exitCode === 0,
};

export const meetsStep = (step, plan, run) => STEP_PASSES[step](plan, run);

// What the ledger keeps of one test's run at one step.
export const cycleRun = ({ exitCode, timedOut, excerpt }, passed) => ({ passed, exitCodes: [exitCode], timedOut, excerpt: excerpt.slice(-CYCLE_EXCERPT_CHARS) });

// RED needs every run to fail with a configured code: 5 is pytest's "no tests", and a timeout has no code at all.
export function runRecord(plans, runs, { name, attempt }) {
  return {
    stage: name,
    attempt,
    passed: runs.every(({ exitCode }) => exitCode === 0),
    red: runs.every(({ exitCode }, i) => plans[i].failureCodes.includes(exitCode)),
    runs,
  };
}

// A failing run's tail in a refusal: long enough to hold the assertion past a runner's closing summary.
const FAILED_RUN_TAIL = 1500;

// pytest exits 5 when it collected no test: a selector or a path that names nothing, not a failing test.
const PYTEST_NO_TESTS = 5;
const isPytestArgv = (argv = []) => argv.some((word) => basename(word) === "pytest" || word === "pytest");
export const collectedNoTest = ({ argv, exitCode }) => exitCode === PYTEST_NO_TESTS && isPytestArgv(argv);

function howItFailed(run) {
  if (run.timedOut) return `timed out after ${Math.round(run.durationMs / 1000)}s`;
  if (collectedNoTest(run)) return `collected no test (pytest exit code ${PYTEST_NO_TESTS})`;
  return `failed with exit code ${run.exitCode}`;
}

// Each failing run by name, how it failed and its output, so whoever reads the refusal (the next agent's try, the human)
// knows what broke and why. rows: the tests the runs selected, in the same order, to name each by its test; else each
// run is named by its runner.
export function failedRunsText(runs, rows = null) {
  return runs
    .map((run, i) => ({ run, row: rows?.[i] }))
    .filter(({ run }) => run.exitCode !== 0 || run.timedOut)
    .map(({ run, row }) => `${row ? `test ${row.test_id} (${row.test_function} in ${row.test_file})` : `runner ${run.runner}`} ${howItFailed(run)}. Its output:\n${String(run.excerpt ?? "").slice(-FAILED_RUN_TAIL)}`)
    .join("\n\n");
}

// ---------- a selected run that ran no test ----------

const escapedPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isNodeTestArgv = (argv) => basename(argv[0] ?? "") === "node" && argv.includes("--test");

// Why a selected run that exited 0 ran no test, or null when it did or the output cannot tell. node --test exits 0 when
// --test-name-pattern matches nothing, counting the file itself as one passing test, so the test must be named as passing
// (spec "✔ name" or TAP "ok N - name"). pytest's no-test exit 5 is no pass already, and the mod helper exits 1 itself.
export function ranNoTest({ argv }, { exitCode, excerpt }, { test_function: name }) {
  if (exitCode !== 0 || !isNodeTestArgv(argv)) return null;
  const passed = new RegExp(`^\\s*(?:✔|ok \\d+ -) ${escapedPattern(name)}(?:\\s\\(|\\s*$)`, "m");
  return passed.test(String(excerpt ?? "")) ? null : `its selector matched none: node --test passed without running ${name}`;
}
