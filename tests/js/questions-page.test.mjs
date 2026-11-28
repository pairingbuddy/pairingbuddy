// The questions page /pb-questions opens: every question set aside for the human, in full, with the command that answers it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderQuestionsPage } from "../../shared-node/questions-page.mjs";
import { PAGE_CSS, pill } from "../../shared-node/page-design.mjs";

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
  assert.ok(text.includes("5 open · T1a Solo"), text);
  assert.ok(text.includes("+3 more, only counted: the report has their text"), "those past the bound are counted");
});

test("the page sends the human to the walk: one plain line, no per-question command, no button and no script", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [question(1), question(2)] } });

  const text = textOf(html);
  assert.ok(text.replaceAll("&quot;", '"').includes('To answer: type /pb-questions in the Claude Code session and choose "Answer them now". You can stop at any question.'), text);
  assert.ok(!html.includes("/pb-questions 2"), "no command per question");
  assert.ok(!/<button|<script/.test(html), "no button, no script");
  assert.ok(text.includes("2. Doubt 2?"), "numbers still shown");
});

test("one list in number order: an answered question stays in its place, folded and dimmed, its answer inside", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [question(1, { answer: "Yes, <always>.", answeredAt: "t" }), question(2)] } });

  assert.ok(!/<summary>\d+ answered<\/summary>/.test(html), "no separate answered group");
  assert.ok(html.indexOf("Doubt 1?") < html.indexOf("Doubt 2?"), "number order kept");
  assert.match(html, /<li class="question answered"><details>\s*<summary>1\. ✓ Answered · Doubt 1\?<\/summary>/, "folded, in place, marked");
  const fold = html.slice(html.indexOf('<li class="question answered">'), html.indexOf("</details>"));
  assert.ok(fold.includes("Yes, &lt;always&gt;."), "the answer inside, escaped");
});

test("plan text never reaches the page as markup, and an old record's whole task text shows as its title", () => {
  const html = renderQuestionsPage({ unit: { unit: "<b>T1a</b>", questions: [question(1, { ambiguity: "<img src=x onerror=alert(1)>?", task: "Task 9: nine\n\n**Goal:** <script>x</script>" })] } });

  assert.ok(!/<img|<b>|<script>x/.test(html), "no tag from the record");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;?"));
  assert.ok(html.includes("Task 9: nine") && !html.includes("Goal:"), "the title only");
});

test("the header counts the answered questions beside the open ones", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [question(1, { answer: "Yes.", answeredAt: "t" }), question(2), question(3)] } });

  assert.ok(textOf(html).includes("▲ 2 open · ✓ 1 answered · T1a"), textOf(html));
});

test("a rework of a unit whose name has a colon still shows the rework's name whole", () => {
  const html = renderQuestionsPage({ unit: { unit: "TB1: Baseline", questions: [
    question(1, { answer: "Yes.", answeredAt: "2026-11-26T14:05:09.000Z", settled: "rework", rework: "Rework 1 in TB1: Baseline: Doubt 1?" }),
  ] } });

  const text = textOf(html);
  assert.ok(text.includes("led to rework: Rework 1 in TB1: Baseline "), text);
  assert.ok(!text.includes("Baseline: Doubt 1?"), text);
});

test("with no open unit or no questions the page says so", () => {
  assert.ok(textOf(renderQuestionsPage({ unit: null })).includes("0 open"));
});

test("an answered question tells when it was answered and, once settled, whether it led to rework", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [
    question(1, { answer: "Drafts.", answeredAt: "2026-11-26T14:05:09.000Z", settled: "rework", rework: "Rework 1 in T1a: Doubt 1?" }),
    question(2, { answer: "Fine.", answeredAt: "2026-11-26T14:06:00.000Z", settled: "keep" }),
    question(3, { answer: "Later.", answeredAt: "2026-11-26T14:07:00.000Z" }),
  ] } });

  const text = textOf(html);
  assert.ok(text.includes("answered 2026-11-26 14:05 UTC · led to rework: Rework 1 in T1a ·") || text.includes("answered 2026-11-26 14:05 UTC · led to rework: Rework 1 in T1a "), text);
  assert.ok(!text.includes("led to rework: Rework 1 in T1a: Doubt 1?"), "the rework's title only, not the question again");
  assert.ok(text.includes("answered 2026-11-26 14:06 UTC · no rework needed"), text);
  assert.ok(text.includes("answered 2026-11-26 14:07 UTC · not yet weighed"), text);
});

test("the questions page wears the shared look: the shared stylesheet, one main column, the counts as pills", () => {
  const html = renderQuestionsPage({ unit: { unit: "T1a", questions: [question(1, { answer: "Yes.", answeredAt: "t" }), question(2), question(3)] } });

  assert.ok(html.includes(PAGE_CSS), "the shared stylesheet, inlined");
  assert.match(html, /<body>\s*<main>[\s\S]*<\/main>\s*<\/body>/);
  assert.ok(html.includes(`${pill("waiting", "2 open")} · ${pill("done", "1 answered")} · T1a`), "open and answered in their states' colours");
});
