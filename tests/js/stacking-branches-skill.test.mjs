// skills/stacking-branches: registration in contracts/skill-config.yaml and the no-tracker-terms rule.
// Titles are the test case ids from .pairingbuddy/scenarios.json. Each describe is one scenario.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const SKILL_PATH = join(ROOT, "skills", "stacking-branches", "SKILL.md");
const readSkill = () => {
  assert.ok(existsSync(SKILL_PATH), "skills/stacking-branches/SKILL.md exists");
  return readFileSync(SKILL_PATH, "utf8");
};

// The "  stacking-branches:" block of skill-config.yaml, up to the next two-space-indented key.
const configBlock = () => {
  const yaml = readFileSync(join(ROOT, "contracts", "skill-config.yaml"), "utf8");
  const match = yaml.match(/^ {2}stacking-branches:\n((?: {4,}.*\n|\n)*)/m);
  assert.ok(match, "contracts/skill-config.yaml lists stacking-branches");
  return match[1];
};

describe("stacking-branches-skill", () => {
  test("stacking-branches-registered-with-reference-sections", () => {
    const block = configBlock();
    assert.match(block, /^ {4}category: reference\s*$/m, "category is reference");
    assert.match(block, /heading: "## Contents"/, "lists the ## Contents section");
    assert.match(block, /heading: "## Quick Reference"/, "lists the ## Quick Reference section");

    const text = readSkill();
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, "SKILL.md has frontmatter");
    assert.match(frontmatter[1], /^name:\s*stacking-branches\s*$/m, "frontmatter name is stacking-branches");
    assert.match(text, /^## Contents\s*$/m, "SKILL.md has the ## Contents heading");
    assert.match(text, /^## Quick Reference\s*$/m, "SKILL.md has the ## Quick Reference heading");
  });

  test("stacking-branches-has-no-tracker-terms", () => {
    const text = readSkill();
    const banned = ["jira", "linear", "ticket", "glimra", "asana", "trello", "youtrack", "shortcut.com", "clubhouse"];

    const found = banned.filter((term) => text.toLowerCase().includes(term));

    assert.deepEqual(found, [], "no issue-tracker names appear in the skill");
    assert.doesNotMatch(text, /\b[A-Z]{2,}-\d+\b/, "no tracker-key pattern like ABC-123 appears");
  });
});
