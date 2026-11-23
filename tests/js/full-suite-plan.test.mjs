// The full-suite plan of each runner, and what counts as a selected run that ran a test (live T4d run: `node --test tests/js`
// ran every .mjs in the folder, helper shims that wait on stdin included, so the safety net's check hung past its timeout).
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { failedRunsText, fullSuitePlans } from "../../shared-node/test-run.mjs";

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function repoWith(files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-full-plan-")));
  tempDirs.push(dir);
  for (const file of files) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
  return dir;
}

const config = (runner) => ({ runners: { r: { test_directory: "tests/js", run_args: [], ...runner } }, default_runner: "r" });

describe("the full-suite plan", () => {
  test("node --test gets the files its file_pattern matches, not the bare folder", () => {
    const root = repoWith(["tests/js/a.test.mjs", "tests/js/deep/b.test.mjs", "tests/js/helper-shim.mjs"]);

    const [plan] = fullSuitePlans(config({ command: "node --test", file_pattern: "*.test.mjs" }), root);

    assert.deepEqual(plan.argv, ["node", "--test", "tests/js/a.test.mjs", "tests/js/deep/b.test.mjs"]);
  });

  test("node --test with no file_pattern keeps the folder, as node itself picks its test files", () => {
    const root = repoWith(["tests/js/a.test.mjs"]);

    const [plan] = fullSuitePlans(config({ command: "node --test" }), root);

    assert.deepEqual(plan.argv, ["node", "--test", "tests/js"]);
  });

  test("pytest keeps the folder, whatever its file_pattern", () => {
    const root = repoWith(["tests/js/test_a.py"]);

    const [plan] = fullSuitePlans(config({ command: "pytest", file_pattern: "test_*.py" }), root);

    assert.deepEqual(plan.argv, ["pytest", "tests/js"]);
  });
});

describe("a failed run, in words", () => {
  const run = (over) => ({ runner: "js", argv: [], exitCode: 1, signal: null, timedOut: false, durationMs: 10, excerpt: "boom", excerptTruncated: false, ...over });

  test("a run that timed out says so by name, with how long it ran", () => {
    const text = failedRunsText([run({ exitCode: null, signal: "SIGKILL", timedOut: true, durationMs: 540_123 })]);

    assert.match(text, /runner js timed out after 540s/, text);
  });

  test("a test's run names the test", () => {
    const text = failedRunsText([run({ timedOut: true, durationMs: 9_600 })], [{ test_id: "t9", test_function: "f9", test_file: "tests/a.mjs" }]);

    assert.match(text, /test t9 \(f9 in tests\/a\.mjs\) timed out after 10s/, text);
  });

  test("a passing run is not named", () => {
    assert.equal(failedRunsText([run({ exitCode: 0 })]), "");
  });
});
