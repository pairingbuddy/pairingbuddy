// The unit's "questions for you": the doubts a gate passed by the auto policy deferred instead of stopping the run. They
// live in run/unit.json, so they outlive the task and the run that raised them, and G:publish asks them all at once before
// the unit's pull request goes out. Pure, with no imports, so the mod can load it.

// How many deferred doubts the unit keeps in full. The rest are counted in questionsMore; their text stays in the gate
// records of the kept runs, where the report reads it.
export const QUESTIONS_KEPT = 20;

// The unit with the gate's deferred doubts added, each with the gate and the task that raised it.
export function addQuestions(unit, { gate, task, doubts }) {
  const kept = Array.isArray(unit.questions) ? unit.questions : [];
  const added = doubts.map(({ step, ambiguity }) => ({ gate, task, step, ambiguity }));
  const room = Math.max(0, QUESTIONS_KEPT - kept.length);
  const more = (unit.questionsMore ?? 0) + Math.max(0, added.length - room);
  return { ...unit, questions: [...kept, ...added.slice(0, room)], ...(more > 0 ? { questionsMore: more } : {}) };
}

// The questions still open on a unit: those kept in full, how many more were only counted, and the total.
export function openQuestions(unit) {
  const kept = Array.isArray(unit?.questions) ? unit.questions : [];
  const more = Number.isInteger(unit?.questionsMore) ? unit.questionsMore : 0;
  return { kept, more, count: kept.length + more };
}

// The pane's and band's words for the open questions, or null when there are none.
export const questionsLine = (count) => (count > 0 ? `${count} ${count === 1 ? "question" : "questions"} for you` : null);
