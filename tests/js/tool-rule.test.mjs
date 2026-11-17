import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A lab run's human met about ten permission prompts before the first real question: compound Bash inspections from the
// main context and from an agent (`cd ... && ls ...; cat ...`, `find ... && cat $(find ...)`). The tool rule lives once in
// contracts/agent-config.yaml, in the focus warning every agent carries, and the main context's skills carry it word for word.
const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const TOOL_RULE = /\nfocus_warning:\n {2}content: \|\n[\s\S]*?\n {4}(Look at files with Read[^\n]*)\n/.exec(read("contracts", "agent-config.yaml"))[1];

test("the canonical tool rule names the shapes that prompted", () => {
  for (const shape of ["Read, Glob and Grep", "`&&`", "`;`", "`|`", "`$(...)`", "`cd`", "environment variable"]) assert.ok(TOOL_RULE.includes(shape), shape);
});

// The skills the main context runs during /pairingbuddy:code.
for (const skill of ["coding", "curating-guidance", "setting-up-spike"]) {
  test(`the ${skill} skill carries the tool rule`, () => {
    assert.ok(read("skills", skill, "SKILL.md").includes(TOOL_RULE), `skills/${skill}/SKILL.md lacks: ${TOOL_RULE}`);
  });
}
