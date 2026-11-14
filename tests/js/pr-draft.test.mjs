import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { blockOf, runScript } from "./harness.mjs";
import { withStageMaxAgents } from "./stage-cap-fixture.mjs";
import { readLabel } from "../../shared-node/labels.mjs";

// Control-flow tests for the built pr-draft stage. The agent is a recording stand-in.
const STAGE = fileURLToPath(new URL("../../workflows/pr-draft.js", import.meta.url));
const CONTRACT = new URL("../../contracts/schemas/draft-pull-request-result.schema.json", import.meta.url);
const LENSES = new URL("../../contracts/lenses.json", import.meta.url);
const PLUGIN_ROOT = "/plugins/pairingbuddy";
const PB = `node ${PLUGIN_ROOT}/cli/pb.mjs`;
const AGENT = "draft-pull-request";
const ARGS = { attempt: 1, pluginRoot: PLUGIN_ROOT, task: { description: "add the export button" } };

const contractOf = (url) => JSON.parse(readFileSync(url, "utf8"));
const unpinned = ({ properties: { pb_key: { enum: pinned, ...pbKey }, ...properties }, ...schema }) => ({ ...schema, properties: { pb_key: pbKey, ...properties } });
const DRAFT = { title: "feat: add export button", body: "body", labels: [], base: "main", coordination: null };
const commandsOf = (prompt) => blockOf(prompt, "commands").split("\n");
const isRunner = (opts) => opts.agentType === "pairingbuddy:runner";
// The lone lint call and the final lint-plus-finish call are told apart by what they run, not by how many commands they carry.
const isLintRunner = (prompt, opts) => isRunner(opts) && commandsOf(prompt).length === 1 && commandsOf(prompt)[0].endsWith(" pr lint");
const isFinalRunner = (prompt, opts) => isRunner(opts) && commandsOf(prompt).some((command) => command.endsWith(" stage finish"));
const lensNameOf = ({ opts }) => opts.label.match(/ lens (\w+) r\d+$/)[1];

// Default stand-in for every agent the stage spawns after the draft: a valid draft, a snapshot that lists one path, a passing lint relay, lenses with no findings, and exit 0 for any other runner.
const standIn = async (prompt, opts) => {
  if (opts.agentType === `pairingbuddy:${AGENT}`) return DRAFT;
  if (opts.agentType === "pairingbuddy:lens") return { findings: [] };
  if (opts.agentType !== "pairingbuddy:runner") return {};
  const commands = commandsOf(prompt);
  if (commands.some((command) => command.endsWith(" snapshot"))) return { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: ["CLAUDE.md"] }) };
  if (isLintRunner(prompt, opts)) return { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, failures: [], bodyHash: "h" }) };
  return { cli_exit_code: 0, cli_output: "" };
};
const runStage = (args = ARGS, agent = standIn) => runScript(STAGE, { args, agent });

test("pr-draft-spawns-the-draft-pull-request-agent-once-with-key-task-and-paths", async () => {
  const { calls } = await runStage();

  assert.equal(calls[0].opts.agentType, `pairingbuddy:${AGENT}`, "the writer is the first call");
  assert.equal(calls.filter(({ opts }) => opts.agentType === `pairingbuddy:${AGENT}`).length, 1, "exactly one writer call");
  assert.equal(calls[0].opts.agentType, `pairingbuddy:${AGENT}`);
  assert.ok(calls[0].prompt.includes(`Return pb_key exactly as: pr-draft.${AGENT}.-.r1.a1`), "the prompt names its key");
  assert.deepEqual(JSON.parse(blockOf(calls[0].prompt, "task")), ARGS.task, "the task block carries the task");
  const paths = JSON.parse(blockOf(calls[0].prompt, "paths"));
  assert.ok(Object.keys(paths).length > 0, "the input paths are given");
  for (const path of Object.values(paths)) assert.match(path, /^\.pairingbuddy\//, "each path is under .pairingbuddy");
});

test("pr-draft-label-is-a-valid-pb-label-and-the-key-pins-stage-role-and-attempt", async () => {
  const first = await runStage();
  const redo = await runStage({ ...ARGS, attempt: 2 });

  assert.equal(first.calls[0].opts.label, `pb1 pr-draft - ${AGENT} - r1`);
  assert.equal(readLabel(first.calls[0].opts.label).unknown, false);
  assert.deepEqual(first.calls[0].opts.schema.properties.pb_key.enum, [`pr-draft.${AGENT}.-.r1.a1`]);
  assert.deepEqual(redo.calls[0].opts.schema.properties.pb_key.enum, [`pr-draft.${AGENT}.-.r1.a2`]);
});

test("pr-draft-schema-is-the-contract-with-the-key-pinned", async () => {
  const { calls } = await runStage();

  const { schema } = calls[0].opts;
  assert.deepEqual(schema.properties.pb_key.enum, [`pr-draft.${AGENT}.-.r1.a1`]);
  assert.equal(schema.additionalProperties, false, "extra fields are refused at runtime");
  assert.deepEqual(unpinned(schema), contractOf(CONTRACT));
});

test("pr-draft-contract-requires-title-body-labels-base-and-coordination", () => {
  const { required, properties } = contractOf(CONTRACT);

  for (const field of ["title", "body", "labels", "base", "coordination"]) assert.ok(required.includes(field), `${field} is required`);
  assert.deepEqual([...properties.coordination.type].sort(), ["null", "string"], "coordination is a string or null");
});

test("pr-draft-lints-after-writer-records-hash-then-finishes", async () => {
  const lintFailed = JSON.stringify({ ok: false, failures: [{ rule: "hype", text: "seamless" }] });
  // Only the final runner, which also finishes the stage, relays the failed lint: the earlier runner calls pass so the stage reaches it.
  const agent = async (prompt, opts) => (isFinalRunner(prompt, opts) ? { cli_exit_code: 0, cli_output: lintFailed } : standIn(prompt, opts));

  const { calls, result } = await runStage(ARGS, agent);

  const finalRunner = calls.at(-1);
  assert.equal(finalRunner.opts.agentType, "pairingbuddy:runner", "the last call is the runner");
  assert.ok(finalRunner.prompt.includes("Return pb_key exactly as: pr-draft.runner.-.r3.a1"), "the runner prompt names its key");
  assert.deepEqual(blockOf(finalRunner.prompt, "commands").split("\n"), [
    `${PB} pr lint`,
    `${PB} stage finish`,
  ], "lint first, then finish, in one runner call");
  assert.equal(result.runner.pbKey, "pr-draft.runner.-.r3.a1");
  assert.equal(result.runner.result.cli_output, lintFailed, "a failed lint is relayed and does not stop the stage finishing");
  assert.equal(result.started, true, "the stage started");
});

// Scenario: pr-draft-stage-flow
test("stage-call-order-draft-snapshot-lint-lenses-final", async () => {
  const { calls } = await runStage();

  assert.deepEqual(calls.map(({ opts }) => opts.agentType), [`pairingbuddy:${AGENT}`, "pairingbuddy:runner", "pairingbuddy:runner", "pairingbuddy:lens", "pairingbuddy:lens", "pairingbuddy:runner"], "draft, snapshot, lint, two lenses, no refuter, final runner");
  assert.ok(calls[1].prompt.includes("Return pb_key exactly as: pr-draft.runner.-.r1.a1"), "the snapshot runner is round 1");
  assert.deepEqual(commandsOf(calls[1].prompt), [`${PB} snapshot`], "the snapshot runner runs only the snapshot");
  assert.ok(calls[2].prompt.includes("Return pb_key exactly as: pr-draft.runner.-.r2.a1"), "the lint runner is round 2");
  assert.deepEqual(commandsOf(calls[2].prompt), [`${PB} pr lint`], "the lint runner runs only the lint");
  assert.deepEqual([calls[3].opts.label, calls[4].opts.label], ["pb1 pr-draft - lens claims r1", "pb1 pr-draft - lens permanence r1"], "the claims and permanence lenses");
  assert.ok(calls[5].prompt.includes("Return pb_key exactly as: pr-draft.runner.-.r3.a1"), "the final runner is round 3");
  assert.deepEqual(commandsOf(calls[5].prompt), [`${PB} pr lint`, `${PB} stage finish`], "the final runner lints and then finishes");
});

test("both-lenses-run-at-sonnet", async () => {
  const { calls } = await runStage();

  const lensCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:lens");
  assert.deepEqual(lensCalls.map(lensNameOf), ["claims", "permanence"], "the two lenses are the ones checked");
  assert.deepEqual(lensCalls.map(({ opts }) => opts.model), ["sonnet", "sonnet"], "both lenses run at sonnet");
});

test("lens-subject-carries-paths", async () => {
  const { calls } = await runStage();

  const lensCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:lens");
  const { rows } = JSON.parse(readFileSync(LENSES, "utf8"));
  const { lenses } = rows.find(({ row }) => row === "pr-draft");
  assert.equal(lensCalls.length, 2, "the claims and permanence lenses are spawned");
  for (const call of lensCalls) {
    const { prompt } = call;
    const lens = lensNameOf(call);
    const row = lenses.find(({ name }) => name === lens);
    assert.ok(row, `${lens} lens is listed in lenses.json`);
    assert.deepEqual(JSON.parse(blockOf(prompt, "subject")), {
      pr_body: ".pairingbuddy/run/pr-body.md",
      draft: ".pairingbuddy/run/task/artifacts/pr-draft.draft-pull-request.-.r1.a1.json",
      unit: ".pairingbuddy/run/unit.json",
      subject_diff: ".pairingbuddy/run/subject.diff",
      refresh: ".pairingbuddy/run/refresh.json",
      old_body: ".pairingbuddy/run/refresh-body.md",
    }, `${lens} lens: the subject names the files, not the draft's contents`);
    assert.deepEqual(blockOf(prompt, "corpus").split("\n").map((line) => JSON.parse(line)), ["CLAUDE.md"], `${lens} lens: the corpus lists the snapshot's paths`);
    assert.equal(JSON.parse(blockOf(prompt, "brief")), row.brief, `${lens} lens: the prompt carries its row's brief`);
  }
});

test("stage-paths-name-refresh-and-old-body", async () => {
  const { calls } = await runStage();

  const refreshPaths = { refresh: ".pairingbuddy/run/refresh.json", old_body: ".pairingbuddy/run/refresh-body.md" };
  const drafterPaths = JSON.parse(blockOf(calls[0].prompt, "paths"));
  assert.deepEqual({ refresh: drafterPaths.refresh, old_body: drafterPaths.old_body }, refreshPaths, "the drafter's paths name the refresh record and the old body");
  assert.equal(drafterPaths.unit, ".pairingbuddy/run/unit.json", "unit is still named");
  const lensCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:lens");
  assert.equal(lensCalls.length, 2, "both lenses are spawned");
  for (const call of lensCalls) {
    const subject = JSON.parse(blockOf(call.prompt, "subject"));
    assert.deepEqual({ refresh: subject.refresh, old_body: subject.old_body }, refreshPaths, `${lensNameOf(call)} lens: the subject names the refresh record and the old body`);
  }
});

// Fixtures and helpers for the fix-loop tests.
const KEY = /Return pb_key exactly as: (\S+)/;
const keyOf = (prompt) => prompt.match(KEY)[1];
const artifactOf = (key) => `.pairingbuddy/run/task/artifacts/${key}.json`;
const FIRST_DRAFT = artifactOf(`pr-draft.${AGENT}.-.r1.a1`);
const FIX_R2 = "pr-draft.fix.g1.r2.a1";
const FIX_R3 = "pr-draft.fix.g1.r3.a1";
const CLAIMS_FINDING = { rule: "claims-match-record", severity: "high", kind: "fix-here", claim: "says tests ran on CI", where: "pr-body.md" };
const LINT_FAILED = { cli_exit_code: 0, cli_output: JSON.stringify({ ok: false, failures: [{ rule: "hype", text: "seamless" }], bodyHash: "h" }) };
const LINT_PASSED = { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, failures: [], bodyHash: "h" }) };
const BETTER = { verdict: "better", mistake: "none", what_went_wrong: "" };
const wrongDirection = (note) => ({ verdict: "wrong-direction", mistake: "missed-finding", what_went_wrong: note });
const rollbackRelay = ({ note, failedAttempts }) => ({ cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, note, failedAttempts, maxAttempts: 5, stopped: false }) });
const checkerReply = (prompt, verdict) => ({ pb_key: keyOf(prompt), finding_id: "claims-1", ...verdict });
const isRollbackRunner = (prompt, opts) => isRunner(opts) && commandsOf(prompt).some((command) => command.includes(" rollback"));

// A stand-in that answers from lists, in the order the stage asks. Lint runs, claims lens runs, course-checker verdicts and rollback notes
// are each consumed in call order; once a list runs out the default stand-in answers (lint passes, no finding).
// snapshot.rolledBack is how many rollbacks the snapshot says already happened, so the rollback relays count on from there.
// relayCounts false makes the rollback relays leave out failedAttempts, so only a loop's own count speaks.
const scriptedStandIn = ({ lints = [], claims = [], verdicts = [], rollbackNotes = [], snapshot = {}, relayCounts = true } = {}) => {
  const used = { lints: 0, claims: 0, verdicts: 0, rollbacks: 0 };
  return async (prompt, opts) => {
    if (opts.agentType === "pairingbuddy:lens") return { findings: lensNameOf({ opts }) === "claims" ? (claims[used.claims++] ?? []) : [] };
    if (opts.agentType === "pairingbuddy:course-checker" && used.verdicts < verdicts.length) return checkerReply(prompt, verdicts[used.verdicts++]);
    if (isLintRunner(prompt, opts) && used.lints < lints.length) return lints[used.lints++];
    if (isRollbackRunner(prompt, opts) && used.rollbacks < rollbackNotes.length) {
      const index = used.rollbacks++;
      return rollbackRelay({ note: rollbackNotes[index], failedAttempts: relayCounts ? (snapshot.rolledBack ?? 0) + index + 1 : undefined });
    }
    if (snapshot.rolledBack !== undefined && isRunner(opts) && commandsOf(prompt).some((command) => command.endsWith(" snapshot"))) {
      return { cli_exit_code: 0, cli_output: JSON.stringify({ ok: true, paths: ["CLAUDE.md"], rolledBack: snapshot.rolledBack }) };
    }
    return standIn(prompt, opts);
  };
};

const callsOfType = (calls, type) => calls.filter(({ opts }) => opts.agentType === `pairingbuddy:${type}`);
const rollbacksOf = (calls) => calls.filter(({ prompt, opts }) => isRollbackRunner(prompt, opts));
const fixCallsOf = (calls) => callsOfType(calls, AGENT).filter(({ opts }) => opts.label?.startsWith("pb1 pr-draft - fix "));
// One readable line per call, so a test can compare a whole stretch of the run at once: the agent and what its prompt pins as its key.
const stepOf = ({ prompt, opts }) => `${opts.agentType.replace("pairingbuddy:", "")} ${prompt.match(KEY)?.[1] ?? opts.label}`;
const assertStoppedWith = (calls, result, reason) => {
  const last = calls.at(-1);
  assert.equal(last.opts.agentType, "pairingbuddy:runner", "the last call is the runner");
  assert.ok(last.prompt.includes("Return pb_key exactly as: pr-draft.runner.-.r3.a1"), "the stop runner is round 3");
  assert.deepEqual(commandsOf(last.prompt), [`${PB} stage stop ${reason}`], "the stop runner runs only the stop");
  assert.ok(!calls.some(({ prompt, opts }) => isFinalRunner(prompt, opts)), "the stage is never finished");
  assert.equal(result.stopReason, reason, `the stage stops with ${reason}`);
};
const assertRanToFinal = (calls) => {
  const last = calls.at(-1);
  assert.ok(last.prompt.includes("Return pb_key exactly as: pr-draft.runner.-.r3.a1"), "the run ends with the final runner");
  assert.deepEqual(commandsOf(last.prompt), [`${PB} pr lint`, `${PB} stage finish`], "the final runner lints and then finishes");
};

// What a lint runner relays when the lint itself could not run, or ran and said nothing usable. Both lint loops must stop on these.
// Both the stage's first lint and a redraft's lint read the relay the same way, so each case stops either one.
const runnerFailures = [
  ["a refusal with exit 1", { cli_exit_code: 1, cli_output: "pb: refused, no run in progress" }],
  ["exit 1 with JSON that says ok true", { cli_exit_code: 1, cli_output: JSON.stringify({ ok: true, failures: [], bodyHash: "h" }) }],
  ["exit 0 with output that is not JSON", { cli_exit_code: 0, cli_output: "lint ran fine, trust me" }],
  ["exit 0 with JSON that has no ok", { cli_exit_code: 0, cli_output: JSON.stringify({ bodyHash: "h" }) }],
  ["exit 0 with ok that is not a boolean", { cli_exit_code: 0, cli_output: JSON.stringify({ ok: "yes", failures: [], bodyHash: "h" }) }],
  ["exit 0 with ok false and no failures list", { cli_exit_code: 0, cli_output: JSON.stringify({ ok: false, bodyHash: "h" }) }],
];
for (const [name, relay] of runnerFailures) {
  test(`lint-runner-failure-stops-step-failed: ${name}`, async () => {
    const agent = async (prompt, opts) => (isLintRunner(prompt, opts) ? relay : standIn(prompt, opts));

    const { calls, result } = await runStage(ARGS, agent);

    assert.equal(callsOfType(calls, "lens").length, 0, "no lens is spawned after a lint runner failure");
    assert.equal(callsOfType(calls, AGENT).length, 1, "no second draft is requested");
    assertStoppedWith(calls, result, "step-failed");
    assert.equal(result.started, true, "the stage started");
  });
}
test("failed-lint-spawns-no-lens-and-starts-fix", async () => {
  const lintFailed = JSON.stringify({ ok: false, failures: [{ rule: "hype", text: "seamless" }, { rule: "title-form", text: "Added stuff" }], bodyHash: "h" });
  const agent = async (prompt, opts) => (isLintRunner(prompt, opts) ? { cli_exit_code: 0, cli_output: lintFailed } : standIn(prompt, opts));

  const { calls } = await runStage(ARGS, agent);

  const lintIndex = calls.findIndex(({ prompt, opts }) => isLintRunner(prompt, opts));
  const fix = calls[lintIndex + 1];
  const fixKey = "pr-draft.fix.g1.r2.a1";
  assert.equal(callsOfType(calls.slice(0, lintIndex + 2), "lens").length, 0, "no lens is spawned before or at the first redraft");
  assert.equal(fix.opts.agentType, `pairingbuddy:${AGENT}`, "the call right after the lint runner is the redraft");
  assert.equal(fix.opts.model, "sonnet", "the redraft runs at sonnet");
  assert.equal(fix.opts.label, "pb1 pr-draft - fix g1 r2", "the redraft is the fix group's second round");
  assert.ok(fix.prompt.includes(`Return pb_key exactly as: ${fixKey}`), "the prompt names the fix key");
  assert.deepEqual(fix.opts.schema.properties.pb_key.enum, [fixKey], "the schema pins the fix key");
  assert.deepEqual(JSON.parse(blockOf(fix.prompt, "findings")), [
    { id: "lint-1", rule: "hype", claim: "seamless", where: "pr-body.md", severity: "high", kind: "fix-here" },
    { id: "lint-2", rule: "title-form", claim: "Added stuff", where: "pr-body.md", severity: "high", kind: "fix-here" },
  ], "each lint failure becomes a finding");
  const paths = JSON.parse(blockOf(fix.prompt, "paths"));
  assert.equal(paths.draft, FIRST_DRAFT, "the redraft starts from the first draft");
  const first = JSON.parse(blockOf(calls[0].prompt, "paths"));
  for (const [name, path] of Object.entries(first)) assert.equal(paths[name], path, `the stage's ${name} path is passed on`);
  for (const name of ["unit", "git_config", "human_guidance"]) assert.ok(name in paths, `${name} is an input path`);
});
test("lint-passing-redraft-kept-without-checker", async () => {
  // The first lone lint fails; the lint run after the redraft (keyed with the fix group) passes.
  const agent = scriptedStandIn({ lints: [LINT_FAILED] });

  const { calls, result } = await runStage(ARGS, agent);

  const fixIndex = calls.findIndex(({ opts }) => opts.label === "pb1 pr-draft - fix g1 r2");
  const afterFix = calls[fixIndex + 1];
  assert.ok(fixIndex > 0, "the redraft is requested");
  assert.equal(afterFix.opts.agentType, "pairingbuddy:runner", "a runner comes right after the redraft");
  assert.ok(afterFix.prompt.includes("Return pb_key exactly as: pr-draft.runner.g1.r2.a1"), "the runner after the redraft is the fix group's lint");
  assert.deepEqual(commandsOf(afterFix.prompt), [`${PB} pr lint`], "it runs only the lint");
  assert.equal(callsOfType(calls, "course-checker").length, 0, "no course checker is spawned");
  assert.equal(rollbacksOf(calls).length, 0, "nothing is rolled back");
  const lensCalls = callsOfType(calls.slice(fixIndex + 2), "lens");
  assert.deepEqual(lensCalls.map(lensNameOf), ["claims", "permanence"], "both lenses run after the kept redraft");
  for (const { prompt } of lensCalls) assert.equal(JSON.parse(blockOf(prompt, "subject")).draft, ".pairingbuddy/run/task/artifacts/pr-draft.fix.g1.r2.a1.json", "each lens reads the kept redraft");
  assertRanToFinal(calls);
  assert.ok(!result.stopReason, "the stage is not stopped");
  assert.deepEqual(result.review.findings.map(({ id, outcome }) => ({ id, outcome })), [{ id: "lint-1", outcome: "fixed" }], "the lint failure the kept redraft passed reads fixed");
});
for (const [name, relay] of runnerFailures) {
  test(`redraft-lint-runner-failure-stops-step-failed: ${name}`, async () => {
    // The first lint fails, so the redraft is requested; the runner that lints the redraft is the one that breaks.
    const agent = scriptedStandIn({ lints: [LINT_FAILED, relay] });

    const { calls, result } = await runStage(ARGS, agent);

    assert.equal(calls.filter(({ prompt, opts }) => isLintRunner(prompt, opts) && keyOf(prompt) === "pr-draft.runner.g1.r2.a1").length, 1, "the redraft's own lint runner ran");
    assert.equal(callsOfType(calls, "course-checker").length, 0, "no course checker is spawned");
    assert.equal(rollbacksOf(calls).length, 0, "nothing is rolled back");
    assert.equal(fixCallsOf(calls).length, 1, "no second redraft is requested");
    assertStoppedWith(calls, result, "step-failed");
  });
}
test("lint-failing-redraft-rolled-back-and-retried-with-note", async () => {
  const note = "The PR lint failed: hype: seamless";
  // The first lone lint and the first redraft's lint fail; the rollback relays its note; the second redraft passes.
  const agent = scriptedStandIn({ lints: [LINT_FAILED, LINT_FAILED], rollbackNotes: [note] });

  const { calls } = await runStage(ARGS, agent);

  const firstFixIndex = calls.findIndex(({ opts }) => opts.label === "pb1 pr-draft - fix g1 r2");
  assert.ok(firstFixIndex > 0, "the first redraft is requested");
  const [, failedLint, rollback, retry] = calls.slice(firstFixIndex);
  assert.deepEqual(calls.slice(firstFixIndex, firstFixIndex + 4).map(stepOf), [
    `${AGENT} ${FIX_R2}`,
    "runner pr-draft.runner.g1.r2.a1",
    "runner pr-draft.runner.g1-rollback.r2.a1",
    `${AGENT} ${FIX_R3}`,
  ], "the first redraft is linted and rolled back, with no checker between, and the redraft is retried right after the rollback");
  assert.ok(failedLint.prompt.includes("Return pb_key exactly as: pr-draft.runner.g1.r2.a1"), "the first redraft's lint is run");
  assert.deepEqual(commandsOf(rollback.prompt), [`${PB} rollback --artifact --from ${FIX_R2}`], "it rolls back the first redraft");
  assert.equal(callsOfType(calls, "course-checker").length, 0, "no course checker is spawned");
  assert.deepEqual(JSON.parse(blockOf(retry.prompt, "what_went_wrong")), [note], "the retry carries the lint note");
  assert.equal(JSON.parse(blockOf(retry.prompt, "paths")).draft, FIRST_DRAFT, "the rolled-back redraft never becomes the draft to start from");
  assert.deepEqual(callsOfType(calls.slice(firstFixIndex + 4), "lens").map(lensNameOf), ["claims", "permanence"], "the lenses run once the retry passes");
});
test("lens-finding-redraft-linted-then-course-checked", async () => {
  const note = "kept the CI claim";
  // Only the first claims run finds anything. The first redraft's checker says wrong-direction; the retry's says better.
  const agent = scriptedStandIn({ claims: [[CLAIMS_FINDING]], verdicts: [wrongDirection(note), BETTER], rollbackNotes: [note] });

  const { calls } = await runStage(ARGS, agent);

  const lensIndex = calls.findIndex(({ opts }) => opts.agentType === "pairingbuddy:lens");
  const fixIndex = calls.findIndex(({ opts }) => opts.label === "pb1 pr-draft - fix g1 r2");
  assert.ok(fixIndex > lensIndex && lensIndex > 0, "the lenses run before the redraft");
  assert.deepEqual(calls.slice(lensIndex, fixIndex).map(lensNameOf), ["claims", "permanence"], "both lenses ran first");
  const [fix, , checker, rollback, retry] = calls.slice(fixIndex);
  assert.deepEqual(calls.slice(fixIndex, fixIndex + 7).map(stepOf), [
    `${AGENT} ${FIX_R2}`,
    "runner pr-draft.runner.g1.r2.a1",
    "course-checker pr-draft.course-checker.g1.r2.a1",
    "runner pr-draft.runner.g1-rollback.r2.a1",
    `${AGENT} ${FIX_R3}`,
    "runner pr-draft.runner.g1.r3.a1",
    "course-checker pr-draft.course-checker.g1.r3.a1",
  ], "each redraft is linted and then course-checked; the wrong-direction one is rolled back and retried");
  assert.deepEqual(JSON.parse(blockOf(fix.prompt, "findings")), [{ ...CLAIMS_FINDING, id: "claims-1", blocking: true }], "the redraft is given the claims finding, tagged as the lens round tags it");
  assert.equal(JSON.parse(blockOf(fix.prompt, "paths")).draft, FIRST_DRAFT, "the redraft starts from the first draft");
  assert.deepEqual(JSON.parse(blockOf(checker.prompt, "diff")), { before: FIRST_DRAFT, after: artifactOf(FIX_R2) }, "the checker compares the first draft with the redraft");
  assert.deepEqual(commandsOf(rollback.prompt), [`${PB} rollback --artifact --from ${FIX_R2}`], "the wrong-direction redraft is rolled back");
  assert.deepEqual(JSON.parse(blockOf(retry.prompt, "what_went_wrong")), [note], "the retry carries the checker's note");
  assert.equal(callsOfType(calls, "course-checker").length, 2, "one checker call per redraft");
  assert.equal(callsOfType(calls, "refuter").length, 0, "no refuter is called");
  assertRanToFinal(calls);
});
test("a lint failure repeated on the same finding makes the next retry change approach", async () => {
  // The first lint and redrafts 1 and 2 all fail on the same finding; redrafts 1 and 2 are rolled back; redraft 3 passes.
  const agent = scriptedStandIn({ lints: [LINT_FAILED, LINT_FAILED, LINT_FAILED, LINT_PASSED], rollbackNotes: ["note 1", "note 2"] });

  const { calls } = await runStage(ARGS, agent);

  const [, secondRedraft, thirdRedraft] = fixCallsOf(calls);
  const retryOf = ({ prompt }) => JSON.parse(blockOf(prompt, "retry"));
  assert.equal(retryOf(secondRedraft).mustChangeApproach, false, "the lint finding has failed once, so redraft 2 need not change approach");
  assert.equal(retryOf(thirdRedraft).mustChangeApproach, true, "the same lint finding failed again, so redraft 3 must change approach");
});
test("lens-loop-fix-keys-continue-after-lint-loop", async () => {
  const lintRedraft = artifactOf(FIX_R2);
  // The first lone lint fails and its redraft passes. Then the claims lens finds one thing, and that redraft passes lint and the checker.
  const agent = scriptedStandIn({ lints: [LINT_FAILED], claims: [[CLAIMS_FINDING]], verdicts: [BETTER] });

  const { calls } = await runStage(ARGS, agent);

  const fixCalls = fixCallsOf(calls);
  assert.deepEqual(fixCalls.map(({ opts }) => opts.label), ["pb1 pr-draft - fix g1 r2", "pb1 pr-draft - fix g1 r3"], "the lens redraft is the group's next round, not a repeat of r2");
  const lensFix = fixCalls[1];
  assert.ok(lensFix.prompt.includes(`Return pb_key exactly as: ${FIX_R3}`), "the lens redraft key follows the lint redraft's");
  const lensFixIndex = calls.indexOf(lensFix);
  const lint = calls[lensFixIndex + 1];
  assert.ok(isLintRunner(lint.prompt, lint.opts) && lint.prompt.includes("Return pb_key exactly as: pr-draft.runner.g1.r3.a1"), "its lint runner continues the keys");
  const checker = calls[lensFixIndex + 2];
  assert.equal(checker.opts.agentType, "pairingbuddy:course-checker", "the lens redraft's lint is followed by the course checker");
  assert.ok(checker.prompt.includes("Return pb_key exactly as: pr-draft.course-checker.g1.r3.a1"), "its checker continues the keys");
  const keys = calls.map(({ prompt }) => prompt.match(KEY)?.[1]).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length, `every pb key in the run is unique: ${keys.join(", ")}`);
  assert.equal(JSON.parse(blockOf(lensFix.prompt, "paths")).draft, lintRedraft, "the lens redraft starts from the lint redraft");
  assert.equal(JSON.parse(blockOf(checker.prompt, "diff")).before, lintRedraft, "the checker compares against the lint redraft");
});
test("fifth-failed-attempt-stops-attempt-cap: across the lint loop and the lens loop", async () => {
  // Lint runs 1 to 3 fail (the first lint and redrafts 1 and 2), run 4 passes (redraft 3 is kept). The claims lens then finds one thing, its redrafts pass lint, and every checker says wrong-direction.
  // The relays count every rollback and never say stopped, so only the loop's own cap can stop the stage.
  const agent = scriptedStandIn({
    lints: [LINT_FAILED, LINT_FAILED, LINT_FAILED, LINT_PASSED],
    claims: [[CLAIMS_FINDING]],
    verdicts: [wrongDirection("missed it"), wrongDirection("missed it"), wrongDirection("missed it")],
    rollbackNotes: ["n1", "n2", "n3", "n4", "n5"],
  });

  const { calls, result } = await runStage(ARGS, agent);

  const rollbackCalls = rollbacksOf(calls);
  const lastRollbackIndex = calls.lastIndexOf(rollbackCalls.at(-1));
  // Fix calls: the lint loop makes 3 (redrafts 1 and 2 rolled back, redraft 3 kept) and the lens loop makes 3 (rolled back), so 6. The 5th rollback is the lens loop's 3rd.
  assert.equal(rollbackCalls.length, 5, "exactly five rollbacks, no sixth");
  assert.equal(fixCallsOf(calls).length, 6, "3 lint-loop redrafts plus 3 lens-loop redrafts");
  assert.equal(callsOfType(calls.slice(lastRollbackIndex + 1), AGENT).length, 0, "no fix call after the fifth rollback");
  assertStoppedWith(calls, result, "attempt-cap");
  assert.deepEqual(result.lensAttack.lessons, ["n1", "n2", "n3", "n4", "n5"], "the stage's note holds the lint loop's notes and the lens loop's");
});
test("fifth-failed-attempt-stops-attempt-cap: a re-run's earlier rollbacks count toward the cap", async () => {
  // The snapshot says 4 rollbacks already happened, so the first rollback of this run is the fifth and must stop it.
  const agent = scriptedStandIn({ lints: [LINT_FAILED, LINT_FAILED], rollbackNotes: ["n5"], snapshot: { rolledBack: 4 } });

  const { calls, result } = await runStage(ARGS, agent);

  assert.equal(fixCallsOf(calls).length, 1, "no second redraft after the one rollback");
  assert.equal(rollbacksOf(calls).length, 1, "a single rollback");
  assertStoppedWith(calls, result, "attempt-cap");
});
test("lens-retry-carries-lint-notes", async () => {
  // Lint runs 1 and 2 fail (the first lint and redraft 1, which is rolled back with "lint note"); run 3 passes, so redraft 2 is kept.
  // The claims lens then finds one thing; its first redraft is checked wrong-direction and rolled back with "lens note"; its retry is checked better.
  const agent = scriptedStandIn({
    lints: [LINT_FAILED, LINT_FAILED, LINT_PASSED],
    claims: [[CLAIMS_FINDING]],
    verdicts: [wrongDirection("lens note"), BETTER],
    rollbackNotes: ["lint note", "lens note"],
  });

  const { calls, result } = await runStage(ARGS, agent);

  const fixCalls = fixCallsOf(calls);
  assert.equal(fixCalls.length, 4, "two lint-loop redrafts and two lens-loop redrafts");
  const lensRetry = fixCalls.at(-1);
  assert.deepEqual(JSON.parse(blockOf(lensRetry.prompt, "what_went_wrong")), ["lint note", "lens note"], "the lens-loop retry carries the lint loop's note and its own");
  assert.deepEqual(result.lensAttack.lessons, ["lint note", "lens note"], "the stage's notes are listed in the order they happened");
});
test("fix-loops-stop-at-agent-budget", async (t) => {
  // The loops share the stage's maxAgents: when the budget runs out the loop ends with agent-budget and the remaining findings stay open.
  // Spawned before the loop: the draft, the snapshot runner and the first lint runner. The finishing runner is reserved.
  const PRE_LOOP = 3;
  const RESERVED_FINAL = 1;
  // A lint-failed redraft spawns fix, its lint runner and the rollback runner, and an attempt needs room for one more than that before it starts.
  const PER_FAILED_REDRAFT = 3;
  const MAX_AGENTS = 14;
  const loopBudget = MAX_AGENTS - PRE_LOOP - RESERVED_FINAL;
  const redraftsAllowed = Math.floor((loopBudget - (PER_FAILED_REDRAFT + 1)) / PER_FAILED_REDRAFT) + 1;
  const cappedPath = withStageMaxAgents(STAGE, "pr-draft", MAX_AGENTS, t);
  const agent = async (prompt, opts) => (isLintRunner(prompt, opts) ? LINT_FAILED : standIn(prompt, opts));

  const { calls, result } = await runScript(cappedPath, { args: ARGS, agent });

  assert.equal(fixCallsOf(calls).length, redraftsAllowed, "the budget allows this many redrafts");
  assert.equal(callsOfType(calls, "lens").length, 0, "no lens runs while the lint is still failing");
  assert.equal(result.lensAttack.stopReason, "agent-budget", "the stage's return carries the stop reason");
  assertRanToFinal(calls);
});
test("the first lens check after a lint-loop rollback runs on Opus", async () => {
  // The first lint and redraft 1 fail (redraft 1 is rolled back); redraft 2 passes. The rollback relay gives no count, so only the lint loop's own count says one rollback happened.
  const agent = scriptedStandIn({ lints: [LINT_FAILED, LINT_FAILED, LINT_PASSED], claims: [[CLAIMS_FINDING]], verdicts: [BETTER], rollbackNotes: ["lint note"], relayCounts: false });

  const { calls } = await runStage(ARGS, agent);

  const checkers = callsOfType(calls, "course-checker");
  assert.equal(checkers.length, 1, "the lens redraft is checked once");
  assert.equal(checkers[0].opts.model, "opus", "a rollback earlier in the stage moves the check to opus");
});
test("a re-run with earlier rollbacks checks the first lens redraft on Opus", async () => {
  // The lint passes, so no lint loop runs; only the snapshot knows about the earlier rollback.
  const agent = scriptedStandIn({ claims: [[CLAIMS_FINDING]], verdicts: [BETTER], snapshot: { rolledBack: 1 } });

  const { calls } = await runStage(ARGS, agent);

  const checkers = callsOfType(calls, "course-checker");
  assert.equal(checkers.length, 1, "the lens redraft is checked once");
  assert.equal(checkers[0].opts.model, "opus", "the snapshot's rollback moves the check to opus");
});
test("a re-run's rollbacks count toward the cap in the lint loop even when the relay gives no count", async () => {
  // The snapshot says 4 rollbacks happened, so this run's first rollback is the fifth; the relay says nothing, so the loop's own count must carry the 4.
  const agent = scriptedStandIn({ lints: [LINT_FAILED, LINT_FAILED], rollbackNotes: ["n5"], snapshot: { rolledBack: 4 }, relayCounts: false });

  const { calls, result } = await runStage(ARGS, agent);

  assert.equal(fixCallsOf(calls).length, 1, "exactly one redraft");
  assertStoppedWith(calls, result, "attempt-cap");
});
test("the lens loop gets only the budget the lint loop left", async (t) => {
  // The first lint fails; redraft 1 fails lint and is rolled back; redraft 2 is kept. The claims lens then finds one thing and the checker rejects every lens redraft.
  const PRE_LOOP = 3;
  const RESERVED_FINAL = 1;
  // The lint loop spent: two redrafts, each with its lint runner, and one rollback runner.
  const LINT_LOOP_SPAWNED = 5;
  const LENSES_SPAWNED = 2;
  // A rejected lens redraft spawns fix, lint runner, checker and rollback runner.
  const PER_REJECTED_REDRAFT = 4;
  const MAX_AGENTS = 19;
  const lensLoopBudget = MAX_AGENTS - PRE_LOOP - RESERVED_FINAL - LINT_LOOP_SPAWNED - LENSES_SPAWNED;
  const lensRedraftsAllowed = Math.floor((lensLoopBudget - PER_REJECTED_REDRAFT) / PER_REJECTED_REDRAFT) + 1;
  const lensRedraftsWithFullBudget = Math.floor((MAX_AGENTS - PRE_LOOP - RESERVED_FINAL - LENSES_SPAWNED - PER_REJECTED_REDRAFT) / PER_REJECTED_REDRAFT) + 1;
  assert.ok(lensRedraftsAllowed < lensRedraftsWithFullBudget, "the cap tells the two budgets apart");
  const cappedPath = withStageMaxAgents(STAGE, "pr-draft", MAX_AGENTS, t);
  const agent = scriptedStandIn({
    lints: [LINT_FAILED, LINT_FAILED, LINT_PASSED],
    claims: [[CLAIMS_FINDING]],
    verdicts: [wrongDirection("a"), wrongDirection("b"), wrongDirection("c"), wrongDirection("d")],
    rollbackNotes: ["n1", "n2", "n3", "n4"],
  });

  const { calls, result } = await runScript(cappedPath, { args: ARGS, agent });

  assert.equal(fixCallsOf(calls).length - 2, lensRedraftsAllowed, "the lens loop makes only the redrafts its remaining budget allows");
  assert.equal(result.lensAttack.stopReason, "agent-budget", "the stage's return carries the stop reason");
  assertRanToFinal(calls);
});

// Scenario: the-return-tells-the-end-state. In a live run the return led with the first draft and the pre-fix survivors, so the
// session said a fixed finding went out. The return now leads with what became of each finding, then the draft the stage kept.
test("the-return-leads-with-the-review-then-the-kept-redraft", async () => {
  const REDRAFT = { ...DRAFT, body: "body without the CI claim" };
  const scripted = scriptedStandIn({ claims: [[CLAIMS_FINDING]], verdicts: [BETTER] });
  const agent = async (prompt, opts) => (opts.label === "pb1 pr-draft - fix g1 r2" ? { pb_key: keyOf(prompt), ...REDRAFT } : scripted(prompt, opts));

  const { result } = await runStage(ARGS, agent);

  assert.deepEqual(Object.keys(result).slice(0, 3), ["started", "review", "result"], "the review comes first, then the result");
  assert.deepEqual(result.review.findings, [{ id: "claims-1", claim: CLAIMS_FINDING.claim, where: CLAIMS_FINDING.where, outcome: "fixed" }], "the claims finding reads fixed");
  assert.equal(result.result.body, REDRAFT.body, "the result is the redraft the stage kept, not the first draft");
  assert.ok(!JSON.stringify(result).includes('"body":"body"'), "the first draft is not in the return: nothing reads it there");
});
