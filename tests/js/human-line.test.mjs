// Scenario human-line: the ! line a human types is short, so a paste never breaks it across lines (recovery drill: the adopt
// line held the repo's and the plugin's absolute paths and broke on paste). pb keeps a shim at <root>/.pairingbuddy/bin/pb.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureShim, humanCommand } from "../../shared-node/verbs.mjs";

const projectRoot = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "human-line-")));
  mkdirSync(join(root, ".pairingbuddy"));
  return root;
};

test("the human line names the project's shim, not the absolute paths", () => {
  const root = projectRoot();
  ensureShim(root);

  assert.equal(humanCommand(root, "adopt"), "!.pairingbuddy/bin/pb human adopt");
});

test("the shim runs this plugin's CLI from the project root, from wherever it is called", () => {
  const root = projectRoot();
  ensureShim(root);

  const result = spawnSync(join(root, ".pairingbuddy", "bin", "pb"), ["human", "adopt"], { cwd: tmpdir(), encoding: "utf8" });

  assert.match(result.stderr, /no run is open: nothing to adopt/, result.stderr);
});

test("with no shim for this plugin, the line is the long one that works from anywhere", () => {
  const root = projectRoot();

  assert.match(humanCommand(root, "adopt"), /^!cd \S+ && node \S+pb\.mjs human adopt$/);
});
