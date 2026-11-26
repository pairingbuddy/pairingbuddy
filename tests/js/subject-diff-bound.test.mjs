// Scenario: bounded subject diff. The diff the lenses and the write-up read is kept whole while it is small; past a fixed
// size it becomes the diffstat plus each file's diff cut at a line limit, and says what it left out.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SUBJECT_DIFF_MAX_LINES, SUBJECT_FILE_MAX_LINES, boundDiff } from "../../shared-node/snapshot.mjs";

const fileDiff = (name, lines) => [
  `diff --git a/${name} b/${name}`, "new file mode 100644", "index 0000000..1111111", "--- /dev/null", `+++ b/${name}`, `@@ -0,0 +1,${lines} @@`,
  ...Array.from({ length: lines }, (_, i) => `+${name} line ${i}`),
].join("\n");
const diffOf = (files) => `${files.map(([name, lines]) => fileDiff(name, lines)).join("\n")}\n`;

test("a diff within the bound is kept byte for byte", () => {
  const diff = diffOf([["a.txt", 3], ["b.txt", 5]]);

  assert.equal(boundDiff(diff, " 2 files changed", "abc"), diff);
});

test("past the bound: a note, the diffstat, then each file's diff cut at its line limit, and the whole stays within the bound", () => {
  const files = Array.from({ length: 40 }, (_, n) => [`big-${String(n).padStart(2, "0")}.txt`, 3000]);
  const diff = diffOf(files);
  const stat = " big-00.txt | 3000 +\n 40 files changed, 120000 insertions(+)";

  const bounded = boundDiff(diff, stat, "abc123");

  const lines = bounded.split("\n");
  assert.ok(lines.length <= SUBJECT_DIFF_MAX_LINES + 20, `within the bound, got ${lines.length} lines`);
  assert.match(lines[0], /too big to show whole/, "it opens by saying the diff is cut");
  assert.ok(bounded.includes("git diff abc123..HEAD"), "it names the command that shows the whole diff");
  assert.ok(bounded.indexOf(stat) < bounded.indexOf("diff --git a/big-00.txt"), "the diffstat comes before the first file");
  const first = bounded.slice(bounded.indexOf("diff --git a/big-00.txt"), bounded.indexOf("diff --git a/big-01.txt"));
  assert.ok(first.split("\n").length <= SUBJECT_FILE_MAX_LINES + 3, "one file's diff is cut at the per-file limit");
  assert.match(first, /… 2606 more lines of big-00\.txt/, "the cut says how many lines of that file it left out");
});

test("files past the whole bound are not shown and the end counts them", () => {
  const files = Array.from({ length: 40 }, (_, n) => [`big-${String(n).padStart(2, "0")}.txt`, 3000]);

  const bounded = boundDiff(diffOf(files), " 40 files changed", "abc123");

  const shown = (bounded.match(/^diff --git /gm) ?? []).length;
  assert.ok(shown < 40, "not every file fits");
  assert.ok(bounded.trimEnd().endsWith(`… ${40 - shown} more files, see git diff abc123..HEAD`), `the end counts the rest, got: ${bounded.slice(-120)}`);
});
