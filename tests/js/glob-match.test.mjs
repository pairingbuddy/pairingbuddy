// Scenario: config-globs. matchesGlob and outsideGlobs decide which files a config_change task may touch.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { matchesGlob, outsideGlobs } from "../../shared-node/glob-match.mjs";

describe("a pattern without a slash", () => {
  test("matches the file name at the repo root", () => {
    assert.equal(matchesGlob("*.json", "package.json"), true);
  });

  test("matches the file name in a nested directory", () => {
    assert.equal(matchesGlob("*.json", "a/b/package.json"), true);
  });

  test("does not match a different file name", () => {
    assert.equal(matchesGlob("*.json", "a/b/package.js"), false);
  });
});

describe("a pattern with a slash", () => {
  test("matches the whole path", () => {
    assert.equal(matchesGlob("config/app.yaml", "config/app.yaml"), true);
  });

  test("does not match the same file name elsewhere", () => {
    assert.equal(matchesGlob("config/app.yaml", "src/config/app.yaml"), false);
  });

  test("ignores a leading slash", () => {
    assert.equal(matchesGlob("/config/app.yaml", "config/app.yaml"), true);
  });
});

describe("wildcards", () => {
  test("* matches within one directory", () => {
    assert.equal(matchesGlob("config/*.yaml", "config/app.yaml"), true);
  });

  test("* does not cross a directory", () => {
    assert.equal(matchesGlob("config/*.yaml", "config/sub/app.yaml"), false);
  });

  test("** crosses directories", () => {
    assert.equal(matchesGlob("config/**/app.yaml", "config/a/b/app.yaml"), true);
  });

  test("**/ also matches zero directories", () => {
    assert.equal(matchesGlob("config/**/app.yaml", "config/app.yaml"), true);
  });

  test("a lone ** matches every path", () => {
    assert.equal(matchesGlob("**", "any/deep/path/file.txt"), true);
  });

  test("? matches one character", () => {
    assert.equal(matchesGlob("file?.txt", "file1.txt"), true);
  });

  test("? does not match zero characters", () => {
    assert.equal(matchesGlob("file?.txt", "file.txt"), false);
  });

  test("? does not match two characters", () => {
    assert.equal(matchesGlob("file?.txt", "file12.txt"), false);
  });

  test("a dot in the pattern is literal", () => {
    assert.equal(matchesGlob("a.json", "aXjson"), false);
  });
});

describe("outsideGlobs", () => {
  test("returns the files no glob covers", () => {
    const outside = outsideGlobs(["*.json", "config/**"], ["package.json", "config/app.yaml", "src/index.js", "README.md"]);

    assert.deepEqual(outside, ["src/index.js", "README.md"]);
  });

  test("returns nothing when every file is covered", () => {
    assert.deepEqual(outsideGlobs(["**"], ["a.txt", "b/c.txt"]), []);
  });

  test("returns every file when there are no globs", () => {
    assert.deepEqual(outsideGlobs([], ["a.txt", "b.txt"]), ["a.txt", "b.txt"]);
  });
});
