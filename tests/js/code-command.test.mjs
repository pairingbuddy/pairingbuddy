import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const command = readFileSync(new URL("../../commands/code.md", import.meta.url), "utf8");
const body = command.split("---").slice(2).join("---");

// "The coding skill" alone sent 6 of 6 S1 sessions to pairingbuddy:code, this command, which loads nothing.
test("the command names the skill to load in full, and where its file is", () => {
  assert.match(body, /`pairingbuddy:coding`/);
  assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/coding\/SKILL\.md/);
});

test("the command warns off itself and the stage workflows, which look like the task's skill", () => {
  assert.match(body, /`pairingbuddy:code` is this text/);
  assert.match(body, /`pairingbuddy:code-\*`/);
});

for (const [file, skill] of [["plan", "planning"], ["design-ux", "designing-ux"]]) {
  const text = readFileSync(new URL(`../../commands/${file}.md`, import.meta.url), "utf8").split("---").slice(2).join("---");

  test(`/${file} names its skill in full, where its file is, and warns off itself`, () => {
    assert.match(text, new RegExp(`\`pairingbuddy:${skill}\``));
    assert.match(text, new RegExp(`\\$\\{CLAUDE_PLUGIN_ROOT\\}/skills/${skill}/SKILL\\.md`));
    assert.match(text, new RegExp(`\`pairingbuddy:${file}\` is this text`));
  });
}

// A skill listing shows the stages too, and 4 of 5 S1 runs loaded one despite the warning in the command.
for (const stage of ["code-config", "code-safety-net"]) {
  test(`${stage} calls itself internal, started by the coding skill`, () => {
    const firstLine = readFileSync(new URL(`../../workflows/${stage}.js`, import.meta.url), "utf8").split("\n")[0];

    assert.match(firstLine, /description: '[^']*internal[^']*started by the coding skill/i);
  });
}

test("the task stays data, inside its block", () => {
  assert.match(body, /<task>\n\$ARGUMENTS\n<\/task>/);
  assert.match(body, /Plugin root: \$\{CLAUDE_PLUGIN_ROOT\}/);
});
