#!/usr/bin/env node
// Smoke S5, refactoring half: a refactoring task run through the scope, apply and safety-net stages.
//
// assertRefactoringRun(ledger, log) checks the finished run's ledger and the git log: the refactor-step
// checkpoints that were committed are counted, and the summary returns that count. This is run by hand
// (`node tests/smoke/s5.mjs`) and never by a suite, like tests/smoke/s4.mjs; the unit tests in
// tests/js/smoke-s5.test.mjs only exercise the pure assertion helpers on synthetic ledgers.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parseKey } from "../../shared-node/keys.mjs";
import { wiredLensConfig } from "../../shared-node/lens-merge.mjs";
import { installGhShim } from "../js/gh-shim.mjs";
import { Budget, SmokeError, SpendCapError, cleanEnv, runClaude } from "./claude-run.mjs";
import { RunRecorder } from "./run-recorder.mjs";
import { RECORDINGS, git, parseOptions, position } from "./s2.mjs";
import { makeS3Repo } from "./s3.mjs";
import { LENS_REASON, MAX_HUMAN_APPROVALS, RUN_TIMEOUT_MS, assertCleanEnv, assertDraftPr, codeSnapshots, humanPb, publishSnapshots, readLedgerOrNull, sessionOf } from "./s4.mjs";

export const TASK = "Refactor line_total in cart.py: rename p, q and t to price, quantity and total, and name the 1.25 VAT rate as a module constant. Behaviour must not change; the existing test is the whole check.";
const PUBLISH_GATE = "G:publish";

const LENS_MAP = JSON.parse(readFileSync(new URL("../../contracts/lenses.json", import.meta.url), "utf8"));
const STAGES = ["intake", "code-refactor-scope", "code-refactor-apply", "code-safety-net"];

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

const SPIKE_STAGES = ["intake", "code-spike-unit", "code-spike-document"];
export const SPIKE_UNITS = 2;
const DOC_COMMIT = /^docs: record the spike findings in (.+)$/;

export function assertSpikeRun(ledger, log, opts = {}) {
  if (ledger.taskType !== "spike") throw new SmokeError(`taskType is ${ledger.taskType}, expected spike`);
  const names = (ledger.stages ?? []).map((s) => s.name);
  if (names.join() !== SPIKE_STAGES.join()) throw new SmokeError(`stages are [${names}], expected ${SPIKE_STAGES} in that order`);
  for (const stage of ledger.stages) if (stage.status !== "done") throw new SmokeError(`stage ${stage.name} is not done (${stage.status})`);
  const explored = ledger.stages.find((s) => s.name === "code-spike-unit")?.explored ?? [];
  if (explored.length < SPIKE_UNITS) throw new SmokeError(`the spike explored ${explored.length}, expected at least ${SPIKE_UNITS} units (explored: [${explored}])`);
  const committedUnits = new Set((ledger.checkpoints ?? []).filter((c) => c.step === "spike-unit" && c.committed).map((c) => parseKey(c.key).item));
  for (const unit of explored) if (!committedUnits.has(unit)) throw new SmokeError(`unit ${unit} has no committed spike-unit checkpoint in the ledger`);
  const docCommits = (ledger.checkpoints ?? []).filter((c) => c.step === "spike-doc" && c.committed).length;
  if (docCommits === 0) throw new SmokeError("no committed spike-doc checkpoint in the ledger");
  const stray = log.find((c) => !c.subject.startsWith("chore:") && !c.subject.startsWith("docs:"));
  if (stray) throw new SmokeError(`a commit that is neither chore: nor docs: is in the log (${stray.sha}): ${stray.subject}`);
  if (opts.publishSeen) throw new SmokeError("a publish run was seen: a spike does not publish");
  const create = (opts.ghCalls ?? []).find((argv) => argv[0] === "pr" && argv[1] === "create");
  if (create) throw new SmokeError(`gh pr create was called (${create.join(" ")}): a spike opens no PR`);
  if (opts.unitOpen) throw new SmokeError("a unit is still open: run/unit.json exists after the run");
  if (opts.docInHead === false) throw new SmokeError("the spike write-up is not in HEAD");
  return { units: explored.length, docCommits };
}

export const SPIKE_TASK = "Spike: compare two ways to round line_total's VAT result in cart.py to cents — round() versus decimal.Decimal.quantize — each as a short script under spike/ run with python3, two units, write-up to docs/spikes/rounding.md. No production change.";

// The run loop both halves share: claude run, answer asking gates as the human, resume.
async function driveRun({ repo, task, budget, env, recorder, gh, pluginDir, result, stopAt }) {
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
    if (!asking || stopAt(asking) || result.humanApprovals.length >= MAX_HUMAN_APPROVALS) break;
    const approved = humanPb(repo, gh, pluginDir, "human", "approve", asking.gate);
    if (approved.code !== 0) throw new SmokeError(`the human's pb human approve ${asking.gate}: exit ${approved.code}, ${approved.stderr}`);
    result.humanApprovals.push({ gate: asking.gate, reason: asking.reason });
    prompt = `I ran the approve command for ${asking.gate}. Continue.`;
    resume = sessionOf(recorder.stream);
    if (resume === null) throw new SmokeError("the run's stream has no session id to resume");
  }
  recorder.poll();
}

function setUp(record, out) {
  // new_feature's sample is green with short names and a magic rate: what the refactoring task renames and the spike measures.
  const { repo, remote } = makeS3Repo(record, "new_feature");
  const base = git(repo, "rev-parse", "HEAD").trim();
  const gh = installGhShim({ parent: record, remember: true });
  const env = assertCleanEnv({ ...cleanEnv(), ...gh.env() });
  if (Object.hasOwn(env, "ANTHROPIC_API_KEY") || Object.hasOwn(env, "ANTHROPIC_AUTH_TOKEN")) throw new SmokeError("an Anthropic key would reach the run");
  const recorder = new RunRecorder(repo, out, { streamPath: join(record, "stream.jsonl") }).start();
  return { repo, remote, base, gh, env, recorder };
}

const logSince = (repo, from) => git(repo, "log", "--reverse", "--format=%H %s", `${from}..HEAD`).trim().split("\n").filter(Boolean).map((line) => ({ sha: line.slice(0, 40), subject: line.slice(41) }));
const finish = (result, budget, recorder) => ({ ...result, costUsd: Number(budget.spent.toFixed(6)), costKnown: budget.costKnown, seconds: Number(recorder.seconds().toFixed(1)) });

async function runS5(budget, record, out, task, pluginDir) {
  const { repo, remote, base, gh, env, recorder } = setUp(record, out);
  const result = { passed: false, cause: "", runNote: "", humanApprovals: [] };
  try {
    await driveRun({ repo, task, budget, env, recorder, gh, pluginDir, result, stopAt: (asking) => asking.gate === PUBLISH_GATE && asking.reason === LENS_REASON });
    const finished = codeSnapshots(recorder.snapshots).at(-1);
    if (finished === undefined) throw new SmokeError(`no code-run ledger was seen; ${result.runNote}`);
    result.refactorSteps = assertRefactoringRun(finished, logSince(repo, recorder.unit?.baseSha ?? base)).refactorSteps;
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
  return finish(result, budget, recorder);
}

async function runSpike(budget, record, out, task, pluginDir) {
  const { repo, base, gh, env, recorder } = setUp(record, out);
  const result = { passed: false, cause: "", runNote: "", humanApprovals: [] };
  try {
    await driveRun({ repo, task, budget, env, recorder, gh, pluginDir, result, stopAt: () => false });
    const finished = codeSnapshots(recorder.snapshots).at(-1);
    if (finished === undefined) throw new SmokeError(`no code-run ledger was seen; ${result.runNote}`);
    const log = logSince(repo, base);
    const docPath = log.map((c) => DOC_COMMIT.exec(c.subject)?.[1]).find((p) => p !== undefined);
    const docInHead = docPath !== undefined && spawnSync("git", ["cat-file", "-e", `HEAD:${docPath}`], { cwd: repo }).status === 0;
    const facts = {
      publishSeen: publishSnapshots(recorder.snapshots).length > 0,
      ghCalls: gh.calls().map(({ argv }) => argv),
      unitOpen: existsSync(join(repo, ".pairingbuddy", "run", "unit.json")),
      docInHead,
    };
    const summary = assertSpikeRun(finished, log, facts);
    result.units = summary.units;
    result.docCommits = summary.docCommits;
    result.passed = true;
  } catch (e) {
    if (!(e instanceof SmokeError)) throw e;
    result.cause = `${e.message}; ${position(recorder.last)}`;
  } finally {
    recorder.stop();
  }
  return finish(result, budget, recorder);
}

const taskGiven = (argv) => parseArgs({ args: argv, options: { task: { type: "string" } }, strict: false }).values.task !== undefined;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some((arg) => arg === "--type" || arg.startsWith("--type="))) throw new Error("--type is not supported by S5, which always runs the refactoring task");
  const { budgetUsd, recordDir, recording, task, pluginDir } = parseOptions(argv);
  const record = recordDir ?? mkdtempSync(join(tmpdir(), "pb-smoke-s5-"));
  mkdirSync(record, { recursive: true });
  const out = join(RECORDINGS, recording ?? `s5-${new Date().toISOString().replaceAll(":", "-")}`);
  const budget = new Budget(budgetUsd);
  const refactoring = await runS5(budget, record, out, taskGiven(argv) ? task : TASK, pluginDir);
  // A spend-cap stop in the first half skips the second and fails.
  const capped = refactoring.runNote.startsWith("SpendCapError");
  const spike = capped ? { passed: false, skipped: true, cause: "skipped: the spend cap was reached in the refactoring half" } : await runSpike(budget, join(record, "spike"), join(out, "spike"), SPIKE_TASK, pluginDir);
  const result = { refactoring, spike, costUsd: Number(budget.spent.toFixed(6)), passed: refactoring.passed && spike.passed };
  console.log(JSON.stringify(result));
  console.log(`${result.passed ? "PASS" : "FAIL"} S5, $${result.costUsd}, repo in ${record}, recorded in ${out}`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
