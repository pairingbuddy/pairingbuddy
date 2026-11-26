// The questions page /pb-answer writes under the reports folder and opens: every question set aside for the human on the
// open unit, in full, each with the command that answers it. The terminal shows only a few, cut to one line. Pure; no I/O.
import { escape, STYLE } from "./plan-page.mjs";
import { openQuestions, taskTitle } from "./questions.mjs";

const HOW = "Answer in the session: /pb-answer <number> <your answer>. It reaches the next step that starts.";

// Copy answer command: hidden in the markup and shown by the page's own script, so a page whose script does not run shows the
// command as text and no button that does nothing. A copy that fails leaves the command on the page to select by hand.
const COPY_SCRIPT = `<script>(() => { document.querySelectorAll("button.copy").forEach((b) => { b.removeAttribute("hidden"); b.addEventListener("click", () => { navigator.clipboard.writeText(b.dataset.command).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy answer command"; }, 1500); }, () => {}); }); }); })();</script>`;
const COPY_STYLE = `.question{margin:0 0 18px}
.answer button{font:inherit;color:var(--link);background:none;border:1px solid var(--rule);border-radius:4px;padding:1px 8px;margin-left:1ch;cursor:pointer}
.answer button:hover{border-color:var(--link)}`;

const isAnswered = (question) => typeof question.answer === "string";

function openItem(question, n) {
  const who = [question.step, question.gate].filter(Boolean).join(" at ");
  return `<li class="question">
<p><strong>${n}. ${escape(question.ambiguity)}</strong></p>
<p class="facts">${escape(taskTitle(question.task))}${who ? ` · ${escape(who)}` : ""}</p>
<p class="answer"><code>/pb-answer ${n} </code><button type="button" class="copy" data-command="/pb-answer ${n} " hidden>Copy answer command</button></p>
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
${COPY_STYLE}
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
${COPY_SCRIPT}
</body></html>`;
}
