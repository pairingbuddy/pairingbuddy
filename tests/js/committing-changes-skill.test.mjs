import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const TEXT = readFileSync(join(ROOT, "skills", "committing-changes", "SKILL.md"), "utf8");
const skill = () => TEXT;

const section = (heading) => {
  const lines = TEXT.split("\n");
  const start = lines.findIndex((l) => /^#+\s/.test(l) && heading.test(l));
  assert.ok(start >= 0, `a heading matching ${heading} exists`);
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n");
};
// Body rows of the table under "Commit Step Table" only (header and separator skipped).
const rows = () =>
  section(/commit step table/i)
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
    .slice(2);
const first = (row) => row[0].replace(/[*`]/g, "");
const rest = (row) => row.slice(1).join(" ").toLowerCase();
// Rows whose first cell matches are merged into one, so a step may be split across rows.
const merged = (re) => {
  const hits = rows().filter((r) => re.test(first(r)));
  return hits.length ? ["", ...hits.flatMap((r) => r)] : undefined;
};
const stepRow = {
  red: () => rows().find((r) => /^red$/i.test(first(r))),
  covered: () => rows().find((r) => /^covered red/i.test(first(r))),
  green: () => rows().find((r) => /^green$/i.test(first(r))),
  refactor: () => rows().find((r) => /^refactor/i.test(first(r))),
  docsConfig: () => merged(/docs|config/i),
};
const sentences = () =>
  skill()
    .split(/\n\s*\n|(?<=[.!?])\s+|\n(?=\s*[-*] )/)
    .map((x) => x.replace(/\s+/g, " ").trim());
const NEG = /\b(no|not|never|don't|do not|without|avoid)\b/i;

test("table has all step rows: SKILL.md has a table row for RED, covered RED, GREEN, REFACTOR, and docs or config", () => {
  for (const [name, find] of Object.entries(stepRow)) {
    assert.ok(find(), `a table row exists for step ${name}`);
  }
});

test("table maps steps to types: RED to test, covered RED to test with no GREEN, GREEN to feat or fix, REFACTOR to refactor (test for test-only), docs to docs, config to chore", () => {
  const has = (row, re, msg) => { assert.ok(row, msg); assert.match(rest(row), re, msg); };
  has(stepRow.red(), /\btest\b/, "RED maps to test");
  has(stepRow.covered(), /\btest\b/, "covered RED maps to test");
  has(stepRow.covered(), /no green|without (a )?green|skip/, "covered RED has no GREEN");
  has(stepRow.green(), /\bfeat\b/, "GREEN maps to feat");
  has(stepRow.green(), /\bfix\b/, "GREEN maps to fix");
  has(stepRow.refactor(), /\brefactor\b/, "REFACTOR maps to refactor");
  has(stepRow.refactor(), /\btest\b/, "REFACTOR maps to test for test-only changes");
  has(stepRow.docsConfig(), /\bdocs\b/, "docs step maps to docs");
  has(stepRow.docsConfig(), /\bchore\b/, "config step maps to chore");
});

test("step fixes the type: the step decides the commit type, so structure and behaviour change never share a commit", () => {
  const hit = sentences().find(
    (x) =>
      /\bstep\b/i.test(x) &&
      /(fixes|decides|determines|sets)/i.test(x) &&
      /type/i.test(x) &&
      /structur/i.test(x) &&
      /behaviou?r/i.test(x),
  );
  assert.ok(hit, "a statement ties the step to the type and keeps structure and behaviour apart");
});

test("no change no commit: a step with no change makes no commit", () => {
  const hit = sentences().find((x) => /no change|nothing (changed|to commit)|no (files|diff)/i.test(x) && /commit/i.test(x) && NEG.test(x));
  assert.ok(hit, "a statement says a step with no change makes no commit");
});

test("commit after green stated: 'When to Commit' says to commit once tests pass (GREEN) and after each applied refactor", () => {
  const sec = section(/when to commit/i);
  const marker = sec.search(/\*\*don.t commit when/i);
  assert.ok(marker >= 0, "the section has a labelled don't-commit list");
  const doPart = sec.slice(0, marker);
  assert.match(doPart, /green|tests? pass/i, "commit when tests pass (GREEN)");
  assert.match(doPart, /refactor/i, "commit after refactoring");
});

test("failing tests no commit: the skill says not to commit while tests are failing, with the RED exception stated separately", () => {
  const sec = section(/when to commit/i);
  assert.match(sec, /(don't|do not|never) commit[\s\S]*fail/i, "do not commit while tests fail");
  const exception = sentences().find((x) => /\bred\b/i.test(x) && /(except|exception|unless|allowed|still)/i.test(x) && /fail/i.test(x));
  assert.ok(exception, "the RED exception for failing tests is stated");
});

test("red commit allowed under squash: the skill states a failing-test (RED) commit is allowed because squash merge keeps it off the main branch", () => {
  const hit = sentences().find((x) => /squash/i.test(x) && /\bred\b|failing[- ]test/i.test(x) && /default branch|\bmain\b/i.test(x));
  assert.ok(hit, "a statement allows a RED commit because squash keeps it off the default branch");
});

test("red commits setting named: the skill names the red_commits setting and says a project that does not squash sets red_commits: false", () => {
  const text = skill();
  assert.match(text, /red_commits/, "red_commits is named");
  assert.match(text, /red_commits:\s*false/, "red_commits: false is stated");
  const hit = sentences().find((x) => /red_commits:\s*false/.test(x) && /squash/i.test(x));
  assert.ok(hit, "the false setting is tied to not squashing");
});

test("no AI trailer by default: the skill says not to add a Co-Authored-By or other AI attribution trailer by default", () => {
  const hit = sentences().find((x) => /co-authored-by|attribution|trailer/i.test(x) && NEG.test(x));
  assert.ok(hit, "a statement forbids AI attribution trailers");
});

test("no trailer in examples: no example commit message in the skill contains a Co-Authored-By or generated-with trailer", () => {
  const fences = [...skill().matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(fences.length > 0, "the skill has example code fences");
  for (const f of fences) {
    assert.doesNotMatch(f, /co-authored-by|generated (with|by)/i, "example has no trailer");
  }
});

test("no pairingbuddy paths: SKILL.md does not mention .pairingbuddy, pb checkpoint, pairingbuddy or other plugin-specific paths and commands", () => {
  const text = skill();
  assert.doesNotMatch(text, /pb checkpoint/i, "no pb checkpoint command");
  assert.doesNotMatch(text, /pairingbuddy/i, "no pairingbuddy mention (covers .pairingbuddy paths)");
});

test("no plan decision ids: SKILL.md does not cite internal decision ids (D16, D21) in its text", () => {
  assert.doesNotMatch(skill(), /\bD\d+\b/);
});
