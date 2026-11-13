// Scenario: lens-map-contract. contracts/lenses.json replaces tests/fixtures/lens-map.json; every lens entry names a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lensMapProblems } from "../../shared-node/lenses-contract.mjs";
import { KEY_TOKEN } from "../../shared-node/keys.mjs";
const REAL_LENS_MAP = JSON.parse(readFileSync(new URL("../../contracts/lenses.json", import.meta.url), "utf8"));
const withLightReview = (patch) => ({ ...REAL_LENS_MAP, lightReview: { ...REAL_LENS_MAP.lightReview, ...patch } });

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

test("lenses-json-rows-with-refute-name-caps", () => {
  const isPositiveInt = (n) => Number.isInteger(n) && n > 0;
  const refuteRows = REAL_LENS_MAP.rows.filter((row) => row.refute !== "none");
  const noCaps = { rows: [{ row: "scenarios", stage: "scenarios", lenses: [{ name: "necessity", model: "sonnet" }], refute: "one" }] };

  const problems = lensMapProblems(REAL_LENS_MAP);

  assert.ok(refuteRows.length > 0, "the real lens map has rows that refute");
  assert.deepEqual(problems, [], "the real lens map reports no cap problems");
  assert.match(lensMapProblems(noCaps).join("\n"), /scenarios: .*maxRefuters/, "a refuting row without maxRefuters is reported");
  assert.match(lensMapProblems(noCaps).join("\n"), /scenarios: .*maxFindingsPerLens/, "a refuting row without maxFindingsPerLens is reported");
  for (const row of refuteRows) {
    assert.ok(isPositiveInt(row.maxRefuters), `${row.row} names maxRefuters as a positive integer`);
    assert.ok(isPositiveInt(row.maxFindingsPerLens), `${row.row} names maxFindingsPerLens as a positive integer`);
  }
});

test("A cap of 0 is reported, on a refuting row or a row that only names a cap", () => {
  const zeroCap = (row) => ({ rows: [{ row: "scenarios", stage: "scenarios", lenses: [{ name: "necessity", model: "sonnet" }], ...row }] });

  const refuting = lensMapProblems(zeroCap({ refute: "one", maxRefuters: 3, maxFindingsPerLens: 0 })).join("\n");
  const named = lensMapProblems(zeroCap({ refute: "none", maxFindingsPerLens: 0 })).join("\n");

  assert.match(refuting, /scenarios: maxFindingsPerLens must be a positive integer/);
  assert.match(named, /scenarios: maxFindingsPerLens must be a positive integer/);
  assert.deepEqual(lensMapProblems(zeroCap({ refute: "none" })), [], "a non-refuting row needs no caps");
});

// Scenario: misalignment-empty-corpus. A lens that needs a corpus declares "needsCorpus" as a boolean on its entry.
test("misalignment_needs_corpus_boolean", () => {
  const lensMap = (needsCorpus) => ({ rows: [{ row: "scenarios", stage: "scenarios", lenses: [{ name: "corpus-misalignment", model: "sonnet", needsCorpus }] }] });

  assert.deepEqual(lensMapProblems(lensMap(true)), [], "a boolean true needsCorpus is accepted");
  assert.deepEqual(lensMapProblems(lensMap(false)), [], "a boolean false needsCorpus is accepted");
  assert.match(lensMapProblems(lensMap("yes")).join("\n"), /scenarios: lens corpus-misalignment needsCorpus must be a boolean/, "a non-boolean needsCorpus is reported");
});

test("A lens name that fails the key rule is reported, and every real lens name passes it", () => {
  const named = (name) => ({ rows: [{ row: "scenarios", stage: "scenarios", lenses: [{ name, model: "sonnet" }] }] });

  assert.match(lensMapProblems(named("pyramid level")).join("\n"), /scenarios: lens pyramid level name does not fit the key rule/, "a name with a space is reported");
  assert.match(lensMapProblems(named("PR-unit-fit")).join("\n"), /scenarios: lens PR-unit-fit name does not fit the key rule/, "a name with a capital is reported");
  assert.deepEqual(lensMapProblems(named("pyramid-level")), [], "a kebab-case name passes");
  for (const { lenses } of REAL_LENS_MAP.rows) for (const { name } of lenses) assert.ok(KEY_TOKEN.test(name), `${name} fits the key rule`);
});

// Scenario: light-review-contract. The lightReview block of contracts/lenses.json and its validation.
test("real-block-has-six-focuses-and-passes", () => {
  const { lightReview } = REAL_LENS_MAP;

  assert.ok(lightReview, "the real lens map has a lightReview block");
  assert.equal(lightReview.model, "sonnet", "lightReview runs on sonnet");
  assert.equal(lightReview.maxFocuses, 2, "lightReview picks at most two focuses");
  assert.deepEqual(lightReview.rule, { test: "test-quality", production: "code-smell" }, "the focus rule maps test and production changes");
  assert.deepEqual(
    lightReview.catalog.map(({ name }) => name),
    ["code-smell", "naming-and-domain", "duplication-against-corpus", "test-quality", "test-level", "design-fit"],
    "the catalog holds the six focuses in order",
  );
  for (const { name, brief } of lightReview.catalog) assert.ok(typeof brief === "string" && brief.length > 0, `${name} has a non-empty brief`);
  assert.deepEqual(lensMapProblems(REAL_LENS_MAP), [], "the real lens map has no problems");
});
test("rule-focus-outside-catalog-reported", () => {
  const lensMap = withLightReview({ rule: { ...REAL_LENS_MAP.lightReview.rule, test: "security" } });

  const problems = lensMapProblems(lensMap);

  assert.ok(
    problems.some((problem) => /lightReview: .*security.*catalog/.test(problem)),
    `a rule focus outside the catalog is reported, got: ${JSON.stringify(problems)}`,
  );
});
test("catalog-name-breaking-key-rule-reported", () => {
  const lensMap = withLightReview({ catalog: [...REAL_LENS_MAP.lightReview.catalog, { name: "Code Smell", brief: "x" }] });

  const problems = lensMapProblems(lensMap);

  assert.match(problems.join("\n"), /lightReview: .*Code Smell.*key rule/, `a catalog name that fails the key rule is reported, got: ${JSON.stringify(problems)}`);
});
