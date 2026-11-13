import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULTS } from "../../shared-node/gitconf.mjs";
import { violations } from "./schema-check.mjs";

const SCHEMA_NAME = "git-config.schema.json";
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

// Scenario: git-config-schema (structural level only).

test("schema-accepts-defaults-and-rejects-bad-types", () => {
  const schema = JSON.parse(read(`contracts/schemas/${SCHEMA_NAME}`));
  const config = read("contracts/agent-config.yaml");

  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#", "schema declares the pinned draft-07 version");
  assert.match(config, new RegExp(`^\\s*- ${SCHEMA_NAME.replaceAll(".", "\\.")}\\s*$`, "m"), "schema is registered in agent-config.yaml schemas list");
  assert.deepEqual(violations(schema, DEFAULTS), [], "schema accepts the gitconf DEFAULTS");
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(DEFAULTS).sort(), "schema describes every top-level DEFAULTS field");
  const bad = violations(schema, { ...DEFAULTS, protected_branches: "main" });
  assert.equal(bad.length, 1, "schema rejects protected_branches given as a string");
  assert.match(bad[0], /protected_branches/, "the rejection names protected_branches");
});

test("state-cleanup-keeps-git-config", () => {
  const keepers = ["test-config.json", "doc-config.json", "human-guidance.json"];
  const keepLists = ["skills/coding/SKILL.md", "CLAUDE.md"].flatMap((file) =>
    read(file)
      .split("\n")
      .map((text, i) => ({ where: `${file}:${i + 1}`, text }))
      .filter(({ text }) => /except/i.test(text) && keepers.every((name) => text.includes(name))),
  );

  assert.ok(keepLists.length >= 3, `found the SKILL.md (two) and CLAUDE.md keep-lists, got ${keepLists.length}`);
  for (const { where, text } of keepLists) {
    assert.ok(text.includes("git-config.json"), `${where} keep-list names git-config.json`);
  }
});
