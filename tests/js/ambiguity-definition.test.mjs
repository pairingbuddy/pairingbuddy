import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A comparison run's task-end gate stopped on a refactor-tests return whose ambiguity explained its choices ("The
// malformed-time test has no match= because ... The two placeholder tests were left alone because other tasks own them").
// Every non-empty ambiguity stops a gate for a human, so every place that defines it says it is a question only, and
// names where an explanation goes instead.
const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");
const DEFINITION = "only a question a human must answer before the work can be trusted, phrased as a question";
const EXPLANATION_FIELDS = ["notes", "rationale", "summary", "document", "not_checked"];

const schemas = readdirSync(join(ROOT, "contracts", "schemas"))
  .map((file) => ({ file, schema: JSON.parse(read("contracts", "schemas", file)) }))
  .filter(({ schema }) => schema.properties?.ambiguity !== undefined);

test("some return schemas define ambiguity", () => assert.ok(schemas.length > 10, schemas.length));

for (const { file, schema } of schemas) {
  test(`${file} defines ambiguity as a question only`, () => {
    assert.ok(schema.properties.ambiguity.description.toLowerCase().includes(DEFINITION), schema.properties.ambiguity.description);
  });

  test(`${file} has a field for explanations, which its ambiguity names`, () => {
    const field = EXPLANATION_FIELDS.find((name) => schema.properties[name] !== undefined);
    assert.ok(field, `${file} has none of ${EXPLANATION_FIELDS.join(", ")}`);
    assert.ok(schema.properties.ambiguity.description.includes(field), `${file}: ambiguity does not name ${field}`);
  });
}

// Every return field is required, so notes is too, and an empty string says there is nothing to explain.
test("a notes field is a required string that may be empty", () => {
  for (const { file, schema } of schemas) {
    if (schema.properties.notes === undefined) continue;
    assert.ok(schema.required.includes("notes"), file);
    assert.equal(schema.properties.notes.type, "string", file);
    assert.equal(schema.properties.notes.minLength, undefined, file);
  }
});

const agents = readdirSync(join(ROOT, "agents")).filter((file) => read("agents", file).includes("ambiguity"));

test("some agents return ambiguity", () => assert.ok(agents.length > 10, agents.length));

for (const file of agents) {
  test(`agents/${file} defines ambiguity as a question only`, () => {
    assert.ok(read("agents", file).toLowerCase().includes(DEFINITION), `agents/${file} lacks: ${DEFINITION}`);
  });
}
