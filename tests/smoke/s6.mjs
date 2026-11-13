#!/usr/bin/env node
// Smoke S6: a two-unit plan run across three sessions on the new path, on a cheap model, with a clean env and the
// recording gh. Unit A is a bug fix and a [HUMAN] task; unit B depends on unit A and is one new feature.
//
// Session 1 runs Task 1 and must stop at the human task, with nothing past it started. S6 ticks the human task as the
// human. Session 2 publishes unit A (an independent draft PR into the base), opens unit B stacked on unit A's open PR,
// and is killed by S6 the moment Task 3's scenarios stage is active. S6 adopts the run as the human (refused without
// --force while the owner was just seen, then forced), and session 3, a fresh session, finishes that same run, ends
// Task 3 and publishes unit B as a draft PR stacked on unit A's branch. Before any of it, on a copy of the fresh sample,
// a box ticked by hand must make pb plan next refuse. Asking gates are answered as the human, as S4 and S5 do: bounded,
// listed, and never G:publish asking for a missing lens record. The whole plan's agents stay under AGENT_CEILING, and
// all of it runs under one spend cap. Run by hand (`node tests/smoke/s6.mjs`), never by a suite; the unit tests in
// tests/js/smoke-s6.test.mjs exercise the pure helpers.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parsePlan } from "../../shared-node/plan.mjs";
import { boxLabel } from "../../shared-node/plan-boxes.mjs";
import { installGhShim, viewsEnv } from "../js/gh-shim.mjs";
import { Budget, KilledError, REPO_ROOT, SmokeError, SpendCapError, cleanEnv, humanPb, readLedgerOrNull, runClaude, sessionOf } from "./claude-run.mjs";
import { RunRecorder } from "./run-recorder.mjs";
import { RECORDINGS, position } from "./s2.mjs";
import { makeS3Repo } from "./s3.mjs";
import { LENS_REASON, RUN_TIMEOUT_MS, assertCleanEnv } from "./s4.mjs";

export const PLAN_PATH = "docs/plans/discounts.md";
export const UNIT_A = "Discount fix";
export const UNIT_B = "Discounted totals";
export const TASK_1 = "Task 1: Fix apply_discount";
export const HUMAN_TASK = "Task 2: [HUMAN] Check the fix by hand";
export const TASK_3 = "Task 3: Add discounted_total";

// Unit B depends on unit A for real: discounted_total is only right once apply_discount is fixed.
export const PLAN = `# Discounts

## Tasks

### T1: Discounts — Prices come out right

#### PR: ${UNIT_A}

- [ ] **${TASK_1}**

  **What to build:** Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. One regression test for exactly that case is the whole scope.

- [ ] **${HUMAN_TASK}**

  **HUMAN TASK. An agent must stop here, and must not perform or tick this task.**

  **Steps:** Run \`python3 -c "from discount import apply_discount; print(apply_discount(100, 10))"\` and check that it prints 90.0.

#### PR: ${UNIT_B}

Depends on: ${UNIT_A}

- [ ] **${TASK_3}**

  **What to build:** Add discounted_total(price, percent, quantity) to discount.py: it returns apply_discount(price, percent) times quantity, so discounted_total(100, 10, 2) returns 180. One test for exactly that example is the whole scope.
`;

// S6 kills the session that runs Task 3 the moment its scenarios stage is active: a stage the kill strands, before any
// agent of it has written to the tree.
export const KILL_STAGE = "code-scenarios";

export const isKillPoint = (ledger) => ledger?.kind === "code" && ledger.plan?.title === TASK_3 && ledger.stage?.name === KILL_STAGE && ledger.stage.status === "active";

// Every plan task as [title, checked], in plan order.
export const boxStates = (text) => parsePlan(text).units.flatMap(({ tasks }) => tasks.map(({ title, checked }) => [title, checked]));

const UNTICKED = "- [ ] ";

// The human's own tick of one box: the plan text with that task's box ticked and nothing else changed.
export function tickBox(text, title) {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith(UNTICKED) && boxLabel(line.slice(UNTICKED.length).trim()) === title);
  if (at === -1) throw new SmokeError(`the plan has no unticked box titled ${JSON.stringify(title)}`);
  lines[at] = `- [x] ${lines[at].slice(UNTICKED.length)}`;
  return lines.join("\n");
}

// "Well under the 1000-agent cap", for the whole plan: every run and every session together, at most a quarter of it.
export const AGENT_CEILING = 250;

// Each run's highest ledger agent count, in the order the runs were first seen, and their sum.
export function agentCounts(snapshots) {
  const runs = new Map();
  for (const { runId, kind, spend } of snapshots) {
    const seen = runs.get(runId) ?? { runId, kind, agents: 0 };
    runs.set(runId, { ...seen, agents: Math.max(seen.agents, spend?.agents ?? 0) });
  }
  const perRun = [...runs.values()];
  return { perRun, total: perRun.reduce((sum, { agents }) => sum + agents, 0) };
}

// spawnsSeen is the agents the recorder found in the stream and the workflow transcripts, a count no ledger can lower.
export function assertAgents({ perRun, total }, spawnsSeen) {
  if (perRun.length === 0) throw new SmokeError("no run was counted, so the agent count proves nothing");
  if (total >= AGENT_CEILING) throw new SmokeError(`the ledgers count ${total} agents across ${perRun.length} runs, at or over the ceiling of ${AGENT_CEILING}`);
  if (spawnsSeen >= AGENT_CEILING) throw new SmokeError(`the stream and transcripts show ${spawnsSeen} agents, at or over the ceiling of ${AGENT_CEILING}`);
  return { total, spawnsSeen, ceiling: AGENT_CEILING };
}

function check(condition, message) {
  if (!condition) throw new SmokeError(message);
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const outputOf = ({ stdout, stderr }) => `${stdout}\n${stderr}`;

// After session 1: Task 1 ran and is recorded in the open unit A, pb plan next refuses at the human task, and nothing
// went past it: no run for the human task or for Task 3, no publish run, no PR.
export function assertHumanStop({ plan, refusal, titlesRun, publishSeen, creates, unit }) {
  const boxes = boxStates(plan);
  check(sameJson(boxes, [[TASK_1, true], [HUMAN_TASK, false], [TASK_3, false]]), `the boxes after session 1 are ${JSON.stringify(boxes)}, expected only Task 1 ticked`);
  const said = outputOf(refusal);
  check(refusal.code !== 0 && said.includes("is a human task") && said.includes(HUMAN_TASK), `pb plan next did not stop at the human task: exit ${refusal.code}, ${said.trim()}`);
  check(sameJson(titlesRun, [TASK_1]), `the runs opened in session 1 were for ${JSON.stringify(titlesRun)}, expected Task 1 alone`);
  check(!publishSeen, "a publish run opened before the human ticked the human task");
  check(creates === 0, `gh saw ${creates} pr create calls before the human ticked the human task`);
  check(unit?.unit === UNIT_A && (unit.tasks ?? []).some(({ title }) => title === TASK_1), `unit A is not open with Task 1's record: ${JSON.stringify(unit)}`);
  return { stoppedAt: HUMAN_TASK };
}

const parsedOrNull = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// Across the kill: S6 killed the session at the kill point; the plan's boxes and order are as they were (Task 3 still
// unticked) and nothing changed them between the kill and session 3; pb human adopt warns about the recent owner
// without --force and fails the stranded stage with it; session 3 finished that same run, re-running the stranded stage
// at a later attempt and keeping every stage that was done before the kill.
export function assertKillResume({ killed, ledgerAtKill, planAtKill, planBeforeResume, adoptPlain, adoptForced, resumed }) {
  check(killed && isKillPoint(ledgerAtKill), `session 2 was not killed at Task 3's ${KILL_STAGE} stage: killed ${killed}, ledger stage ${JSON.stringify(ledgerAtKill?.stage)}`);
  const boxes = boxStates(planAtKill);
  check(sameJson(boxes, [[TASK_1, true], [HUMAN_TASK, true], [TASK_3, false]]), `the boxes at the kill are ${JSON.stringify(boxes)}, expected Task 1 and the human task ticked`);
  check(planBeforeResume === planAtKill, "the plan changed between the kill and session 3");
  check(adoptPlain.code !== 0 && /was active \d+ minutes? ago/.test(outputOf(adoptPlain)), `pb human adopt without --force did not warn about a recently active owner: exit ${adoptPlain.code}, ${outputOf(adoptPlain).trim()}`);
  const adopted = parsedOrNull(adoptForced.stdout);
  const { attempt } = ledgerAtKill.stage;
  check(adoptForced.code === 0 && adopted?.adopted === true && sameJson(adopted.failedStage, { stage: KILL_STAGE, attempt, nextAttempt: attempt + 1 }), `pb human adopt --force did not fail the stranded stage: exit ${adoptForced.code}, ${outputOf(adoptForced).trim()}`);
  check(resumed != null, "no code run for Task 3 was seen after the adopt");
  check(resumed.runId === ledgerAtKill.runId, `session 3 finished a new run ${resumed.runId}, not the killed run ${ledgerAtKill.runId}`);
  const stage = (ledger, name) => (ledger.stages ?? []).find((s) => s.name === name);
  const rerun = stage(resumed, KILL_STAGE);
  check(rerun?.status === "done" && rerun.attempt > attempt, `${KILL_STAGE} finished at attempt ${rerun?.attempt} (${rerun?.status}), expected a done attempt after ${attempt}`);
  for (const before of (ledgerAtKill.stages ?? []).filter(({ status }) => status === "done")) {
    const after = stage(resumed, before.name);
    check(after?.attempt === before.attempt, `${before.name} was done at attempt ${before.attempt} before the kill, and is at ${after?.attempt} after it`);
  }
  return { runId: resumed.runId, killedAt: { stage: KILL_STAGE, attempt }, resumedAttempt: rerun.attempt };
}

// S3's base branch, and the PR URLs the recording gh prints: one per publish, in order.
export const BASE = "develop";
export const PR_URLS = ["https://github.com/example/repo/pull/1", "https://github.com/example/repo/pull/2"];

const flagsOf = (argv, flag) => argv.flatMap((arg, i) => (arg === flag ? [argv[i + 1]] : []));
const prOf = ({ argv }) => ({ head: flagsOf(argv, "--head")[0], base: flagsOf(argv, "--base")[0], draft: argv.includes("--draft") });

// Two draft PRs on the recording gh: unit A's into the base, then unit B's stacked on unit A's branch, whose pushed
// head unit B's pushed branch contains.
export function assertPublishes({ creates, aBranch, bBranch, bContainsA }) {
  check(creates.length === 2, `gh saw ${creates.length} pr create calls, expected 2`);
  const [a, b] = creates.map(prOf);
  check(a.head === aBranch && a.base === BASE, `unit A's PR goes from ${a.head} into ${a.base}, expected ${aBranch} into ${BASE}`);
  check(b.head === bBranch && b.base === aBranch, `unit B's PR goes from ${b.head} into ${b.base}, expected ${bBranch} stacked on ${aBranch}`);
  check(a.draft && b.draft, `a PR is not a draft: unit A ${a.draft}, unit B ${b.draft}`);
  check(bContainsA, `unit B's pushed branch ${bBranch} does not contain unit A's pushed head`);
  return { independent: { head: a.head, base: a.base }, stacked: { head: b.head, base: b.base } };
}

// The plan at the end: the same tasks in the same order, every box ticked, each unit with its PR line; the two agent
// tasks ended once each, in plan order; and pb plan next has nothing left.
export function assertPlanFinished({ planStart, planEnd, taskEnds, planNext }) {
  const boxes = boxStates(planEnd);
  const expected = boxStates(planStart).map(([title]) => [title, true]);
  check(sameJson(boxes, expected), `the boxes at the end are ${JSON.stringify(boxes)}, expected ${JSON.stringify(expected)}`);
  const prs = parsePlan(planEnd).units.map(({ pr }) => pr);
  check(sameJson(prs, PR_URLS), `the plan's PR lines are ${JSON.stringify(prs)}, expected ${JSON.stringify(PR_URLS)}`);
  check(sameJson(taskEnds, [TASK_1, TASK_3]), `the task ends were ${JSON.stringify(taskEnds)}, expected Task 1 then Task 3, once each`);
  const next = parsedOrNull(planNext.stdout);
  check(planNext.code === 0 && next?.ok === true && next.next === null, `the plan is not done: pb plan next exit ${planNext.code}, ${outputOf(planNext).trim()}`);
  return { tasksEnded: taskEnds, prs };
}

// On a copy of the fresh sample with Task 1 ticked by hand, pb plan next refuses and names the box.
export function assertHandTickRefused(refusal) {
  const said = outputOf(refusal);
  check(refusal.code !== 0 && said.includes("A box ticked by hand earns nothing") && said.includes(TASK_1), `pb plan next did not refuse the hand-ticked ${TASK_1}: exit ${refusal.code}, ${said.trim()}`);
  return { refused: TASK_1 };
}

// The plan title of each `pb task end` that succeeded, in order; null for a success with no plan. A Bash call may chain
// other pb calls before it, so only an ok line with the `removed` that pb task end prints counts.
export const endedTitles = (taskEnds) =>
  taskEnds.flatMap(({ output }) => output.split("\n").map(parsedOrNull).filter((parsed) => parsed?.ok === true && "removed" in parsed).map(({ plan }) => plan?.title ?? null));

// ---------- the live run ----------

export const S6_BUDGET_USD = 6;
// The killed session reports no cost, so it is charged its whole cap: kept low, so that upper bound leaves room.
export const KILL_RUN_CAP_USD = 1.5;
// Human answers across the whole plan: S4's four per task-to-PR, for two tasks and two publishes.
export const MAX_HUMAN_APPROVALS = 8;
const PUBLISH_GATE = "G:publish";
const KILL_POLL_MS = 20;

const PROMPTS = {
  start: `/pairingbuddy:code Run the plan in ${PLAN_PATH}`,
  afterHuman: `/pairingbuddy:code I did the human task and ticked its box. Continue the plan in ${PLAN_PATH}`,
  afterKill: `/pairingbuddy:code The last session was killed, and I adopted its run with pb human adopt. Continue the plan in ${PLAN_PATH}`,
};

// The run env may carry no Anthropic key, and no ANTHROPIC_ name but the two model aliases.
function runEnv(extra = {}) {
  const env = { ...cleanEnv(), ...extra };
  if (Object.hasOwn(env, "ANTHROPIC_API_KEY") || Object.hasOwn(env, "ANTHROPIC_AUTH_TOKEN")) throw new SmokeError("an Anthropic key would reach the run");
  return assertCleanEnv(env);
}

const SAMPLE_FILES = { ".gitignore": ".pairingbuddy/\n__pycache__/\n.pytest_cache/\ndocs/plans/\n", [PLAN_PATH]: PLAN };

// S3's repo with S2's discount bug, and the plan under docs/plans/, which is ignored, as this repo keeps its own plans:
// pb task end ticks a box and pb publish writes a PR: line, and neither may dirty the tree.
function makeS6Repo(record) {
  return makeS3Repo(record, "bug_fix", SAMPLE_FILES);
}

const planPathOf = (repo) => join(repo, PLAN_PATH);
const readPlan = (repo) => readFileSync(planPathOf(repo), "utf8");
const readUnitOrNull = (repo) => parsedOrNull((() => {
  try {
    return readFileSync(join(repo, ".pairingbuddy", "run", "unit.json"), "utf8");
  } catch {
    return "";
  }
})());

// On a copy of the fresh sample: Task 1 ticked by hand, then the human's pb plan next.
function handTickedRefusal(record, repo, gh, pluginDir) {
  const copy = join(record, "hand-ticked");
  cpSync(repo, copy, { recursive: true });
  writeFileSync(planPathOf(copy), tickBox(readPlan(copy), TASK_1));
  return humanPb(copy, gh, pluginDir, "plan", "next", PLAN_PATH);
}

// One session: a fresh claude run of the prompt, then the human's answer to each asking gate and a resume of the same
// session, as S4 does. killAt, when given, is watched on the ledger, and the run is killed the moment it holds.
async function driveSession(ctx, label, prompt, { env, capUsd = Infinity, killAt = null }) {
  const { repo, budget, recorder, gh, pluginDir, result } = ctx;
  const from = { stream: recorder.stream.length, snapshots: recorder.snapshots.length };
  const session = { label, killed: false, ledgerAtKill: null, notes: [] };
  let next = prompt;
  let resume = null;
  for (;;) {
    const controller = new AbortController();
    const watch = killAt && setInterval(() => {
      const ledger = readLedgerOrNull(repo);
      if (controller.signal.aborted || !killAt(ledger)) return;
      session.ledgerAtKill = ledger;
      controller.abort();
    }, KILL_POLL_MS);
    try {
      await runClaude(repo, next, budget, { env, onLine: (event) => recorder.line(event), pluginDir, resume, timeoutMs: RUN_TIMEOUT_MS, capUsd, signal: controller.signal });
    } catch (e) {
      if (!(e instanceof SmokeError)) throw e;
      if (e instanceof KilledError) session.killed = true;
      else session.notes.push(`${e.constructor.name}: ${e.message}`);
      if (e instanceof SpendCapError) result.capped = true;
    } finally {
      clearInterval(watch);
    }
    recorder.poll();
    if (session.killed || result.capped) break;
    const ledger = readLedgerOrNull(repo);
    const asking = ledger?.stop === null ? ledger.needsHuman : null;
    if (!asking || (asking.gate === PUBLISH_GATE && asking.reason === LENS_REASON) || result.humanApprovals.length >= MAX_HUMAN_APPROVALS) break;
    const approved = humanPb(repo, gh, pluginDir, "human", "approve", asking.gate);
    check(approved.code === 0, `the human's pb human approve ${asking.gate}: exit ${approved.code}, ${approved.stderr}`);
    result.humanApprovals.push({ session: label, gate: asking.gate, reason: asking.reason });
    next = `I ran the approve command for ${asking.gate}. Continue.`;
    resume = sessionOf(recorder.stream.slice(from.stream));
    check(resume !== null, `${label}'s stream has no session id to resume`);
  }
  session.snapshots = recorder.snapshots.slice(from.snapshots);
  result.sessions.push({ label, killed: session.killed, notes: session.notes });
  return session;
}

const titlesOf = (snapshots) => [...new Set(snapshots.filter(({ kind }) => kind === "code").map(({ plan }) => plan?.title))];
const bare = (remote, ...args) => execFileSync("git", ["--git-dir", remote, ...args], { encoding: "utf8", env: cleanEnv() }).trim();
const isAncestor = (remote, older, newer) => spawnSync("git", ["--git-dir", remote, "merge-base", "--is-ancestor", older, newer], { env: cleanEnv() }).status === 0;
const prBranchOf = (plan, url) => new RegExp(`^PR: ${url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} branch: (\\S+)$`, "m").exec(plan)?.[1] ?? null;

async function runS6(budget, record, out, pluginDir) {
  const { repo, remote } = makeS6Repo(record);
  const gh = installGhShim({ parent: record });
  const planStart = readPlan(repo);
  const recorder = new RunRecorder(repo, out, { streamPath: join(record, "stream.jsonl") }).start();
  const result = { passed: false, cause: "", phases: {}, sessions: [], humanApprovals: [], capped: false };
  const ctx = { repo, budget, recorder, gh, pluginDir, result };
  try {
    result.phases.handTicked = assertHandTickRefused(handTickedRefusal(record, repo, gh, pluginDir));

    const first = await driveSession(ctx, "session 1", PROMPTS.start, { env: runEnv(gh.env()) });
    const unitA = readUnitOrNull(repo);
    result.phases.humanStop = assertHumanStop({
      plan: readPlan(repo),
      refusal: humanPb(repo, gh, pluginDir, "plan", "next", PLAN_PATH),
      titlesRun: titlesOf(first.snapshots),
      publishSeen: first.snapshots.some(({ kind }) => kind === "publish"),
      creates: gh.prCreates().length,
      unit: unitA,
    });
    writeFileSync(planPathOf(repo), tickBox(readPlan(repo), HUMAN_TASK));

    // Unit A's PR, as the recording gh shows it to pb unit open and pb unit status: open, from unit A's branch.
    const views = viewsEnv({ [PR_URLS[0]]: { url: PR_URLS[0], head: unitA.branch, base: BASE, state: "OPEN" } });
    const second = await driveSession(ctx, "session 2", PROMPTS.afterHuman, { env: runEnv(gh.env({ GH_SHIM_URL: PR_URLS[0], ...views })), capUsd: KILL_RUN_CAP_USD, killAt: isKillPoint });
    const planAtKill = readPlan(repo);
    const adoptPlain = humanPb(repo, gh, pluginDir, "human", "adopt");
    const adoptForced = humanPb(repo, gh, pluginDir, "human", "adopt", "--force");
    const planBeforeResume = readPlan(repo);

    const third = await driveSession(ctx, "session 3", PROMPTS.afterKill, { env: runEnv(gh.env({ GH_SHIM_URL: PR_URLS[1], ...views })) });
    const resumed = third.snapshots.filter(({ kind, plan }) => kind === "code" && plan?.title === TASK_3).at(-1) ?? null;
    result.phases.killResume = assertKillResume({ killed: second.killed, ledgerAtKill: second.ledgerAtKill, planAtKill, planBeforeResume, adoptPlain, adoptForced, resumed });

    const planEnd = readPlan(repo);
    result.phases.planFinished = assertPlanFinished({ planStart, planEnd, taskEnds: endedTitles(recorder.taskEnds), planNext: humanPb(repo, gh, pluginDir, "plan", "next", PLAN_PATH) });
    const [aBranch, bBranch] = PR_URLS.map((url) => prBranchOf(planEnd, url));
    check(aBranch === unitA.branch, `unit A's PR line names ${aBranch}, and unit A opened on ${unitA.branch}`);
    const heads = Object.fromEntries([aBranch, bBranch].map((branch) => [branch, spawnSync("git", ["--git-dir", remote, "rev-parse", "--verify", "-q", `refs/heads/${branch}`], { encoding: "utf8", env: cleanEnv() }).stdout.trim()]));
    const bContainsA = Boolean(heads[aBranch] && heads[bBranch]) && isAncestor(remote, heads[aBranch], heads[bBranch]);
    result.phases.publishes = assertPublishes({ creates: gh.prCreates(), aBranch, bBranch, bContainsA });
    check(bare(remote, "for-each-ref", "refs/pairingbuddy/") === "", "refs/pairingbuddy/ reached the remote");

    const spawnsSeen = recorder.spawns().filter(({ kind }) => kind === "workflow_agent" || kind === "Agent").length;
    result.phases.agents = { ...assertAgents(agentCounts(recorder.snapshots), spawnsSeen), perRun: agentCounts(recorder.snapshots).perRun };
    check(budget.spent <= budget.total, `the plan spent $${budget.spent.toFixed(4)}, over the $${budget.total} cap`);
    result.passed = true;
  } catch (e) {
    if (!(e instanceof SmokeError)) throw e;
    result.cause = `${e.message}; ${position(recorder.last)}`;
  } finally {
    recorder.stop();
  }
  return { ...result, repo, costUsd: Number(budget.spent.toFixed(6)), costUpperBound: budget.upperBound, costKnown: budget.costKnown, seconds: Number(recorder.seconds().toFixed(1)) };
}

export function parseOptions(argv) {
  const { values } = parseArgs({ args: argv, options: { "budget-usd": { type: "string" }, "record-dir": { type: "string" }, recording: { type: "string" }, "plugin-dir": { type: "string" } } });
  const budgetUsd = Math.min(Number(values["budget-usd"] ?? S6_BUDGET_USD), S6_BUDGET_USD);
  return { budgetUsd, recordDir: values["record-dir"], recording: values.recording, pluginDir: values["plugin-dir"] ?? REPO_ROOT };
}

async function main() {
  runEnv();
  const { budgetUsd, recordDir, recording, pluginDir } = parseOptions(process.argv.slice(2));
  const record = recordDir ?? mkdtempSync(join(tmpdir(), "pb-smoke-s6-"));
  mkdirSync(record, { recursive: true });
  const out = join(RECORDINGS, recording ?? `s6-${new Date().toISOString().replaceAll(":", "-")}`);
  const result = await runS6(new Budget(budgetUsd), record, out, pluginDir);
  console.log(JSON.stringify(result));
  console.log(`${result.passed ? "PASS" : "FAIL"} S6, $${result.costUsd}${result.costUpperBound ? " at most" : ""}, repo in ${record}, recorded in ${out}`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
