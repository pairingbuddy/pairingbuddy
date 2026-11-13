import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, planStep } from "../../shared-node/plan.mjs";
import * as s6 from "../smoke/s6.mjs";
import { SmokeError } from "../smoke/claude-run.mjs";

// These tests run the pure helpers of tests/smoke/s6.mjs. The live S6 run is by hand (`node tests/smoke/s6.mjs`)
// and is not a test case here.

test("s6-sample-plan-is-two-units-the-second-depending-on-the-first-with-a-human-task", () => {
  const { units, problems } = parsePlan(s6.PLAN);

  assert.deepEqual(problems, [], "the sample plan has no format problems");
  assert.deepEqual(units.map(({ unit }) => unit), [s6.UNIT_A, s6.UNIT_B], "two units, in order");
  assert.equal(units[0].dependsOn, null, "the first unit is independent");
  assert.equal(units[1].dependsOn, s6.UNIT_A, "the second unit depends on the first");
  assert.deepEqual(units.flatMap(({ tasks }) => tasks.map(({ title, human }) => [title, human])), [[s6.TASK_1, false], [s6.HUMAN_TASK, true], [s6.TASK_3, false]], "three tasks, the second a human task");
  assert.equal(units.flatMap(({ tasks }) => tasks).every(({ checked }) => !checked), true, "nothing is ticked yet");
  assert.equal(planStep(units, { plan: s6.PLAN_PATH, openUnit: null }).next.title, s6.TASK_1, "the first task is next");
});

// A code run's ledger on the given plan task, at the given stage and status.
const runLedger = ({ kind = "code", title = s6.TASK_3, stage = s6.KILL_STAGE, status = "active" } = {}) => ({ kind, plan: { path: s6.PLAN_PATH, title }, stage: { name: stage, status, attempt: 1 } });

test("s6-kill-point-is-unit-b's-scenarios-stage-while-it-is-active", () => {
  assert.equal(s6.isKillPoint(runLedger()), true, "Task 3's code run with its scenarios stage active is the kill point");
  for (const [label, ledger] of [
    ["no ledger", null],
    ["Task 1's run", runLedger({ title: s6.TASK_1 })],
    ["intake", runLedger({ stage: "intake" })],
    ["a done stage", runLedger({ status: "done" })],
    ["a publish run", runLedger({ kind: "publish" })],
  ]) assert.equal(s6.isKillPoint(ledger), false, `${label} is not the kill point`);
});

test("s6-human-tick-ticks-only-the-named-box-and-box-states-read-them-in-order", () => {
  const ticked = s6.tickBox(s6.PLAN, s6.HUMAN_TASK);

  assert.deepEqual(s6.boxStates(ticked), [[s6.TASK_1, false], [s6.HUMAN_TASK, true], [s6.TASK_3, false]], "only the human task's box is ticked, and the order is the plan's");
  assert.equal(ticked.replace("- [x] **Task 2", "- [ ] **Task 2"), s6.PLAN, "nothing else in the plan changed");
  assert.throws(() => s6.tickBox(ticked, s6.HUMAN_TASK), /no unticked box/, "a box already ticked cannot be ticked again");
  assert.throws(() => s6.tickBox(s6.PLAN, "Task 9: Nothing"), /no unticked box/, "an unknown title is refused");
});

const snap = (runId, kind, agents) => ({ runId, kind, spend: { agents } });

test("s6-agent-counts-take-each-run's-highest-count-and-stay-under-the-ceiling", () => {
  const counts = s6.agentCounts([snap("r1", "code", 3), snap("r1", "code", 7), snap("r2", "publish", 12), snap("r1", "code", 7), { runId: "r3", kind: "code" }]);

  assert.deepEqual(counts, { perRun: [{ runId: "r1", kind: "code", agents: 7 }, { runId: "r2", kind: "publish", agents: 12 }, { runId: "r3", kind: "code", agents: 0 }], total: 19 }, "each run counts its highest agents once");
  assert.deepEqual(s6.assertAgents(counts, 30), { total: 19, spawnsSeen: 30, ceiling: s6.AGENT_CEILING }, "well under the ceiling passes");
  assert.throws(() => s6.assertAgents({ perRun: [], total: 0 }, 0), /no run/, "no run counted fails");
  assert.throws(() => s6.assertAgents({ ...counts, total: s6.AGENT_CEILING }, 0), /ledgers count/, "a ledger total at the ceiling fails");
  assert.throws(() => s6.assertAgents(counts, s6.AGENT_CEILING), /transcripts show/, "transcripts at the ceiling fail");
  assert.ok(s6.AGENT_CEILING <= 250, "the ceiling is at most a quarter of the 1000-agent cap");
});

// What S6 has after session 1: Task 1 done and recorded in unit A, the plan stopped at the human task.
const AFTER_TASK_1 = s6.PLAN.replace(`- [ ] **${s6.TASK_1}**`, `- [x] **${s6.TASK_1}**`);
const humanStopFacts = (over = {}) => ({
  plan: AFTER_TASK_1,
  refusal: { code: 1, stdout: "", stderr: `pb: unit "${s6.UNIT_A}"'s next task "${s6.HUMAN_TASK}" is a human task: only a person does it and ticks its box. Nothing was written.` },
  titlesRun: [s6.TASK_1],
  publishSeen: false,
  creates: 0,
  unit: { unit: s6.UNIT_A, plan: s6.PLAN_PATH, tasks: [{ title: s6.TASK_1 }] },
  ...over,
});

test("s6-human-stop-accepts-a-plan-stopped-at-the-human-task", () => {
  assert.deepEqual(s6.assertHumanStop(humanStopFacts()), { stoppedAt: s6.HUMAN_TASK });
});

for (const [label, over, cause] of [
  ["Task 1 not ticked", { plan: s6.PLAN }, /boxes after session 1/],
  ["the human box ticked", { plan: s6.tickBox(AFTER_TASK_1, s6.HUMAN_TASK) }, /boxes after session 1/],
  ["pb plan next did not refuse", { refusal: { code: 0, stdout: "{}", stderr: "" } }, /did not stop at the human task/],
  ["a refusal for another reason", { refusal: { code: 1, stdout: "", stderr: "pb: the plan has format problems" } }, /did not stop at the human task/],
  ["a run for the human task", { titlesRun: [s6.TASK_1, s6.HUMAN_TASK] }, /runs opened/],
  ["a run past the stop", { titlesRun: [s6.TASK_1, s6.TASK_3] }, /runs opened/],
  ["no run at all", { titlesRun: [] }, /runs opened/],
  ["a publish before the human tick", { publishSeen: true }, /publish run/],
  ["a PR before the human tick", { creates: 1 }, /pr create/],
  ["no unit open", { unit: null }, /unit A/],
  ["Task 1 not recorded", { unit: { unit: s6.UNIT_A, plan: s6.PLAN_PATH, tasks: [] } }, /unit A/],
]) {
  test(`s6-human-stop-rejects: ${label}`, () => {
    assert.throws(() => s6.assertHumanStop(humanStopFacts(over)), (err) => err instanceof SmokeError && cause.test(err.message), `${label} throws a SmokeError naming the cause`);
  });
}

// What S6 has around the kill: Task 3's run killed in its scenarios stage, adopted, then finished by session 3.
const AT_KILL = s6.tickBox(AFTER_TASK_1, s6.HUMAN_TASK);
const stageAt = (name, attempt, status = "done") => ({ name, status, attempt });
const killedLedger = { ...runLedger(), runId: "run-b", stages: [stageAt("intake", 1)] };
const killFacts = (over = {}) => ({
  killed: true,
  ledgerAtKill: killedLedger,
  planAtKill: AT_KILL,
  planBeforeResume: AT_KILL,
  adoptPlain: { code: 1, stdout: "", stderr: "pb: the run's owner session abc was active 0 minutes ago (at 2026-11-13T10:00:00Z); if that session is still working, close it first" },
  adoptForced: { code: 0, stdout: JSON.stringify({ ok: true, adopted: true, previousOwner: "abc", failedStage: { stage: s6.KILL_STAGE, attempt: 1, nextAttempt: 2 } }), stderr: "" },
  resumed: { kind: "code", runId: "run-b", plan: { path: s6.PLAN_PATH, title: s6.TASK_3 }, stages: [stageAt("intake", 1), stageAt(s6.KILL_STAGE, 2), stageAt("code-tdd", 1), stageAt("code-safety-net", 1)] },
  ...over,
});

test("s6-kill-resume-accepts-a-run-killed-adopted-and-finished-in-the-same-run", () => {
  assert.deepEqual(s6.assertKillResume(killFacts()), { runId: "run-b", killedAt: { stage: s6.KILL_STAGE, attempt: 1 }, resumedAttempt: 2 });
});

for (const [label, over, cause] of [
  ["the session was not killed", { killed: false }, /not killed/],
  ["killed elsewhere", { ledgerAtKill: { ...killedLedger, stage: stageAt("intake", 1, "active") } }, /not killed/],
  ["Task 3 ticked at the kill", { planAtKill: s6.tickBox(AT_KILL, s6.TASK_3) }, /boxes at the kill/],
  ["the plan changed across the kill", { planBeforeResume: `${AT_KILL}\n` }, /changed between the kill and session 3/],
  ["adopt without --force went through", { adoptPlain: { code: 0, stdout: "{}", stderr: "" } }, /recently active/],
  ["adopt with --force refused", { adoptForced: { code: 1, stdout: "", stderr: "pb: no run is open" } }, /--force/],
  ["adopt failed no stage", { adoptForced: { code: 0, stdout: JSON.stringify({ ok: true, adopted: true, failedStage: null }), stderr: "" } }, /--force/],
  ["no resumed ledger", { resumed: null }, /no code run/],
  ["a new run for Task 3", { resumed: { ...killFacts().resumed, runId: "run-c" } }, /new run/],
  ["scenarios not re-run past the kill", { resumed: { ...killFacts().resumed, stages: [stageAt("intake", 1), stageAt(s6.KILL_STAGE, 1)] } }, /attempt/],
  ["intake run again", { resumed: { ...killFacts().resumed, stages: [stageAt("intake", 2), stageAt(s6.KILL_STAGE, 2)] } }, /intake/],
]) {
  test(`s6-kill-resume-rejects: ${label}`, () => {
    assert.throws(() => s6.assertKillResume(killFacts(over)), (err) => err instanceof SmokeError && cause.test(err.message), `${label} throws a SmokeError naming the cause`);
  });
}

const create = (head, base, { draft = true } = {}) => ({ argv: ["pr", "create", "--title", "t", "--body-file", "/tmp/b", "--base", base, "--head", head, ...(draft ? ["--draft"] : [])] });
const publishFacts = (over = {}) => ({ creates: [create("fix/a", s6.BASE), create("feat/b", "fix/a")], aBranch: "fix/a", bBranch: "feat/b", bContainsA: true, ...over });

test("s6-publishes-accepts-one-independent-and-one-stacked-draft-pr", () => {
  assert.deepEqual(s6.assertPublishes(publishFacts()), { independent: { head: "fix/a", base: s6.BASE }, stacked: { head: "feat/b", base: "fix/a" } });
});

for (const [label, over, cause] of [
  ["one PR", { creates: [create("fix/a", s6.BASE)] }, /pr create calls, expected 2/],
  ["unit A not into the base", { creates: [create("fix/a", "main"), create("feat/b", "fix/a")] }, /unit A's PR/],
  ["unit B not stacked", { creates: [create("fix/a", s6.BASE), create("feat/b", s6.BASE)] }, /unit B's PR/],
  ["the PRs in the other order", { creates: [create("feat/b", "fix/a"), create("fix/a", s6.BASE)] }, /unit A's PR/],
  ["a PR not a draft", { creates: [create("fix/a", s6.BASE), create("feat/b", "fix/a", { draft: false })] }, /draft/],
  ["unit B's branch without unit A's head", { bContainsA: false }, /does not contain/],
]) {
  test(`s6-publishes-rejects: ${label}`, () => {
    assert.throws(() => s6.assertPublishes(publishFacts(over)), (err) => err instanceof SmokeError && cause.test(err.message), `${label} throws a SmokeError naming the cause`);
  });
}

const withPrLines = (text) => text
  .replace(`#### PR: ${s6.UNIT_A}\n`, `#### PR: ${s6.UNIT_A}\nPR: ${s6.PR_URLS[0]} branch: fix/a\n`)
  .replace(`#### PR: ${s6.UNIT_B}\n`, `#### PR: ${s6.UNIT_B}\nPR: ${s6.PR_URLS[1]} branch: feat/b\n`);
const FINISHED = withPrLines(s6.tickBox(AT_KILL, s6.TASK_3));
const finishFacts = (over = {}) => ({ planStart: s6.PLAN, planEnd: FINISHED, taskEnds: [s6.TASK_1, s6.TASK_3], planNext: { code: 0, stdout: JSON.stringify({ ok: true, next: null }), stderr: "" }, ...over });

test("s6-plan-finished-accepts-every-box-ticked-in-order-with-both-pr-lines", () => {
  assert.deepEqual(s6.assertPlanFinished(finishFacts()), { tasksEnded: [s6.TASK_1, s6.TASK_3], prs: s6.PR_URLS });
});

for (const [label, over, cause] of [
  ["Task 3 unticked", { planEnd: withPrLines(AT_KILL) }, /boxes at the end/],
  ["a task moved", { planEnd: FINISHED.replace(`**${s6.TASK_1}**`, "**Task 0: Moved**") }, /boxes at the end/],
  ["no PR line for unit B", { planEnd: FINISHED.replace(`PR: ${s6.PR_URLS[1]} branch: feat/b\n`, "") }, /PR lines/],
  ["Task 1 ended twice", { taskEnds: [s6.TASK_1, s6.TASK_1, s6.TASK_3] }, /task ends/],
  ["the tasks out of order", { taskEnds: [s6.TASK_3, s6.TASK_1] }, /task ends/],
  ["the plan not done", { planNext: { code: 1, stdout: "", stderr: "pb: unit is done but not published" } }, /not done/],
  ["a next task left", { planNext: { code: 0, stdout: JSON.stringify({ ok: true, next: { title: s6.TASK_3 } }), stderr: "" } }, /not done/],
]) {
  test(`s6-plan-finished-rejects: ${label}`, () => {
    assert.throws(() => s6.assertPlanFinished(finishFacts(over)), (err) => err instanceof SmokeError && cause.test(err.message), `${label} throws a SmokeError naming the cause`);
  });
}

test("s6-hand-tick-refusal-accepts-pb-plan-next-refusing-the-ticked-box", () => {
  const refusal = { code: 1, stdout: "", stderr: `pb: unit "${s6.UNIT_A}" has ticked tasks with no task record: ${s6.TASK_1}. A box ticked by hand earns nothing. Nothing was written` };
  assert.deepEqual(s6.assertHandTickRefused(refusal), { refused: s6.TASK_1 });
  assert.throws(() => s6.assertHandTickRefused({ code: 0, stdout: "{}", stderr: "" }), SmokeError, "no refusal fails");
  assert.throws(() => s6.assertHandTickRefused({ ...refusal, stderr: "pb: the plan has format problems" }), SmokeError, "another refusal fails");
});

test("s6-ended-titles-are-the-plan-titles-of-the-task-ends-that-succeeded-in-order", () => {
  const end = (output) => ({ command: "pb task end", output, isError: false });
  const ok = (title) => end(JSON.stringify({ ok: true, removed: "x", plan: { path: s6.PLAN_PATH, title, ticked: true } }));
  const status = JSON.stringify({ ok: true, stage: { name: "code-safety-net", status: "done" } });
  const taskEnds = [ok(s6.TASK_1), end("pb: stage code-tdd is not finished, so the task cannot end"), end(`noise\n${JSON.stringify({ ok: true, removed: "x", plan: null })}`), end(`${status}\n---\n${ok(s6.TASK_3).output}`)];

  assert.deepEqual(s6.endedTitles(taskEnds), [s6.TASK_1, null, s6.TASK_3], "a refusal is skipped, a success with no plan reads as null, and another pb call's ok line in the same output is not a task end");
});
