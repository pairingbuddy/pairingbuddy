import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const CODE_PATH_STAGES = ["scenarios", "refactor-scope", "code-safety-net", "code-config", "pr-draft", "spike-document"];

function codePathLensNames() {
  const { rows } = JSON.parse(readFileSync(new URL("../../contracts/lenses.json", import.meta.url), "utf8"));
  const names = rows.filter((row) => CODE_PATH_STAGES.includes(row.stage)).flatMap((row) => row.lenses.map((lens) => lens.name));
  return [...new Set(names)];
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

test("the intake stage, its type gate and the classify-task agent have plain names", () => {
  for (const id of ["intake", "G:type", "classify-task"]) {
    const name = plainName(id);

    assert.ok(typeof name === "string" && name.trim() !== "", `${id} has a plain name`);
    assert.notEqual(name, id, `${id} is not shown as its raw id`);
  }
});

test("plain-name-lens-and-fix-roles", () => {
  const lenses = codePathLensNames();
  assert.ok(lenses.length > 0, "no lenses were collected from the code-path rows of contracts/lenses.json");

  const names = lenses.map((lens) => [lens, plainName(lens)]);
  const unnamed = names.filter(([, name]) => typeof name !== "string" || name.trim() === "").map(([lens]) => lens);
  const dashJoined = names.filter(([, name]) => typeof name === "string" && /\w-\w/.test(name)).map(([lens]) => lens);
  const distinct = new Set(names.map(([, name]) => name));

  assert.deepEqual(unnamed, [], `lenses without a plain name: ${unnamed.join(", ")}`);
  assert.deepEqual(dashJoined, [], `lens names that look like ids: ${dashJoined.join(", ")}`);
  assert.equal(distinct.size, lenses.length, "two lenses share one plain name");
  assert.equal(plainName("corpus-misalignment"), "docs and plan");
  assert.equal(plainName("permanence"), "how long it lasts");
  assert.equal(plainName("claims-against-recorded-evidence"), "claims checked against evidence");
  assert.equal(plainName("fix"), "fixing a finding");
});
