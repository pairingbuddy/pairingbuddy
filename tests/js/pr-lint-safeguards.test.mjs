// Safeguards for the pr.lint config validation in shared-node/pr-lint.mjs: a wrong type is refused with PrLintConfigRefused,
// pattern lists must hold valid regular expressions, and only the *_patterns lists are read as regular expressions.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintDraft, PrLintConfigRefused } from "../../shared-node/pr-lint.mjs";

const lintWith = (config, body = "Adds a button.\n") => lintDraft({ title: "feat: add a button", body, diffLines: 10, titleTemplate: "{type}: {summary}", config });
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

test("ai-phrases-wrong-type-refused", () => {
  assert.throws(() => lintWith({ ai_phrases: "x" }), refusal("pr.lint.ai_phrases must be an array of strings; it extends the default list"));
});

test("body-max-words-override-replaces-default", () => {
  const result = lintWith({ body_max_words: 2 });

  assert.deepEqual(result.failures.map(({ rule, text }) => ({ rule, text })), [{ rule: "word-count", text: "3 words exceeds 2" }]);
});

const aiPhraseTexts = (result) => result.failures.filter(({ rule }) => rule === "ai-phrase").map(({ text }) => text);

test("ai-phrases-override-adds-a-phrase-matched-as-plain-text", () => {
  const result = lintWith({ ai_phrases: ["moves (the) needle a lot"] }, "This moves (the) needle a lot for users.\n");

  assert.deepEqual(aiPhraseTexts(result), ["moves (the) needle a lot"]);
});

test("ai-phrases-override-keeps-the-default-phrases", () => {
  const result = lintWith({ ai_phrases: ["moves (the) needle a lot"] }, "It is worth noting that this is a button.\n");

  assert.deepEqual(aiPhraseTexts(result), ["worth noting"]);
});

test("ai-phrase-ending-in-punctuation-is-matched", () => {
  const result = lintWith({ ai_phrases: ["moves the needle (a lot)"] }, "It moves the needle (a lot).\n");

  assert.deepEqual(aiPhraseTexts(result), ["moves the needle (a lot)"]);
});
