import { test } from "node:test";
import assert from "node:assert/strict";
import * as s9 from "../smoke/s9.mjs";

// Tests for the pure helpers of the S9 smoke (tests/smoke/s9.mjs).
// Bodies that still say "not implemented" are placeholders and fail until the real test is written.

const draftCreate = (head) => ({ argv: ["pr", "create", "--head", head, "--draft"] });

test("s9-two-unit-plan-opens-two-draft-prs", () => {
  const creates = [draftCreate("feat/b"), draftCreate("fix/a")];
  const units = [{ unit: "Unit A", branch: "fix/a" }, { unit: "Unit B", branch: "feat/b" }];

  const result = s9.summarizeDraftPrs({ creates, units });

  assert.deepEqual(result, { count: 2, heads: ["fix/a", "feat/b"] }, "two draft PRs, heads taken from the units in plan order, not from the order of the creates");
});

test("s9-rejects-a-non-draft-pr", () => {
  const creates = [draftCreate("fix/a"), { argv: ["pr", "create", "--head", "feat/b"] }];
  const units = [{ unit: "Unit A", branch: "fix/a" }, { unit: "Unit B", branch: "feat/b" }];

  assert.throws(() => s9.summarizeDraftPrs({ creates, units }), /Unit B/, "a pr create without --draft is rejected and the error names the unit");
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
