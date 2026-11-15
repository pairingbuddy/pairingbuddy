// Scenario: light-review-schema-and-safeguard. light-review-result.schema.json pins the shape of a light review return.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { violations } from "./schema-check.mjs";

const finding = { focus: "code-smell", rule: "no-magic-numbers", severity: "high", kind: "fix-here", title: "Unnamed literal 42", claim: "A literal 42 is used without a name.", where: "src/a.py:12" };
const valid = () => ({
  pb_key: "k",
  ambiguity: null,
  not_checked: null,
  focus_changes: [{ focus: "design-fit", change: "add", reason: "new boundary" }],
  findings: [{ ...finding }],
});

test("schema-requires-not-checked-apart-from-ambiguity", () => {
  const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/light-review-result.schema.json", import.meta.url), "utf8"));
  const result = valid();
  delete result.not_checked;

  assert.deepEqual(violations(schema, { ...valid(), not_checked: "the full cart.py was not read" }), [], "a not_checked string is valid");
  assert.ok(violations(schema, result).includes("$.not_checked: required property is missing"), "not_checked is required");
});

test("schema-requires-a-finding-title-of-at-most-60-characters", () => {
  const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/light-review-result.schema.json", import.meta.url), "utf8"));
  const untitled = valid();
  delete untitled.findings[0].title;
  const long = valid();
  long.findings[0].title = "x".repeat(61);

  assert.ok(violations(schema, untitled).includes("$.findings[0].title: required property is missing"), "title is required");
  assert.notDeepEqual(violations(schema, long), [], "a title is at most 60 characters");
});

test("schema-rejects-change-without-reason", () => {
  const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/light-review-result.schema.json", import.meta.url), "utf8"));
  const result = valid();
  delete result.focus_changes[0].reason;

  assert.deepEqual(violations(schema, valid()), [], "a complete result has no violations");
  assert.deepEqual(violations(schema, result), ["$.focus_changes[0].reason: required property is missing"], "a focus change without a reason is rejected for the missing reason");
});
