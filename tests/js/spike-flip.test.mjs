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
  { name: "intake", gate: "G:type", evidence: ["artifact:classify-task"] },
  { name: "code-spike-unit", gate: "G:unit", repeat: true, evidence: ["artifact:explore-spike-unit", "checkpoint:spike-unit"] },
  { name: "code-spike-document", gate: "G:task-end", evidence: ["artifact:document-spike", "checkpoint:spike-doc"] },
];

const committedContract = () => JSON.parse(readFileSync(join(ROOT, "contracts/stages.json"), "utf8"));

function assertSpikeGraph(graph, where) {
  assert.deepEqual(graph.nodes, SPIKE_NODES, `${where}: the spike graph is intake, unit, then document`);
  assert.deepEqual(Object.keys(graph.gates).sort(), ["G:task-end", "G:type", "G:unit"], `${where}: exactly the type, unit and task-end gates`);
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
  test("migrated-types-list-spike-in-the-contract-and-the-mirror", () => {
    assert.ok(committedContract().migratedTypes.includes("spike"), "contracts/stages.json lists spike as migrated");
    assert.ok(stagesContract.migratedTypes.includes("spike"), "shared-node/stages-contract.mjs lists spike as migrated");
  });

  test("the-router-offers-spike-as-a-branch-type", () => {
    sentencesSaying("that spike is a branch type to guess", routerSection(), /branch type you guess from the task/, /`spike`/);
  });

  test("setting-up-spike-runs-after-g-type-inside-the-new-path", () => {
    const [step] = sentencesSaying("the spike setup after G:type", routerSection(), /After G:type/, /setting-up-spike skill/, /`pb spike setup`/);

    assert.match(step, /spike whose setup is not recorded/);
    assert.match(step, /main context/);
    assert.doesNotMatch(pseudocode(), /_setting_up_spike\(task\)/, "the router no longer sets up a spike before the run");
  });

  test("a-closed-task-end-result-stops-without-a-publish-run", () => {
    sentencesSaying("that a closed pb task end result reports its reason and stops", routerSection(), /If its output has `closed`/, /report its `reason` and stop/);
    sentencesSaying("that a closed result does not open the publish run", routerSection(), /If its output has `closed`/, /do not run `pb run open --kind publish`/);
  });
});
