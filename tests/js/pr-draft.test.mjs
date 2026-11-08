import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { blockOf, runScript } from "./harness.mjs";
import { readLabel } from "../../shared-node/labels.mjs";

// Control-flow tests for the built pr-draft stage. The agent is a recording stand-in.
const STAGE = fileURLToPath(new URL("../../workflows/pr-draft.js", import.meta.url));
const CONTRACT = new URL("../../contracts/schemas/draft-pull-request-result.schema.json", import.meta.url);
const PLUGIN_ROOT = "/plugins/pairingbuddy";
const AGENT = "draft-pull-request";
const ARGS = { attempt: 1, pluginRoot: PLUGIN_ROOT, task: { description: "add the export button" } };

const contractOf = (url) => JSON.parse(readFileSync(url, "utf8"));
const unpinned = ({ properties: { pb_key: { enum: pinned, ...pbKey }, ...properties }, ...schema }) => ({ ...schema, properties: { pb_key: pbKey, ...properties } });
const runStage = (args = ARGS, agent = async () => ({})) => runScript(STAGE, { args, agent });

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
  const agent = async (prompt, opts) => {
    if (opts.agentType === `pairingbuddy:${AGENT}`) return { title: "feat: add export button", body: "body", labels: [], base: "main", coordination: null };
    return { cli_exit_code: 0, cli_output: lintFailed };
  };

  const { calls, result } = await runStage(ARGS, agent);

  assert.deepEqual(calls.map(({ opts }) => opts.agentType), [`pairingbuddy:${AGENT}`, "pairingbuddy:runner"], "the runner follows the writer");
  assert.ok(calls[1].prompt.includes("Return pb_key exactly as: pr-draft.runner.-.r1.a1"), "the runner prompt names its key");
  assert.deepEqual(blockOf(calls[1].prompt, "commands").split("\n"), [
    `node ${PLUGIN_ROOT}/cli/pb.mjs pr lint`,
    `node ${PLUGIN_ROOT}/cli/pb.mjs stage finish`,
  ], "lint first, then finish, in one runner call");
  assert.equal(result.runner.pbKey, "pr-draft.runner.-.r1.a1");
  assert.equal(result.runner.result.cli_output, lintFailed, "a failed lint is relayed and does not stop the stage finishing");
  assert.equal(result.started, true);
});
