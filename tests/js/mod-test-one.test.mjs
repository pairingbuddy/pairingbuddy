// cli/mod-test-one.mjs: `claude plugin test <dir>` has no name filter, so this runs the suite and speaks for one test.
// A fake `claude` first on PATH prints a canned suite output and exits with a canned code.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HELPER = fileURLToPath(new URL("../../cli/mod-test-one.mjs", import.meta.url));

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const SUITE = [
  "mod/pane.test.tsx:",
  "(pass) the pane opens [12.5ms]",
  "(fail) the pane closes [3ms]",
  "(pass) a row per test: one [1ms]",
  "(pass) a row per test: two [1ms]",
  "",
  "mod/band.test.tsx:",
  "(pass) the pane closes [2ms]",
  "(fail) a row per test: three [1ms]",
  "",
  " 4 pass",
  " 2 fail",
].join("\n");

// A project dir with a fake claude that logs its argv and prints `output`, exiting `code`.
function project({ output = SUITE, code = 1 } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-mod-one-")));
  tempDirs.push(dir);
  const fake = join(dir, "claude");
  writeFileSync(fake, `#!/bin/sh\necho "$@" > ${JSON.stringify(join(dir, "argv.txt"))}\ncat <<'PB_EOF'\n${output}\nPB_EOF\nexit ${code}\n`);
  chmodSync(fake, 0o755);
  return dir;
}

function helper(dir, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [HELPER, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  return { code: status, stdout, stderr };
}

describe("one mod test", () => {
  test("a named test that passes exits 0", () => {
    assert.equal(helper(project(), "mod/pane.test.tsx", "the pane opens").code, 0);
  });

  test("a named test that fails exits 1", () => {
    assert.equal(helper(project(), "mod/pane.test.tsx", "the pane closes").code, 1);
  });

  test("only the named file counts: the same name passing in another file speaks for that file alone", () => {
    assert.equal(helper(project(), "mod/band.test.tsx", "the pane closes").code, 0);
  });

  test("a parametrized test passes when every case passes, and fails when one fails", () => {
    const dir = project();

    assert.equal(helper(dir, "mod/pane.test.tsx", "a row per test").code, 0);
    assert.equal(helper(dir, "mod/band.test.tsx", "a row per test").code, 1);
  });

  test("a name the suite never printed exits 1 and says so", () => {
    const result = helper(project({ code: 0 }), "mod/pane.test.tsx", "no such test");

    assert.equal(result.code, 1);
    assert.match(result.stdout, /no test named "no such test" in mod\/pane\.test\.tsx/);
  });

  test("a name is matched whole, not as a prefix", () => {
    assert.equal(helper(project({ code: 0 }), "mod/pane.test.tsx", "the pane").code, 1);
  });

  test("with no arguments it is the whole suite, with the suite's exit code", () => {
    const dir = project({ code: 3 });

    const result = helper(dir);

    assert.equal(result.code, 3);
    assert.match(result.stdout, /4 pass/);
  });
});
