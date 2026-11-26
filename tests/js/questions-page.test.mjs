// The questions page /pb-questions opens: every question set aside for the human, in full, with the command that answers it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderQuestionsPage } from "../../shared-node/questions-page.mjs";

const question = (n, extra = {}) => ({ gate: "G:task-end", task: `Task ${n}: t${n}`, step: "a reviewer", ambiguity: `Doubt ${n}?`, ...extra });
const textOf = (html) => html.replace(/<(script|style)>[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("each open question shows its number, its task's title, who raised it and its full text", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [question(1), question(2)] } });

  const text = textOf(html);
  assert.ok(text.includes("1. Doubt 1?"), text);
  assert.ok(text.includes("Task 1: t1"), "the task's title");
  assert.ok(text.includes("a reviewer at G:task-end"), "the step and gate that raised it");
});

test("the header counts the open questions, names the unit, and says how to answer and when an answer takes effect", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a Solo", questions: [question(1), question(2)], questionsMore: 3 } });

  const text = textOf(html);
  assert.ok(text.includes("5 questions for you · T1a Solo"), text);
  assert.ok(text.includes("+3 more, only counted: the report has their text"), "those past the bound are counted");
});

test("the page sends the human to the walk: one plain line, no per-question command, no button and no script", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [question(1), question(2)] } });

  const text = textOf(html);
  assert.ok(text.includes("To answer, type /pb-questions in the session and choose Answer them now. You can stop whenever you like. An answer reaches the next step that starts."), text);
  assert.ok(!html.includes("/pb-questions 2"), "no command per question");
  assert.ok(!/<button|<script/.test(html), "no button, no script");
  assert.ok(text.includes("2. Doubt 2?"), "numbers still shown");
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

test("an answered question tells when it was answered and, once settled, whether it led to rework", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [
    question(1, { answer: "Drafts.", answeredAt: "2026-11-26T14:05:09.000Z", settled: "rework", rework: "Rework 1 in T1a: Doubt 1?" }),
    question(2, { answer: "Fine.", answeredAt: "2026-11-26T14:06:00.000Z", settled: "keep" }),
    question(3, { answer: "Later.", answeredAt: "2026-11-26T14:07:00.000Z" }),
  ] } });

  const text = textOf(html);
  assert.ok(text.includes("answered 2026-11-26 14:05 UTC · led to rework: Rework 1 in T1a: Doubt 1?"), text);
  assert.ok(text.includes("answered 2026-11-26 14:06 UTC · no rework needed"), text);
  assert.ok(text.includes("answered 2026-11-26 14:07 UTC · not yet weighed"), text);
});
