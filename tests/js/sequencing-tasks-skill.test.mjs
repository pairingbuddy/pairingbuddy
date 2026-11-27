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

const agentText = () => readFileSync(join(ROOT, "agents", "sequence-tasks.md"), "utf8");

// The type is settled while planning, with the human at hand, so a run never stops to ask it.
test("skill-requires-a-type-line-in-every-task", () => {
  const text = skillText();

  sentencesSaying("every task carries a `Type:` line", text, /every task/i, /`Type: <type>`/);
  sentencesSaying("the type is one of the five task types", text, /`new_feature`/, /`bug_fix`/, /`refactoring`/, /`config_change`/, /`spike`/);
});

test("sequence-tasks-agent-writes-a-type-line-and-asks-when-unsure", () => {
  const text = agentText();

  sentencesSaying("the agent writes a `Type:` line in every task", text, /every task/i, /`Type: <type>`/);
  sentencesSaying("an unclear type is asked at the human review", text, /unclear/i, /type/i, /Human Review/);
});
