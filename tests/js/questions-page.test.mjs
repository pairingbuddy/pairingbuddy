// The questions page /pb-answer opens: every question set aside for the human, in full, with the command that answers it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderQuestionsPage } from "../../shared-node/questions-page.mjs";

const question = (n, extra = {}) => ({ gate: "G:task-end", task: `Task ${n}: t${n}`, step: "a reviewer", ambiguity: `Doubt ${n}?`, ...extra });
const textOf = (html) => html.replace(/<(script|style)>[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("each open question shows its number, its task's title, who raised it, its full text and the command that answers it", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [question(1), question(2)] } });

  const text = textOf(html);
  assert.ok(text.includes("1. Doubt 1?"), text);
  assert.ok(text.includes("Task 1: t1"), "the task's title");
  assert.ok(text.includes("a reviewer at G:task-end"), "the step and gate that raised it");
  assert.ok(html.includes("<code>/pb-answer 2 </code>"), "the command, as text, works with no script");
});

test("the header counts the open questions, names the unit, and says how to answer and when an answer takes effect", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a Solo", questions: [question(1), question(2)], questionsMore: 3 } });

  const text = textOf(html);
  assert.ok(text.includes("5 questions for you · T1a Solo"), text);
  assert.ok(text.includes("Answer in the session: /pb-answer <number> <your answer>. It reaches the next step that starts."), text);
  assert.ok(text.includes("+3 more, only counted: the report has their text"), "those past the bound are counted");
});

test("each open question has a Copy answer command button that only the page's own script shows", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [question(1), question(2)] } });

  assert.match(html, /<button type="button" class="copy" data-command="\/pb-answer 2 " hidden>Copy answer command<\/button>/);
  const script = html.match(/<script>([^<]*)<\/script>/)?.[1] ?? "";
  assert.ok(script.includes('removeAttribute("hidden")') && script.includes("navigator.clipboard.writeText(b.dataset.command)"), "the script shows the buttons and copies");
});

test("answered questions sit below in one folded group, each with its answer", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [question(1, { answer: "Yes, <always>.", answeredAt: "t" }), question(2)] } });

  assert.match(html, /<details class="answered">\s*<summary>1 answered<\/summary>/, "folded, counted");
  const fold = html.slice(html.indexOf('<details class="answered">'));
  assert.ok(fold.includes("1. Doubt 1?") && fold.includes("Yes, &lt;always&gt;."), "the question with its answer, escaped");
  assert.ok(html.indexOf("2. Doubt 2?") < html.indexOf('<details class="answered">'), "open questions come first");
});

test("plan text never reaches the page as markup, and an old record's whole task text shows as its title", () => {
  const html = renderQuestionsPage({ unit: { unit: "<b>T1a</b>", questions: [question(1, { ambiguity: "<img src=x onerror=alert(1)>?", task: "Task 9: nine\n\n**Goal:** <script>x</script>" })] } });

  assert.ok(!/<img|<b>|<script>x/.test(html), "no tag from the record");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;?"));
  assert.ok(html.includes("Task 9: nine") && !html.includes("Goal:"), "the title only");
});

test("with no open unit or no questions the page says so", () => {
  assert.ok(textOf(renderQuestionsPage({ unit: null })).includes("0 questions for you"));
});
