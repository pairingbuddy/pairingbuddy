import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { wiredLensConfig } from "../../shared-node/lens-merge.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

// Pins the refactoring flip: the graph in contracts/stages.json and the safety net's refactoring lens row.

test("refactoring-graph-is-scope-apply-safety-net", () => {
  const contract = JSON.parse(readFileSync(join(ROOT, "contracts/stages.json"), "utf8"));
  const safetyNetEvidence = contract.taskTypes.bug_fix.nodes.find((node) => node.name === "code-safety-net").evidence;

  const graph = contract.taskTypes.refactoring;

  assert.deepEqual(
    graph.nodes,
    [
      { name: "intake", gate: "G:type", evidence: ["artifact:classify-task"] },
      { name: "code-refactor-scope", gate: "G:scope", evidence: ["tests:full", "artifact:scope-refactoring"] },
      { name: "code-refactor-apply", gate: null, evidence: ["checkpoint:refactor-step"] },
      { name: "code-safety-net", gate: "G:task-end", evidence: safetyNetEvidence },
    ],
    "the refactoring graph is scope, apply, safety net",
  );
  assert.deepEqual(Object.keys(graph.gates).sort(), ["G:scope", "G:task-end", "G:type"], "the refactoring graph has exactly the type, scope and task-end gates");
  assert.equal(graph.gates["G:scope"].class, "continue", "G:scope is continue-class");
  assert.equal(graph.gates["G:task-end"].class, "continue", "G:task-end is continue-class");
});

test("safety-net-uses-refactoring-lens-row", () => {
  const lenses = JSON.parse(readFileSync(join(ROOT, "contracts/lenses.json"), "utf8"));

  const config = wiredLensConfig(lenses, "code-safety-net", "refactoring");

  assert.deepEqual(config.lenses.map(({ name }) => name), ["behaviour-preservation", "tests", "corpus-misalignment"], "the refactoring row's lenses");
  assert.equal(config.lenses[0].model, "opus", "behaviour-preservation runs at opus");
  assert.equal(config.refute, "one", "the row refutes one finding at a time");
  assert.equal(config.maxRefuters, 6, "the row caps refuters at 6");
});
