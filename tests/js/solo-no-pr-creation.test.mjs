import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/solo-buddy.sh", import.meta.url));

// Task 111: solo-buddy.sh no longer pushes or opens PRs (publish stages own that),
// SOLO_BUDDY_REPORT.md is no longer a PR body, and tests/test_solo_buddy_pr_creation.py is retired.
// Placeholders: each body fails until implement-tests writes the real assertion.

test("no-gh-pr-create-in-script", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");

  const matches = source.split("\n").filter((line) => /gh\s+pr\s+create/.test(line));

  assert.deepEqual(matches, [], "solo-buddy.sh must not contain any `gh pr create`; publish stages own PR creation");
});

test("no-git-push-in-script", () => {
  assert.fail("placeholder: not implemented");
});

test("success-run-makes-no-gh-or-push-call", () => {
  assert.fail("placeholder: not implemented");
});

test("exit-code-still-matches-claude", () => {
  assert.fail("placeholder: not implemented");
});

test("report-file-not-passed-as-body", () => {
  assert.fail("placeholder: not implemented");
});

test("exit-summary-has-no-pr-lines", () => {
  assert.fail("placeholder: not implemented");
});

test("pr-creation-test-file-removed", () => {
  assert.fail("placeholder: not implemented");
});

test("other-solo-tests-remain", () => {
  assert.fail("placeholder: not implemented");
});
