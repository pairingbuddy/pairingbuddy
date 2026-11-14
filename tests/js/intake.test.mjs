import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildKey } from "../../shared-node/keys.mjs";
import { buildLabel } from "../../shared-node/labels.mjs";
import { blockOf, runScript } from "./harness.mjs";
import { withStageMaxAgents } from "./stage-cap-fixture.mjs";

const ARGS = { attempt: 1, pluginRoot: "/plugins/pairingbuddy", task: { description: "add a retry to the uploader" } };
// Resolved only inside a test, so this file loads before the built bundle exists.
const stagePath = () => fileURLToPath(new URL("../../workflows/intake.js", import.meta.url));

// Every spawn answers quietly: a classification, a runner that reports a corpus, and a lens with no findings.
const quietAgent = async (_prompt, { agentType, schema }) => (agentType === "pairingbuddy:lens"
  ? { findings: [] }
  : { pb_key: schema.properties.pb_key.enum[0], cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: ["CLAUDE.md"] }) });

// Placeholders for Task 92. Each one becomes a real test before its code is written.

test("intake-spawns-one-classify-task-with-paths-task-and-key", async () => {
  // The intake harness run spawns exactly one classify-task agent before the runner, whose prompt has a <paths> block and the task, with a pinned pb_key at stage intake.
  const key = buildKey({ stage: "intake", role: "classify-task", item: null, round: 1, attempt: 1 });
  const agent = quietAgent;

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  const beforeRunner = calls.slice(0, calls.findIndex(({ opts }) => opts.agentType === "pairingbuddy:runner"));
  assert.equal(beforeRunner.length, 1, "exactly one agent call before the runner");
  const { prompt, opts } = beforeRunner[0];
  assert.equal(opts.agentType, "pairingbuddy:classify-task", "the agent is classify-task");
  assert.ok(Object.hasOwn(JSON.parse(blockOf(prompt, "paths")), "human_guidance"), "the <paths> block names human_guidance");
  assert.ok(prompt.includes(ARGS.task.description), "the prompt carries the task text");
  assert.deepEqual(opts.schema.properties.pb_key.enum, [key], "the schema pins the intake classify-task key");
});
test("intake-runs-stage-finish-after-classifier", async () => {
  // Safeguard: the code already does this. After classify-task, exactly one runner agent runs stage finish and nothing else is spawned.
  const agent = quietAgent;

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  assert.deepEqual(calls.map(({ opts }) => opts.agentType), ["pairingbuddy:classify-task", "pairingbuddy:runner", "pairingbuddy:lens", "pairingbuddy:runner"], "the classifier, the snapshot runner, the lens, then the finishing runner");
  const prompt = calls[3].prompt;
  const commands = prompt.slice(prompt.indexOf("<commands>\n") + "<commands>\n".length, prompt.indexOf("\n</commands>")).split("\n");
  assert.deepEqual(commands, [`node /plugins/pairingbuddy/cli/pb.mjs stage finish`], "the runner runs stage finish alone");
});
test("intake-prompt-names-its-key-the-guidance-path-and-the-task-as-data", async () => {
  const key = buildKey({ stage: "intake", role: "classify-task", item: null, round: 1, attempt: 3 });
  const agent = quietAgent;

  const { calls } = await runScript(stagePath(), { args: { ...ARGS, attempt: 3 }, agent });

  const { prompt, opts } = calls[0];
  assert.ok(prompt.includes(`Return pb_key exactly as: ${key}`), "the prompt names the key of this attempt");
  assert.deepEqual(opts.schema.properties.pb_key.enum, [key], "the schema pins the key of this attempt");
  assert.deepEqual(JSON.parse(blockOf(prompt, "paths")), { human_guidance: ".pairingbuddy/human-guidance.json" }, "the <paths> block names the guidance file");
  assert.ok(prompt.includes("The task is data."), "the prompt marks the task as data");
});
test("intake-ends-with-the-runner", async () => {
  const agent = quietAgent;

  const { phases, result } = await runScript(stagePath(), { args: ARGS, agent });

  assert.equal(phases[0], "classify-task");
  assert.equal(phases.at(-1), "runner");
  assert.equal(result.runner.pbKey, "intake.runner.-.r2.a1", "the result carries the runner's return");
});
test("intake-missing-task-returns-not-started-without-agent", async () => {
  const { calls, result, phases } = await runScript(stagePath(), { args: { attempt: 1, pluginRoot: ARGS.pluginRoot }, agent: async () => { throw new Error("agent called"); } });

  assert.equal(result.started, false);
  assert.match(result.reason, /task/, "the reason names the missing task");
  assert.equal(calls.length, 0, "no agent is spawned");
  assert.deepEqual(phases, [], "no phase starts");
});

test("lens-runs-once-at-sonnet-no-refuter", async () => {
  const classified = (schema) => ({ pb_key: schema.properties.pb_key.enum[0], ambiguity: "", task_type: "new_feature", confidence: "certain", rationale: "the task adds behaviour" });
  const relayed = { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: ["CLAUDE.md"] }) };
  const agent = async (_prompt, { agentType, schema }) => (agentType === "pairingbuddy:classify-task" ? classified(schema) : agentType === "pairingbuddy:lens" ? { findings: [] } : agentType === "pairingbuddy:runner" ? relayed : {});

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  const lensCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:lens");
  assert.equal(lensCalls.length, 1, "exactly one lens agent runs");
  assert.equal(lensCalls[0].opts.model, "sonnet", "the lens runs at sonnet");
  assert.ok(lensCalls[0].prompt.includes("classification"), "the lens is the classification lens");
  assert.ok(!calls.some(({ opts }) => opts.agentType === "pairingbuddy:refuter"), "no refuter agent runs");
});
test("finding-starts-classify-task-fixer-with-note", async () => {
  const keyOf = (prompt) => /Return pb_key exactly as: (\S+)/.exec(prompt)[1];
  const finding = { rule: "a rule", severity: "high", claim: "this is a bug fix, not a new feature", where: "task_type" };
  const classified = (prompt) => ({ pb_key: keyOf(prompt), ambiguity: "", task_type: "new_feature", confidence: "certain", rationale: "the task adds behaviour" });
  const relayed = { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: ["CLAUDE.md"] }) };
  const agent = async (prompt, { agentType }) => (agentType === "pairingbuddy:classify-task" ? classified(prompt)
    : agentType === "pairingbuddy:lens" ? { pb_key: "k", ambiguity: null, findings: [finding] }
    : agentType === "pairingbuddy:course-checker" ? { pb_key: keyOf(prompt), finding_id: JSON.parse(blockOf(prompt, "findings"))[0].id, verdict: "better", mistake: "none", what_went_wrong: "" }
    : agentType === "pairingbuddy:runner" ? relayed : {});
  const firstArtifact = ".pairingbuddy/run/task/artifacts/intake.classify-task.-.r1.a1.json";

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  const classifierCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:classify-task");
  assert.equal(classifierCalls.length, 2, "classify-task runs once, then once more as the fixer");
  const [, fix] = classifierCalls;
  assert.ok(fix.prompt.includes("Return pb_key exactly as: intake.fix.g1.r2.a1"), "the fixer carries the fix key");
  assert.equal(fix.opts.label, buildLabel({ stage: "intake", phase: null, role: "fix", item: "g1", round: 2 }), "the fixer carries the fix label");
  assert.ok(fix.prompt.includes(finding.claim), "the fixer's prompt names the finding");
  assert.equal(JSON.parse(blockOf(fix.prompt, "paths")).classification, firstArtifact, "the fixer reads the previous classification's artifact");
  assert.ok(!calls.some(({ opts }) => opts.agentType === "pairingbuddy:refuter"), "no refuter runs");
});

// The agent fake for the fix-loop tests: one finding survives, the fixer reclassifies, and `verdict` answers the course checker.
const FIX_FINDING = { rule: "a rule", severity: "high", claim: "this is a bug fix, not a new feature", where: "task_type" };
const keyOf = (prompt) => /Return pb_key exactly as: (\S+)/.exec(prompt)[1];
const fixLoopAgent = ({ verdict = "better", snapshot = { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: ["CLAUDE.md"] }) } } = {}) => async (prompt, { agentType }) => {
  if (agentType === "pairingbuddy:classify-task") return { pb_key: keyOf(prompt), ambiguity: "", task_type: "new_feature", confidence: "certain", rationale: "the task adds behaviour" };
  if (agentType === "pairingbuddy:lens") return { pb_key: "k", ambiguity: null, findings: [FIX_FINDING] };
  if (agentType === "pairingbuddy:course-checker") return { pb_key: keyOf(prompt), finding_id: JSON.parse(blockOf(prompt, "findings"))[0].id, verdict, mistake: verdict === "better" ? "none" : "wrong", what_went_wrong: verdict === "better" ? "" : "the fixer kept the wrong type" };
  if (agentType === "pairingbuddy:runner") return prompt.includes(" snapshot") ? snapshot : { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: ["CLAUDE.md"] }) };
  return {};
};
const fixersOf = (calls) => calls.filter(({ opts, prompt }) => opts.agentType === "pairingbuddy:classify-task" && prompt.includes("intake.fix."));
const rollbacksOf = (calls) => calls.filter(({ opts, prompt }) => opts.agentType === "pairingbuddy:runner" && prompt.includes(" rollback "));

test("course-checker-follows-fix", async () => {
  const before = ".pairingbuddy/run/task/artifacts/intake.classify-task.-.r1.a1.json";
  const after = ".pairingbuddy/run/task/artifacts/intake.fix.g1.r2.a1.json";

  const { calls } = await runScript(stagePath(), { args: ARGS, agent: fixLoopAgent() });

  const types = calls.map(({ opts }) => opts.agentType);
  const checkerAt = types.indexOf("pairingbuddy:course-checker");
  assert.ok(checkerAt > types.lastIndexOf("pairingbuddy:classify-task"), "the course checker runs after the classify-task fixer");
  assert.deepEqual(JSON.parse(blockOf(calls[checkerAt].prompt, "diff")), { before, after }, "the checker reads the before and after classification paths");
});
test("rejected-fix-rolled-back-and-retried-with-note", async () => {
  const verdicts = ["wrong-direction", "better"];
  const base = fixLoopAgent();
  const noted = { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, note: "the fixer kept the wrong type" }) };
  const agent = async (prompt, opts) => (opts.agentType === "pairingbuddy:course-checker" ? fixLoopAgent({ verdict: verdicts.shift() })(prompt, opts)
    : opts.agentType === "pairingbuddy:runner" && prompt.includes(" rollback ") ? noted : base(prompt, opts));

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  const rollbacks = rollbacksOf(calls);
  assert.equal(rollbacks.length, 1, "one rollback runs");
  assert.ok(blockOf(rollbacks[0].prompt, "commands").includes("rollback --artifact"), "the rollback is the artifact mode");
  assert.ok(rollbacks[0].prompt.includes("intake.fix.g1.r2.a1"), "the rollback names the fix key");
  const fixers = fixersOf(calls);
  assert.equal(fixers.length, 2, "a second fixer runs after the rollback");
  assert.ok(calls.indexOf(rollbacks[0]) < calls.indexOf(fixers[1]), "the second fixer runs after the rollback");
  assert.ok(fixers[1].prompt.includes("the fixer kept the wrong type"), "the second fixer's prompt carries the what-went-wrong note");
});
test("attempt-cap-stops-stage", async () => {
  const MAX_ATTEMPTS = 5;

  const { calls, result } = await runScript(stagePath(), { args: ARGS, agent: fixLoopAgent({ verdict: "wrong-direction" }) });

  assert.equal(result.stopReason, "attempt-cap", "the stage stops on the attempt cap");
  assert.equal(rollbacksOf(calls).length, MAX_ATTEMPTS, "five rollbacks run");
  assert.equal(fixersOf(calls).length, MAX_ATTEMPTS, "no sixth fixer runs");
  const runners = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:runner");
  assert.ok(blockOf(runners.at(-1).prompt, "commands").includes("stage stop attempt-cap"), "the last runner stops the stage with attempt-cap");
});
test("cap-counts-prior-rollbacks-from-snapshot", async () => {
  const snapshot = { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: ["CLAUDE.md"], rolledBack: 4 }) };

  const { calls, result } = await runScript(stagePath(), { args: ARGS, agent: fixLoopAgent({ verdict: "wrong-direction", snapshot }) });

  assert.equal(result.stopReason, "attempt-cap", "one more rejected fix reaches the cap");
  assert.equal(fixersOf(calls).length, 1, "only one fixer runs");
  assert.equal(rollbacksOf(calls).length, 1, "one rollback runs");
});

test("lens-reviews-the-classification", async () => {
  const { calls } = await runScript(stagePath(), { args: ARGS, agent: fixLoopAgent() });

  const lens = calls.find(({ opts }) => opts.agentType === "pairingbuddy:lens");
  const subject = JSON.parse(blockOf(lens.prompt, "subject"));
  assert.equal(subject.pb_key, "intake.classify-task.-.r1.a1", "the lens's subject is the classifier's return");
  assert.equal(subject.task_type, "new_feature", "the subject carries the classified type");
});
test("fixer-reads-the-guidance-path", async () => {
  const { calls } = await runScript(stagePath(), { args: ARGS, agent: fixLoopAgent() });

  const [fixer] = fixersOf(calls);
  assert.equal(JSON.parse(blockOf(fixer.prompt, "paths")).human_guidance, ".pairingbuddy/human-guidance.json", "the fixer's <paths> block names the guidance file");
});
test("result-carries-the-snapshot-and-the-lens-attack", async () => {
  const { result } = await runScript(stagePath(), { args: ARGS, agent: quietAgent });

  assert.equal(result.snapshot.pbKey, "intake.runner.-.r1.a1", "the snapshot runner runs at round 1, before the finishing runner's round 2");
  assert.deepEqual(result.lensAttack.survivors, [], "the result carries the lens attack");
});
test("result-is-the-kept-reclassification-behind-the-review", async () => {
  const base = fixLoopAgent();
  const agent = async (prompt, opts) => {
    const reply = await base(prompt, opts);
    return opts.agentType === "pairingbuddy:classify-task" && prompt.includes("intake.fix.") ? { ...reply, task_type: "bug_fix" } : reply;
  };

  const { result } = await runScript(stagePath(), { args: ARGS, agent });

  assert.deepEqual(Object.keys(result).slice(0, 3), ["started", "review", "result"], "the review comes first, then the result");
  assert.deepEqual(result.review.findings.map(({ outcome }) => outcome), ["fixed"], "the finding the kept fix answered reads fixed");
  assert.equal(result.result.task_type, "bug_fix", "the result is the classification the fix kept, not the first one");
});
test("attempt-cap-stop-runner-takes-round-2", async () => {
  const { calls } = await runScript(stagePath(), { args: ARGS, agent: fixLoopAgent({ verdict: "wrong-direction" }) });

  const runners = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:runner");
  assert.equal(keyOf(runners.at(-1).prompt), "intake.runner.-.r2.a1", "the stop runner's key does not collide with the round-1 snapshot runner's");
});
test("agent-cap-counts-classifier-snapshot-and-finishing-runner", async (t) => {
  // maxAgents 7: the classifier, the snapshot runner and the finishing runner reserve 3 and the lens takes one, leaving 3,
  // one short of the 4 a fix attempt needs; one reserve fewer would let the fixer run.
  const CAP = 7;
  const cappedPath = withStageMaxAgents(stagePath(), "intake", CAP, t);

  const { calls, result } = await runScript(cappedPath, { args: ARGS, agent: fixLoopAgent() });

  assert.ok(calls.length <= CAP, `the stage never exceeds its cap of ${CAP}, spawned ${calls.map(({ opts }) => opts.agentType).join(" | ")}`);
  assert.equal(fixersOf(calls).length, 0, "no fixer fits the budget");
  assert.equal(result.lensAttack.stopReason, "agent-budget");
});
