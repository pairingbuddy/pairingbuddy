import assert from "node:assert/strict";
import { test } from "node:test";
import { stageNamesFor } from "../../shared-node/stage-graph.mjs";
import contract from "../../shared-node/stages-contract.mjs";

const namesOf = (type) => contract.taskTypes[type].nodes.map((node) => node.name);

test("a ledger with a null taskType keeps listing the contract default graph steps", () => {
  const ledger = { taskType: null, stages: [] };

  const names = stageNamesFor(contract, ledger);

  assert.deepEqual(names, namesOf(contract.defaultTaskType), "a run opened before classification takes the default graph");
});

test("a bug_fix ledger renders bug_fix stage names and none of the config_change names", () => {
  const ledger = { taskType: "bug_fix", stages: [] };
  const configOnly = namesOf("config_change").filter((name) => !namesOf("bug_fix").includes(name));

  const names = stageNamesFor(contract, ledger);

  assert.deepEqual(names, namesOf("bug_fix"), "the bug_fix graph is listed");
  assert.ok(configOnly.length > 0, "config_change has a stage bug_fix lacks");
  for (const name of configOnly) assert.ok(!names.includes(name), `${name} belongs to config_change only`);
});
