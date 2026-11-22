import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A lab run's human met about ten permission prompts before the first real question: compound Bash inspections from the
// main context and from an agent (`cd ... && ls ...; cat ...`, `find ... && cat $(find ...)`). The tool rule lives once in
// contracts/agent-config.yaml, in the focus warning every agent carries, and the main context's skills carry it word for word.
const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const TOOL_RULE = /\nfocus_warning:\n {2}content: \|\n[\s\S]*?\n {4}(Look at files with Read[^\n]*)\n/.exec(read("contracts", "agent-config.yaml"))[1];

test("the canonical tool rule names the shapes that prompted", () => {
  for (const shape of ["Look at files with Read.", "`&&`", "`;`", "`|`", "`$(...)`", "`cd`", "environment variable"]) assert.ok(TOOL_RULE.includes(shape), shape);
});

// Some Claude Code builds leave Glob and Grep out of the tool set and search through Bash's find and grep instead: a session
// that reached for Glob got "No such tool available". The rule names the fallback, still one plain command.
test("the tool rule falls back to one plain find or grep when Glob and Grep are missing", () => {
  for (const shape of ["Glob and Grep when they exist", "one plain `find` or `grep` Bash command"]) assert.ok(TOOL_RULE.includes(shape), shape);
});

// Every agent file carries the focus warning, and with it the tool rule.
test("every agent file carries the tool rule", () => {
  for (const file of readdirSync(join(ROOT, "agents"))) assert.ok(read("agents", file).includes(TOOL_RULE), `agents/${file} lacks the tool rule`);
});

// The gate lets the lens, refuter, synthesizer and course checker use only Read, Grep and Glob (Task 80), so on a build with no
// Glob or Grep they cannot search. Their own rule, said once in the contract, tells them to read the files their input names
// instead of a Bash call the gate denies; their definitions and the stage prompts carry it word for word.
const CONFINED_RULE = /\nconfined_tool_rule:\n {2}content: \|\n {4}([^\n]*)\n/.exec(read("contracts", "agent-config.yaml"))?.[1];
const CONFINED_AGENTS = ["lens", "refuter", "synthesizer", "course-checker"];

test("the confined agents carry the read-only tool rule, which names no Bash command", () => {
  assert.ok(CONFINED_RULE, "contracts/agent-config.yaml has confined_tool_rule");
  assert.match(CONFINED_RULE, /no Bash/);
  assert.doesNotMatch(CONFINED_RULE, /Bash command/);
  for (const name of CONFINED_AGENTS) assert.ok(read("agents", `${name}.md`).includes(CONFINED_RULE), `agents/${name}.md lacks the read-only tool rule`);
  assert.ok(read("workflows-src", "shared", "prompt-data.mjs").includes(`const CONFINED_TOOL_RULE = '${CONFINED_RULE}';`), "prompt-data.mjs holds the canonical text");
});

// The skills the main context runs during /pairingbuddy:code.
for (const skill of ["coding", "curating-guidance", "setting-up-spike"]) {
  test(`the ${skill} skill carries the tool rule`, () => {
    assert.ok(read("skills", skill, "SKILL.md").includes(TOOL_RULE), `skills/${skill}/SKILL.md lacks: ${TOOL_RULE}`);
  });
}

// Every agent a stage spawns gets the rule in its prompt too, through the one wrapper all stage code calls.
const SOURCES = ["shared", "stages"].flatMap((dir) => readdirSync(join(ROOT, "workflows-src", dir)).map((file) => join("workflows-src", dir, file)));

test("stage code spawns agents only through pbAgent", () => {
  for (const file of SOURCES) {
    const direct = read(file).split("\n").filter((line) => /(?<![\w.])agent(?:\(|\s*[,})])/.test(line) && !/^\s*\/\//.test(line) && !line.includes("agent(`${toolRuleFor(options?.agentType)}\\n${PATH_RULE}\\n\\n${prompt}`"));
    assert.deepEqual(direct, [], `${file} calls agent() directly`);
  }
});

test("the workflow prompts carry the canonical tool rule", () => {
  assert.ok(read("workflows-src", "shared", "prompt-data.mjs").includes(`const TOOL_RULE = '${TOOL_RULE}';`), "prompt-data.mjs holds the canonical text");
  for (const file of readdirSync(join(ROOT, "workflows"))) assert.ok(read("workflows", file).includes(TOOL_RULE), `workflows/${file} lacks the tool rule`);
});
