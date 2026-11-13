import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sentencesSaying } from "./skill-router.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const skillText = () => readFileSync(join(ROOT, "skills", "curating-guidance", "SKILL.md"), "utf8");

// The curating-guidance skill carries the same curation rules as agents/curate-guidance.md. Placeholders only; the
// assertions are written one at a time during the RED phase.

test("skill-classifies-and-persists", () => {
  const text = skillText();

  sentencesSaying("it reads human-guidance.json", text, /read/i, /`\.pairingbuddy\/human-guidance\.json`/);
  sentencesSaying("it reads task.json", text, /read/i, /`\.pairingbuddy\/task\.json`/);
  sentencesSaying("it drops task-specific entries", text, /drop/i, /task-specific/i);
  sentencesSaying("it drops task_scoped entries", text, /drop/i, /`task_scoped`/);
  sentencesSaying("it keeps general entries", text, /keep/i, /general/i);
  sentencesSaying("it consolidates similar entries", text, /consolidat/i, /similar/i);
  sentencesSaying("approved entries get persistent true", text, /approved/i, /`"persistent": true`/);
});
test("skill-silent-carry-over-without-human", () => {
  const text = skillText();

  sentencesSaying("it checks first whether a human can answer", text, /first/i, /human/i);
  sentencesSaying("AskUserQuestion being denied means no human", text, /AskUserQuestion/, /no human/i);
  sentencesSaying("`claude -p` means no human", text, /`claude -p`/, /no human/i);
  sentencesSaying("the check reads the gate policy and the entrypoint: auto/ is the auto policy, /sdk-cli is `claude -p`", text, /`auto\/`/, /`\/sdk-cli`/);
  sentencesSaying("the auto policy means no human", text, /auto/i, /policy/i, /no human/i);
  sentencesSaying("Solo means no human", text, /`PAIRINGBUDDY_SOLO`/, /no human|Solo/i);
  sentencesSaying("with no human it carries the guidance over silently", text, /no human/i, /silent/i, /carr/i);
  sentencesSaying("it keeps persistent entries", text, /keep/i, /persistent/i);
  sentencesSaying("it drops task-scoped entries", text, /drop/i, /task.scoped/i);
  sentencesSaying("it asks nothing", text, /ask nothing|never ask|do not ask/i);
  sentencesSaying("it never asks in chat", text, /(never|do not|don't) ask/i, /chat/i);
  sentencesSaying("it returns so the workflow goes on to cleanup", text, /return/i, /cleanup/i);
});
test("skill-reviews-with-human-and-records-feedback", () => {
  const text = skillText();

  sentencesSaying("it presents the proposed carry-over with AskUserQuestion", text, /present/i, /`AskUserQuestion`/);
  sentencesSaying("the proposal shows what it keeps, drops and consolidates", text, /keep/i, /drop/i, /consolidat/i);
  sentencesSaying("the human can add new persistent guidance", text, /add/i, /new/i, /persistent/i);
  sentencesSaying("it loops on feedback", text, /feedback/i, /loop|again|redo/i);
  sentencesSaying("it exits only on explicit approval", text, /explicit/i, /approv/i);
  sentencesSaying("it writes the file only after approval", text, /only/i, /approv/i, /writ/i);
});
