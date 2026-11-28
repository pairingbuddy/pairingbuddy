// The questions page /pb-questions writes under the reports folder and opens: every question set aside for the human on the
// open unit, in full, and those already answered. /pb-questions opens it on See them all first, to look before answering.
// Pure; no I/O.
import { escape, PAGE_CSS, pill } from "./page-design.mjs";
import { openQuestions, taskTitle } from "./questions.mjs";

const HOW = 'To answer: type /pb-questions in the Claude Code session and choose "Answer them now". You can stop at any question.';

// Each question a box in its state's colour: open ones amber (they wait for you), answered ones green and folded.
const QUESTION_STYLE = `header{display:flex;flex-direction:column;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--line)}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.question{--state:var(--amber);border:1px solid var(--line);border-left:4px solid var(--state);background:color-mix(in srgb,var(--state) 7%,var(--surface));border-radius:6px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.question.answered{--state:var(--pass);background:var(--surface)}
.answered summary{color:var(--muted)}
.answered details{display:flex;flex-direction:column;gap:6px}
.answered details[open] summary{margin-bottom:6px;color:var(--fg)}`;

const isAnswered = (question) => typeof question.answer === "string";

function openItem(question, n) {
  const who = [question.step, question.gate].filter(Boolean).join(" at ");
  return `<li class="question">
<p><strong>${n}. ${escape(question.ambiguity)}</strong></p>
<p class="facts">${escape(taskTitle(question.task))}${who ? ` · ${escape(who)}` : ""}</p>
</li>`;
}

// When it was answered, to the minute in UTC, as pb stamps answeredAt; nothing when the stamp does not read as a time.
function whenAnswered(at) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(at ?? ""));
  return match ? `answered ${match[1]} ${match[2]} UTC` : "";
}

// The rework task's name, without the question its title repeats after the unit's name ("Rework 1 in <unit>: <question>").
function reworkName(title, unitName) {
  const text = String(title ?? "");
  const head = /^Rework \d+ in /.exec(text);
  if (!head || !unitName || !text.startsWith(`${head[0]}${unitName}: `)) return text;
  return `${head[0]}${unitName}`;
}

// What came of the answer: the rework task it led to, no rework, or not weighed yet (settled at the next task boundary).
function outcome(question, unitName) {
  if (question.settled === "rework") return `led to rework: ${reworkName(question.rework, unitName)}`.trim();
  if (question.settled === "keep") return "no rework needed";
  return "not yet weighed";
}

// One line of a question, for the folded summary of an answered one.
const oneLine = (text, width = 90) => {
  const line = String(text ?? "").replace(/\s+/g, " ").trim();
  return line.length > width ? `${line.slice(0, width - 1)}…` : line;
};

// An answered question keeps its place in the list, folded and dimmed: opening it shows the question, the answer and what came of it.
const answeredItem = (question, n, unitName) => {
  const facts = [whenAnswered(question.answeredAt), outcome(question, unitName)].filter(Boolean).join(" · ");
  return `<li class="question answered"><details>
<summary>${n}. ✓ Answered · ${escape(oneLine(question.ambiguity))}</summary>
<p>${escape(question.ambiguity)}</p><p class="facts">${escape(taskTitle(question.task))}</p><p>Your answer: ${escape(question.answer)}</p><p class="facts">${escape(facts)}</p>
</details></li>`;
};

// unit: the open unit record (run/unit.json), or null when none is open.
export function renderQuestionsPage({ unit } = {}) {
  const questions = Array.isArray(unit?.questions) ? unit.questions : [];
  const { more, count } = openQuestions(unit);
  const numbered = questions.map((question, i) => ({ question, n: i + 1 }));
  const answeredCount = questions.filter(isAnswered).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Questions for you</title>
<style>
${PAGE_CSS}
${QUESTION_STYLE}
</style></head>
<body>
<main>
<header>
<h1>QUESTIONS FOR YOU</h1>
<p>${pill("waiting", `${count} open`)}${answeredCount > 0 ? ` · ${pill("done", `${answeredCount} answered`)}` : ""}${unit?.unit ? ` · ${escape(unit.unit)}` : ""}</p>
<p>${escape(HOW)}</p>
</header>
<ul>
${numbered.map(({ question, n }) => (isAnswered(question) ? answeredItem(question, n, unit?.unit) : openItem(question, n))).join("\n")}
</ul>
${more > 0 ? `<p class="facts">+${more} more, only counted: the report has their text</p>\n` : ""}</main>
</body></html>`;
}
