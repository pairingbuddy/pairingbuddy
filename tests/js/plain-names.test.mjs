import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { allStages, loadStages, pipelineAgents, TASK_TYPES } from "../../shared-node/stages.mjs";
import { PHASES, ROLES } from "../../shared-node/labels.mjs";
import { plainName } from "../../shared-node/plain-names.mjs";

const pluginRoot = fileURLToPath(new URL("../..", import.meta.url));

function realIds() {
  const contract = loadStages(pluginRoot);
  const stages = allStages(contract);
  const gates = Object.values(contract.taskTypes).flatMap((graph) => Object.keys(graph.gates));
  const steps = [...pipelineAgents(pluginRoot)];
  return [...new Set([...stages, ...gates, ...steps, ...TASK_TYPES, ...PHASES, ...ROLES])];
}

function containsIdToken(name, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(name);
}

test("every stage, gate, agent, task type, phase and role id has a plain name", () => {
  const ids = realIds();
  assert.ok(ids.length > 0, "no ids were enumerated from the real sources");
  for (const required of ["refactoring", "spike"]) {
    assert.ok(TASK_TYPES.includes(required), `TASK_TYPES is missing ${required}`);
  }

  const named = ids.map((id) => [id, plainName(id)]);
  const missing = named.filter(([, name]) => typeof name !== "string" || name.trim() === "").map(([id]) => id);

  assert.deepEqual(missing, [], `ids without a plain name: ${missing.join(", ")}`);
});

test("no plain name equals or contains a stage, gate, agent, task type, phase or role id", () => {
  const ids = realIds();
  const idLike = /G:|[a-z0-9]+_[a-z0-9_]+/;

  const names = ids.map((id) => [id, plainName(id)]).filter(([, name]) => typeof name === "string");
  // An id with no hyphen, underscore or colon is already a plain word, so its own name may hold it.
  const isPlainWord = (id) => !/[-_:]/.test(id);
  const offenders = names.filter(([ownId, name]) => idLike.test(name) || ids.some((id) => !(id === ownId && isPlainWord(id)) && containsIdToken(name, id)));

  assert.deepEqual(offenders, [], `plain names that hold an id: ${JSON.stringify(offenders)}`);
});
