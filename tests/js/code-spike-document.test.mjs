import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_TRIES } from "../../shared-node/limits.mjs";
import { blockOf, runScript } from "./harness.mjs";

// Control-flow tests for the built code-spike-document stage, modelled on code-spike-unit.test.mjs and code-scenarios.test.mjs.
// Workflow harness with recording stand-ins for agents and runner; assert on recorded calls, never on agent output.
// Scenario spike-document-stage. The bundle path is resolved lazily inside each test, so the file imports before the bundle is built.
const stagePath = () => fileURLToPath(new URL("../../workflows/code-spike-document.js", import.meta.url));
const PLUGIN_ROOT = "/plugins/pairingbuddy";
const PB = `node ${PLUGIN_ROOT}/cli/pb.mjs`;
const ARGS = { attempt: 1, pluginRoot: PLUGIN_ROOT, task: { description: "compare two ways to round the VAT total" } };
const RUNNER = "pairingbuddy:runner";
const WRITER = "pairingbuddy:document-spike";
const LENS = "pairingbuddy:lens";

const SPIKE = ".pairingbuddy/run/task/spike.json";
const FINDINGS = [".pairingbuddy/run/task/artifacts/code-spike-unit.explore-spike-unit.u1.r1.a1.json", ".pairingbuddy/run/task/artifacts/code-spike-unit.explore-spike-unit.u2.r1.a1.json"];
const DRAFT_KEY = "code-spike-document.document-spike.-.r1.a1";
const DRAFT_PATH = `.pairingbuddy/run/task/artifacts/${DRAFT_KEY}.json`;

const pbKeyOf = (opts) => opts.schema.properties.pb_key.enum[0];
// Every runner command must go through the plugin's pb CLI; the prefix is asserted, then stripped.
const commandsOf = (prompt) =>
  blockOf(prompt, "commands")
    .split("\n")
    .map((line) => {
      assert.ok(line.startsWith(`${PB} `), `the runner command goes through the plugin's pb CLI: ${line}`);
      return line.slice(PB.length + 1);
    });
// One entry per runner command (so one runner with two commands equals two runners), one per other agent call.
const stepsOf = (calls) =>
  calls.flatMap(({ prompt, opts }) =>
    opts.agentType === RUNNER ? commandsOf(prompt).map((command) => `runner [${command}]`) : [`${opts.agentType} ${pbKeyOf(opts)}`],
  );

const SPIKE_STATE = { ok: true, taskType: "spike", spike: SPIKE, units: ["u1", "u2"], explored: ["u1", "u2"], next: null, findings: FINDINGS };
const SNAPSHOT = { ok: true, paths: ["CLAUDE.md"] };

const standIn = async (prompt, opts) => {
  const pb_key = pbKeyOf(opts);
  if (opts.agentType === RUNNER) {
    const [command] = commandsOf(prompt);
    const output = command === "spike state" ? SPIKE_STATE : command === "snapshot" ? SNAPSHOT : { ok: true };
    return { pb_key, cli_exit_code: 0, cli_output: JSON.stringify(output) };
  }
  if (opts.agentType === LENS) return { pb_key, ambiguity: null, findings: [] };
  return { pb_key, ambiguity: "", document: "# Spike\n", finding_map: [{ unit_id: "u1", section: "u1" }, { unit_id: "u2", section: "u2" }] };
};

test("stage-runs-state-agent-lens-write-finish", async () => {
  const { calls } = await runScript(stagePath(), { args: ARGS, agent: standIn });

  assert.deepEqual(stepsOf(calls), [
    "runner [spike state]",
    `${WRITER} ${DRAFT_KEY}`,
    "runner [snapshot]",
    `${LENS} code-spike-document.lens.claims-against-recorded-evidence.r1.a1`,
    "runner [spike write]",
    "runner [stage finish]",
  ]);
  const writer = calls.find(({ opts }) => opts.agentType === WRITER);
  assert.deepEqual(
    JSON.parse(blockOf(writer.prompt, "paths")),
    { spike: SPIKE, findings: FINDINGS, human_guidance: ".pairingbuddy/human-guidance.json" },
    "the paths block names the spike file, the list of recorded findings and the flat human-guidance file",
  );
  const lenses = calls.filter(({ opts }) => opts.agentType === LENS);
  assert.equal(lenses.length, 1, "exactly one lens runs, and no refuter, fix or course checker");
  const [{ prompt, opts }] = lenses;
  assert.equal(opts.model, "sonnet", "the lens runs at sonnet");
  assert.ok(opts.label.includes("claims-against-recorded-evidence"), "the label names the lens");
  assert.equal(JSON.parse(blockOf(prompt, "lens")), "claims-against-recorded-evidence");
  assert.deepEqual(JSON.parse(blockOf(prompt, "subject")), { document: DRAFT_PATH, spike: SPIKE, findings: FINDINGS }, "the subject names the draft path, the spike file and the findings");
});

const keyOf = (prompt) => /Return pb_key exactly as: (\S+)/.exec(prompt)[1];
const sentIdOf = (prompt) => /^Finding id: (.+)$/m.exec(prompt)[1];

test("stage-fix-loop-capped-at-five-attempts", async () => {
  const agent = async (prompt, opts) => {
    if (opts.agentType === LENS) return { pb_key: pbKeyOf(opts), ambiguity: null, findings: [{ rule: "a rule", severity: "high", claim: "a claim", where: "section u1" }] };
    if (opts.agentType === "pairingbuddy:refuter") return { pb_key: pbKeyOf(opts), finding_id: sentIdOf(prompt), verdict: "survives", ambiguity: null };
    if (opts.agentType === "pairingbuddy:course-checker") {
      return { pb_key: keyOf(prompt), finding_id: JSON.parse(blockOf(prompt, "findings"))[0].id, verdict: "wrong-direction", mistake: "wrong", what_went_wrong: "off course" };
    }
    return standIn(prompt, opts);
  };

  const { calls, result } = await runScript(stagePath(), { args: ARGS, agent });

  const fixCalls = calls.filter(({ opts }) => opts.agentType === WRITER && pbKeyOf(opts).startsWith("code-spike-document.fix."));
  assert.deepEqual(
    fixCalls.map(({ opts }) => pbKeyOf(opts)),
    [2, 3, 4, 5, 6].map((n) => `code-spike-document.fix.g1.r${n}.a1`),
    "exactly five fix attempts by the document-spike agent",
  );
  assert.deepEqual(
    fixCalls.map(({ prompt }) => JSON.parse(blockOf(prompt, "paths")).document),
    Array.from({ length: 5 }, () => DRAFT_PATH),
    "every fix gets the standing document: the course checker rolls each fix back, so that stays the first draft",
  );
  assert.equal(result.stopReason, "attempt-cap", "the stage stops on the attempt cap");
  const commands = calls.filter(({ opts }) => opts.agentType === RUNNER).flatMap(({ prompt }) => commandsOf(prompt));
  assert.ok(!commands.some((command) => command.startsWith("spike write") || command.startsWith("stage finish")), `no spike write or stage finish runs: ${commands.join(" | ")}`);
});
test("stage-state-relay-retried-then-step-failed", async () => {
  const agent = async (prompt, opts) => {
    if (opts.agentType === RUNNER && commandsOf(prompt)[0] === "spike state") return {};
    return standIn(prompt, opts);
  };

  const { calls, result } = await runScript(stagePath(), { args: ARGS, agent });

  assert.deepEqual(
    stepsOf(calls),
    [...Array.from({ length: MAX_TRIES }, () => "runner [spike state]"), "runner [stage stop step-failed]"],
    "spike state is tried MAX_TRIES times, then the stage stops step-failed, with no document-spike, lens or fix agent",
  );
  assert.equal(result.stopReason, "step-failed");
});

const runnerKeysOf = (calls) => calls.filter(({ opts }) => opts.agentType === RUNNER).map(({ opts }) => pbKeyOf(opts));
const assertAllUnique = (keys, message) => assert.equal(new Set(keys).size, keys.length, `${message}: ${keys.join(" | ")}`);

test("stage-runner-pb-keys-are-unique-on-the-happy-path", async () => {
  const { calls } = await runScript(stagePath(), { args: ARGS, agent: standIn });

  assertAllUnique(runnerKeysOf(calls), "every runner call has its own pb_key");
});

test("stage-runner-pb-keys-are-unique-when-the-first-state-relay-is-unusable", async () => {
  let stateCalls = 0;
  const agent = async (prompt, opts) => {
    if (opts.agentType === RUNNER && commandsOf(prompt)[0] === "spike state" && (stateCalls += 1) === 1) return {};
    return standIn(prompt, opts);
  };

  const { calls } = await runScript(stagePath(), { args: ARGS, agent });

  assert.equal(runnerKeysOf(calls).length, 4, "state twice, snapshot, then write and finish in one runner");
  assertAllUnique(runnerKeysOf(calls), "the retried state runner shares no key with the snapshot or the final runner");
});

// Late safeguards: the state relay's shape check, and the agent cap counting every non-lens spawn.

test("stage-state-relay-without-a-findings-array-is-retried-then-step-failed", async () => {
  const { findings, ...withoutFindings } = SPIKE_STATE;
  const agent = async (prompt, opts) => {
    if (opts.agentType === RUNNER && commandsOf(prompt)[0] === "spike state") return { pb_key: pbKeyOf(opts), cli_exit_code: 0, cli_output: JSON.stringify(withoutFindings) };
    return standIn(prompt, opts);
  };

  const { calls, result } = await runScript(stagePath(), { args: ARGS, agent });

  assert.deepEqual(
    stepsOf(calls),
    [...Array.from({ length: MAX_TRIES }, () => "runner [spike state]"), "runner [stage stop step-failed]"],
    "a relay with ok and spike but no findings array is unusable: tried MAX_TRIES times, then step-failed, with no writer",
  );
  assert.equal(result.stopReason, "step-failed");
});

test("stage-agent-cap-counts-state-writer-snapshot-and-the-final-runner", async (t) => {
  const built = readFileSync(stagePath(), "utf8");
  const original = "const maxAgents = STAGES.stageMaxAgents[stage] ?? STAGES.maxAgents;";
  assert.ok(built.includes(original), "the built stage reads its cap from the inlined contract");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-spike-doc-budget-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // The smallest cap at which the writer, the snapshot, the lens and the final runner leave less than a fix attempt costs, yet one runner short of the arithmetic would let it run.
  const CAP = 8;
  const path = join(dir, "code-spike-document.js");
  writeFileSync(path, built.replace(original, `const maxAgents = ${CAP};`));

  const agent = async (prompt, opts) => {
    if (opts.agentType === LENS) return { pb_key: pbKeyOf(opts), ambiguity: null, findings: [{ rule: "a rule", severity: "high", claim: "a claim", where: "section u1" }] };
    if (opts.agentType === "pairingbuddy:refuter") return { pb_key: pbKeyOf(opts), finding_id: sentIdOf(prompt), verdict: "survives", ambiguity: null };
    return standIn(prompt, opts);
  };

  const { calls } = await runScript(path, { args: ARGS, agent });

  assert.ok(calls.length <= CAP, `the stage never exceeds its cap of ${CAP}, spawned ${calls.length}: ${stepsOf(calls).join(" | ")}`);
  assert.deepEqual(calls.map(({ opts }) => opts.agentType), [RUNNER, WRITER, RUNNER, LENS, RUNNER], "no fix attempt fits once the state runner, writer, snapshot, lens and final runner are counted");
  assert.deepEqual(commandsOf(calls.at(-1).prompt), ["spike write", "stage finish"], "the reserved final runner still runs");
});
