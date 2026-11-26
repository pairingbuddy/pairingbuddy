// Scenario: lens-result contract. The lens agent returns { pb_key, ambiguity, findings }; the schema pins its shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { violations } from "./schema-check.mjs";

const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/lens-result.schema.json", import.meta.url), "utf8"));
const finding = { rule: "no-magic-numbers", severity: "high", kind: "fix-here", title: "Unnamed literal 42", claim: "A literal 42 is used without a name.", where: "src/a.py:12" };
const valid = () => ({ pb_key: "k", ambiguity: null, not_checked: null, findings: [{ ...finding }] });

test("a valid result passes", () => {
  assert.deepEqual(violations(schema, valid()), []);
});

for (const key of ["pb_key", "findings", "ambiguity", "not_checked"]) {
  test(`a result missing ${key} fails`, () => {
    const result = valid();
    delete result[key];

    assert.notDeepEqual(violations(schema, result), [], `${key} is required`);
  });
}

for (const key of ["rule", "severity"]) {
  test(`a finding without ${key} fails`, () => {
    const result = valid();
    delete result.findings[0][key];

    assert.notDeepEqual(violations(schema, result), [], `${key} is required on a finding`);
  });
}

test("a finding without claim fails", () => {
  const result = valid();
  delete result.findings[0].claim;

  assert.ok(violations(schema, result).includes("$.findings[0].claim: required property is missing"), "claim is required on a finding");
});

test("a finding without title fails: every new return gives the gist", () => {
  const result = valid();
  delete result.findings[0].title;

  assert.ok(violations(schema, result).includes("$.findings[0].title: required property is missing"), "title is required on a finding");
});

test("a title longer than 60 characters fails", () => {
  const result = valid();
  result.findings[0].title = "x".repeat(61);

  assert.notDeepEqual(violations(schema, result), [], "a title is at most 60 characters");
  result.findings[0].title = "x".repeat(60);
  assert.deepEqual(violations(schema, result), [], "60 characters is a title");
});

test("a finding without where fails", () => {
  const result = valid();
  delete result.findings[0].where;

  assert.ok(violations(schema, result).includes("$.findings[0].where: required property is missing"), "where is required on a finding");
});

test("a severity outside high|medium|low fails", () => {
  const result = valid();
  result.findings[0].severity = "critical";

  assert.notDeepEqual(violations(schema, result), [], "critical is not a severity");
});

test("an empty rule is valid", () => {
  const result = valid();
  result.findings[0].rule = "";

  assert.deepEqual(violations(schema, result), []);
});

test("ambiguity string is valid", () => {
  assert.deepEqual(violations(schema, { ...valid(), ambiguity: "which rule applies?" }), []);
});

test("ambiguity number is invalid", () => {
  assert.notDeepEqual(violations(schema, { ...valid(), ambiguity: 3 }), [], "a number is not an ambiguity");
});

test("an extra finding field such as a model-supplied id is rejected", () => {
  const result = valid();
  result.findings[0].id = "f-1";

  assert.notDeepEqual(violations(schema, result), [], "findings carry no model-supplied id");
});

test("lens-result-schema-requires-finding-kind", () => {
  const item = schema.properties.findings.items;

  assert.ok(item.required.includes("kind"), "kind is required on a finding");
  assert.deepEqual(item.properties.kind?.enum, ["fix-here", "risk", "drift"], "kind enum is fix-here | risk | drift");
});

test("a reviewer may suggest up to three answers to its question, as ambiguity_options; more, or a blank one, fails", () => {
  const refuter = JSON.parse(readFileSync(new URL("../../contracts/schemas/refuter-verdict.schema.json", import.meta.url), "utf8"));
  const light = JSON.parse(readFileSync(new URL("../../contracts/schemas/light-review-result.schema.json", import.meta.url), "utf8"));
  const verdict = { pb_key: "k", ambiguity: "Empty cart: 0 or None?", not_checked: null, finding_id: "code-1", verdict: "survives", reason: "r" };

  assert.deepEqual(violations(schema, { ...valid(), ambiguity: "Empty cart: 0 or None?", ambiguity_options: ["0", "None"] }), []);
  assert.notDeepEqual(violations(schema, { ...valid(), ambiguity_options: ["a", "b", "c", "d"] }), [], "at most three");
  assert.notDeepEqual(violations(schema, { ...valid(), ambiguity_options: [""] }), [], "never blank");
  assert.ok(!violations(refuter, { ...verdict, ambiguity_options: ["0", "None"] }).some((v) => v.includes("ambiguity_options")), "the refuter too");
  assert.ok(!violations(light, { pb_key: "k", ambiguity: "q?", ambiguity_options: ["0"], not_checked: null, focus_changes: [], findings: [] }).some((v) => v.includes("ambiguity_options")), "and a light review");
});
