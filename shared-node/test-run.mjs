// pb test: what to run, from the human-owned test-config and the tests artifact, and how to run it. The command is
// split into words here and spawned with no shell, in a process group of its own. Node built-ins only.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";

import { parseKey } from "./keys.mjs";

// Under the Bash tool's 10-minute cap, so pb gets to record the timeout before the tool kills it.
const DEFAULT_TIMEOUT_SECONDS = 540;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const DEFAULT_FAILURE_EXIT_CODES = [1];
const EXCERPT_BYTES = 8192;
// How long a finished process's output may keep arriving, when something it left behind holds the pipes open.
const DRAIN_MS = 1000;
const FORWARDED_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
const TESTS_ROLE = "create-test-placeholders";

export class TestRunRefused extends Error {}

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

// The hash covers the bytes that are parsed, so the file cannot change between the two.
export function readTestConfig(root, configHash) {
  const path = join(root, ".pairingbuddy", "test-config.json");
  if (!existsSync(path)) throw new TestRunRefused(`missing ${path}`);
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== configHash) {
    throw new TestRunRefused(`the config hash changed: ${path} is not the file this run opened with. Stop here and tell the human.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new TestRunRefused(`${path} is not valid JSON`);
  }
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

function checkedRunner(config, id) {
  const runners = config?.runners ?? {};
  if (!Object.hasOwn(runners, id)) throw new TestRunRefused(`runner ${id} is not in test-config.json`);
  const runner = runners[id];
  const { run_args: runArgs, test_directory: testDirectory } = runner;
  if (!Array.isArray(runArgs) || !runArgs.every((arg) => typeof arg === "string")) throw new TestRunRefused(`runner ${id} needs run_args to be a list of strings`);
  if (typeof testDirectory !== "string" || testDirectory === "") throw new TestRunRefused(`runner ${id} needs a test_directory`);
  return { id, command: commandWords(id, runner), runArgs, testDirectory, failureCodes: failureCodes(id, runner), timeoutMs: timeoutMs(id, runner) };
}

const planFor = (runner, paths) => ({ runner: runner.id, argv: [...runner.command, ...paths, ...runner.runArgs], failureCodes: runner.failureCodes, timeoutMs: runner.timeoutMs });

// Every configured runner, so the evidence for the whole suite covers the whole suite.
export function fullSuitePlans(config) {
  checkedRunner(config, config?.default_runner);
  return Object.keys(config.runners).map((id) => {
    const runner = checkedRunner(config, id);
    return planFor(runner, [runner.testDirectory]);
  });
}

// ---------- the tests artifact ----------

function keyOf(file) {
  try {
    return parseKey(file.replace(/\.json$/, ""));
  } catch {
    return null;
  }
}

// The latest return of this attempt's own stage, so a redo cannot run a list from before it.
function latestTestsFile(dir, { name, attempt }) {
  const found = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ file, key: keyOf(file) }))
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
  return tests;
}

// A model wrote these rows: a test_file that reads as a flag would change what the human's command does.
function checkRow({ test_id: id, test_file: file }) {
  if (typeof id !== "string" || id === "") throw new TestRunRefused(`a row in the tests artifact has no test_id: ${JSON.stringify(id)}`);
  if (typeof file !== "string" || file === "") throw new TestRunRefused(`test ${id} has no test_file`);
  if (file.startsWith("-")) throw new TestRunRefused(`test ${id} has a test_file that reads as a flag: ${file}`);
}

// One plan per runner, each naming its test files once, plus every test id they cover.
export function selectedPlans(config, artifactsDir, stage) {
  const tests = readTests(latestTestsFile(artifactsDir, stage));
  const filesByRunner = new Map();
  for (const row of tests) {
    checkRow(row);
    const files = filesByRunner.get(row.runner_id) ?? new Set();
    filesByRunner.set(row.runner_id, files.add(row.test_file));
  }
  const plans = [...filesByRunner].map(([id, files]) => planFor(checkedRunner(config, id), [...files]));
  return { plans, testIds: tests.map((row) => row.test_id) };
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
    const child = spawn(argv[0], argv.slice(1), { cwd, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
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
