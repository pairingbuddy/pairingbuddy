import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, realpathSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WORKTREE = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const HELPER = "../smoke/broken-plugin.mjs";

const status = () =>
  execFileSync("git", ["status", "--porcelain"], { cwd: WORKTREE, encoding: "utf8" });

test("copy-in-temp-worktree-untouched", async () => {
  const { makeBrokenCopy } = await import(HELPER);
  const before = status();

  const copies = [];

  try {
    copies.push(await makeBrokenCopy());
    copies.push(await makeBrokenCopy());
    const [first, second] = copies;
    const tmp = realpathSync(tmpdir());
    for (const dir of copies) {
      assert.ok(existsSync(dir), `copy exists at ${dir}`);
      assert.ok(realpathSync(dir).startsWith(tmp + sep), `${dir} is under ${tmp}`);
      assert.ok(!realpathSync(dir).startsWith(WORKTREE + sep), `${dir} is outside the worktree`);
    }
    assert.notEqual(first, second, "two calls make separate dirs");
    assert.equal(status(), before, "worktree git status unchanged");
  } finally {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  }
});

const read = (dir, file) => readFileSync(join(dir, "mod", file), "utf8");

const lastNonBlankLine = (source) =>
  source.split("\n").filter((line) => line.trim() !== "").at(-1) ?? "";

describe("copy-mod-fails", () => {
  const dirs = [];
  let helper;
  let loadDir;
  let renderDir;

  const fresh = () => {
    const dir = mkdtempSync(join(tmpdir(), "broken-copy-test-"));
    dirs.push(dir);
    return dir;
  };
  const own = (file) => readFileSync(join(WORKTREE, "mod", file), "utf8");

  before(async () => {
    helper = await import(HELPER);
    for (const file of ["register.tsx", "pane.tsx"]) {
      assert.ok(
        !own(file).includes(helper.BROKEN_MARKER),
        `setup guard: worktree mod/${file} must not contain the marker`,
      );
    }
    loadDir = helper.makeBrokenCopy({ mode: "load", into: fresh() });
    renderDir = helper.makeBrokenCopy({ mode: "render", into: fresh() });
  });

  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  test("exports a non-empty marker", () => {
    assert.ok(
      typeof helper.BROKEN_MARKER === "string" && helper.BROKEN_MARKER.length > 0,
      "marker is exported",
    );
  });

  test("load mode ends register.tsx with a throw carrying the marker", () => {
    const last = lastNonBlankLine(read(loadDir, "register.tsx"));

    assert.ok(last.startsWith("throw new Error("), `last line is a throw: ${last}`);
    assert.ok(last.includes(helper.BROKEN_MARKER), "the throw carries the marker");
  });

  test("render mode leaves register.tsx untouched", () => {
    assert.equal(read(renderDir, "register.tsx"), own("register.tsx"));
  });

  test("render mode makes the Pane body throw with the marker", () => {
    const pane = read(renderDir, "pane.tsx");

    assert.match(pane, /export function Pane\([\s\S]*?\}\)\s*\{\s*throw new Error\(/);
    assert.ok(pane.includes(helper.BROKEN_MARKER), "pane.tsx carries the marker");
  });

  test("an unknown mode is rejected", () => {
    assert.throws(
      () => helper.makeBrokenCopy({ mode: "nope", into: fresh() }),
      /unknown mode|nope/,
      "unknown mode throws",
    );
  });
});

const COMPARED_DIRS = ["hooks", "workflows", "cli", "shared-node", "agents", "skills", "commands", "contracts"];
const BROKEN_FILE = { load: "mod/register.tsx", render: "mod/pane.tsx" };

const filesUnder = (root, dir) => {
  const base = join(root, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
};

describe("copy-hooks-workflows-cli-identical", () => {
  test("every compared dir exists in the worktree and is non-empty", () => {
    for (const dir of [...COMPARED_DIRS, "mod"]) {
      assert.ok(filesUnder(WORKTREE, dir).length > 0, `${dir}/ exists in the worktree and has files`);
    }
  });

  for (const mode of ["load", "render"]) {
    test(`${mode} mode copies everything except the one broken mod file byte for byte`, async () => {
      const { makeBrokenCopy } = await import(HELPER);
      const copy = makeBrokenCopy({ mode, into: mkdtempSync(join(tmpdir(), "broken-copy-identical-")) });
      try {
        const files = [
          ...COMPARED_DIRS.flatMap((dir) => filesUnder(WORKTREE, dir)),
          ".claude-plugin/plugin.json",
          ...filesUnder(WORKTREE, "mod").filter((file) => file !== BROKEN_FILE[mode]),
        ];

        for (const file of files) {
          assert.ok(
            readFileSync(join(WORKTREE, file)).equals(readFileSync(join(copy, file))),
            `${mode}: ${file} is byte-identical`,
          );
        }
        for (const dir of COMPARED_DIRS) {
          assert.deepEqual(filesUnder(copy, dir), filesUnder(WORKTREE, dir), `${mode}: ${dir}/ has the same files`);
        }
        assert.deepEqual(filesUnder(copy, "mod"), filesUnder(WORKTREE, "mod"), `${mode}: mod/ has the same files`);
        assert.notDeepEqual(
          readFileSync(join(copy, BROKEN_FILE[mode])),
          readFileSync(join(WORKTREE, BROKEN_FILE[mode])),
          `${mode}: ${BROKEN_FILE[mode]} differs`,
        );
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    });
  }
});
