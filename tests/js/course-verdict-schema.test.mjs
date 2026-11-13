// Scenario: course-verdict-schema. course-verdict.schema.json accepts a well-formed verdict and rejects values outside the pinned enums.
// Placeholders: each test fails until the schema is implemented. Skips are not allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { violations } from "./schema-check.mjs";

const schema = JSON.parse(readFileSync(new URL("../../contracts/schemas/course-verdict.schema.json", import.meta.url), "utf8"));
const valid = () => ({
  pb_key: "k",
  finding_id: "code-1",
  verdict: "wrong-direction",
  mistake: "missed-finding",
  what_went_wrong: "the fix renamed the helper but left the magic number",
});

test("valid-verdict-passes", () => {
  assert.deepEqual(violations(schema, valid()), []);
});

for (const verdict of ["maybe", "survives"]) {
  test(`verdict-outside-three-values-fails (${verdict})`, () => {
    assert.ok(violations(schema, { ...valid(), verdict }).some((v) => v.startsWith("$.verdict")), `verdict "${verdict}" should be rejected on $.verdict`);
  });
}

for (const verdict of ["better", "wrong-direction", "broke-something"]) {
  test(`verdict-in-three-values-passes (${verdict})`, () => {
    assert.deepEqual(violations(schema, { ...valid(), verdict }), [], `verdict "${verdict}" should be accepted`);
  });
}

for (const mistake of ["tests-red", "typo"]) {
  test(`mistake-outside-pinned-list-fails (${mistake})`, () => {
    assert.ok(violations(schema, { ...valid(), mistake }).some((v) => v.startsWith("$.mistake")), `mistake "${mistake}" should be rejected on $.mistake`);
  });
}

for (const mistake of ["none", "missed-finding", "changed-behaviour", "out-of-scope", "weakened-tests", "new-defect", "other"]) {
  test(`mistake-in-pinned-list-passes (${mistake})`, () => {
    assert.deepEqual(violations(schema, { ...valid(), mistake }), [], `mistake "${mistake}" should be accepted`);
  });
}
