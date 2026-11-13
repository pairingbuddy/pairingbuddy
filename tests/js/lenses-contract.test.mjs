// Scenario: lens-map-contract. contracts/lenses.json replaces tests/fixtures/lens-map.json; every lens entry names a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lensMapProblems } from "../../shared-node/lenses-contract.mjs";
const REAL_LENS_MAP = JSON.parse(readFileSync(new URL("../../contracts/lenses.json", import.meta.url), "utf8"));

test("contracts/lenses.json parses and every row has a stage id and a lenses list whose entries each have a non-empty name, in the D8 lens-map shape the label-contract test already reads", () => {
  const { rows } = REAL_LENS_MAP;

  assert.ok(Array.isArray(rows) && rows.length > 0, "lenses.json has a non-empty rows list");
  for (const row of rows) {
    assert.ok(row.stage, `${row.row} has a stage id`);
    assert.ok(Array.isArray(row.lenses), `${row.row} has a lenses list`);
    for (const lens of row.lenses) assert.ok(typeof lens.name === "string" && lens.name !== "", `${row.row} lens has a non-empty name`);
  }
});

test("A lens entry with no model (or an empty model) is reported by the contract check; a valid map reports nothing", () => {
  const valid = { rows: [{ row: "scenarios", stage: "scenarios", lenses: [{ name: "necessity", model: "sonnet" }] }] };
  const noModel = { rows: [{ row: "scenarios", stage: "scenarios", lenses: [{ name: "necessity" }] }] };
  const emptyModel = { rows: [{ row: "scenarios", stage: "scenarios", lenses: [{ name: "necessity", model: "" }] }] };

  assert.deepEqual(lensMapProblems(valid), [], "a valid map reports nothing");
  assert.match(lensMapProblems(noModel).join("\n"), /scenarios: lens necessity has no model/, "a lens with no model is reported");
  assert.match(lensMapProblems(emptyModel).join("\n"), /scenarios: lens necessity has no model/, "a lens with an empty model is reported");
});

test("Every model is a bare alias (sonnet or opus), never a full model id, so the smoke env mapping can rewrite it", () => {
  const fullId = { rows: [{ row: "scenarios", stage: "scenarios", lenses: [{ name: "necessity", model: "claude-sonnet-4-5" }] }] };

  assert.match(lensMapProblems(fullId).join("\n"), /scenarios: lens necessity model claude-sonnet-4-5 is not a bare alias/, "a full model id is reported");
  assert.deepEqual(lensMapProblems(REAL_LENS_MAP), [], "the real lens map has no problems");
});
