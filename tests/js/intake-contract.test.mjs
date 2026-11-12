import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import bundled from "../../shared-node/stages-contract.mjs";

// Contract tests for Task 92: how the task paths start.
const SOURCE = JSON.parse(readFileSync(new URL("../../contracts/stages.json", import.meta.url), "utf8"));
const TASK_TYPES = ["config_change", "bug_fix", "new_feature", "refactoring", "spike"];
const INTAKE = { name: "intake", gate: "G:type", evidence: ["artifact:classify-task"] };

test("task-paths-start-with-intake-gated-by-type", () => {
  for (const [label, contract] of [["contracts/stages.json", SOURCE], ["shared-node/stages-contract.mjs", bundled]]) {
    for (const type of TASK_TYPES) {
      const path = contract.taskTypes[type];

      assert.deepEqual(path.nodes[0], INTAKE, `${label}: ${type} starts with the intake node`);
      assert.deepEqual(path.gates["G:type"], { class: "conditional" }, `${label}: ${type} has G:type as a conditional gate`);
    }
  }
});

test("publish-and-refresh-paths-unchanged", () => {
  // Safeguard: the code already does this.
  for (const [label, contract] of [["contracts/stages.json", SOURCE], ["shared-node/stages-contract.mjs", bundled]]) {
    for (const type of ["publish", "refresh"]) {
      const path = contract.taskTypes[type];

      assert.deepEqual(path.nodes.filter((node) => node.gate === "G:publish").map((node) => node.name), ["pr-draft"], `${label}: ${type} has pr-draft as its only G:publish node`);
      assert.ok(!path.nodes.some((node) => node.name === "intake" || node.gate === "G:type"), `${label}: ${type} has no intake node or G:type gate`);
      assert.ok(!Object.hasOwn(path.gates, "G:type"), `${label}: ${type} declares no G:type gate`);
    }
  }
});

const readRepoFile = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const CLASSIFY_FIELDS = ["pb_key", "ambiguity", "task_type", "confidence", "rationale"];

test("classify-task-result-schema-requires-every-field-and-the-agent-lists-them", () => {
  // The return schema requires exactly the five fields and refuses others, and the paths-block Output JSON in the agent lists the same fields.
  const schema = JSON.parse(readRepoFile("contracts/schemas/classify-task-result.schema.json"));
  const agent = readRepoFile("agents/classify-task.md");
  const pathsJson = /With a `<paths>` block, return the result as your StructuredOutput[^\n]*\n\n```json\n([\s\S]*?)\n```/.exec(agent)?.[1];

  assert.deepEqual([...schema.required].sort(), [...CLASSIFY_FIELDS].sort(), "the schema requires exactly the five fields");
  assert.equal(schema.additionalProperties, false, "the schema refuses extra fields");
  assert.ok(pathsJson, "the Output section has a paths-block JSON block");
  assert.deepEqual(Object.keys(JSON.parse(pathsJson)).sort(), [...CLASSIFY_FIELDS].sort(), "the inline Output JSON lists exactly the schema fields");
});

test("classify-task-result-is-return-only-in-agent-config", () => {
  // agent-config.yaml registers the result schema and lists it as a return_only output of classify-task.
  const config = readRepoFile("contracts/agent-config.yaml");

  assert.match(config, /classify_result:\n\s+schema: classify-task-result\.schema\.json\n\s+return_only: true/, "the contract lists the result schema as a return_only output");
  assert.ok(config.includes("  - classify-task-result.schema.json\n"), "the schema is registered in agent-config.yaml");
});

test("classify-task-states-the-one-input-rule-and-never-waits-for-a-human", () => {
  // With a paths block the agent reads only the named paths, returns StructuredOutput, asks no human and writes no files.
  const agent = readRepoFile("agents/classify-task.md");

  assert.match(agent, /With a `<paths>` block in the prompt: read only what the paths name for your inputs, and return your Output as StructuredOutput/, "Input states the paths-block rule");
  assert.match(agent, /With no `<paths>` block: use the legacy flat files below and write the legacy Output/, "Input keeps the legacy rule");
  assert.match(agent, /With a `<paths>` block: where the steps below say to ask the human, do not guess and do not ask\. No human is reachable from a stage/, "the agent asks no human under a paths block");
  assert.match(agent, /With a `<paths>` block: write no files/, "File Creation Restrictions say a paths block writes no files");
});
