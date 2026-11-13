// Scenario curate-guidance-drops-suggestions: curate-guidance drops task-scoped suggestions at the next task.
// Structural checks over agents/curate-guidance.md and the human-guidance schema. Placeholders only.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const AGENT = new URL("../../agents/curate-guidance.md", import.meta.url);
const SCHEMA = new URL("../../contracts/schemas/human-guidance.schema.json", import.meta.url);

// Body of the section under `heading`, up to the next heading of the same or a higher level.
function sectionOf(markdown, heading) {
  const level = heading.match(/^#+/)[0].length;
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `agents/curate-guidance.md has no "${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => {
    const m = l.match(/^(#+) /);
    return m && m[1].length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

// The DROP bullet and its indented sub-list, up to the next sibling bullet or blank line.
function dropRuleOf(stepText) {
  const lines = stepText.split("\n");
  const start = lines.findIndex((l) => l.includes("`task_specific`"));
  assert.notEqual(start, -1, "Step 2 has no `task_specific` (DROP) bullet");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.trim() === "" || /^\s{0,4}- `/.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

describe("curate-guidance-drops-suggestions", () => {
  test("curate-guidance-drops-task-scoped-entries", () => {
    const agent = readFileSync(AGENT, "utf8");

    const classify = sectionOf(agent, "### Step 2: Main Work");
    const dropRule = dropRuleOf(classify);
    assert.match(dropRule, /task_scoped/, "Step 2 must name task_scoped entries in the task_specific (DROP) rule");
    assert.match(dropRule, /without asking/i, "Step 2 must say task_scoped entries are dropped without asking");

    const silent = sectionOf(agent, "### When No Human Is Here");
    const sentences = silent.split(/(?<=[.!?])\s+/);
    assert.ok(
      sentences.some((sentence) => /task_scoped/.test(sentence) && /\b(remov|drop)/i.test(sentence)),
      "the no-human path must remove task_scoped entries",
    );
    assert.match(silent, /exactly as it stands/, "the no-human path must still leave other entries exactly as they stand");
  });

  test("curate-guidance-input-schema-matches-marking", () => {
    // tests/agents/test_agent_schemas.py already checks inline-schema property parity for human-guidance
    // across every agent. This test stays narrowly about task_scoped: present in both, boolean, optional.
    const agent = readFileSync(AGENT, "utf8");
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));

    const inputBlock = sectionOf(agent, "## Input").match(/```json\n([\s\S]*?)```/)?.[1];
    assert.ok(inputBlock, "agents/curate-guidance.md ## Input has no json block");
    const inline = inputBlock.match(/"task_scoped":\s*"([^"]*)"/)?.[1];
    assert.ok(inline, "the inline Input schema has no task_scoped property");
    assert.match(inline, /^boolean\b/, "the inline task_scoped must be typed boolean");
    assert.match(inline, /optional/, "the inline task_scoped must be marked optional");

    const entry = schema.properties.guidance.items;
    assert.equal(entry.properties?.task_scoped?.type, "boolean", "the canonical task_scoped must be a boolean");
    assert.ok(!(entry.required ?? []).includes("task_scoped"), "the canonical task_scoped must not be required");
  });
});
