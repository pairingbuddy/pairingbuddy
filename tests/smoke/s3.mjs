#!/usr/bin/env node
// Smoke S3: a one-task unit publishes through `pb publish`, and only as it should. It extends S2 against a local bare
// remote, with a recording `gh` first on PATH for every claude and pb call.
//
// The sample repo starts on main, and the unit branch is made by `pb unit open` from pr.base_branch: `develop`, a branch
// on the remote that is not the default, so the PR target is proven to come from git-config.json. The human opens the
// unit from this script's shell, with --yes, before run 1, and /code resumes that empty unit. Under the auto policy the
// model cannot confirm it: the CLI's refusal of a bare `pb unit open` names a command for the human, and Claude Code's
// auto-mode classifier denies a model's own --yes as an auto-mode bypass, so /code from main stops before any branch.
//
// Run 1, `/pairingbuddy:code <S2 bug task>` under the auto policy, in the open unit: S2's control flow on the task's ledger, then the unit
// record (branch, base, baseSha, one task record with a green full suite at HEAD, its commits), the publish run done
// with pr-draft and stopped at G:publish with needsHuman and the "no lens record yet" reason, the PR lint result, nothing
// pushed and no `gh pr create`. Then, as the human, from this script's own shell: `pb human approve G:publish`, and the
// gate binding it records in the ledger (HEAD, target, body hash) is kept before the run closes it.
//
// Forced stop, with no model, on copies of the repo and its remote: a stop the human answered at G:publish, and a stop
// recorded after the approval, each make `pb publish` refuse with nothing pushed and no gh call.
//
// Run 2 resumes run 1's session with a short "continue": pb publish ran, the remote has the unit branch at the approved
// HEAD, the shim saw one `pr create` with --base develop and --draft (auto policy) and the approved body, and one
// `pr comment` with the draft's coordination text when it had any, the unit is closed, no refs/pairingbuddy/ ref is on
// the remote, and no PR: plan line (a non-plan /code task has no plan).
//
// Each run is recorded as S2's are, under recordings/<name>/run1 and run2, and each has its own spend cap.
//
// Run it by hand, in a separate shell, from the repo root. It spends money, so no suite collects it:
//
//     node tests/smoke/s3.mjs [--budget-usd N] [--record-dir DIR] [--recording NAME] [--plugin-dir DIR]
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { recordAnswer } from "../../shared-node/gates.mjs";
import { DEFAULTS } from "../../shared-node/gitconf.mjs";
import { updateLedger } from "../../shared-node/ledger.mjs";
import { readDraftArtifact } from "../../shared-node/pr-lint-run.mjs";
import { FAKE_PR_URL, flagValues, installGhShim } from "../js/gh-shim.mjs";
import { BUDGET_USD, Budget, REPO_ROOT, SmokeError, cleanEnv, runClaude } from "./claude-run.mjs";
import { RunRecorder } from "./run-recorder.mjs";
import { RECORDINGS, TASK, assertControlFlow, git, makeRepo, position, runLog } from "./s2.mjs";

const BASE = "develop";
const UNIT = { type: "fix", slug: "apply-discount" };
const UNIT_BRANCH = `${UNIT.type}/${UNIT.slug}`;
const GATE = "G:publish";
const LENS_REASON = "no lens record yet for the safety net";
const CONTINUE = "I ran the approve command for G:publish. Continue.";
const PB_PUBLISH = /\bpb(?:\.mjs)?["']?\s+publish\b/;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const runDirOf = (repo) => join(repo, ".pairingbuddy", "run");
const ledgerOf = (repo) => join(runDirOf(repo), "task", "ledger.json");

function check(condition, message) {
  if (!condition) throw new SmokeError(message);
}

const bare = (remote, ...args) => execFileSync("git", ["--git-dir", remote, ...args], { encoding: "utf8", env: cleanEnv() }).trim();
const remoteHeads = (remote) => Object.fromEntries(bare(remote, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/").split("\n").filter(Boolean).map((line) => line.split(" ")));
const remotePrivateRefs = (remote) => bare(remote, "for-each-ref", "--format=%(refname)", "refs/pairingbuddy/").split("\n").filter(Boolean);

// S2's repo left on main, with a bare origin that has main and develop at the same commit, and pr.base_branch develop
// in git-config.json before anything reads it, so the unit's git-config hash is this file's.
function makeS3Repo(record) {
  const repo = makeRepo(record, "bug_fix", { onMain: true });
  const remote = join(record, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env: cleanEnv() });
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main", `main:refs/heads/${BASE}`);
  git(repo, "remote", "set-head", "origin", "main");
  writeFileSync(join(repo, ".pairingbuddy", "git-config.json"), `${JSON.stringify({ ...DEFAULTS, pr: { ...DEFAULTS.pr, base_branch: BASE } }, null, 2)}\n`);
  return { repo, remote };
}

// The human's own `pb` call, from this shell: no claude, no policy env, the shim first on PATH.
function humanPb(repo, gh, pluginDir, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(pluginDir, "cli", "pb.mjs"), ...args], { cwd: repo, env: { ...cleanEnv(), ...gh.env() }, encoding: "utf8" });
  return { code: status, stdout, stderr };
}

// The env every claude run gets: S2's clean env with the shim first on PATH. No ANTHROPIC_API_KEY may reach a run.
function claudeEnv(gh) {
  const env = { ...cleanEnv(), ...gh.env() };
  check(!Object.hasOwn(env, "ANTHROPIC_API_KEY") && !Object.hasOwn(env, "ANTHROPIC_AUTH_TOKEN"), "an Anthropic key would reach the run");
  return env;
}

// The task's own ledger: the last snapshot of the code run, which pb task end removed before the publish run opened.
const codeLedger = (snapshots) => snapshots.filter(({ kind }) => kind === "code").at(-1) ?? null;

function assertUnitRecord(repo, remote, unit) {
  const head = git(repo, "rev-parse", "HEAD").trim();
  const branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim();
  check(unit.branch === UNIT_BRANCH && branch === UNIT_BRANCH, `the unit branch is ${unit.branch} and HEAD is on ${branch}, expected ${UNIT_BRANCH}`);
  check(unit.base === BASE && unit.baseSha === remoteHeads(remote)[BASE], `the unit base is ${unit.base} at ${unit.baseSha}, expected ${BASE} at ${remoteHeads(remote)[BASE]}`);
  check(unit.plan === null && unit.unit === null, `a non-plan task has no plan, and the unit names ${unit.plan} ${unit.unit}`);
  check(unit.tasks.length === 1, `the unit has ${unit.tasks.length} task records, expected one`);
  const [task] = unit.tasks;
  check(task.headSha === head, `the task record is at ${task.headSha}, HEAD is ${head}`);
  check(task.fullSuite?.passed === true && task.fullSuite.head === head, `the task record's full suite is ${JSON.stringify(task.fullSuite)}, expected green at ${head}`);
  const commits = git(repo, "rev-list", "--reverse", `${unit.baseSha}..HEAD`).trim().split("\n").filter(Boolean);
  check(commits.length > 0 && JSON.stringify(unit.commits) === JSON.stringify(commits), `unit commits ${JSON.stringify(unit.commits)}, expected ${JSON.stringify(commits)}`);
}

// Where run 1 must stop: the publish run, pr-draft done, G:publish asked with the lens reason, the lint on file.
function assertStoppedAtPublish(repo, ledger) {
  check(ledger.kind === "publish", `the open run is a ${ledger.kind} run, expected publish`);
  check(ledger.stages.some(({ name, status }) => name === "pr-draft" && status === "done"), `pr-draft is not done: ${JSON.stringify(ledger.stages)}`);
  check(ledger.needsHuman?.gate === GATE && ledger.needsHuman.reason === LENS_REASON, `needsHuman is ${JSON.stringify(ledger.needsHuman)}, expected ${GATE} with "${LENS_REASON}"`);
  check(!Object.hasOwn(ledger.gates, GATE), `${GATE} is recorded already: ${JSON.stringify(ledger.gates[GATE])}`);
  check(ledger.stop === null, `the publish run stopped: ${JSON.stringify(ledger.stop)}`);
  check(ledger.policy?.mode === "auto", `the publish policy is ${JSON.stringify(ledger.policy)}`);
  const lintPath = join(runDirOf(repo), "pr-lint.json");
  check(existsSync(lintPath), "run/pr-lint.json is missing");
  const lint = readJson(lintPath);
  check(typeof lint.ok === "boolean" && Array.isArray(lint.failures), `pr-lint.json is ${JSON.stringify(lint)}`);
  return lint;
}

function assertNothingOut(remote, gh, label) {
  const heads = Object.keys(remoteHeads(remote)).sort();
  check(JSON.stringify(heads) === JSON.stringify(["develop", "main"]), `${label}: the remote has ${heads}, expected only develop and main`);
  check(remotePrivateRefs(remote).length === 0, `${label}: refs/pairingbuddy/ is on the remote`);
  check(gh.prCreates().length === 0 && gh.prComments().length === 0, `${label}: gh saw ${gh.prCreates().length} pr create and ${gh.prComments().length} pr comment`);
}

function assertBinding(repo, ledger) {
  const record = ledger.gates[GATE];
  const head = git(repo, "rev-parse", "HEAD").trim();
  check(record?.source === "human-cli" && record.answer === "approve", `${GATE} is ${JSON.stringify(record)}, expected a human-cli approval`);
  check(record.headSha === head && record.target === BASE && typeof record.bodyHash === "string", `the binding is ${JSON.stringify(record)}, expected HEAD ${head} into ${BASE} with a body hash`);
  check(ledger.needsHuman === null, `needsHuman is still ${JSON.stringify(ledger.needsHuman)}`);
  return record;
}

// A copy of the repo whose origin is a copy of the remote, so a refusal that pushed would show there and nowhere else.
function copyOf(record, repo, remote, name) {
  const [copy, copyRemote] = [join(record, name, "repo"), join(record, name, "origin.git")];
  cpSync(repo, copy, { recursive: true });
  cpSync(remote, copyRemote, { recursive: true });
  git(copy, "remote", "set-url", "origin", copyRemote);
  return { copy, copyRemote };
}

function assertPublishRefused(copy, copyRemote, pluginDir, record, label, reason) {
  const gh = installGhShim({ parent: record });
  const result = humanPb(copy, gh, pluginDir, "publish");
  check(result.code === 1 && result.stderr.includes(reason), `${label}: pb publish exit ${result.code}, stdout ${result.stdout}, stderr ${result.stderr}`);
  check(gh.calls().length === 0, `${label}: gh was called: ${JSON.stringify(gh.calls())}`);
  assertNothingOut(copyRemote, gh, label);
  return result.stderr.trim();
}

// No model: the human answers stop at G:publish (the tap's record of it), and a stop raised after an approval.
function forcedStops(record, repo, remote, pluginDir) {
  const answered = copyOf(record, repo, remote, "stop-answered");
  updateLedger(ledgerOf(answered.copy), (ledger) => recordAnswer(ledger, GATE, "stop", []));
  const afterApproval = copyOf(record, repo, remote, "stop-after-approval");
  const approve = humanPb(afterApproval.copy, installGhShim({ parent: record }), pluginDir, "human", "approve", GATE);
  check(approve.code === 0, `stop-after-approval: pb human approve: ${approve.stderr}`);
  const reason = "smoke S3: forced stop after the approval";
  updateLedger(ledgerOf(afterApproval.copy), (ledger) => ({ ...ledger, stop: { code: "human-stopped", reason, seq: ledger.seq + 1 } }));
  return {
    answered: assertPublishRefused(answered.copy, answered.copyRemote, pluginDir, record, "stop-answered", `the human answered stop at ${GATE}`),
    afterApproval: assertPublishRefused(afterApproval.copy, afterApproval.copyRemote, pluginDir, record, "stop-after-approval", reason),
  };
}

// What pb publish printed in a run's stream, parsed, or null when the run never called it.
function publishOutputs(stream) {
  const calls = new Map();
  const outputs = [];
  for (const { event } of stream) {
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    for (const block of content) {
      if (event.type === "assistant" && block.type === "tool_use" && block.name === "Bash" && PB_PUBLISH.test(block.input?.command ?? "")) calls.set(block.id, block.input.command);
      if (event.type === "user" && block.type === "tool_result" && calls.has(block.tool_use_id)) {
        const text = typeof block.content === "string" ? block.content : (block.content ?? []).filter(({ type }) => type === "text").map(({ text: t }) => t).join("");
        outputs.push({ command: calls.get(block.tool_use_id), text, isError: block.is_error === true });
      }
    }
  }
  return outputs;
}

function parsedPublish(outputs) {
  for (const { text } of outputs.toReversed()) {
    const line = text.split("\n").find((candidate) => candidate.trim().startsWith("{") && candidate.includes('"result"'));
    if (line === undefined) continue;
    try {
      return JSON.parse(line);
    } catch {
      // not the JSON line
    }
  }
  return null;
}

function assertPublished(repo, remote, gh, { binding, draft, body, unit }, printed) {
  check(printed?.result === "published" && printed.url === FAKE_PR_URL, `pb publish printed ${JSON.stringify(printed)}`);
  check(!printed.warnings.some((warning) => /PR:|plan/.test(warning)), `pb publish warned about a plan: ${printed.warnings}`);
  check(remoteHeads(remote)[unit.branch] === binding.headSha, `the remote has ${unit.branch} at ${remoteHeads(remote)[unit.branch]}, approved ${binding.headSha}`);
  check(git(repo, "rev-parse", "HEAD").trim() === binding.headSha, "HEAD moved after the approval");
  const creates = gh.prCreates();
  check(creates.length === 1, `gh saw ${creates.length} pr create calls`);
  const [{ argv, bodyFile }] = creates;
  check(JSON.stringify(flagValues(argv, "--base")) === JSON.stringify([BASE]), `pr create --base ${flagValues(argv, "--base")}, expected ${BASE}`);
  check(JSON.stringify(flagValues(argv, "--head")) === JSON.stringify([unit.branch]), `pr create --head ${flagValues(argv, "--head")}, expected ${unit.branch}`);
  check(argv.includes("--draft"), `pr create has no --draft under the auto policy: ${argv}`);
  check(JSON.stringify(flagValues(argv, "--title")) === JSON.stringify([draft.title]), `pr create --title ${flagValues(argv, "--title")}, the draft's is ${draft.title}`);
  check(bodyFile === body, "pr create's body is not the approved run/pr-body.md");
  const comments = gh.prComments();
  const coordination = typeof draft.coordination === "string" && draft.coordination.trim() !== "" ? draft.coordination : null;
  check(comments.length === (coordination === null ? 0 : 1), `gh saw ${comments.length} pr comment calls, the draft's coordination is ${JSON.stringify(draft.coordination)}`);
  if (coordination !== null) check(comments[0].argv[2] === FAKE_PR_URL && comments[0].bodyFile === coordination, `pr comment ${JSON.stringify(comments[0])}, expected the coordination text on ${FAKE_PR_URL}`);
  check(!existsSync(join(runDirOf(repo), "unit.json")), "run/unit.json is still there, so the unit did not close");
  check(!existsSync(join(runDirOf(repo), "task")), "run/task is still there, so the publish run did not end");
  check(remotePrivateRefs(remote).length === 0, `refs/pairingbuddy/ is on the remote: ${remotePrivateRefs(remote)}`);
  const local = git(repo, "for-each-ref", "--format=%(refname)", `refs/pairingbuddy/${unit.branch}/`).trim();
  check(local === "", `the unit's refs were not deleted: ${local}`);
  return { comments: comments.length };
}

const runSummary = (budget, recorder) => ({ costUsd: Number(budget.spent.toFixed(6)), costKnown: budget.costKnown, seconds: Number(recorder.seconds().toFixed(1)) });

const sessionOf = (stream) => stream.map(({ event }) => event.session_id).find((id) => typeof id === "string") ?? null;

async function runOne(label, { repo, out, record, prompt, budgetUsd, env, pluginDir, resume = null }) {
  const budget = new Budget(budgetUsd);
  const recorder = new RunRecorder(repo, out, { streamPath: join(record, `${label}.stream.jsonl`) }).start();
  const run = { label, budget, recorder };
  try {
    await runClaude(repo, prompt, budget, { env, onLine: (event) => recorder.line(event), pluginDir, resume });
    recorder.poll();
  } catch (e) {
    // The spend and the position of a run that failed are still the caller's to report.
    e.run = run;
    throw e;
  } finally {
    recorder.stop();
  }
  return run;
}

async function runS3({ budgetUsd, record, out, pluginDir }) {
  const { repo, remote } = makeS3Repo(record);
  const gh = installGhShim({ parent: record, remember: true });
  const env = claudeEnv(gh);
  const result = { passed: false, step: "unit-open", cause: "", runs: {} };
  let current = null;
  try {
    const opened = humanPb(repo, gh, pluginDir, "unit", "open", "--type", UNIT.type, "--slug", UNIT.slug, "--yes");
    check(opened.code === 0, `the human's pb unit open: exit ${opened.code}, ${opened.stderr}`);
    check(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim() === UNIT_BRANCH, `pb unit open left HEAD off ${UNIT_BRANCH}`);
    result.step = "run1";
    current = await runOne("run1", { repo, out: join(out, "run1"), record, prompt: `/pairingbuddy:code ${TASK}`, budgetUsd, env, pluginDir });
    result.runs.run1 = runSummary(current.budget, current.recorder);
    const task = codeLedger(current.recorder.snapshots);
    check(task !== null, "no code run was seen");
    assertControlFlow(task, runLog(repo), { snapshots: current.recorder.snapshots.filter(({ kind }) => kind === "code"), agents: current.recorder.spawns() });
    check(existsSync(ledgerOf(repo)), "no publish run is open after run 1");
    const unit = readJson(join(runDirOf(repo), "unit.json"));
    assertUnitRecord(repo, remote, unit);
    const publishLedger = readJson(ledgerOf(repo));
    const lint = assertStoppedAtPublish(repo, publishLedger);
    assertNothingOut(remote, gh, "after run 1");
    result.run1 = { branch: unit.branch, lint, taskTypes: unit.tasks.map(({ stages }) => stages) };

    result.step = "forced-stop";
    result.forcedStop = forcedStops(record, repo, remote, pluginDir);

    result.step = "approve";
    const draft = readDraftArtifact(repo, publishLedger.stage);
    const body = readFileSync(join(runDirOf(repo), "pr-body.md"), "utf8");
    const approved = humanPb(repo, gh, pluginDir, "human", "approve", GATE);
    check(approved.code === 0, `pb human approve ${GATE}: exit ${approved.code}, ${approved.stderr}`);
    const binding = assertBinding(repo, readJson(ledgerOf(repo)));
    result.binding = binding;
    result.draft = { title: draft.title, coordination: draft.coordination };

    result.step = "run2";
    const session = sessionOf(current.recorder.stream);
    check(session !== null, "run 1's stream has no session id to resume");
    current = await runOne("run2", { repo, out: join(out, "run2"), record, prompt: CONTINUE, budgetUsd, env, pluginDir, resume: session });
    result.runs.run2 = runSummary(current.budget, current.recorder);
    const outputs = publishOutputs(current.recorder.stream);
    check(outputs.length > 0, "run 2 never called pb publish");
    result.run2 = { publish: parsedPublish(outputs), ...assertPublished(repo, remote, gh, { binding, draft, body, unit }, parsedPublish(outputs)) };
    result.passed = true;
  } catch (e) {
    if (!(e instanceof SmokeError)) throw e;
    current = e.run ?? current;
    if (current !== null) result.runs[current.label] ??= runSummary(current.budget, current.recorder);
    result.cause = `${e.constructor.name}: ${e.message}; ${position(current?.recorder.last ?? null)}`;
  }
  result.ghCalls = gh.calls().map(({ argv }) => argv.slice(0, 2).join(" "));
  result.commits = runLog(repo).map(({ subject }) => subject);
  result.costUsd = Number(Object.values(result.runs).reduce((sum, { costUsd }) => sum + costUsd, 0).toFixed(6));
  return result;
}

export function parseOptions(argv) {
  const { values } = parseArgs({ args: argv, options: { "budget-usd": { type: "string" }, "record-dir": { type: "string" }, recording: { type: "string" }, "plugin-dir": { type: "string" } } });
  const budgetUsd = Math.min(Number(values["budget-usd"] ?? BUDGET_USD), BUDGET_USD);
  return { budgetUsd, recordDir: values["record-dir"], recording: values.recording, pluginDir: values["plugin-dir"] ?? REPO_ROOT };
}

async function main() {
  const { budgetUsd, recordDir, recording, pluginDir } = parseOptions(process.argv.slice(2));
  const record = recordDir ?? mkdtempSync(join(tmpdir(), "pb-smoke-s3-"));
  mkdirSync(record, { recursive: true });
  const out = join(RECORDINGS, recording ?? `s3-${new Date().toISOString().replaceAll(":", "-")}`);
  const result = await runS3({ budgetUsd, record, out, pluginDir });
  console.log(JSON.stringify(result));
  console.log(`${result.passed ? "PASS" : "FAIL"} S3 at ${result.step}, $${result.costUsd}, repo in ${record}, recorded in ${out}`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
