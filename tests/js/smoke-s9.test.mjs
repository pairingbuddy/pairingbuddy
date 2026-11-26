import { test } from "node:test";
import assert from "node:assert/strict";
import * as s9 from "../smoke/s9.mjs";

// Placeholders for the pure helpers of the S9 smoke (tests/smoke/s9.mjs, not yet written).
// Each body fails until the real test is written.

const create = (head, base) => ({ argv: ["pr", "create", "--title", "t", "--body-file", "/tmp/b", "--base", base, "--head", head, "--draft"] });

test("s9-two-unit-plan-opens-two-draft-prs", () => {
  const creates = [create("fix/a", "develop"), create("feat/b", "develop")];
  const units = [{ unit: "Unit A", branch: "fix/a" }, { unit: "Unit B", branch: "feat/b" }];

  const result = s9.assertDraftPrs({ creates, units });

  assert.deepEqual(result, { count: 2, heads: ["fix/a", "feat/b"] }, "two draft PRs, one per unit branch, in plan order");
});

test("s9-rejects-a-non-draft-pr", () => {
  assert.fail("not implemented: s9-rejects-a-non-draft-pr");
});

test("s9-rejects-wrong-pr-count", () => {
  assert.fail("not implemented: s9-rejects-wrong-pr-count");
});

test("s9-accepts-report-with-both-pr-links", () => {
  assert.fail("not implemented: s9-accepts-report-with-both-pr-links");
});

test("s9-forced-stop-leaves-commits-local", () => {
  assert.fail("not implemented: s9-forced-stop-leaves-commits-local");
});

test("s9-forced-stop-summary-reports-failure", () => {
  assert.fail("not implemented: s9-forced-stop-summary-reports-failure");
});

test("s9-passes-six-dollar-cap-to-shared-clamp", () => {
  assert.fail("not implemented: s9-passes-six-dollar-cap-to-shared-clamp");
});
