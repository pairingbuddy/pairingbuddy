// The unit's "questions for you": the doubts a gate passed by the auto policy deferred instead of stopping the run. They
// live in run/unit.json, so they outlive the task and the run that raised them, and G:publish asks them all at once before
// the unit's pull request goes out. Pure, with no imports, so the mod can load it.

// How many deferred doubts the unit keeps in full. The rest are counted in questionsMore; their text stays in the gate
// records of the kept runs, where the report reads it.
export const QUESTIONS_KEPT = 20;

// A task's title: the first line of its plan text, without bold markers. The ledger keeps the task's whole text, and a
// question names its task by title only; an old record with the whole text reads the same way.
export const taskTitle = (task) => String(task ?? "").trim().split("\n")[0].replace(/\*\*/g, "").trim();

// A doubt's suggested answers, as the dialog offers them: at most OPTIONS_KEPT, each one short line.
export const OPTIONS_KEPT = 3;
const OPTION_MAX = 60;
function suggestedAnswers(options) {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option) => typeof option === "string")
    .map((option) => option.replace(/\s+/g, " ").trim())
    .filter((option) => option !== "")
    .map((option) => (option.length <= OPTION_MAX ? option : `${option.slice(0, OPTION_MAX - 1).trimEnd()}…`))
    .slice(0, OPTIONS_KEPT);
}

// The unit with the gate's deferred doubts added, each with the gate and the task that raised it.
export function addQuestions(unit, { gate, task, doubts }) {
  const kept = Array.isArray(unit.questions) ? unit.questions : [];
  const added = doubts.map(({ step, ambiguity, options }) => {
    const suggested = suggestedAnswers(options);
    return { gate, task: taskTitle(task), step, ambiguity, ...(suggested.length > 0 ? { options: suggested } : {}) };
  });
  const room = Math.max(0, QUESTIONS_KEPT - kept.length);
  const more = (unit.questionsMore ?? 0) + Math.max(0, added.length - room);
  return { ...unit, questions: [...kept, ...added.slice(0, room)], ...(more > 0 ? { questionsMore: more } : {}) };
}

const listed = (unit) => (Array.isArray(unit?.questions) ? unit.questions : []);
const isAnswered = (question) => typeof question.answer === "string";

// The questions still open on a unit: those kept in full and not yet answered, how many more were only counted, and the total.
export function openQuestions(unit) {
  const kept = listed(unit).filter((question) => !isAnswered(question));
  const more = Number.isInteger(unit?.questionsMore) ? unit.questionsMore : 0;
  return { kept, more, count: kept.length + more };
}

// The unit with the human's answer on its question number n (1-based, as /pb-answer lists them). The question stays on the
// list, so G:publish can show it as handled. Throws a QuestionRefused when there is no such question or no answer.
export function answerQuestion(unit, n, text, at) {
  const questions = listed(unit);
  const answer = String(text ?? "").trim();
  if (!Number.isInteger(n) || n < 1 || n > questions.length) throw new QuestionRefused(`there is no question ${n} for you: ${questions.length === 0 ? "none is open" : `they are numbered 1 to ${questions.length}`}`);
  if (answer === "") throw new QuestionRefused("the answer is empty");
  return { ...unit, questions: questions.map((question, i) => (i === n - 1 ? { ...question, answer, answeredAt: at } : question)) };
}

// The questions the human answered that the session has not settled yet, each with its number: at the next task boundary
// the session settles each as rework (the answer changes work already done) or keep (it only guides what comes next).
export const answeredQuestions = (unit) => listed(unit).map((question, i) => ({ ...question, n: i + 1 })).filter((question) => isAnswered(question) && question.settled === undefined);

// The unit with answered question n settled: "keep", or "rework" with the title of the task the rework runs as.
export function settleQuestion(unit, n, how, reworkTitle) {
  const question = listed(unit)[n - 1];
  if (question === undefined || !isAnswered(question)) throw new QuestionRefused(`question ${n} has no answer to settle`);
  if (question.settled !== undefined) throw new QuestionRefused(`question ${n} is already settled as ${question.settled}`);
  const settled = how === "rework" ? { settled: "rework", rework: reworkTitle } : { settled: "keep" };
  return { ...unit, questions: listed(unit).map((q, i) => (i === n - 1 ? { ...q, ...settled } : q)) };
}

// How many rework tasks answers may add to one unit; past that, pb stops and asks the human whether it is a re-plan.
export const REWORKS_PER_UNIT = 3;
const TITLE_MAX = 100;

export const reworkCount = (unit) => listed(unit).filter(({ settled }) => settled === "rework").length;

// Plan text as one line: no line breaks and no bold markers, so it cannot break the plan's markup.
const flat = (text) => String(text).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

// The plan task rework number k of the unit runs as: its title and the markdown pb inserts into the plan.
export function reworkTask(unitName, k, { task, ambiguity, answer }) {
  const title = cut(`Rework ${k} in ${flat(unitName)}: ${flat(ambiguity)}`, TITLE_MAX);
  const text = [
    `- [ ] **${title}**`,
    "",
    "  **Goal:** Change the work already done so it follows the human's answer to a question set aside for them.",
    "",
    `  **The question (from ${taskTitle(task)}):** ${flat(ambiguity)}`,
    "",
    `  **The human's answer:** ${flat(answer)}`,
    "",
    "  **Acceptance criteria:**",
    "  - The work already done follows the answer.",
    "  - The full suite passes.",
    "",
  ].join("\n");
  return { title, text };
}

export class QuestionRefused extends Error {}

// The pane's and band's words for the open questions, or null when there are none.
export const questionsLine = (count) => (count > 0 ? `${count} ${count === 1 ? "question" : "questions"} for you` : null);
