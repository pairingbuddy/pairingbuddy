// The end state the pane leads with once the unit's work is finished: is it done, what was done, does it meet the goal, and
// the pull request. Built from what the run recorded only; what cannot be known is never inferred. Pure; no node: imports.
import { plural } from "./glance.mjs";
import { lensOfFinding } from "./lens-merge.mjs";
import { FINDING_WORDS, findingGist, findingLines, fit, lensRound } from "./lens-round.mjs";
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

// What the pane keeps of a code run's ledger once the publish run has replaced it: the task, whether its task-end gate
// passed, how many of its tests pass, and where its safety-net round ran. Null for a publish run or no ledger.
export function codeRunOf(ledger) {
  if (!ledger || typeof ledger !== "object" || ledger.kind === PUBLISH_KIND) return null;
  const perTest = ledger.tests?.perTest && typeof ledger.tests.perTest === "object" ? Object.values(ledger.tests.perTest) : [];
  const stages = [...(Array.isArray(ledger.stages) ? ledger.stages : []), ledger.stage].filter((stage) => stage?.name === SAFETY_NET);
  const safetyNet = stages.at(-1);
  return {
    runId: ledger.runId,
    task: ledger.task,
    taskEndPassed: ledger.gates && typeof ledger.gates === "object" ? isPassed(ledger, TASK_END) : false,
    testsPassing: perTest.filter((record) => record?.green?.passed === true).length,
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
// round: the code run's safety-net round as lensRound gives it, or undefined when it is not known.
// pr: what the publish result or the unit record said ({ url?, title?, result? }), or undefined before the publish.
export function endRows({ codeRun, changed, round, pr } = {}) {
  if (codeRun?.taskEndPassed !== true) return { done: DASH, goal: DASH, pr: DASH };
  return { done: doneText(codeRun, changed), goal: goalText(codeRun, round), pr: prText(pr) };
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
  const findings = Array.isArray(round.findings) ? round.findings : [];
  if (!findings.length) return [{ text: "review: no issues found" }];
  const counted = Object.values(FINDING_WORDS).map((word) => [word, findings.filter((finding) => finding.word === word).length]).filter(([, count]) => count > 0);
  const issues = `review: ${plural(findings.length, "issue")}`;
  // One outcome for all reads as one phrase; several are parts the line folds at when it is too long.
  const summary = counted.length === 1 ? `${issues}, all ${counted[0][0]}` : [issues, ...counted.map(([word, count]) => `${count} ${word}`)].join(PART_BREAK);
  return [...fit({ text: summary }, columns), ...findingLines(findings, columns)];
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

// Met only on a recorded verdict: the task-end gate passed (checked by the caller) and the goal lens returned with no finding
// still open. A goal lens that did not return, or a round that is not known, is not checked.
function goalText(codeRun, round) {
  const lens = round?.lenses?.find(({ id }) => isGoalLens(id));
  if (lens?.state !== "returned") return "not checked";
  const open = round.findings.find((finding) => isGoalLens(lensOfFinding(finding)) && OPEN_WORDS.includes(finding.word));
  if (open) return `in doubt${PART_BREAK}${findingGist(open)}`;
  return ["met", firstSentence(codeRun.task)].filter(Boolean).join(PART_BREAK);
}
