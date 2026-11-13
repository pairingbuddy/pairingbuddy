import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Shared extractors for skills/coding/SKILL.md: the workflow pseudocode and the Migrated-Types Router section, plus
// sentence-level matching so a test pins one claim to one sentence.

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

export const skill = () => readFileSync(join(ROOT, "skills", "coding", "SKILL.md"), "utf8");
export const pseudocode = () => /## Workflow[\s\S]*?```python\n([\s\S]*?)```/.exec(skill())[1];
export const routerSection = () => /### Migrated-Types Router\n([\s\S]*?)\n## /.exec(skill())[1];

// The Plan Loop section: from its heading up to the next heading. A missing section fails here, saying so.
export const planLoopSection = () => {
  const found = /### Plan Loop\n([\s\S]*?)(?=\n#{2,3} |$)/.exec(skill());
  assert.ok(found, "skills/coding/SKILL.md has no '### Plan Loop' section");
  return found[1];
};

// The router's steps are numbered list items, each a run of sentences. A sentence ends at . ! or ? followed by a space
// and a capital letter or a backtick, so "step 2 and do not run `pb unit open` again." stays whole, and the list markers
// are not sentences of their own.
const listMarker = /^\s*(\d+\.|-)\s+/;
export const sentencesOf = (text) => text.split("\n").map((line) => line.replace(listMarker, "")).flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z`])/)).filter((sentence) => sentence.trim() !== "");

// Every sentence of the text matching all of the patterns (regular expressions only, so each needle is visibly a pattern).
export const sentencesMatching = (text, ...patterns) => sentencesOf(text).filter((sentence) => patterns.every((pattern) => pattern.test(sentence)));

// The sentences that say it, at least one: a claim nobody makes fails here, with what the router does say.
export function sentencesSaying(claim, text, ...patterns) {
  const found = sentencesMatching(text, ...patterns);
  assert.ok(found.length > 0, `no sentence says ${claim} (${patterns.join(" and ")}). The router's sentences:\n${sentencesOf(text).join("\n")}`);
  return found;
}
