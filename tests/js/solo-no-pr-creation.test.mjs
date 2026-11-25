import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/solo-buddy.sh", import.meta.url));

// Task 111: solo-buddy.sh no longer pushes or opens PRs (publish stages own that),
// SOLO_BUDDY_REPORT.md is no longer a PR body, and tests/test_solo_buddy_pr_creation.py is retired.
// Tests whose body is assert.fail("placeholder...") still wait for implement-tests.

test("no-gh-pr-create-in-script", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");

  const found = source.match(/gh\s+pr\s+create/);

  assert.equal(found, null, `solo-buddy.sh must not contain \`gh pr create\`, found: ${found?.[0]}`);
});

test("no-git-push-in-script", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");

  const found = source.match(/git\s+push/);

  assert.equal(found, null, `solo-buddy.sh must not contain \`git push\`, found: ${found?.[0]}`);
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
