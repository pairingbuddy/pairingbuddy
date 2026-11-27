// The end state the pane leads with once the unit's work is finished: is it done, what was done, does it meet the goal, and
// the pull request. Built from what the run recorded only; what cannot be known is never inferred. Pure; no node: imports.
import { plural } from "./glance.mjs";
import { lensOfFinding } from "./lens-merge.mjs";
import { FINDING_WORDS, cutAtWord, findingGist, findingLines, fit, lensRound, wrapAtWords } from "./lens-round.mjs";

export { wrapAtWords };
import { isPassed } from "./gate-passed.mjs";

const DASH = "—";
const PART_BREAK = " · ";
const SHOWN_FILES = 3;

// The safety-net lens that checks the work against what it was for: a goal lens, or the alignment lens (docs and plan).
const isGoalLens = (id) => typeof id === "string" && /(^|-)goal$|alignment$/.test(id);
// A finding still open once the round ended: the work may not do what was asked.
const OPEN_WORDS = [FINDING_WORDS.toFix, FINDING_WORDS.fixing, FINDING_WORDS.checking, FINDING_WORDS.leftAsIs];

const TASK_END = "G:task-end";
const SAFETY_NET = "code-safety-net";
const PUBLISH_KIND = "publish";

// A test's record cut to the marks the TESTS row reads: passed, or covered by an earlier test.
const testMarks = (record) => ({ ...(record?.green?.passed === true && { green: { passed: true } }), ...(record?.covered?.done === true && { covered: { done: true } }) });

// What the pane keeps of a code run's ledger once the publish run has replaced it: the task, whether its task-end gate
// passed, its tests' marks and how many pass (a covered test passes), and where its safety-net round ran. Null for a publish run or no ledger.
export function codeRunOf(ledger) {
  if (!ledger || typeof ledger !== "object" || ledger.kind === PUBLISH_KIND) return null;
  const records = ledger.tests?.perTest && typeof ledger.tests.perTest === "object" ? ledger.tests.perTest : {};
  const perTest = Object.values(records);
  const stages = [...(Array.isArray(ledger.stages) ? ledger.stages : []), ledger.stage].filter((stage) => stage?.name === SAFETY_NET);
  const safetyNet = stages.at(-1);
  return {
    runId: ledger.runId,
    task: ledger.task,
    taskEndPassed: ledger.gates && typeof ledger.gates === "object" ? isPassed(ledger, TASK_END) : false,
    // A test an earlier one already covered passes too, as the TESTS row counts it.
    testsPassing: perTest.filter((record) => record?.green?.passed === true || record?.covered?.done === true).length,
    perTest: Object.fromEntries(Object.entries(records).map(([id, record]) => [id, testMarks(record)])),
    safetyNet: safetyNet ? { attempt: safetyNet.attempt, startedAt: safetyNet.startedAt } : null,
    rollbacks: Array.isArray(ledger.fixes?.rollbacks) ? ledger.fixes.rollbacks : [],
  };
}

// The code run's safety-net round, from the returns the session recorded, read as over. Undefined when it cannot be known.
export function safetyNetRound({ codeRun, calls = [], spawns = [] }) {
  if (!codeRun?.safetyNet) return undefined;
  const stage = { name: SAFETY_NET, status: "done", attempt: codeRun.safetyNet.attempt, startedAt: codeRun.safetyNet.startedAt };
  return lensRound({ ledger: { stage, fixes: { rollbacks: codeRun.rollbacks ?? [] } }, calls, spawns, ended: true });
}

// codeRun: the unit's last code run as the poller kept it (codeRunOf).
// changed: the paths run/changed.json lists, or null when it does not read.
// pr: what the publish result or the unit record said ({ url?, title?, result? }), or undefined before the publish.
export function endRows({ codeRun, changed, pr } = {}) {
  if (codeRun?.taskEndPassed !== true) return { done: DASH, pr: DASH };
  return { done: doneText(codeRun, changed), pr: prText(pr) };
}

// What pb publish says when it opened nothing, in plain words.
const NOT_OPENED = { local: "kept local", "kept-local": "kept local", skip: "nothing to publish" };

function prText(pr) {
  if (typeof pr?.url === "string" && pr.url !== "") {
    const number = /\/pull\/(\d+)\/?$/.exec(pr.url)?.[1];
    const named = number ? [`#${number}`, pr.title].filter(Boolean).join(" ") : pr.url;
    return `opened${PART_BREAK}${named}`;
  }
  return Object.hasOwn(NOT_OPENED, pr?.result ?? "") ? `not opened${PART_BREAK}${NOT_OPENED[pr.result]}` : DASH;
}

// The review once the work is finished: one summary line, then the findings by their gist.
export function endReviewLines(round, columns = 0) {
  if (!round) return [];
  return [...endReviewSummaryLines(round, columns), ...findingLines(findingsOf(round), columns)];
}

const findingsOf = (round) => (Array.isArray(round.findings) ? round.findings : []);

// The end review's summary line, alone for a short pane.
export function endReviewSummaryLines(round, columns = 0) {
  if (!round) return [];
  const findings = findingsOf(round);
  if (!findings.length) return [{ text: "review: no issues found" }];
  const counted = Object.values(FINDING_WORDS).map((word) => [word, findings.filter((finding) => finding.word === word).length]).filter(([, count]) => count > 0);
  const issues = `review: ${plural(findings.length, "issue")}`;
  // One outcome for all reads as one phrase; several are parts the line folds at when it is too long.
  const summary = counted.length === 1 ? `${issues}, all ${counted[0][0]}` : [issues, ...counted.map(([word, count]) => `${count} ${word}`)].join(PART_BREAK);
  return fit({ text: summary }, columns);
}

// The pull request's title: the last one the pr-draft stage's draft or its redrafts returned; undefined when none was seen.
export function prTitleOf(calls = []) {
  const titled = (Array.isArray(calls) ? calls : []).filter((call) => typeof call?.input?.pb_key === "string" && call.input.pb_key.startsWith("pr-draft.") && typeof call.input.title === "string" && call.input.title !== "");
  return titled.at(-1)?.input.title;
}

function filesText(changed) {
  if (!Array.isArray(changed) || !changed.length) return undefined;
  if (changed.length <= SHOWN_FILES + 1) return changed.join(", ");
  return `${changed.slice(0, SHOWN_FILES).join(", ")} + ${plural(changed.length - SHOWN_FILES, "more file")}`;
}

function doneText(codeRun, changed) {
  const tests = `${plural(codeRun.testsPassing ?? 0, "test")} passing`;
  return [filesText(changed), tests].filter(Boolean).join(PART_BREAK);
}

// The task's first sentence, the goal it was given.
export const firstSentence = (task) => (typeof task === "string" ? task.trim().split(/(?<=[.!?])\s+/)[0] : "");

const OPENERS = { "(": ")", "[": "]", "{": "}" };

// Where the clauses of a text end: each ": ", "; " or ", " outside brackets and backticks, so a comma in `f(a, b)` is not one.
function clauseEnds(text) {
  const ends = [];
  const open = [];
  let code = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "`") code = !code;
    else if (code) continue;
    else if (Object.hasOwn(OPENERS, char)) open.push(OPENERS[char]);
    else if (char === open.at(-1)) open.pop();
    else if (open.length === 0 && i > 0 && ":;,".includes(char) && text[i + 1] === " ") ends.push(i);
  }
  return ends;
}

// A goal's gist told in `room` characters: whole when it fits, else cut at the last clause break (": ", "; ", ", ") that fits,
// else at the last word that fits. Never cut mid-clause when a clause ends in the room; the report holds the whole goal.
export function goalGist(text, room) {
  if (!(room > 0) || [...text].length <= room) return text;
  const head = [...text].slice(0, room + 1).join("");
  const clauseEnd = clauseEnds(head).at(-1);
  return clauseEnd === undefined ? cutAtWord(text, room) : head.slice(0, clauseEnd);
}

// The goal the pane leads with: the task's first sentence, its first line only (a task's context follows a blank line).
export const goalOf = (task) => (typeof task === "string" ? firstSentence(task.trim().split("\n")[0]) : "");

// Text of " · " parts wrapped into lines of at most `room`: whole parts first, a part wider than the room at its words.
export function wrapAtParts(text, room) {
  if (!(room > 0) || [...text].length <= room) return [text];
  const lines = [];
  for (const part of text.split(PART_BREAK)) {
    const last = lines.at(-1);
    if (last !== undefined && [...`${last}${PART_BREAK}${part}`].length <= room) lines[lines.length - 1] = `${last}${PART_BREAK}${part}`;
    else lines.push(...wrapAtWords(part, room));
  }
  return lines;
}

// A loud state's bar text on at most `most` lines of `room`, wrapped at words so its head and why share the first line;
// only when it needs more is the last line what is left, cut at a word and marked by "…". No room known gives one line.
export function barLines(text, room, most) {
  if (!(room > 0)) return [text];
  const lines = wrapAtWords(text, room);
  if (lines.length <= most) return lines;
  const rest = lines.slice(most - 1).join(" ");
  return [...lines.slice(0, most - 1), `${cutAtWord(rest, room - 1)}…`];
}

// The goal on at most `most` lines of `room`: wrapped, and only when it needs more, its last line cut at a clause break or
// a word (goalGist). The report holds the whole task.
export function goalLines(goal, room, most = 2) {
  const text = goal.trim().replace(/\s+/g, " ");
  const lines = wrapAtWords(text, room);
  if (lines.length <= most) return lines;
  const head = lines.slice(0, most - 1);
  // Each wrapped line is the text's next run of characters, then a space where it wrapped at one.
  const used = head.reduce((at, line) => at + line.length + (text[at + line.length] === " " ? 1 : 0), 0);
  return [...head, goalGist(text.slice(used), room)];
}

// Met only on a recorded verdict: the task-end gate passed (checked by the caller) and the goal lens returned with no finding
// still open. A goal lens that did not return, or a round that is not known, gives no verdict: undefined, so STATUS says
// nothing of the goal (the human saw the goal check at the sign-off).
function goalText(codeRun, round) {
  const lens = round?.lenses?.find(({ id }) => isGoalLens(id));
  if (lens?.state !== "returned") return undefined;
  const open = round.findings.find((finding) => (Array.isArray(finding.ids) ? finding.ids : [finding.id]).some((id) => isGoalLens(lensOfFinding({ id }))) && OPEN_WORDS.includes(finding.word));
  return open ? `${IN_DOUBT}: ${findingGist(open)}` : MET;
}

const MET = "met";
const IN_DOUBT = "in doubt";

// The pull request's fate in a few words for the STATUS row, or undefined while it is not known.
function prOutcome(pr) {
  if (typeof pr?.url === "string" && pr.url !== "") {
    const number = /\/pull\/(\d+)\/?$/.exec(pr.url)?.[1];
    return number ? `PR #${number} opened` : "PR opened";
  }
  return Object.hasOwn(NOT_OPENED, pr?.result ?? "") ? NOT_OPENED[pr.result] : undefined;
}

// The call to action once the unit is done with nothing left to do.
export const READY = "ready for your next task";

// The plan's next unit to build: the first with boxes left; undefined when the plan has none left, or there is no plan.
export const nextUnitOf = (plan) => plan?.units?.find((unit) => unit.tasks.some((task) => !task.checked))?.unit;

// What comes once the unit is done: the plan's next unit when it has one left (nextUnit), else that it is ready for the next
// task. STATUS, the band and the native notice all say it so.
export const nextWords = (nextUnit) => (typeof nextUnit === "string" && nextUnit !== "" ? `next in the plan: ${nextUnit}` : READY);

// The one wording for a unit done with nothing left to do, shared by the band and the native notice.
export const doneWords = (nextUnit) => `done · ${nextWords(nextUnit)}`;

// The unit's work is over with nothing left to run: no run is live, the task was signed off, and either the pull request's
// fate is known or no unit is open that would still publish.
export function isUnitDone({ live = false, codeRun, unitOpen = false, pr } = {}) {
  return !live && codeRun?.taskEndPassed === true && (prOutcome(pr) !== undefined || !unitOpen);
}

// What STATUS says after "done" once the unit is done: the goal's verdict, the pull request, and what comes next: the plan's
// next unit when it has one left (nextUnit), else that it is ready for the next task. A goal in doubt leaves the call to
// action out: the doubt is the human's to look at first.
export function doneStatus({ codeRun, round, pr, nextUnit } = {}) {
  const goal = goalText(codeRun, round);
  const doubt = goal?.startsWith(IN_DOUBT);
  return [goal && `goal ${goal}`, prOutcome(pr), doubt ? undefined : nextWords(nextUnit)].filter(Boolean).join(PART_BREAK);
}
