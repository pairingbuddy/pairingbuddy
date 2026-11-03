import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isKey } from "../../shared-node/checkpoint.mjs";

// The one input rule (Section 7) on the agents the bug_fix path calls. What these agents produce is the model's, so
// this reads what they are told and what the contract says, and never what a run returned.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const schemaOf = (name) => JSON.parse(read(`contracts/schemas/${name}`));

const CONFIG = read("contracts/agent-config.yaml");
const FILE_FIELDS = ["pb_key", "ambiguity", "commit_subject", "files_changed"];
const AGENTS = [
  { name: "enumerate-scenarios-and-test-cases", paths: ["test_config", "human_guidance"], fields: ["pb_key", "ambiguity", "scenarios"], legacy: ".pairingbuddy/scenarios.json", legacySchema: "scenarios.schema.json" },
  { name: "create-test-placeholders", paths: ["scenarios", "test_config", "human_guidance", "tests", "coverage_report"], fields: [...FILE_FIELDS, "tests"], legacy: ".pairingbuddy/tests.json", legacySchema: "tests.schema.json" },
  { name: "implement-tests", paths: ["tests", "scenarios", "test_config", "human_guidance"], fields: FILE_FIELDS, legacy: ".pairingbuddy/test-state.json", legacySchema: "test-state.schema.json" },
  { name: "implement-code", paths: ["tests", "test_config", "human_guidance"], fields: FILE_FIELDS, legacy: ".pairingbuddy/code-state.json", legacySchema: "code-state.schema.json" },
];

const resultSchema = ({ name }) => `${name}-result.schema.json`;
const textOf = ({ name }) => read(`agents/${name}.md`);
const sectionOf = (text, heading) => {
  const start = text.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `${heading} is there`);
  const next = text.indexOf("\n## ", start + heading.length + 2);
  return next === -1 ? text.slice(start) : text.slice(start, next);
};
const configOf = (name) => {
  const start = CONFIG.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `${name} is in agent-config.yaml`);
  return CONFIG.slice(start + 1).split(/\n\n/)[0];
};
const fieldsOfBlock = (block) => Object.keys(JSON.parse(block));
const pathsOutput = (agent) => /With a `<paths>` block[^\n]*\n\n```json\n([\s\S]*?)\n```/.exec(sectionOf(textOf(agent), "## Output"))?.[1];

for (const agent of AGENTS) {
  test(`${agent.name}: with paths it reads those paths and returns its schema`, () => {
    const input = sectionOf(textOf(agent), "## Input");

    assert.match(input, /With a `<paths>` block in the prompt: read only what the paths name/);
    for (const key of agent.paths) assert.ok(input.includes(`\`${key}\``), `the Input section names the path ${key}`);
    assert.match(input, /return your Output as StructuredOutput/);
    assert.match(input, /`pb_key`/);
  });

  test(`${agent.name}: with no paths it keeps its legacy output`, () => {
    const text = textOf(agent);

    assert.match(sectionOf(text, "## Input"), /With no `<paths>` block: use the legacy flat files below and write the legacy Output/);
    assert.ok(sectionOf(text, "## Output").includes(`\`${agent.legacy}\``), "the legacy Output is still documented");
    assert.ok(configOf(agent.name).includes(`file: ${agent.legacy}`), "the contract still names the legacy file");
    assert.ok(configOf(agent.name).includes(`schema: ${agent.legacySchema}`));
  });

  test(`${agent.name}: the return is exactly the schema, in the agent and in the contract`, () => {
    const schema = schemaOf(resultSchema(agent));

    assert.deepEqual(Object.keys(schema.properties).sort(), [...agent.fields].sort());
    assert.deepEqual([...schema.required].sort(), [...agent.fields].sort(), "every field is required");
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.ambiguity.type, "string");
    assert.deepEqual(fieldsOfBlock(pathsOutput(agent)).sort(), [...agent.fields].sort(), "the inline schema matches");
    assert.match(configOf(agent.name), new RegExp(`schema: ${resultSchema(agent)}\\n\\s+return_only: true`));
    assert.ok(CONFIG.includes(`  - ${resultSchema(agent)}\n`), "the schema is registered");
  });

  test(`${agent.name}: with paths no human is reachable, so doubt goes in the return`, () => {
    assert.match(textOf(agent), /no human is reachable from a stage/i);
    assert.match(textOf(agent), /`ambiguity`/);
  });
}

for (const name of ["create-test-placeholders", "implement-tests", "implement-code"]) {
  test(`${name}: files_changed is repo-relative, for pb checkpoint`, () => {
    const { files_changed: files } = schemaOf(`${name}-result.schema.json`).properties;

    assert.deepEqual(files.items, { type: "string", pattern: "^(?!/)" }, "the rule apply-config-change already keeps");
  });
}

test("the legacy scenarios and tests schemas gain no required field", () => {
  assert.deepEqual(schemaOf("scenarios.schema.json").required, ["scenarios"]);
  assert.deepEqual(schemaOf("tests.schema.json").required, ["tests"]);
  assert.deepEqual(schemaOf("tests.schema.json").properties.tests.items.required, ["test_id", "test_case_id", "scenario_id", "runner_id", "test_file", "test_function"]);
});

// ---------- selectors ----------

const ROW = () => schemaOf("create-test-placeholders-result.schema.json").properties.tests.items;
const fieldPattern = (field) => new RegExp(ROW().properties[field].pattern);

test("a row of the tests artifact holds the legacy fields, each one required and alone", () => {
  const legacy = schemaOf("tests.schema.json").properties.tests.items;

  assert.deepEqual(Object.keys(ROW().properties).sort(), Object.keys(legacy.properties).sort());
  assert.deepEqual(ROW().required, legacy.required);
  assert.equal(ROW().additionalProperties, false, "a row carries no free-text selector");
});

test("a test_id can name a test in a stage key", () => {
  const pattern = fieldPattern("test_id");

  for (const id of ["t1", "login-valid", "a_b"]) {
    assert.match(id, pattern);
    assert.equal(isKey(`code-tdd.implement-tests.${id}.r1.a1`), true);
  }
  for (const id of ["T1", "-x", "a.b", "a b", ""]) assert.doesNotMatch(id, pattern);
});

test("a test_file is a repo-relative file name and cannot read as an option", () => {
  const pattern = fieldPattern("test_file");

  assert.match("tests/test_a.py", pattern);
  for (const file of ["/abs/test_a.py", "-k", "@args", "", "tests/a.py::test_x", "tests/a.py\n-x"]) assert.doesNotMatch(file, pattern);
});

test("a test_function is one name, never a flag or a file::name selector", () => {
  const pattern = fieldPattern("test_function");

  for (const name of ["test_login", "a redo clears the gate record", "test_x[1-a]"]) assert.match(name, pattern);
  for (const name of ["-k", "@args", "", "tests/a.py::test_x", "a\nb"]) assert.doesNotMatch(name, pattern);
});

test("a test_function may be a class path, and :: means nothing else", () => {
  const pattern = fieldPattern("test_function");

  for (const name of ["TestLogin::test_valid", "TestOuter::TestInner::test_valid"]) assert.match(name, pattern);
  for (const name of ["::test_valid", "TestLogin::", "Test Login::test_valid", "TestLogin:::test_valid", "TestLogin::test valid", "a.b::test_valid", "TestLogin::-x", "TestLogin::test_a\nb"]) assert.doesNotMatch(name, pattern);
});

test("the CLI holds the same selector rules as the schema, since a model's return may have skipped it", () => {
  const source = read("shared-node/test-run.mjs");

  for (const field of ["test_file", "test_function"]) assert.ok(source.includes(`/${ROW().properties[field].pattern}/`), `${field} matches the schema pattern`);
});

test("the agent is told the selector rule", () => {
  const text = read("agents/create-test-placeholders.md");

  assert.match(text, /Each row is the selector/);
  assert.match(text, /every test of the task/);
  assert.match(text, /`Class::test_name`/);
});

test("the test config names the selector template, in the schema and in every agent that shows it", () => {
  const { selector_template: template } = schemaOf("test-config.schema.json").properties.runners.additionalProperties.properties;

  assert.equal(template.type, "array");
  assert.equal(template.minItems, 1);
  for (const name of ["create-test-placeholders", "implement-tests", "implement-code"]) assert.match(read(`agents/${name}.md`), /"selector_template"/);
});

test("an agent is told the optional tests path may be missing, and to keep its rows", () => {
  const text = read("agents/create-test-placeholders.md");

  assert.match(text, /`tests` and `coverage_report` are optional/);
  assert.match(text, /keep each row in `tests` exactly as it is/);
});
