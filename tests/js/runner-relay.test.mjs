// The runner relays what pb printed and nothing else (T4d run: it put "$ node .../pb.mjs snapshot" in front of the JSON).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the runner agent is told cli_output holds only what the commands printed, with no command line added", () => {
  const agent = read("agents/runner.md");

  assert.match(agent, /no command line, no `\$` prompt and no words of your own/);
});

test("the runner schema says the same of cli_output", () => {
  const { properties } = JSON.parse(read("contracts/schemas/runner-result.schema.json"));

  assert.match(properties.cli_output.description, /no command line/);
});
