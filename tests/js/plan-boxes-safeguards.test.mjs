// Safeguards for shared-node/plan-boxes.mjs: a PR: line already under the unit heading is replaced, not stacked, and
// replaceFile keeps the mode of the file it replaces.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceFile, withPrLine } from "../../shared-node/plan-boxes.mjs";

test("pr-line-under-the-heading-is-replaced", () => {
  const text = "## Unit A\nPR: https://example.test/pr/1\n- [ ] Task 1\n";

  assert.equal(withPrLine(text, "Unit A", "PR: https://example.test/pr/2"), "## Unit A\nPR: https://example.test/pr/2\n- [ ] Task 1\n");
});

test("pr-line-is-added-when-none-is-there", () => {
  assert.equal(withPrLine("## Unit A\n- [ ] Task 1\n", "Unit A", "PR: https://example.test/pr/2"), "## Unit A\nPR: https://example.test/pr/2\n- [ ] Task 1\n");
});

test("replace-file-keeps-the-existing-mode", () => {
  const file = join(mkdtempSync(join(tmpdir(), "plan-boxes-")), "plan.md");
  writeFileSync(file, "old\n");
  chmodSync(file, 0o600);

  replaceFile(file, "new\n");

  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readFileSync(file, "utf8"), "new\n");
});
