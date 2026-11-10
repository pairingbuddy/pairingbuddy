// Scenario: mistake-check-module. Pure module shared-node/mistake-check.mjs: normalizeApproach, fileOfWhere and mistakeKey.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeApproach, fileOfWhere, mistakeKey } from "../../shared-node/mistake-check.mjs";

test("normalize-approach-collapses-case-and-punctuation", () => {
  const sut = normalizeApproach;

  assert.equal(sut("Extract  the helper!"), "extract the helper", "case, runs of spaces and punctuation collapse to single spaces");
  assert.equal(sut("Extract  the helper!"), sut("extract the helper"), "differently written approaches match");
  assert.equal(sut("  --Rename: foo_bar (v2)--  "), "rename foo bar v2", "every non-alphanumeric run becomes one space and the ends are trimmed");
  assert.equal(sut(null), "", "null gives an empty string");
  assert.equal(sut(undefined), "", "undefined gives an empty string");
});

test("normalize-approach-keeps-non-ascii-letters", () => {
  const sut = normalizeApproach;

  assert.equal(sut("Byt lösning"), "byt lösning", "non-ASCII letters stay part of the word");
  assert.equal(sut("Ändra åäö-fil 2"), "ändra åäö fil 2", "non-ASCII letters and digits stay while punctuation collapses to a space");
});

test("file-of-where-strips-only-the-trailing-line", () => {
  const sut = fileOfWhere;

  assert.equal(sut("dir:1/a.mjs:3"), "dir:1/a.mjs", "a line-like part inside the path stays");
  assert.equal(sut("a.mjs:12:5"), "a.mjs:12", "only the last suffix is removed");
});

test("file-of-where-strips-line-suffix", () => {
  const sut = fileOfWhere;

  assert.equal(sut("src/a.mjs:12"), "src/a.mjs", "a single line suffix is removed");
  assert.equal(sut("src/a.mjs:12-30"), "src/a.mjs", "a line range suffix is removed");
  assert.equal(sut("src/a.mjs"), "src/a.mjs", "a where without a line suffix is unchanged");
});

test("mistake-key-combines-rule-file-and-mistake", () => {
  const sut = mistakeKey;

  assert.equal(sut({ rule: "r1", where: "src/a.mjs:12" }, "new-defect"), JSON.stringify(["r1", "src/a.mjs", "new-defect"]), "the key is the JSON of rule, file and mistake");
  assert.equal(sut({ rule: "r1", where: "src/a.mjs:12" }, "new-defect"), sut({ rule: "r1", where: "src/a.mjs:40-50" }, "new-defect"), "different lines in the same file give the same key");
});
