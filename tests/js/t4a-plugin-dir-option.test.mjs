import assert from "node:assert/strict";
import { test } from "node:test";

import { REPO_ROOT, claudeCommand } from "../smoke/claude-run.mjs";
import { parseOptions } from "../smoke/s2.mjs";

test("parse-options-plugin-dir", () => {
  const defaults = parseOptions([]);
  const given = parseOptions(["--plugin-dir", "/some/broken/copy", "--type", "bug_fix"]);

  assert.equal(defaults.pluginDir, REPO_ROOT, "the plugin dir defaults to this worktree");
  assert.equal(given.pluginDir, "/some/broken/copy", "--plugin-dir names the plugin dir");
  assert.equal(given.type, "bug_fix", "the other options still parse");
  assert.equal(given.task, defaults.task, "the task is parsed as before");
});

test("claude-command-plugin-dir", () => {
  const flagIndex = (argv) => {
    const i = argv.indexOf("--plugin-dir");
    assert.notEqual(i, -1, `--plugin-dir is missing from: ${argv.join(" ")}`);
    return i;
  };
  const flagValue = (argv) => argv[flagIndex(argv) + 1];
  const withoutFlag = (argv) => argv.toSpliced(flagIndex(argv), 2);

  const defaulted = claudeCommand("do it", 1);
  const given = claudeCommand("do it", 1, "/some/broken/copy");

  assert.equal(flagValue(defaulted), REPO_ROOT, "--plugin-dir defaults to REPO_ROOT");
  assert.equal(flagValue(given), "/some/broken/copy", "--plugin-dir takes the given dir");
  assert.deepEqual(withoutFlag(given), withoutFlag(defaulted), "every other flag is unchanged");
});
