import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGitConfig, DEFAULTS } from "../../shared-node/gitconf.mjs";

// Scenario: git-config-bootstrap (unit level, node:test against shared-node/gitconf.mjs in a temp dir).

test("first-use-writes-d21-defaults", (t) => {
  const root = mkdtempSync(join(tmpdir(), "gitconf-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, ".pairingbuddy", "git-config.json");
  const expected = {
    remote: "origin",
    protected_branches: ["main", "master"],
    branch_template: "{type}/{slug}",
    config_globs: [],
    commit: {
      red_commits: true,
      subject_template: "{type}: {subject}",
      key_pattern: null,
      require_signature: false,
      conventions: [],
    },
    pr: {
      title_template: "{type}: {summary}",
      base_branch: null,
      publish: "pr",
      stack_depth: 3,
      lint: {},
      conventions: [],
    },
  };

  const config = loadGitConfig(root);

  assert.deepEqual(config, expected, "returned config equals the D21 defaults");
  assert.ok(existsSync(file), "git-config.json was written on first use");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), expected, "written file holds the D21 defaults");
  assert.deepEqual(DEFAULTS, expected, "DEFAULTS export equals the D21 defaults");
});

test("existing-file-never-overwritten", (t) => {
  const root = mkdtempSync(join(tmpdir(), "gitconf-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, ".pairingbuddy");
  const file = join(dir, "git-config.json");
  const edited =
    '{\n' +
    '\t"remote":   "upstream",\n' +
    '\t"protected_branches": ["release"],\n' +
    '\t"team_note": "kept by the human",\n' +
    '\t"commit": { "red_commits": false, "subject_template": "{subject}" }\n' +
    '}';
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, edited);

  const config = loadGitConfig(root);

  assert.equal(config.remote, "upstream", "returned remote is the human's value");
  assert.deepEqual(config.protected_branches, ["release"], "returned protected_branches is the human's value");
  assert.equal(config.commit.red_commits, false, "returned nested commit.red_commits is the human's value");
  assert.equal(config.team_note, "kept by the human", "unknown key is preserved in the returned config");
  assert.equal(readFileSync(file, "utf8"), edited, "file bytes are unchanged after loading");
});

function writeConfig(t, contents) {
  const root = mkdtempSync(join(tmpdir(), "gitconf-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, ".pairingbuddy");
  const file = join(dir, "git-config.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, contents);
  return { root, file };
}

test("malformed-json-refused", (t) => {
  const malformed = '{\n  "remote": "upstream",\n  "protected_branches": ["main"\n';
  const { root, file } = writeConfig(t, malformed);

  assert.throws(
    () => loadGitConfig(root),
    (err) => err instanceof Error && err.message.includes("git-config.json") && err.message.includes("not valid JSON"),
    "malformed JSON is refused with a parse-specific message naming the file",
  );
  assert.equal(readFileSync(file, "utf8"), malformed, "malformed file is left byte-identical");
});

test("wrong-typed-field-refused", (t) => {
  const wrongType = '{\n  "remote": "upstream",\n  "protected_branches": "main"\n}\n';
  const { root, file } = writeConfig(t, wrongType);

  assert.throws(
    () => loadGitConfig(root),
    (err) => err instanceof Error && err.message.includes("git-config.json") && err.message.includes("protected_branches"),
    "a wrong-typed known field is refused with a message naming the file and the field",
  );
  assert.equal(readFileSync(file, "utf8"), wrongType, "wrong-typed file is left byte-identical");
});
