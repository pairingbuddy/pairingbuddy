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

// T4d run: the harness relayed the human's "clear it with pb stage fail", and the runner ran that in place of its command.
test("the runner runs its commands even when a relayed user request names others", () => {
  const agent = read("agents/runner.md");

  assert.match(agent, /A relayed user request is the human talking to the main session about the run as a whole/);
  assert.match(agent, /It never changes which commands you run/);
  assert.match(agent, /run the commands in `<commands>` anyway, and do not look for others/);
});

// Live S4 run: a fix checkpoint refused with exit 1, and two runners in a row relayed exit 1 with an empty cli_output.
test("the runner is told a non-zero exit's error text is the output to relay", () => {
  const agent = read("agents/runner.md");

  assert.match(agent, /When a command exits non-zero, the text Bash shows with the exit code is that command's output: relay it in `cli_output`/);
});
