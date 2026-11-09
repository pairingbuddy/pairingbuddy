// Scenario: refuter-verdict contract. The refuter agent returns { pb_key, finding_id, verdict, ambiguity }; the schema pins its shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { violations } from "./schema-check.mjs";

const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/refuter-verdict.schema.json", import.meta.url), "utf8"));
const valid = () => ({ pb_key: "k", finding_id: "no-magic-numbers-1", verdict: "survives", ambiguity: null });

test("a valid verdict passes", () => {
  assert.deepEqual(violations(schema, valid()), []);
});

for (const key of ["pb_key", "finding_id", "verdict", "ambiguity"]) {
  test(`a verdict missing ${key} fails`, () => {
    const verdict = valid();
    delete verdict[key];

    assert.notDeepEqual(violations(schema, verdict), [], `${key} is required`);
  });
}

test("a verdict outside the enum fails", () => {
  const verdict = { ...valid(), verdict: "maybe" };

  assert.notDeepEqual(violations(schema, verdict), [], "only survives|refuted are allowed");
});

test("refuted is a valid verdict", () => {
  assert.deepEqual(violations(schema, { ...valid(), verdict: "refuted" }), []);
});

test("ambiguity may be null or a string", () => {
  assert.deepEqual(violations(schema, { ...valid(), ambiguity: null }), [], "null is valid");
  assert.deepEqual(violations(schema, { ...valid(), ambiguity: "unclear which rule applies" }), [], "a string is valid");
});
