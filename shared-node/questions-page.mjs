// The questions page /pb-questions writes under the reports folder and opens: every question set aside for the human on the
// open unit, in full, and those already answered. /pb-questions opens it on See them all first, to look before answering.
// Pure; no I/O.
import { escape, STYLE } from "./plan-page.mjs";
import { openQuestions, taskTitle } from "./questions.mjs";

const HOW = 'To answer: type /pb-questions in the Claude Code session and choose "Answer them now". You can stop at any question.';

const QUESTION_STYLE = `.question{margin:0 0 18px}`;

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

// What came of the answer: the rework task it led to, no rework, or not weighed yet (settled at the next task boundary).
function outcome(question) {
  if (question.settled === "rework") return `led to rework: ${question.rework ?? ""}`.trim();
  if (question.settled === "keep") return "no rework needed";
  return "not yet weighed";
}

const answeredItem = (question, n) => {
  const facts = [whenAnswered(question.answeredAt), outcome(question)].filter(Boolean).join(" · ");
  return `<li><p>${n}. ${escape(question.ambiguity)}</p><p class="facts">${escape(taskTitle(question.task))}</p><p>Your answer: ${escape(question.answer)}</p><p class="facts">${escape(facts)}</p></li>`;
};

// The questions already answered: one folded group under the open ones, so they stay out of the way.
function answeredFold(answered) {
  if (answered.length === 0) return "";
  return `<details class="answered">
<summary>${answered.length} answered</summary>
<ul>
${answered.map(({ question, n }) => answeredItem(question, n)).join("\n")}
</ul>
</details>
`;
}

// unit: the open unit record (run/unit.json), or null when none is open.
export function renderQuestionsPage({ unit } = {}) {
  const questions = Array.isArray(unit?.questions) ? unit.questions : [];
  const { more, count } = openQuestions(unit);
  const numbered = questions.map((question, i) => ({ question, n: i + 1 }));
  const open = numbered.filter(({ question }) => !isAnswered(question));
  const answered = numbered.filter(({ question }) => isAnswered(question));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Questions for you</title>
<style>
${STYLE}
${QUESTION_STYLE}
</style></head>
<body>
<header>
<h1>QUESTIONS FOR YOU</h1>
<p>${count} ${count === 1 ? "question" : "questions"} for you${unit?.unit ? ` · ${escape(unit.unit)}` : ""}</p>
<p>${escape(HOW)}</p>
</header>
<ul>
${open.map(({ question, n }) => openItem(question, n)).join("\n")}
</ul>
${more > 0 ? `<p class="facts">+${more} more, only counted: the report has their text</p>\n` : ""}${answeredFold(answered)}
</body></html>`;
}
