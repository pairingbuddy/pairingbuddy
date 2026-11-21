import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Smoke S1, a config task ("Change port from 8080 to 9090 in app.ini"): the main context opened the unit with --type fix
// before intake, and the classifier then doubted ("fix/app-ini-port-9090 suggests a fix"), so G:type asked a human.
// The branch type is a guess made only to name the branch; classifier, intake prompt and lens are told so.
const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");
const RULE = "The branch name is not evidence of the task type";

for (const file of [["agents", "classify-task.md"], ["workflows-src", "stages", "intake.mjs"], ["workflows", "intake.js"]]) {
  test(`${file.join("/")} says the branch name is not evidence`, () => {
    assert.ok(read(...file).includes(RULE), file.join("/"));
  });
}

test("the classification lens brief says the branch name is not evidence", () => {
  const lenses = JSON.parse(read("contracts", "lenses.json"));
  const lens = lenses.rows.find((row) => row.row === "intake").lenses.find((entry) => entry.name === "classification");
  assert.ok(lens.brief.includes(RULE), lens.brief);
});

test("the coding skill maps the task to the --type of pb unit open, which only names the branch", () => {
  const skill = read("skills", "coding", "SKILL.md");
  for (const pair of ["`chore` for a config change", "`feat` for a new feature", "`fix` for a bug fix", "`refactor` for refactoring", "`spike` for a spike"]) {
    assert.ok(skill.includes(pair), pair);
  }
  assert.ok(skill.includes("The type only names the branch"));
});
