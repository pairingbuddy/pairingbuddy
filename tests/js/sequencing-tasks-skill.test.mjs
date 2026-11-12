import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sentencesSaying } from "./skill-router.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const skillText = () => readFileSync(join(ROOT, "skills", "sequencing-tasks", "SKILL.md"), "utf8");

test("skill-documents-human-marker", () => {
  const text = skillText();

  sentencesSaying("a task whose title starts `[HUMAN]` is a human task", text, /`\[HUMAN\]`/, /title/i, /human task/i);
  sentencesSaying("the marker may follow `Task N:`", text, /`\[HUMAN\]`/, /`Task N:`/);
  sentencesSaying("no agent runs a human task", text, /human task/i, /no agent/i, /run/i);
  sentencesSaying("`pb plan next` stops at a human task and prints its steps", text, /`pb plan next`/, /stops/i, /human task/i, /steps/i);
  sentencesSaying("only a person ticks a human task", text, /only a person/i, /tick/i);
});
