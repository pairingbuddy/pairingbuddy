// Scenario suggest-input: the task-scoped marking on human-guidance entries is schema-valid.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suggestionEntry } from "../../shared-node/suggestion.mjs";

const SCHEMA = new URL("../../contracts/schemas/human-guidance.schema.json", import.meta.url);

function assertFitsSchema(item, e, label) {
  for (const key of item.required) assert.ok(key in e, `${label}: required field ${key} is present`);
  for (const [key, value] of Object.entries(e)) {
    assert.ok(key in item.properties, `${label}: schema allows field ${key}`);
    assert.equal(typeof value, item.properties[key].type, `${label}: field ${key} has the schema's type`);
  }
}

describe("suggest-input schema", () => {
  test("suggestion-marking-is-schema-valid", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
    const item = schema.properties.guidance.items;
    const entry = suggestionEntry({ timestamp: "2026-11-04T10:00:00.000Z", context: "Task 58a", feedback: "Prefer smaller helpers" });
    // Entry from before the marking existed.
    const oldEntry = { agent: "curate-guidance", timestamp: "2026-01-09T21:20:00Z", context: "carried over", feedback: "x", persistent: true };

    assert.equal(item.properties.task_scoped?.type, "boolean", "task_scoped is declared as a boolean property");
    assert.ok(!item.required.includes("task_scoped"), "task_scoped is optional");
    assert.equal(entry.task_scoped, true, "the mod marks the entry task-scoped");
    assertFitsSchema(item, entry, "marked entry");
    assertFitsSchema(item, oldEntry, "legacy entry");
  });
});
