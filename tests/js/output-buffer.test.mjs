// Scenario: one output limit. A child process that prints past Node's 1 MB default dies with ENOBUFS, so every call that
// reads output which grows with the change (git diff, log, numstat, gh, a test suite) takes OUTPUT_MAX_BUFFER.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { OUTPUT_MAX_BUFFER } from "../../shared-node/output-buffer.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${ROOT}${path}`, "utf8");
const READERS = ["cli/pb.mjs", "cli/mod-test-one.mjs", "shared-node/checkpoint.mjs", "shared-node/rollback.mjs", "shared-node/pr-lint-run.mjs"];

test("the shared limit is far past one large diff", () => {
  assert.ok(OUTPUT_MAX_BUFFER >= 256 * 1024 * 1024);
});

test("no reader keeps a buffer size of its own: each takes the shared limit", () => {
  for (const path of READERS) {
    const text = source(path);
    const fail = (what) => `${path} ${what}`;
    assert.ok(!/maxBuffer:\s*\d/.test(text), fail("sets a maxBuffer literal"));
    assert.ok(!/(GIT_BUFFER_BYTES|DIFF_MAX_BUFFER)\s*=/.test(text), fail("defines its own buffer constant"));
    assert.ok(text.includes("OUTPUT_MAX_BUFFER"), fail("does not use OUTPUT_MAX_BUFFER"));
  }
});

test("the git numstat of a PR's diff and pb's gh and quiet git reads take the shared limit", () => {
  assert.ok(/"--numstat"[^\n]*maxBuffer: OUTPUT_MAX_BUFFER/.test(source("shared-node/pr-lint-run.mjs")), "the numstat read");
  const pb = source("cli/pb.mjs");
  assert.ok(/function tryGit[\s\S]{0,200}maxBuffer: OUTPUT_MAX_BUFFER/.test(pb), "tryGit");
  assert.ok(/function gh\(root, args\)[\s\S]{0,300}maxBuffer: OUTPUT_MAX_BUFFER/.test(pb), "gh");
});
