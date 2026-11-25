import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const SKILL_DIR = join(ROOT, "skills", "creating-pull-requests");

const filesUnder = (dir) =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? filesUnder(join(dir, name)) : [join(dir, name)]));

test("skill-text-has-no-tracker-or-company-term", () => {
  assert.ok(existsSync(join(SKILL_DIR, "SKILL.md")), "the skill exists");
  const denied = [/jira/i, /glimra/i, /linear/i, /asana/i, /trello/i, /[A-Z]{2,}-\d+/];

  for (const file of filesUnder(SKILL_DIR)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of denied) assert.equal(pattern.test(text), false, `${file} matches ${pattern}`);
  }
});

test("draft-pull-request-model-is-sonnet", () => {
  const config = readFileSync(join(ROOT, "contracts", "agent-config.yaml"), "utf8");

  const entry = config.match(/^ {2}draft-pull-request:\n((?: {4}.*\n|\n)*)/m);
  assert.ok(entry, "draft-pull-request is in agent-config.yaml");
  assert.match(entry[1], /^ {4}model: sonnet$/m);
});

// The drafter is told the lint's rules up front, with the default numbers, so a draft passes the first time (T10a pr-draft:
// the body named a .pairingbuddy/ path, the lint refused it, and the stage stopped).
test("draft-pull-request-instructions-state-the-pr-lint-rules-up-front", () => {
  const agent = readFileSync(join(ROOT, "agents", "draft-pull-request.md"), "utf8");
  const defaults = JSON.parse(readFileSync(join(ROOT, "contracts", "pr-lint.json"), "utf8"));
  const instructions = agent.slice(agent.indexOf("## Instructions"), agent.indexOf("## Output"));

  assert.match(instructions, /`\.pairingbuddy\/`/, "a .pairingbuddy/ path is named as refused");
  assert.ok(instructions.includes(`${defaults.body_max_words} words`), "the body's word cap is named");
  assert.ok(instructions.includes(`${defaults.title_max_length} characters`), "the title's length cap is named");
  for (const term of ["trailer", "task number", "file paths", "this PR"]) assert.ok(instructions.includes(term), `the rule on ${term} is named`);
});
