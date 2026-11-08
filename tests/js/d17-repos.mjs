// Scratch repos for the D17 tests, made from plain files: the guard never calls git, so neither does the fixture.
import { after } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = [];
after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

export function scratchDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
}

// A repo with a `sub/` directory, HEAD on `branch` (or at `head`, a raw HEAD line, for a detached HEAD) and `config` as .git/config.
export function fakeRepo({ branch = "feature/x", head = `ref: refs/heads/${branch}`, config = "" } = {}) {
  const dir = scratchDir("d17-repo-");
  mkdirSync(join(dir, ".git", "refs", "heads"), { recursive: true });
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, ".git", "HEAD"), `${head}\n`);
  writeFileSync(join(dir, ".git", "config"), config);
  return dir;
}
