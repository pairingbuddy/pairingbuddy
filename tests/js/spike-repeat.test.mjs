import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { makeRepo } from "./cli-repo-fixture.mjs";
import { pbFrom, spikePlugin } from "./spike-plugin-fixture.mjs";
import { writeLedger } from "../../shared-node/ledger.mjs";
import { repeatAfterPass, repeatingNode } from "../../shared-node/repeat.mjs";
import { loadStages, validateStages } from "../../shared-node/stages.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

// Tests for scenario spike-stage-graph-and-repeat: the spike stage graph, validation of the repeat flag, and
// repeat/redo behaviour at G:unit through pb gate eval, pb human approve and the tap hook, all on temp repos.

test("stages-contract-accepts-repeat", async (t) => {
  const committed = loadStages(ROOT);
  const mirror = (await import("../../shared-node/stages-contract.mjs")).default;
  const spikeNode = (contract) => contract.taskTypes.spike?.nodes?.find((node) => node.name === "code-spike-unit");
  const withRepeat = (repeat) => {
    const contract = structuredClone(committed);
    contract.taskTypes.spike = { nodes: [{ name: "code-spike-unit", gate: "G:unit", repeat, evidence: ["artifact:explore-spike-unit"] }], gates: { "G:unit": { class: "continue" } } };
    return contract;
  };

  await t.test("contracts/stages.json holds the spike graph with a repeating code-spike-unit node", () => {
    assert.deepEqual(spikeNode(committed), { name: "code-spike-unit", gate: "G:unit", repeat: true, evidence: ["artifact:explore-spike-unit", "checkpoint:spike-unit"] }, "the spike node");
    assert.deepEqual(committed.taskTypes.spike.gates, { "G:unit": { class: "continue" } }, "the spike gates");
  });

  await t.test("shared-node/stages-contract.mjs mirrors the committed spike graph", () => {
    assert.deepEqual(mirror.taskTypes.spike, committed.taskTypes.spike, "the mirror's spike graph");
  });

  await t.test("the validator accepts the committed contract", () => {
    assert.deepEqual(validateStages(committed), [], "no problems");
  });

  await t.test("the validator accepts a boolean repeat", () => {
    assert.deepEqual(validateStages(withRepeat(false)), [], "repeat false is fine");
  });

  await t.test("the validator rejects a non-boolean repeat", () => {
    assert.match(validateStages(withRepeat("yes")).join("\n"), /repeat/, "a string repeat is reported");
  });

  await t.test("the validator rejects a repeating node with no checkpoint evidence entry", () => {
    const problems = validateStages(withRepeat(true)).join("\n");

    assert.match(problems, /repeat/, "the problem names repeat");
    assert.match(problems, /checkpoint/, "the problem names checkpoint");
  });

  await t.test("spike is not a migrated type", () => {
    assert.ok(!committed.migratedTypes.includes("spike"), "stages.json migratedTypes");
    assert.ok(!mirror.migratedTypes.includes("spike"), "mirror migratedTypes");
  });
});
const UNIT_KEY = "code-spike-unit.explore-spike-unit.u1.r1.a1";
const unit = (id) => ({ id, name: id, description: `Explore ${id}`, execution: { language: "node", run_command: "node x.mjs", working_directory: `spike/${id}` } });
const SPIKE = { goal: "Learn X", code_location: "spike", exploration_mode: "questions", doc_path: "docs/spikes/learn-x.md", units: [unit("u1"), unit("u2")] };

// A spike run with u1 explored at attempt 1 and G:unit due, with two units in spike.json.
function arrangeDoneUnit(t, ledger = {}) {
  const plugin = spikePlugin(t);
  const repo = makeRepo({
    ledger: {
      taskType: "spike",
      policy: { mode: "auto", source: "permission_mode" },
      stage: { name: "code-spike-unit", status: "done", runId: "wf_1", attempt: 1, startedAt: null },
      stages: [{ name: "code-spike-unit", status: "done" }],
      checkpoints: [{ key: UNIT_KEY, step: "spike-unit", committed: false, stage: "code-spike-unit", attempt: 1 }],
      ...ledger,
    },
  });
  const taskDir = join(repo.dir, ".pairingbuddy", "run", "task");
  writeFileSync(join(taskDir, "spike.json"), JSON.stringify(SPIKE));
  const artifact = { pb_key: UNIT_KEY, ambiguity: "", unit_id: "u1", summary: "it works", code_references: [], recommendation: "use it", commit_subject: "try u1", files_changed: [] };
  writeFileSync(join(taskDir, "artifacts", `${UNIT_KEY}.json`), JSON.stringify(artifact));
  return { plugin, repo };
}

function assertRepeats({ plugin, repo }) {
  const ledger = repo.ledger();
  const entry = ledger.stages.find((stage) => stage.name === "code-spike-unit");
  assert.deepEqual(entry.explored, ["u1"], "the stage entry lists u1 as explored");
  assert.equal(entry.status, "repeat", "the stage entry repeats");
  assert.equal(ledger.stage.status, "repeat", "ledger.stage repeats");
  assert.equal("G:unit" in ledger.gates, false, "the G:unit record is removed");
  const action = pbFrom(plugin, repo, "status", "--action");
  const output = `${action.stdout}${action.stderr}`;
  const { next } = JSON.parse(action.stdout);
  assert.deepEqual(next, { stage: "code-spike-unit", attempt: 2 }, `status --action's next is code-spike-unit at attempt 2: ${output}`);
}

test("gate-pass-repeats-stage-while-units-remain", async (t) => {
  await t.test("pb gate eval auto-pass", (st) => {
    const arranged = arrangeDoneUnit(st);

    const result = pbFrom(arranged.plugin, arranged.repo, "gate", "eval");

    assert.equal(result.code, 0, `gate eval exits 0: ${result.stdout}${result.stderr}`);
    assertRepeats(arranged);
  });

  await t.test("pb human approve G:unit", (st) => {
    const arranged = arrangeDoneUnit(st, { policy: { mode: "default", source: "permission_mode" }, needsHuman: { gate: "G:unit", reason: "your OK on this experiment", seq: 0 } });

    const result = pbFrom(arranged.plugin, arranged.repo, "human", "approve", "G:unit");

    assert.equal(result.code, 0, `human approve exits 0: ${result.stdout}${result.stderr}`);
    assertRepeats(arranged);
  });
});

const LAST_KEY = "code-spike-unit.explore-spike-unit.u2.r1.a2";

// A spike run whose u1 is already explored and whose u2 was explored at attempt 2: the last unit, G:unit due.
function arrangeLastUnit(t, ledger = {}) {
  const arranged = arrangeDoneUnit(t, {
    stage: { name: "code-spike-unit", status: "done", runId: "wf_2", attempt: 2, startedAt: null },
    stages: [{ name: "code-spike-unit", status: "done", explored: ["u1"] }],
    checkpoints: [
      { key: UNIT_KEY, step: "spike-unit", committed: false, stage: "code-spike-unit", attempt: 1 },
      { key: LAST_KEY, step: "spike-unit", committed: false, stage: "code-spike-unit", attempt: 2 },
    ],
    ...ledger,
  });
  const artifact = { pb_key: LAST_KEY, ambiguity: "", unit_id: "u2", summary: "it works too", code_references: [], recommendation: "use it", commit_subject: "try u2", files_changed: [] };
  writeFileSync(join(arranged.repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${LAST_KEY}.json`), JSON.stringify(artifact));
  return arranged;
}

function assertStaysDone({ plugin, repo }) {
  const ledger = repo.ledger();
  const entry = ledger.stages.find((stage) => stage.name === "code-spike-unit");
  assert.deepEqual(entry.explored, ["u1", "u2"], "the stage entry lists both units as explored");
  assert.equal(entry.status, "done", "the stage entry stays done");
  assert.equal(ledger.stage.status, "done", "ledger.stage stays done");
  assert.ok("G:unit" in ledger.gates, "the G:unit record is kept");
  const action = pbFrom(plugin, repo, "status", "--action");
  const output = `${action.stdout}${action.stderr}`;
  const { next, action: advice } = JSON.parse(action.stdout);
  assert.equal(next, null, `status --action's next is null: ${output}`);
  assert.doesNotMatch(advice, /code-spike-unit/, `the action no longer names code-spike-unit: ${output}`);
  assert.match(advice, /every stage and gate is done/i, `the action says everything is done: ${output}`);
}

test("gate-pass-last-unit-stays-done", async (t) => {
  await t.test("pb gate eval auto-pass", (st) => {
    const arranged = arrangeLastUnit(st);

    const result = pbFrom(arranged.plugin, arranged.repo, "gate", "eval");

    assert.equal(result.code, 0, `gate eval exits 0: ${result.stdout}${result.stderr}`);
    assertStaysDone(arranged);
  });

  await t.test("pb human approve G:unit", (st) => {
    const arranged = arrangeLastUnit(st, { policy: { mode: "default", source: "permission_mode" }, needsHuman: { gate: "G:unit", reason: "your OK on this experiment", seq: 0 } });

    const result = pbFrom(arranged.plugin, arranged.repo, "human", "approve", "G:unit");

    assert.equal(result.code, 0, `human approve exits 0: ${result.stdout}${result.stderr}`);
    assertStaysDone(arranged);
  });
});
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");

// What a finished AskUserQuestion carries when the human picks `answer` at `gate`.
function gateAnswerPayload(repo, gate, answer) {
  const recorded = JSON.parse(readFileSync(join(PAYLOADS, "posttooluse-askuserquestion.json"), "utf8"));
  const text = `Approve ${gate}?`;
  const options = [
    { label: "approve", description: "Approve this gate and let the run continue." },
    { label: "redo", description: "Redo the stage before this gate." },
    { label: "stop", description: "Stop here." },
  ];
  const question = { question: text, header: `PB gate: ${gate}`, multiSelect: false, options };
  const response = { ...recorded.tool_input, questions: [question], answers: { [text]: answer } };
  return { ...recorded, cwd: repo.dir, tool_input: response, tool_response: response };
}

function tapGateAnswer(plugin, repo, gate, answer) {
  const tapped = spawnSync(process.execPath, [join(ROOT, "hooks", "tap.mjs")], { cwd: repo.dir, input: JSON.stringify(gateAnswerPayload(repo, gate, answer)), env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin }, encoding: "utf8" });
  assert.equal(tapped.status, 0, `the tap exits 0: ${tapped.stderr}`);
}

// Stands in for the stage being run again after a redo: the ledger marks it active on a new attempt.
function restartStage(repo, attempt) {
  const ledger = repo.ledger();
  const restarted = { ...ledger, stage: { ...ledger.stage, status: "active", attempt }, stages: ledger.stages.map((stage) => (stage.name === "code-spike-unit" ? { ...stage, status: "active" } : stage)) };
  writeLedger(join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json"), restarted);
}

test("gate-redo-re-explores-same-unit", (t) => {
  const { plugin, repo } = arrangeDoneUnit(t, { policy: { mode: "default", source: "permission_mode" } });

  const asked = pbFrom(plugin, repo, "gate", "eval");

  assert.equal(asked.code, 0, `gate eval exits 0: ${asked.stdout}${asked.stderr}`);
  assert.equal(JSON.parse(asked.stdout).result, "needs-human", `G:unit asks the human: ${asked.stdout}`);

  tapGateAnswer(plugin, repo, "G:unit", "redo");

  const ledger = repo.ledger();
  const entry = ledger.stages.find((stage) => stage.name === "code-spike-unit");
  assert.deepEqual(entry.explored ?? [], [], "the stage entry lists no explored unit");
  assert.equal(entry.status, "redo", "the stage entry is sent back, not repeated");
  assert.equal(ledger.stage.status, "redo", "ledger.stage is sent back");
  assert.equal("G:unit" in ledger.gates, false, "the redo leaves no G:unit record");

  restartStage(repo, 2);

  const state = pbFrom(plugin, repo, "spike", "state");
  assert.equal(state.code, 0, `spike state exits 0: ${state.stdout}${state.stderr}`);
  assert.equal(JSON.parse(state.stdout).next.id, "u1", `spike state's next is u1 again: ${state.stdout}`);
});

// Late safeguards on the pure repeat rule, with a hand-built contract: a repeating node behind G:unit and another gated node.
const REPEAT_CONTRACT = {
  defaultTaskType: "spike",
  taskTypes: {
    spike: {
      nodes: [
        { name: "code-spike-unit", gate: "G:unit", repeat: true, evidence: ["checkpoint:spike-unit"] },
        { name: "wrap-up", gate: "G:wrap", evidence: [] },
      ],
      gates: { "G:unit": { class: "continue" }, "G:wrap": { class: "continue" } },
    },
  },
};

test("repeat-rule-safeguards", async (t) => {
  const repeatingLedger = (explored) => ({
    taskType: "spike",
    stage: { name: "code-spike-unit", status: "done", attempt: 1 },
    stages: [{ name: "code-spike-unit", status: "done", explored }],
    gates: { "G:unit": { result: "pass" } },
    checkpoints: [{ key: UNIT_KEY, step: "spike-unit", committed: false, stage: "code-spike-unit", attempt: 1 }],
  });

  await t.test("the repeating node is found by its own gate", () => {
    assert.equal(repeatingNode(REPEAT_CONTRACT, "spike", "G:unit")?.name, "code-spike-unit", "G:unit belongs to the repeating node");
  });

  await t.test("another gated node's gate does not repeat", () => {
    assert.equal(repeatingNode(REPEAT_CONTRACT, "spike", "G:wrap"), undefined, "G:wrap's node does not repeat");
  });

  await t.test("a unit that passes twice is listed once in explored", () => {
    const after = repeatAfterPass(REPEAT_CONTRACT, repeatingLedger(["u1"]), "G:unit", ["u1", "u2"]);

    assert.deepEqual(after.stages[0].explored, ["u1"], "u1 appears once");
    assert.equal(after.stages[0].status, "repeat", "u2 remains, so the stage repeats");
  });
});
