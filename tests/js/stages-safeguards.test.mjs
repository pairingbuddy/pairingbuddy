// Safeguards for the stage contract validation in shared-node/stages.mjs: evidence entries with extra parts or a bad role
// are unknown, and a graph with no gates object treats every named gate as unknown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStages } from "../../shared-node/stages.mjs";

const contractWith = (graph) => ({
  v: 1, defaultTaskType: "x", maxAgents: 5, migratedTypes: [], newPathAgents: [], gateClasses: { continue: {} },
  taskTypes: { x: graph },
});
const nodeWith = (fields) => ({ name: "s", evidence: [], gate: null, ...fields });

test("evidence-with-an-extra-part-is-unknown", () => {
  const problems = validateStages(contractWith({ nodes: [nodeWith({ evidence: ["artifact:a:b"] })], gates: {} }));

  assert.deepEqual(problems, ['x: node s has unknown evidence "artifact:a:b"']);
});

test("artifact-evidence-with-a-bad-role-is-unknown", () => {
  const problems = validateStages(contractWith({ nodes: [nodeWith({ evidence: ["artifact:Bad Role", "artifact:good-role"] })], gates: {} }));

  assert.deepEqual(problems, ['x: node s has unknown evidence "artifact:Bad Role"']);
});

test("graph-without-a-gates-object-knows-no-gate", () => {
  const problems = validateStages(contractWith({ nodes: [nodeWith({ gate: "G:x" })], gates: "G:x" }));

  assert.deepEqual(problems, ["x: node s names unknown gate G:x"]);
});
