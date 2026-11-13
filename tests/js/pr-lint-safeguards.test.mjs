// Safeguards for the pr.lint config validation in shared-node/pr-lint.mjs: a wrong type is refused with PrLintConfigRefused,
// pattern lists must hold valid regular expressions, and only the *_patterns lists are read as regular expressions.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintDraft, PrLintConfigRefused } from "../../shared-node/pr-lint.mjs";

const lintWith = (config) => lintDraft({ title: "feat: add a button", body: "Adds a button.\n", diffLines: 10, titleTemplate: "{type}: {summary}", config });
const refusal = (message) => (error) => error instanceof PrLintConfigRefused && error.message === message;

test("pattern-list-with-an-invalid-regex-is-refused", () => {
  assert.throws(() => lintWith({ attribution_patterns: ["(unclosed"] }), refusal("pr.lint.attribution_patterns has a pattern that is not a valid regular expression: (unclosed"));
});

test("word-list-is-not-read-as-regex", () => {
  const result = lintWith({ hype_words: ["(unclosed"] });

  assert.equal(result.ok, true);
});

for (const [label, config] of [["null", null], ["an array", []], ["a string", "strict"]]) {
  test(`config-that-is-${label.replace(/ /g, "-")}-is-refused`, () => {
    assert.throws(() => lintWith(config), refusal("pr.lint must be an object"));
  });
}

for (const [label, value] of [["a string", "word"], ["an array holding a number", ["ok", 3]]]) {
  test(`list-key-holding-${label.replace(/ /g, "-")}-is-refused`, () => {
    assert.throws(() => lintWith({ hype_words: value }), refusal("pr.lint.hype_words must be an array of strings; it extends the default list"));
  });
}

for (const [label, value] of [["negative", -1], ["fractional", 1.5], ["a string", "72"]]) {
  test(`scalar-key-that-is-${label.replace(/ /g, "-")}-is-refused`, () => {
    assert.throws(() => lintWith({ title_max_length: value }), refusal("pr.lint.title_max_length must be a non-negative integer; it replaces the default"));
  });
}

test("scalar-key-of-zero-replaces-the-default", () => {
  const result = lintWith({ title_max_length: 0 });

  assert.deepEqual(result.failures.map(({ rule }) => rule), ["title-length"]);
});
