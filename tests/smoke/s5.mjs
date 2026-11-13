#!/usr/bin/env node
// Smoke S5, refactoring half: a refactoring task run through the scope, apply and safety-net stages.
//
// assertRefactoringRun(ledger, log) checks the finished run's ledger and the git log: the refactor-step
// checkpoints that were committed are counted, and the summary returns that count. This is run by hand
// (`node tests/smoke/s5.mjs`) and never by a suite, like tests/smoke/s4.mjs; the unit tests in
// tests/js/smoke-s5.test.mjs only exercise the pure assertion helpers on synthetic ledgers.

import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { wiredLensConfig } from "../../shared-node/lens-merge.mjs";
import { installGhShim } from "../js/gh-shim.mjs";
import { Budget, SmokeError, SpendCapError, cleanEnv, runClaude } from "./claude-run.mjs";
import { RunRecorder } from "./run-recorder.mjs";
import { RECORDINGS, git, parseOptions, position } from "./s2.mjs";
import { makeS3Repo } from "./s3.mjs";
import { LENS_REASON, MAX_HUMAN_APPROVALS, RUN_TIMEOUT_MS, assertCleanEnv, assertDraftPr, codeSnapshots, humanPb, readLedgerOrNull, sessionOf } from "./s4.mjs";

export const TASK = "Refactor line_total in cart.py: rename p, q and t to price, quantity and total, and name the 1.25 VAT rate as a module constant. Behaviour must not change; the existing test is the whole check.";
const PUBLISH_GATE = "G:publish";

const LENS_MAP = JSON.parse(readFileSync(new URL("../../contracts/lenses.json", import.meta.url), "utf8"));
const STAGES = ["code-refactor-scope", "code-refactor-apply", "code-safety-net"];

export function assertRefactoringRun(ledger, log) {
  for (const prefix of ["feat", "fix"]) {
    const found = log.find((c) => c.subject.startsWith(`${prefix}:`));
    if (found) throw new SmokeError(`a ${prefix}: commit is in the log (${found.sha}): a refactoring adds no behaviour`);
  }
  if (ledger.taskType !== "refactoring") throw new SmokeError(`taskType is ${ledger.taskType}, expected refactoring`);
  const names = (ledger.stages ?? []).map((s) => s.name);
  if (names.join() !== STAGES.join()) throw new SmokeError(`stages are [${names}], expected ${STAGES} in that order`);
  for (const stage of ledger.stages) if (stage.status !== "done") throw new SmokeError(`stage ${stage.name} is not done (${stage.status})`);
  const refactorSteps = (ledger.checkpoints ?? []).filter((c) => c.step === "refactor-step" && c.committed).length;
  if (refactorSteps === 0) throw new SmokeError("no committed refactor-step checkpoint in the ledger");
  const expected = wiredLensConfig(LENS_MAP, "code-safety-net", "refactoring").lenses.find((l) => l.name === "behaviour-preservation");
  const recorded = (ledger.lenses?.["safety-net"]?.lenses ?? []).find((l) => l.name === "behaviour-preservation");
  if (recorded === undefined) throw new SmokeError("the safety-net lens record: behaviour-preservation is missing");
  if (recorded.model !== expected.model) throw new SmokeError(`behaviour-preservation ran on ${recorded.model}, expected ${expected.model}`);
  return { refactorSteps };
}

async function runS5(budget, record, out, task, pluginDir) {
  // new_feature's sample is green with short names and a magic rate: exactly what the task refactors.
  const { repo, remote } = makeS3Repo(record, "new_feature");
  const base = git(repo, "rev-parse", "HEAD").trim();
  const gh = installGhShim({ parent: record, remember: true });
  const env = assertCleanEnv({ ...cleanEnv(), ...gh.env() });
  if (Object.hasOwn(env, "ANTHROPIC_API_KEY") || Object.hasOwn(env, "ANTHROPIC_AUTH_TOKEN")) throw new SmokeError("an Anthropic key would reach the run");
  const recorder = new RunRecorder(repo, out, { streamPath: join(record, "stream.jsonl") }).start();
  const result = { passed: false, cause: "", runNote: "", humanApprovals: [] };
  try {
    let prompt = `/pairingbuddy:code ${task}`;
    let resume = null;
    for (;;) {
      try {
        await runClaude(repo, prompt, budget, { env, onLine: (event) => recorder.line(event), pluginDir, resume, timeoutMs: RUN_TIMEOUT_MS });
      } catch (e) {
        if (!(e instanceof SmokeError)) throw e;
        result.runNote = `${e.constructor.name}: ${e.message}`;
        if (e instanceof SpendCapError) break;
      }
      recorder.poll();
      const ledger = readLedgerOrNull(repo);
      const asking = ledger?.stop === null ? ledger.needsHuman : null;
      if (!asking || (asking.gate === PUBLISH_GATE && asking.reason === LENS_REASON) || result.humanApprovals.length >= MAX_HUMAN_APPROVALS) break;
      const approved = humanPb(repo, gh, pluginDir, "human", "approve", asking.gate);
      if (approved.code !== 0) throw new SmokeError(`the human's pb human approve ${asking.gate}: exit ${approved.code}, ${approved.stderr}`);
      result.humanApprovals.push({ gate: asking.gate, reason: asking.reason });
      prompt = `I ran the approve command for ${asking.gate}. Continue.`;
      resume = sessionOf(recorder.stream);
      if (resume === null) throw new SmokeError("the run's stream has no session id to resume");
    }
    recorder.poll();
    const finished = codeSnapshots(recorder.snapshots).at(-1);
    if (finished === undefined) throw new SmokeError(`no code-run ledger was seen; ${result.runNote}`);
    const from = recorder.unit?.baseSha ?? base;
    const log = git(repo, "log", "--reverse", "--format=%H %s", `${from}..HEAD`).trim().split("\n").filter(Boolean).map((line) => ({ sha: line.slice(0, 40), subject: line.slice(41) }));
    result.refactorSteps = assertRefactoringRun(finished, log).refactorSteps;
    const branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim();
    const pr = assertDraftPr(recorder.snapshots, gh, repo, remote, branch, result.humanApprovals);
    result.pr = { title: pr.title, headSha: pr.headSha, gate: pr.gate };
    result.passed = true;
  } catch (e) {
    if (!(e instanceof SmokeError)) throw e;
    result.cause = `${e.message}; ${position(recorder.last)}`;
  } finally {
    recorder.stop();
  }
  return { ...result, costUsd: Number(budget.spent.toFixed(6)), costKnown: budget.costKnown, seconds: Number(recorder.seconds().toFixed(1)) };
}

const taskGiven = (argv) => parseArgs({ args: argv, options: { task: { type: "string" } }, strict: false }).values.task !== undefined;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some((arg) => arg === "--type" || arg.startsWith("--type="))) throw new Error("--type is not supported by S5, which always runs the refactoring task");
  const { budgetUsd, recordDir, recording, task, pluginDir } = parseOptions(argv);
  const record = recordDir ?? mkdtempSync(join(tmpdir(), "pb-smoke-s5-"));
  mkdirSync(record, { recursive: true });
  const out = join(RECORDINGS, recording ?? `s5-${new Date().toISOString().replaceAll(":", "-")}`);
  const result = await runS5(new Budget(budgetUsd), record, out, taskGiven(argv) ? task : TASK, pluginDir);
  console.log(JSON.stringify(result));
  console.log(`${result.passed ? "PASS" : "FAIL"} S5, $${result.costUsd}, repo in ${record}, recorded in ${out}`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
