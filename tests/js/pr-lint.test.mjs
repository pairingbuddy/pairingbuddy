// Task 68a: the pure PR lint in shared-node/pr-lint.mjs. lintDraft({ title, body, diffLines, titleTemplate, config })
// returns { ok, failures: [{ rule, text }] }. config is the git-config pr.lint override, merged over contracts/pr-lint.json.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintDraft, loadPrLintDefaults, PrLintConfigRefused } from "../../shared-node/pr-lint.mjs";

const TEMPLATE = "{type}: {summary}";
const TITLE = "feat: add export button";
const BODY = "## Summary\n\nAdds an export button to the report page so a reader can download the table as CSV.\n\n## Impact\n\nReaders get a new button; nothing else changes.\n";
const lint = (draft) => lintDraft({ title: TITLE, body: BODY, diffLines: 40, titleTemplate: TEMPLATE, config: {}, ...draft });
const failureOf = (result, rule) => result.failures.find((failure) => failure.rule === rule);

test("title-form-violation-names-rule-and-title", () => {
  const title = "Added the export button";

  const result = lint({ title });

  assert.equal(result.ok, false);
  assert.equal(failureOf(result, "title-form")?.text, title);
});

test("title-too-long-names-rule-and-title", () => {
  const title = `feat: ${"add a very long summary ".repeat(8).trim()}`;

  const result = lint({ title });

  assert.equal(result.ok, false);
  assert.equal(failureOf(result, "title-length")?.text, title);
});

test("body-over-size-budget-names-rule", () => {
  const body = `${BODY}\n${"This sentence pads the body well past any budget. ".repeat(400)}`;

  const result = lint({ body, diffLines: 3 });

  assert.equal(result.ok, false);
  assert.ok(failureOf(result, "size-budget"), "the size-budget rule is named");
});

test("banned-attribution-names-rule-and-text", () => {
  const trailer = "Co-Authored-By: Some Tool <noreply@example.com>";
  const footer = "Generated with [Some Tool](https://example.com)";

  const result = lint({ body: `${BODY}\n${trailer}\n${footer}\n` });

  assert.equal(result.ok, false);
  const texts = result.failures.filter((failure) => failure.rule === "attribution").map((failure) => failure.text);
  assert.ok(texts.includes(trailer), "the trailer line is named");
  assert.ok(texts.includes(footer), "the footer line is named");
});

test("hype-names-rule-and-text", () => {
  const body = BODY.replace("Adds an export button", "Adds a seamless export button");

  const result = lint({ body });

  assert.equal(result.ok, false);
  assert.equal(failureOf(result, "hype")?.text, "seamless");
});

test("file-inventory-names-rule-and-text", () => {
  const lines = ["- src/export/button.ts", "- src/export/csv.ts", "- tests/export/button.test.ts"];

  const result = lint({ body: `${BODY}\n## Changes\n\n${lines.join("\n")}\n` });

  assert.equal(result.ok, false);
  const text = failureOf(result, "file-inventory")?.text ?? "";
  for (const line of lines) assert.ok(text.includes(line), `${line} is named`);
});

test("expiring-text-names-rule-and-text", () => {
  const cases = [
    ["this PR", "This PR adds the button."],
    ["for now", "The export stays hidden for now."],
    ["TODO:", "TODO: wire the filter."],
    ["Task 68", "Follow-up to Task 68."],
  ];
  for (const [matched, sentence] of cases) {
    const result = lint({ body: `${BODY}\n${sentence}\n` });

    assert.equal(result.ok, false, `${matched} fails`);
    assert.equal(failureOf(result, "expiring-text")?.text.toLowerCase(), matched.toLowerCase(), `${matched} is named`);
  }
});

test("clean-draft-passes", () => {
  const result = lint({});

  assert.deepEqual(result, { ok: true, failures: [] });
});

test("size-budget-grows-with-diff", () => {
  const config = { budget_base_chars: 100, budget_chars_per_diff_line: 10 };
  const body = "x".repeat(500);

  const small = lint({ body, diffLines: 5, config });
  const large = lint({ body, diffLines: 100, config });

  assert.ok(failureOf(small, "size-budget"), "fails on the small diff");
  assert.equal(failureOf(large, "size-budget"), undefined, "passes on the large diff");
});

test("same-draft-and-diff-give-same-result", () => {
  const draft = { title: "Added stuff", body: `${BODY}\nThis PR is currently seamless.\n`, diffLines: 12 };

  const first = lint(draft);
  const second = lint(draft);

  assert.equal(first.ok, false);
  assert.deepEqual(second, first);
});

test("pr-lint-override-changes-a-limit", () => {
  assert.equal(lint({}).ok, true, "passes by default");

  const result = lint({ config: { title_max_length: 20 } });

  assert.equal(result.ok, false);
  assert.equal(failureOf(result, "title-length")?.text, TITLE);
});

test("defaults-contain-no-tracker-or-company-terms", () => {
  const defaults = JSON.stringify(loadPrLintDefaults());
  assert.doesNotMatch(defaults, /jira|atlassian|linear|trello|asana|glimra|anthropic/i);
  const banned = [
    ["co-authored-by", "Co-Authored-By: A Person <a@example.com>"],
    ["claude-session", "Claude-Session: abc123"],
    ["generated with", "Generated with [Some Tool](https://example.com)"],
    ["this pr", "This PR adds the button."],
    ["todo", "TODO: wire the filter."],
    ["wip", "WIP: not ready."],
    ["temporary", "A temporary fix for the parser."],
    ["for now", "Hidden for now."],
    [".pairingbuddy/", "See .pairingbuddy/run for the draft."],
  ];
  for (const [name, sentence] of banned) {
    const result = lint({ body: `${BODY}\n${sentence}\n` });

    assert.equal(result.ok, false, `the defaults ban ${name}`);
  }
});

test("generated-by-mid-sentence-passes", () => {
  const result = lint({ body: `${BODY}\nThe file is generated by the build.\n` });

  assert.deepEqual(result, { ok: true, failures: [] });
});

test("todo-mentioned-in-prose-passes", () => {
  const result = lint({ body: `${BODY}\nRemoves a TODO comment in the parser.\n` });

  assert.deepEqual(result, { ok: true, failures: [] });
});

test("list-override-extends-defaults", () => {
  const config = { hype_words: ["blazing"] };

  const stillBanned = lint({ config, body: BODY.replace("Adds an", "Adds a seamless") });
  const added = lint({ config, body: BODY.replace("Adds an", "Adds a blazing") });

  assert.equal(failureOf(stillBanned, "hype")?.text, "seamless", "a default word still fails");
  assert.equal(failureOf(added, "hype")?.text, "blazing", "the added word fails");
});

test("bad-override-type-refused", () => {
  assert.throws(() => lint({ config: { hype_words: "x" } }), PrLintConfigRefused);
});

test("failure-carries-message-and-line", () => {
  const body = `${BODY}\nThis is a seamless upgrade.\n`;
  const lineOfHype = body.split("\n").findIndex((text) => text.includes("seamless")) + 1;

  const failure = failureOf(lint({ body }), "hype");

  assert.equal(failure?.line, lineOfHype);
  assert.ok(failure?.message && failure.message.length > 0, "the failure says how to fix it");
});

// Scenario: word-count-rule. The word-count rule caps the PR body at body_max_words, counting prose words only.
test("word-count-over-cap-fails", () => {
  const body = Array.from({ length: 251 }, () => "word").join(" ");

  const result = lint({ body });

  assert.equal(result.ok, false);
  const failure = failureOf(result, "word-count");
  assert.equal(failure?.text, "251 words exceeds 250");
  assert.equal(failure?.line, null);
});

test("word-count-exactly-at-cap-passes", () => {
  const body = Array.from({ length: 250 }, () => "word").join(" ");

  const result = lint({ body });

  assert.equal(failureOf(result, "word-count"), undefined);
});

test("word-count-ignores-code-blocks-and-table-rows", () => {
  const body = [
    "one two three",
    "",
    "```",
    "alpha beta gamma delta",
    "epsilon zeta eta theta",
    "```",
    "",
    "~~~",
    "iota kappa lambda mu",
    "nu xi omicron pi",
    "~~~",
    "",
    "four five",
    "",
    "| first | second |",
    "| --- | --- |",
    "| cell one | cell two |",
  ].join("\n");

  const result = lint({ body, config: { body_max_words: 4 } });

  assert.equal(failureOf(result, "word-count")?.text, "5 words exceeds 4", "only the five prose words are counted");
});

// Scenario: ai-phrase-rule. The ai-phrase rule flags stock AI phrases in the PR body.
const aiPhraseCases = [
  ["worth noting", "It is Worth Noting that the export stays."],
  ["this change introduces", "This change introduces an export."],
  ["in summary", "In summary, readers get a button."],
];
for (const [phrase, sentence] of aiPhraseCases) {
  test(`ai-phrase-${phrase.replaceAll(" ", "-")}-names-phrase-and-line`, () => {
    const body = `${BODY}\n${sentence}\n`;
    const lineOfPhrase = body.split("\n").findIndex((text) => text.includes(sentence)) + 1;

    const result = lint({ body });

    const failure = failureOf(result, "ai-phrase");
    assert.equal(result.ok, false, `${phrase} fails`);
    assert.equal(failure?.text, phrase, `${phrase} is named`);
    assert.equal(failure?.line, lineOfPhrase, `${phrase} is on its body line`);
  });
}

// Late safeguards from a mutation check of the ai-phrase and word-count rules.
const insideLongerWordCases = [
  ["left", "The parser claims to be fast."],
  ["right", "It aims tomorrow at the cache."],
];
for (const [side, sentence] of insideLongerWordCases) {
  test(`phrase-inside-a-longer-word-passes-${side}`, () => {
    const body = `${BODY}\n${sentence}\n`;

    const result = lint({ body });

    assert.equal(failureOf(result, "ai-phrase"), undefined, `${side} side letter keeps the phrase from matching`);
  });
}

test("word-count-and-ai-phrase-failures-carry-a-message", () => {
  const wordCount = failureOf(lint({ config: { body_max_words: 1 } }), "word-count");
  const aiPhrase = failureOf(lint({ body: `${BODY}\nIt is worth noting that the export stays.\n` }), "ai-phrase");

  assert.ok(wordCount?.message, "the word-count failure has a message");
  assert.ok(aiPhrase?.message, "the ai-phrase failure has a message");
});

test("words-split-on-any-whitespace", () => {
  const result = lint({ body: "one\ttwo\tthree\n", config: { body_max_words: 2 } });

  assert.equal(failureOf(result, "word-count")?.text, "3 words exceeds 2");
});
