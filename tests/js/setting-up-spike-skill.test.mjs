import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sentencesMatching, sentencesOf, sentencesSaying } from "./skill-router.mjs";

// The setting-up-spike skill's Conversation section must open with a check whether a human can answer, so a run with no
// human (smoke S5, `claude -p`) skips the chat instead of stopping to ask in it.

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const skillText = () => readFileSync(join(ROOT, "skills", "setting-up-spike", "SKILL.md"), "utf8");
const conversation = () => /\n## Conversation\n([\s\S]*?)\n## /.exec(skillText())[1];
const steps = () => conversation().split("\n").filter((line) => /^\d+\.\s/.test(line));

test("the first step of the Conversation checks whether a human can answer, before any AskUserQuestion", () => {
  const [firstStep] = steps();
  const askIndex = steps().findIndex((step) => /AskUserQuestion/.test(step));

  assert.match(firstStep, /human/i, `the first step is not about a human: ${firstStep}`);
  assert.match(firstStep, /\b(can|able to) answer\b/i, `the first step does not check that a human can answer: ${firstStep}`);
  assert.ok(askIndex !== 0, "the first step already presents things with AskUserQuestion");
});

test("the check counts AskUserQuestion unavailable, claude -p, auto permission mode and PAIRINGBUDDY_SOLO=true as no human", () => {
  const text = conversation();

  sentencesSaying("AskUserQuestion being unavailable means no human", text, /AskUserQuestion/, /(unavailable|not available|no .*tool)/i, /no human/i);
  sentencesSaying("`claude -p` means no human", text, /`claude -p`/, /no human/i);
  sentencesSaying("auto permission mode means no human", text, /auto permission mode/i, /no human/i);
  sentencesSaying("PAIRINGBUDDY_SOLO=true means no human", text, /PAIRINGBUDDY_SOLO=true/, /no human/i);
});

test("with no human the skill skips the conversation, never asks in chat, writes the default files and returns to pb spike setup", () => {
  const text = conversation();

  sentencesSaying("with no human it skips the conversation", text, /no human/i, /skip/i);
  sentencesSaying("it never asks in chat instead", text, /(never|do not|don't) ask/i, /chat/i);
  sentencesSaying("it writes the default setup files", text, /default/i, /(write|writes)/i, /files/i);
  sentencesSaying("it returns so the workflow goes on to `pb spike setup`", text, /return/i, /`pb spike setup`/);
});

test("the skill says it runs after G:type, inside the run", () => {
  sentencesSaying("the skill runs after G:type", skillText(), /after G:type/);
});

test("the refusal list is pb spike setup's", () => {
  sentencesSaying("`pb spike setup` refuses and opens nothing for bad setup files", skillText(), /`pb spike setup`/, /refuses/);
});

test("no sentence says the skill runs before pb unit open or pb run open, or that pb run open refuses for spike files", () => {
  const text = skillText();

  const before = sentencesMatching(text, /before/i, /`pb (unit|run) open`/);
  const runOpenRefuses = sentencesMatching(text, /`pb run open`/, /refuses/);

  assert.deepEqual(before, [], `stale sentences say the skill runs before pb unit/run open:\n${before.join("\n")}`);
  assert.deepEqual(runOpenRefuses, [], `stale sentences say pb run open refuses:\n${runOpenRefuses.join("\n")}`);
});
