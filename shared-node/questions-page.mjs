// The questions page /pb-answer writes under the reports folder and opens: every question set aside for the human on the
// open unit, in full, and those already answered. /pb-answer list opens it to look before answering; /pb-answer walks them.
// Pure; no I/O.
import { escape, STYLE } from "./plan-page.mjs";
import { openQuestions, taskTitle } from "./questions.mjs";

const HOW = "Answer in the session: /pb-answer. It asks them one at a time, and you can stop whenever you like. An answer reaches the next step that starts.";

const QUESTION_STYLE = `.question{margin:0 0 18px}`;

const isAnswered = (question) => typeof question.answer === "string";

function openItem(question, n) {
  const who = [question.step, question.gate].filter(Boolean).join(" at ");
  return `<li class="question">
<p><strong>${n}. ${escape(question.ambiguity)}</strong></p>
<p class="facts">${escape(taskTitle(question.task))}${who ? ` · ${escape(who)}` : ""}</p>
</li>`;
}

const answeredItem = (question, n) => `<li><p>${n}. ${escape(question.ambiguity)}</p><p class="facts">${escape(taskTitle(question.task))}</p><p>Your answer: ${escape(question.answer)}</p></li>`;

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
