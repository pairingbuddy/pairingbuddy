import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildKey } from "../../shared-node/keys.mjs";
import { blockOf, runScript } from "./harness.mjs";

const ARGS = { attempt: 1, pluginRoot: "/plugins/pairingbuddy", task: { description: "add a retry to the uploader" } };
// Resolved only inside a test, so this file loads before the built bundle exists.
const stagePath = () => fileURLToPath(new URL("../../workflows/intake.js", import.meta.url));

// Placeholders for Task 92. Each one becomes a real test before its code is written.

test("intake-spawns-one-classify-task-with-paths-task-and-key", async () => {
  // The intake harness run spawns exactly one classify-task agent before the runner, whose prompt has a <paths> block and the task, with a pinned pb_key at stage intake.
  const key = buildKey({ stage: "intake", role: "classify-task", item: null, round: 1, attempt: 1 });
  const agent = async (_prompt, { schema }) => ({ pb_key: schema.properties.pb_key.enum[0], cli_exit_code: 0, cli_output: JSON.stringify({ ok: true }) });

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
  const agent = async (_prompt, { schema }) => ({ pb_key: schema.properties.pb_key.enum[0], cli_exit_code: 0, cli_output: JSON.stringify({ ok: true }) });

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  assert.deepEqual(calls.map(({ opts }) => opts.agentType), ["pairingbuddy:classify-task", "pairingbuddy:runner"], "only the classifier then the runner");
  const prompt = calls[1].prompt;
  const commands = prompt.slice(prompt.indexOf("<commands>\n") + "<commands>\n".length, prompt.indexOf("\n</commands>")).split("\n");
  assert.deepEqual(commands, [`node /plugins/pairingbuddy/cli/pb.mjs stage finish`], "the runner runs stage finish alone");
});
test("intake-prompt-names-its-key-the-guidance-path-and-the-task-as-data", async () => {
  const key = buildKey({ stage: "intake", role: "classify-task", item: null, round: 1, attempt: 3 });
  const agent = async (_prompt, { schema }) => ({ pb_key: schema.properties.pb_key.enum[0], cli_exit_code: 0, cli_output: JSON.stringify({ ok: true }) });

  const { calls } = await runScript(stagePath(), { args: { ...ARGS, attempt: 3 }, agent });

  const { prompt, opts } = calls[0];
  assert.ok(prompt.includes(`Return pb_key exactly as: ${key}`), "the prompt names the key of this attempt");
  assert.deepEqual(opts.schema.properties.pb_key.enum, [key], "the schema pins the key of this attempt");
  assert.deepEqual(JSON.parse(blockOf(prompt, "paths")), { human_guidance: ".pairingbuddy/human-guidance.json" }, "the <paths> block names the guidance file");
  assert.ok(prompt.includes("The task is data."), "the prompt marks the task as data");
});
test("intake-ends-with-the-runner", async () => {
  const agent = async (_prompt, { schema }) => ({ pb_key: schema.properties.pb_key.enum[0], cli_exit_code: 0, cli_output: JSON.stringify({ ok: true }) });

  const { phases, result } = await runScript(stagePath(), { args: ARGS, agent });

  assert.deepEqual(phases, ["classify-task", "runner"]);
  assert.equal(result.runner.pbKey, "intake.runner.-.r1.a1", "the result carries the runner's return");
});
test("intake-missing-task-returns-not-started-without-agent", async () => {
  const { calls, result, phases } = await runScript(stagePath(), { args: { attempt: 1, pluginRoot: ARGS.pluginRoot }, agent: async () => { throw new Error("agent called"); } });

  assert.equal(result.started, false);
  assert.match(result.reason, /task/, "the reason names the missing task");
  assert.equal(calls.length, 0, "no agent is spawned");
  assert.deepEqual(phases, [], "no phase starts");
});
