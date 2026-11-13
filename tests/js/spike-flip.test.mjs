import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { wiredLensConfig } from "../../shared-node/lens-merge.mjs";
import stagesContract from "../../shared-node/stages-contract.mjs";
import { pseudocode, routerSection, sentencesSaying } from "./skill-router.mjs";

// Scenario spike-flip: the spike graph gains a document node, and the skill's router treats spike as a migrated type.
// Owns the spike graph and its migrated status; the router's own prose is pinned in code-router.test.mjs.

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

const SPIKE_NODES = [
  { name: "code-spike-unit", gate: "G:unit", repeat: true, evidence: ["artifact:explore-spike-unit", "checkpoint:spike-unit"] },
  { name: "code-spike-document", gate: "G:task-end", evidence: ["artifact:document-spike", "checkpoint:spike-doc"] },
];

const committedContract = () => JSON.parse(readFileSync(join(ROOT, "contracts/stages.json"), "utf8"));

function assertSpikeGraph(graph, where) {
  assert.deepEqual(graph.nodes, SPIKE_NODES, `${where}: the spike graph is unit then document`);
  assert.deepEqual(Object.keys(graph.gates).sort(), ["G:task-end", "G:unit"], `${where}: exactly the unit and task-end gates`);
  assert.equal(graph.gates["G:unit"].class, "continue", `${where}: G:unit is continue-class`);
  assert.equal(graph.gates["G:task-end"].class, "continue", `${where}: G:task-end is continue-class`);
}

describe("the spike stage graph", () => {
  test("graph-spike-has-document-node-with-task-end-gate", () => {
    assertSpikeGraph(committedContract().taskTypes.spike, "contracts/stages.json");
    assertSpikeGraph(stagesContract.taskTypes.spike, "shared-node/stages-contract.mjs");
  });

  test("lens-config-wires-one-claims-lens-for-code-spike-document", () => {
    const lenses = JSON.parse(readFileSync(join(ROOT, "contracts/lenses.json"), "utf8"));

    const config = wiredLensConfig(lenses, "code-spike-document");

    assert.deepEqual(config.lenses.map(({ name, model }) => [name, model]), [["claims-against-recorded-evidence", "sonnet"]], "one claims lens at sonnet");
    assert.equal(config.refute, "none", "the document row refutes nothing");
    assert.ok(config.lenses[0].brief.length > 0, "the lens has a brief");
  });
});

describe("spike-in-migrated-types-everywhere", () => {
  test("migrated-types-list-spike-in-the-contract-the-mirror-and-the-skill", () => {
    const listed = JSON.parse(/^MIGRATED_TYPES = (\[.*\])$/m.exec(pseudocode())[1]);

    assert.ok(committedContract().migratedTypes.includes("spike"), "contracts/stages.json lists spike as migrated");
    assert.ok(stagesContract.migratedTypes.includes("spike"), "shared-node/stages-contract.mjs lists spike as migrated");
    assert.ok(listed.includes("spike"), "MIGRATED_TYPES in SKILL.md lists spike");
  });

  test("the-router-maps-the-spike-task-type-to-the-spike-unit-type", () => {
    assert.match(routerSection(), /`spike` to `spike`/, "the router maps the spike task type to the spike unit type");
  });

  test("setting-up-spike-runs-before-the-new-path", () => {
    const code = pseudocode();

    assert.match(code, /setting[-_]up[-_]spike/, "the pseudocode runs the setting-up-spike skill");
    assert.ok(code.search(/setting[-_]up[-_]spike/) < code.indexOf("_run_new_path(task)"), "setting-up-spike runs before the new path");
  });

  test("a-closed-task-end-result-stops-without-a-publish-run", () => {
    sentencesSaying("that a closed pb task end result reports its reason and stops", routerSection(), /If its output has `closed`/, /report its `reason` and stop/);
    sentencesSaying("that a closed result does not open the publish run", routerSection(), /If its output has `closed`/, /do not run `pb run open --kind publish`/);
  });
});
