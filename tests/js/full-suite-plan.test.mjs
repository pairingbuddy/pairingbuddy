// The full-suite plan of each runner, and what counts as a selected run that ran a test (live T4d run: `node --test tests/js`
// ran every .mjs in the folder, helper shims that wait on stdin included, so the safety net's check hung past its timeout).
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TestRunRefused, failedRunsText, fullSuitePlans } from "../../shared-node/test-run.mjs";

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

  test("each lint command runs after the tests, as part of the full suite", () => {
    const root = repoWith(["tests/js/test_a.py"]);

    const plans = fullSuitePlans({ ...config({ command: "pytest" }), lint_commands: ["uv run ruff check .", "uv run ruff format --check ."] }, root);

    assert.deepEqual(plans.map(({ runner, argv }) => ({ runner, argv })), [
      { runner: "r", argv: ["pytest", "tests/js"] },
      { runner: "lint", argv: ["uv", "run", "ruff", "check", "."] },
      { runner: "lint", argv: ["uv", "run", "ruff", "format", "--check", "."] },
    ]);
  });

  test("lint_commands that is not a list of commands is refused, naming the field", () => {
    const root = repoWith(["tests/js/test_a.py"]);

    for (const bad of ["ruff check .", [], [""], ["   "], [3]]) {
      assert.throws(() => fullSuitePlans({ ...config({ command: "pytest" }), lint_commands: bad }, root), (e) => e instanceof TestRunRefused && /lint_commands/.test(e.message), JSON.stringify(bad));
    }
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

  test("a failing lint run is named as the lint check it ran", () => {
    const text = failedRunsText([run({ runner: "lint", argv: ["uv", "run", "ruff", "check", "."], excerpt: "E501 line too long" })]);

    assert.match(text, /^lint check `uv run ruff check \.` failed with exit code 1\. Its output:\nE501 line too long$/, text);
  });

  test("a passing run is not named", () => {
    assert.equal(failedRunsText([run({ exitCode: 0 })]), "");
  });

  test("pytest's exit 5 is told as no test collected", () => {
    const text = failedRunsText([run({ runner: "py", argv: ["uv", "run", "pytest", "tests/test_a.py::test_x"], exitCode: 5 })]);

    assert.match(text, /runner py collected no test \(pytest exit code 5\)/, text);
  });
});
