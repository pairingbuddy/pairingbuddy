// Gates: which gate is due, why it must ask, and what counts as passing it. The policy itself is
// recorded by the gate hook and read here from the ledger, so no caller can supply it. Node built-ins only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { REDO_STATUS, graphFor, isVoidedAttempt, returnFileKey, withStageStatus } from "./stages.mjs";
import { buildFindingId, buildKey } from "./keys.mjs";
import { keptIntakeReturn, lensRoundAt, readReturn, returnsAt } from "./stage-run.mjs";
import { statedType } from "./stated-type.mjs";
import { acceptVerdict, findingOutcomes, lensOfFinding } from "./lens-merge.mjs";
import { isPassed } from "./gate-passed.mjs";
import { forYou, plainName } from "./plain-names.mjs";
import { HUMAN_STOPPED } from "./stop-codes.mjs";
import { GitConfigRefused, gitConfigPath, readGitConfig } from "./gitconf.mjs";
import { isRefreshRun } from "./ledger.mjs";
import { needsTestSelection } from "./stage-graph.mjs";
import { readTestConfig, selectorAdvice } from "./test-run.mjs";
import { targetBranch, unitHasLensRecords } from "./publish.mjs";
import { headOf } from "./checkpoint.mjs";
import { openQuestions, taskTitle } from "./questions.mjs";
import { PrLintConfigRefused } from "./pr-lint.mjs";
import { PrLintRunRefused, isRefreshSubject, prBodyPath, prLintPath, readDraftArtifact, readPrSubject, readUnit, runPrLint, sha256 } from "./pr-lint-run.mjs";

export { isPassed };

const HUMAN_SOURCES = ["human", "human-cli"];
const REPORT_LISTS = ["survivors", "gaps", "uncovered", "unrefuted"];

export const GATE_OPTIONS = [
  { label: "approve", description: "Yes, carry on." },
  { label: "redo", description: "No, do that step again." },
  { label: "stop", description: "Stop the run here." },
];

export const PUBLISH_GATE = "G:publish";
export const PUBLISH_LABEL = "publish";
export const KEEP_LOCAL_LABEL = "keep local";
export const KEEP_LOCAL = "keep-local";

const PUBLISH_OPTIONS = [
  { label: PUBLISH_LABEL, description: "Yes, push the branch and send the pull request." },
  { label: KEEP_LOCAL_LABEL, description: "No, keep the commits here and publish nothing." },
  { label: "redo", description: "No, rewrite the pull request first." },
];

const optionsOf = (gate) => (gate === PUBLISH_GATE ? PUBLISH_OPTIONS : GATE_OPTIONS);

// After a human's stop at a gate, the question that asks them whether to go on: the way past their own stop, asked in the
// session, so no one types a ! line. needsHuman.wait marks it, so the tap records it as this wait, never as the gate's answer.
export const GO_ON_WAIT = "go-on";
export const GO_ON_LABEL = "Go on";
export const STAY_STOPPED_LABEL = "Stay stopped";

export const goOnQuestion = (gate) => ({
  question: `You stopped the run at ${plainName(gate) ?? gate}. Go on from there?`,
  header: "Go on?",
  options: [
    { label: GO_ON_LABEL, description: "Approve that step and lift your stop." },
    { label: STAY_STOPPED_LABEL, description: "Keep the run stopped." },
  ],
  multiSelect: false,
});

// The first sentence of a model's text, ending in a stop, or null when there is no text.
export function firstSentence(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  const sentence = text.trim().split(/(?<=[.!?])\s+/)[0].replace(/\s+/g, " ");
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function typeLines({ taskType, facts }) {
  const type = plainName(taskType ?? "");
  if (type === undefined) return [];
  const gist = firstSentence(facts.rationale);
  return [`Task type: ${type}.${gist === null ? "" : ` ${gist}`}`];
}

const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A list kept readable in a terminal: the first `keep` rows, then "+ n more" naming the full question file. With no file
// to name (fullAt null) the list is the full question file's, and nothing folds.
const MAX_LIST_ROWS = 12;
// `noun` gives the words between the count and the path, agreeing with the count.
const folded = (rows, keep, fullAt, noun = () => "") =>
  fullAt === null || rows.length <= keep ? rows : [...rows.slice(0, keep), `+ ${rows.length - keep} more${noun(rows.length - keep)}: ${fullAt}`];

const MAX_SCENARIOS = 15;

// Every scenario with its tests when they all fit the list's rows; otherwise one line per scenario with its test count, so no
// scenario is cut off part way through its tests.
function scenarioLines({ facts: { scenarios, finalChecks }, fullAt }) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) return [];
  return [...testLines(scenarios, fullAt), ...finalCheckLines(finalChecks, fullAt)];
}

// One final check per row: what it shows, then its command and why it is no test, when given.
export const finalCheckRow = ({ description, command, why }) => `- ${description}${command ? `: ${command}` : ""}${why ? ` (${why})` : ""}`;

// The checks only a live, paid or manual run can show, after the tests: they run at the end and are never built as tests.
function finalCheckLines(finalChecks, fullAt) {
  if (!Array.isArray(finalChecks) || finalChecks.length === 0) return [];
  return [`Final checks, run live at the end, not built as tests (${finalChecks.length}):`, ...folded(finalChecks.map(finalCheckRow), MAX_FINAL_CHECKS, fullAt, (n) => ` ${n === 1 ? "final check" : "final checks"}`)];
}

const MAX_FINAL_CHECKS = 5;

// The question auto mode leaves on the unit for the final checks: it never runs them (a live run costs money and time) and
// never stops for them, so the human decides when they have time.
export const finalChecksDoubt = (finalChecks) => ({
  step: "final checks",
  ambiguity: ["These checks need a live, paid or manual run, so no test covers them. Run them before the pull request?", ...finalChecks.slice(0, MAX_FINAL_CHECKS).map(finalCheckRow)].join("\n"),
  options: ["Run them before the PR", "Skip them this time"],
});

function testLines(scenarios, fullAt) {
  const tests = scenarios.reduce((sum, { tests: cases }) => sum + cases.length, 0);
  const rows = scenarios.flatMap(({ description, tests: cases }) => [`- ${description}`, ...cases.map((test) => `    - ${test}`)]);
  const shown = fullAt === null || rows.length <= MAX_LIST_ROWS ? rows : folded(scenarios.map(({ description, tests: cases }) => `- ${description} (${counted(cases.length, "test")})`), MAX_SCENARIOS, fullAt, (n) => ` ${n === 1 ? "scenario" : "scenarios"}`);
  return [`Scenarios (${counted(scenarios.length, "scenario")}, ${counted(tests, "test")}):`, ...shown];
}

const MAX_FILES = 5;

// The fold goes last, so the path it names ends the line and a terminal can open it.
function builtLine({ files, tests, passing }, fullAt) {
  const listed = Array.isArray(files) && files.length > 0;
  const more = listed && fullAt !== null ? files.length - MAX_FILES : 0;
  const shown = listed ? (more > 0 ? files.slice(0, MAX_FILES) : files).join(", ") : null;
  const run = [...(tests > 0 ? [counted(tests, "test")] : []), ...(passing === true ? [tests > 0 ? "all passing" : "the full test suite passes"] : [])].join(", ");
  const parts = [shown, run === "" ? null : run].filter((part) => part !== null);
  if (parts.length === 0) return [];
  return [more > 0 ? `Built: ${parts.join("; ")}; + ${counted(more, "more file", "more files")}: ${fullAt}` : `Built: ${parts.join("; ")}.`];
}

// A full suite that checked no lint is said so, since "all passing" alone reads as a clean build.
const lintLine = (note) => (typeof note === "string" && note !== "" ? [`Lint: ${note.replace(/[.\s]+$/, "")}.`] : []);

// The failures the task's baseline already had, which the run did not count: shown, so the human still sees them.
const preexistingPart = ({ runner, failures, broken }) => (broken ? `runner ${runner} could not run` : `runner ${runner}, ${counted(failures.length, "test")}`);
const preexistingLine = (rows) => (Array.isArray(rows) && rows.length > 0 ? [`Already failing before this task, so not counted: ${rows.map(preexistingPart).join("; ")}.`] : []);

function reviewLine(outcomes) {
  if (!Array.isArray(outcomes)) return [];
  if (outcomes.length === 0) return ["Review: no issues."];
  const count = (outcome) => outcomes.filter((each) => each === outcome).length;
  const notReal = count("not a real problem");
  return [`Review: ${counted(outcomes.length, "issue")}, ${count("fixed")} fixed, ${count("left as is")} left as is${notReal > 0 ? `, ${notReal} not a real problem` : ""}.`];
}

// The goal check's first finding, with how many more there are; the full question file lists them all. A check with
// nothing to say gives no line.
function goalCheckLine(findings, fullAt) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  if (fullAt === null) return ["Goal check:", ...findings.map(({ gist, outcome }) => `- ${gist} (${outcome})`)];
  const [{ gist, outcome }] = findings;
  return [findings.length > 1 ? `Goal check: ${gist} (${outcome}); + ${findings.length - 1} more: ${fullAt}` : `Goal check: ${gist} (${outcome}).`];
}

const trimmed = (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

// The goal's first sentence, whole: the question box wraps it. The full question file holds the whole goal.
// Each final check the session ran and recorded (pb final-check), newest result per id, with its note on one line.
const FINAL_CHECK_NOTE_MAX = 200;
function ranFinalCheckLines(finalChecks) {
  if (!Array.isArray(finalChecks)) return [];
  const latest = new Map(finalChecks.map((check) => [check.id, check]));
  const note = (text) => { const flat = String(text).trim().replace(/\s+/g, " "); return flat.length > FINAL_CHECK_NOTE_MAX ? `${flat.slice(0, FINAL_CHECK_NOTE_MAX - 1)}…` : flat; };
  return [...latest.values()].map(({ id, result, note: text }) => `Final check ${id} ${result === "fail" ? "failed" : "passed"}: ${note(text)}`);
}

function taskEndLines({ facts, fullAt }) {
  const goal = fullAt === null ? trimmed(facts.goal) : firstSentence(facts.goal);
  return [...(goal === null ? [] : [`Goal: ${goal}`]), ...builtLine(facts, fullAt), ...ranFinalCheckLines(facts.finalChecks), ...preexistingLine(facts.preexisting), ...lintLine(facts.lint), ...reviewLine(facts.review), ...goalCheckLine(facts.goalCheck, fullAt)];
}

const isHeading = (line) => /^#{1,6}\s/.test(line.trim());
const SUMMARY_HEADING = /^#{1,6}\s+summary\s*$/i;

// The rows' paragraphs, each on one line with its heading lines dropped, so a heading is never the paragraph shown.
const paragraphsOf = (rows) => rows.join("\n").split(/\n\s*\n/).map((part) => part.split("\n").filter((line) => line.trim() !== "" && !isHeading(line)).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);

// The Summary section's first paragraph, whole, or the body's first paragraph when it has no Summary to read.
function summaryOf(body) {
  const rows = body.split(/\r?\n/);
  const at = rows.findIndex((row) => SUMMARY_HEADING.test(row.trim()));
  const end = at === -1 ? -1 : rows.findIndex((row, i) => i > at && isHeading(row));
  const section = at === -1 ? [] : rows.slice(at + 1, end === -1 ? undefined : end);
  return paragraphsOf(section)[0] ?? paragraphsOf(rows)[0] ?? null;
}

// A pull request body does not fit a question box: the question gives its summary and the file that holds it whole, the
// exact body that goes out. With no body file to name, the full question file holds the body. The full question file
// (fullAt null) holds the body as written.
function bodyRows(body, fullAt, bodyAt) {
  if (typeof body !== "string") return [];
  if (fullAt === null) return trimmed(body) === null ? [] : [trimmed(body)];
  const summary = summaryOf(body);
  return summary === null ? [] : [summary, `Full description: ${bodyAt ?? fullAt}`];
}

const publishLines = ({ facts: { title, body, bodyAt }, fullAt }) => [...(typeof title === "string" ? [`Pull request: ${title}`] : []), ...bodyRows(body, fullAt, bodyAt)];

// "it" needs the title line before it to name the pull request.
function publishAsk(refresh, titled) {
  if (titled) return refresh ? "Update it?" : "Open it?";
  return refresh ? "Update the pull request?" : "Open the pull request?";
}

// What each gate asks the human, in plain words. The header is AskUserQuestion's chip, so it stays within 12 characters.
// A gate with `lines` opens with its subject and the facts to judge it by, then the why line, then asks, one line each.
const GATE_ASKS = {
  "G:type": { header: "Task type", lines: typeLines, ask: ({ taskType }) => (plainName(taskType ?? "") === undefined ? "Is the task type right?" : "Is that the right type?") },
  "G:scenarios": { header: "Scenarios", lines: scenarioLines, ask: () => "Start building these?" },
  "G:scope": { header: "Tidy-up", ask: () => "Is this the right list to tidy up?" },
  "G:task-end": { header: "Task done", lines: taskEndLines, ask: () => "Is the task done?" },
  "G:unit": { header: "Experiment", ask: () => "Is this experiment done?" },
  [PUBLISH_GATE]: { header: "Publish", lines: publishLines, ask: ({ refresh, facts }) => publishAsk(refresh, typeof facts.title === "string") },
};

// A gate the table does not know, such as one a test contract adds.
const OTHER_ASK = { header: "Your OK", ask: () => "Can the run go on?" };

// Why the gate asks, in plain words, from the reason askReason gave. Auto mode being off is the usual case, not news, so it says nothing.
const PLAIN_WHYS = [
  [/^it is a decide gate/, "This step always asks you."],
  [/^no classifier reports certain/, "The check was not sure, so it asks you."],
  [/^(no gate policy is recorded|the gate policy is )/, ""],
  [/^the classifier does not report certain/, "The classifier was not sure of the type."],
  [/^the classification lens has an open finding/, "A reviewer doubts the task type."],
  [/no selector_template/, (reason) => selectorWhy(reason)],
  [/^the scope lens found/, "A reviewer doubts the tidy-up fits the goal."],
  [/^the run stopped/, "The run stopped and needs you."],
  [/^retries are exhausted/, "A step ran out of retries."],
  [/config hash changed during the run$/, "A config file changed during the run."],
  [/open ambiguity/, "A step was unsure about something."],
  [/^coverage gaps remain/, "Some scenarios have no test yet."],
  [/^a decide finding survived/, "A review found something only you can decide."],
  [/^a lens is uncovered/, "One review did not get done."],
  [/^an unrefuted high-severity finding/, "A serious review finding is still open."],
  [/cannot be read$/, "A step's result could not be read."],
  [/approval no longer holds/, "Something changed since your last OK."],
  [/^the PR lint /, "The pull request text has not passed its checks."],
  [/^a pull request refresh is approved by a human/, "Updating a pull request always asks you."],
  [/^no lens record yet for the safety net/, "Not every task has had its safety-net review."],
  [/^questions for you are open/, "Doubts were set aside for you while the run went on."],
];

// Names the runners a reason says lack selector_template, and the one fix: the run cannot build a test without it.
function selectorWhy(reason) {
  const named = /^runners? (.+?) (?:has|have) no selector_template/.exec(reason);
  if (named === null) return "A test runner can't run one test on its own: add a selector_template to it in .pairingbuddy/test-config.json, and the run asks you to accept the change.";
  const many = named[1].includes(",");
  return many
    ? `Runners ${named[1]} can't run one test on their own: add a selector_template to each in .pairingbuddy/test-config.json, and the run asks you to accept the change.`
    : `Runner ${named[1]} can't run one test on its own: add a selector_template to it in .pairingbuddy/test-config.json, and the run asks you to accept the change.`;
}

const plainWhy = (reason) => {
  const why = PLAIN_WHYS.find(([pattern]) => pattern.test(reason))?.[1];
  if (why === undefined) return forYou(reason);
  return typeof why === "function" ? why(reason) : why;
};

const AMBIGUITY_REASON = /open ambiguity/;
// G:publish asking the doubts the unit collected (questionsReason).
const QUESTIONS_REASON = /^questions for you are open: \d+$/;

// The open doubts a question shows: the facts' doubts when the gate asks over them, else none.
export const questionDoubts = (reason, { doubts } = {}) => ((AMBIGUITY_REASON.test(reason) || QUESTIONS_REASON.test(reason)) && Array.isArray(doubts) && doubts.length > 0 ? doubts : null);

// A doubt whole on one line: the question box wraps a long line, and a cut sentence cannot be judged.
const doubtText = (ambiguity) => ambiguity.trim().replace(/\s+/g, " ");

const MAX_DOUBTS = 3;

// Where pb gate eval writes the full question, under the target project's root.
export const QUESTION_FILE = ".pairingbuddy/run/question.md";

// The step name a lens or refuter doubt carries: the human needs no word for how the review was split up.
export const REVIEWER = "a reviewer";

// A question the unit kept for G:publish also names the task that raised it, as its doubts come from many tasks.
const doubtLine = ({ step, ambiguity, task: whole }) => {
  const task = whole ? taskTitle(whole) : whole;
  if (step === REVIEWER) return `A reviewer was unsure${task ? ` (${task})` : ""}: ${doubtText(ambiguity)}`;
  return `Unsure (${step}${task ? `, ${task}` : ""}): ${doubtText(ambiguity)}`;
};

const doubtLines = (doubts, fullAt) => folded(doubts.map(doubtLine), MAX_DOUBTS, fullAt);

// At G:type, a classifier that was not certain and named its doubt: the doubt itself, so the human knows what to judge.
const UNSURE_CLASSIFIER = /^the classifier does not report certain/;
const unsureClassifier = (gate, reason, { ambiguity }) =>
  gate === "G:type" && UNSURE_CLASSIFIER.test(reason) && typeof ambiguity === "string" && ambiguity.trim() !== ""
    ? `The classifier was not sure: ${doubtText(ambiguity)}`
    : null;

// The ask, turned so the human knows they decide over the doubts.
const despite = (asked, doubts) => `${asked.replace(/\?$/, "")} despite ${doubts.length === 1 ? "this" : "these"}?`;

// The question's lines, then its ask. fullAt null gives the full question file's lines: no list folds.
// The unit's questions the human already answered (pb human answer, from /pb-questions): G:publish lists them as handled, each
// with its answer, and asks only the open ones.
const handledLine = ({ task, ambiguity, answer }) => `Answered by you${task ? ` (${task})` : ""}: ${doubtText(ambiguity)} → ${doubtText(answer)}`;
const handledLines = ({ handled } = {}, fullAt) => (Array.isArray(handled) && handled.length > 0 ? folded(handled.map(handledLine), MAX_DOUBTS, fullAt) : []);

function questionLines(gate, { reason = "", taskType = null, refresh = false, facts = {} }, fullAt) {
  const { ask, lines } = GATE_ASKS[gate] ?? OTHER_ASK;
  const context = { taskType, refresh, facts, fullAt };
  const handled = handledLines(facts, fullAt);
  const doubts = questionDoubts(reason, facts);
  if (doubts !== null) return [...(lines?.(context) ?? []), ...handled, ...doubtLines(doubts, fullAt), despite(ask(context), doubts)];
  const why = unsureClassifier(gate, reason, facts) ?? plainWhy(reason);
  if (lines === undefined) return [...handled, `${ask(context)} ${why}`.trim()];
  return [...lines(context), ...handled, ...(why === "" ? [] : [why]), ask(context)];
}

// The question gate eval issues: pure, and stored in needsHuman, so the hooks match the answer against what was asked.
// facts: what pb gate eval read for this gate (see gate-facts.mjs); a fact it could not read is absent, and its line is left out.
// fullAt: the file that holds the full question, which every fold names (pb gate eval passes its absolute path).
export function gateQuestion(gate, { fullAt = QUESTION_FILE, ...asked } = {}) {
  const { header } = GATE_ASKS[gate] ?? OTHER_ASK;
  return { question: questionLines(gate, asked, fullAt).join("\n"), header, options: optionsOf(gate), multiSelect: false };
}

const isListRow = (line) => /^\s*- /.test(line);
// A list's row stays under the row or the lead line ("Goal check:") before it.
const joinsAbove = (line, above) => isListRow(line) && (isListRow(above) || above.endsWith(":"));

// The full question as Markdown, for pb gate eval to write at QUESTION_FILE: the same lines with no list folded, every
// doubt and the whole goal and body in full. A list stays under its lead line; every other line is its own paragraph.
export function fullQuestion(gate, asked = {}) {
  const { header } = GATE_ASKS[gate] ?? OTHER_ASK;
  const lines = questionLines(gate, asked, null);
  const body = lines.map((line, i) => (i === 0 ? line : `${joinsAbove(line, lines[i - 1]) ? "\n" : "\n\n"}${line}`)).join("");
  return `# ${header}\n\n${body}\n`;
}

// The question the pending gate asked, or null when no gate waits or the ledger holds none.
export const pendingQuestion = (ledger) => ledger?.needsHuman?.question ?? null;

export const fileHash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// ---------- gates of a run ----------

export function gatesFor(contract, taskType) {
  const { nodes, gates } = contract.taskTypes[graphFor(contract, taskType).taskType];
  return nodes.filter(({ gate }) => gate !== null).map(({ name, gate }) => ({ name: gate, stage: name, class: gates[gate].class }));
}

const doneStages = (ledger) => new Set(ledger.stages.filter((s) => s.status === "done").map((s) => s.name));

// The first gate behind a finished stage that stands in the way of the next stage.
export function blockingGate(gates, ledger) {
  const done = doneStages(ledger);
  return gates.find(({ name, stage }) => done.has(stage) && !isPassed(ledger, name));
}

export function dueGate(gates, ledger) {
  const done = doneStages(ledger);
  return gates.find(({ name, stage }) => done.has(stage) && !Object.hasOwn(ledger.gates, name));
}

// The gate a human answered with something other than approve, with that answer. It stands until they approve it.
export function answeredGate(gates, ledger) {
  if (ledger.needsHuman !== null) return undefined;
  const gate = blockingGate(gates, ledger);
  if (gate === undefined || !Object.hasOwn(ledger.gates, gate.name)) return undefined;
  const { source, answer } = ledger.gates[gate.name];
  return HUMAN_SOURCES.includes(source) ? { ...gate, answer } : undefined;
}

// The gate of a stage sent back by redo and not restarted yet. A redo leaves no gate record, so the stage holds this.
export const reopenedGate = (gates, { stage }) => (stage.status === REDO_STATUS ? gates.find((gate) => gate.stage === stage.name) : undefined);

// ---------- always-stop conditions ----------

function parsedOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const isReport = (report) => report !== null && typeof report === "object" && REPORT_LISTS.every((key) => report[key] === undefined || Array.isArray(report[key]));

// A report carries its stage and attempt, and one with no stamp keeps counting, since nothing shows it is stale.
const isVoidedReport = (report, ledger) => typeof report.stage === "string" && isVoidedAttempt(ledger, report.stage, report.attempt);

const taskReportPath = (root) => join(root, ".pairingbuddy", "run", "task", "report.json");

const UNREADABLE = Symbol("unreadable report");

// The one rule for which report counts: the report when it is readable and not voided, null when it is missing or
// voided, UNREADABLE when it cannot be read.
function standingReport(path, ledger) {
  if (!existsSync(path)) return null;
  const report = parsedOrNull(path);
  if (!isReport(report)) return UNREADABLE;
  return isVoidedReport(report, ledger) ? null : report;
}

// A report that cannot be read stops too: it may be hiding any of these.
function reportStop(path, ledger) {
  const report = standingReport(path, ledger);
  if (report === null) return null;
  if (report === UNREADABLE) return `${path} cannot be read`;
  const { survivors = [], gaps = [], uncovered = [], unrefuted = [] } = report;
  if (survivors.some((finding) => finding?.class === "decide")) return "a decide finding survived";
  if (gaps.length > 0) return `coverage gaps remain: ${gaps.length}`;
  if (uncovered.length > 0) return `a lens is uncovered: ${uncovered.join(", ")}`;
  if (unrefuted.some((finding) => finding?.severity === "high")) return "an unrefuted high-severity finding is past the cap";
  return null;
}

function isVoidedReturn(file, ledger) {
  const key = returnFileKey(file);
  return key !== null && isVoidedAttempt(ledger, key.stage, key.attempt);
}

export const isHumanApproved = (ledger, gate) => {
  const record = Object.hasOwn(ledger.gates, gate) ? ledger.gates[gate] : undefined;
  return HUMAN_SOURCES.includes(record?.source) && record.answer === "approve";
};

// A human who approved a gate has seen what its stage and every stage before it left open. A redo removes the gate's
// record, so a record always speaks for the attempt that stands, and a stage after it has not been seen by anyone.
function settledStages(contract, ledger) {
  const { nodes } = contract.taskTypes[graphFor(contract, ledger.taskType).taskType];
  const last = nodes.findLastIndex(({ gate }) => gate !== null && isHumanApproved(ledger, gate));
  return new Set(nodes.slice(0, last + 1).map(({ name }) => name));
}

// A gate the auto policy passed with its doubts deferred has put them on the unit's questions: for the doubts, it settles
// its stage and every stage before it the way a human approval does, so no later gate defers or asks them again.
// Coverage gaps and the rest are not doubts, and stay with settledStages.
function doubtSettledStages(contract, ledger) {
  const { nodes } = contract.taskTypes[graphFor(contract, ledger.taskType).taskType];
  const deferred = (gate) => Array.isArray(ledger.gates[gate]?.deferred);
  const last = nodes.findLastIndex(({ gate }) => gate !== null && (isHumanApproved(ledger, gate) || deferred(gate)));
  return new Set(nodes.slice(0, last + 1).map(({ name }) => name));
}

const COVERED_ROLE = "implement-tests";

// A pass at RED after an earlier GREEN is the CLI's call: once it recorded the test covered, a question about it is answered.
function isCoveredPass(key, { tests: { perTest = {} } }) {
  if (key?.role !== COVERED_ROLE || key.item === null || !Object.hasOwn(perTest, key.item)) return false;
  return perTest[key.item].covered?.done === true;
}

function isSettled(file, settled, ledger) {
  const key = returnFileKey(file);
  return settled.has(key?.stage) || isCoveredPass(key, ledger);
}

// A lens finding's id, or null when the lens item cannot form one.
function findingIdOf(lens, index) {
  try {
    return buildFindingId({ lens, index });
  } catch {
    return null;
  }
}

// A fix was kept when its course check said better and nothing rolled it back. Returns the check, or null.
function keptCheckOf({ pbKey, stage, item, round, attempt }, dir, ledger) {
  if ((ledger.fixes?.rollbacks ?? []).some((rollback) => rollback?.key === pbKey)) return null;
  const check = readReturn(dir, buildKey({ stage, role: "course-checker", item, round, attempt }));
  return check?.verdict === "better" && typeof check.finding_id === "string" ? check : null;
}

// The kept fixes at this stage attempt, each as { lens, round }: a group is one lens's survivors, and its check names one of them.
function keptFixes(dir, stage, ledger) {
  const fixes = returnsAt(dir, stage).filter(({ role }) => role === "fix");
  return fixes.flatMap((fix) => {
    const check = keptCheckOf(fix, dir, ledger);
    return check === null ? [] : [{ lens: lensOfFinding({ id: check.finding_id }), round: fix.round }];
  });
}

// The lenses whose fix group a kept fix answered at this stage attempt.
export function keptFixLenses(dir, stage, ledger) {
  return new Set(keptFixes(dir, stage, ledger).map(({ lens }) => lens));
}

// The outcome of each finding of a stage attempt's lens round, by id; null when the record cannot settle the round.
function outcomesAt(dir, stage, ledger) {
  try {
    return new Map(findingOutcomes(lensRoundAt(dir, stage, ledger.taskType), keptFixLenses(dir, stage, ledger)).map(({ id, outcome }) => [id, outcome]));
  } catch {
    return null;
  }
}

// A lens's doubt stands while one of its findings stands: one its refuter did not knock down and no kept fix answered.
// A lens with no findings, or a round the record cannot settle, keeps its doubt.
function lensDoubtStands(key, { findings }, dir, ledger) {
  if (!Array.isArray(findings) || findings.length === 0) return true;
  const outcomes = outcomesAt(dir, { name: key.stage, attempt: key.attempt }, ledger);
  if (outcomes === null) return true;
  return findings.some((_, i) => [undefined, "left as is"].includes(outcomes.get(findingIdOf(key.item, i + 1))));
}

// A refuter's doubt is about its one finding, so it stands unless the refuter knocked the finding down or a fix kept in a
// later round of the same review fixed it: the report's "settled by a later fix" rule.
function refuterDoubtStands(key, artifact, dir, ledger) {
  if (acceptVerdict(key.item, artifact)?.verdict === "refuted") return false;
  const stage = { name: key.stage, attempt: key.attempt };
  const lens = lensOfFinding({ id: key.item });
  if (!keptFixes(dir, stage, ledger).some((fix) => fix.lens === lens && fix.round > key.round)) return true;
  return outcomesAt(dir, stage, ledger)?.get(key.item) !== "fixed";
}

// Whether a return's doubt still stands after its round: a refuter's while its finding stands, a lens's while one of its
// findings stands, a fix's unless it was kept. Every other return's doubt (the stage's own subject) stands.
function doubtStands(file, artifact, dir, ledger) {
  const key = returnFileKey(file);
  if (key?.role === "refuter") return refuterDoubtStands(key, artifact, dir, ledger);
  if (key?.role === "lens") return lensDoubtStands(key, artifact, dir, ledger);
  if (key?.role === "fix") return keptCheckOf({ ...key, pbKey: file.replace(/\.json$/, "") }, dir, ledger) === null;
  return true;
}

// The returns whose ambiguity is still open, each with its ambiguity, in file order. `unreadable` names the first return
// that cannot be read, which may hide one more.
function openReturns(dir, ledger, settled) {
  const open = [];
  if (!existsSync(dir)) return { open };
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json") && !name.startsWith(".") && !isVoidedReturn(name, ledger)).sort()) {
    const artifact = parsedOrNull(join(dir, file));
    if (artifact === null) return { open, unreadable: file };
    const { ambiguity = null } = artifact;
    // ambiguity_options: the answers the step suggests for its doubt, which the human may pick instead of typing one.
    const options = Array.isArray(artifact.ambiguity_options) ? { options: artifact.ambiguity_options } : {};
    if (ambiguity !== null && ambiguity !== "" && !isSettled(file, settled, ledger) && doubtStands(file, artifact, dir, ledger)) open.push({ file, ambiguity, ...options });
  }
  return { open };
}

// It names every open return, because approving this gate settles them all.
function ambiguityStop(dir, ledger, settled) {
  const { open, unreadable } = openReturns(dir, ledger, settled);
  if (unreadable !== undefined) return `the return ${unreadable} cannot be read`;
  if (open.length === 0) return null;
  const files = open.map(({ file }) => file);
  return files.length === 1 ? `the return ${files[0]} carries an open ambiguity` : `these returns carry an open ambiguity: ${files.join(", ")}`;
}

// The open ambiguities the gate's stop would name, by the same rule, as { file, ambiguity, options? }; null when a return cannot be read.
export function openDoubts(contract, ledger, root) {
  const { open, unreadable } = openReturns(artifactsDir(root), ledger, doubtSettledStages(contract, ledger));
  return unreadable === undefined ? open : null;
}

const COVERAGE_ROLE = "verify-test-coverage";

// The newest coverage return that stands, since the loop closes gaps round by round and only its last word counts.
function newestCoverage(dir, ledger) {
  const standing = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith(".") && !isVoidedReturn(name, ledger))
    .map((file) => ({ file, key: returnFileKey(file) }))
    .filter(({ key }) => key?.role === COVERAGE_ROLE && key.item === null)
    .sort((a, b) => b.key.attempt - a.key.attempt || b.key.round - a.key.round);
  return standing[0]?.file ?? null;
}

// Gaps the bounded coverage loop left. They outlive the stage's report, which the next stage's report replaces.
function coverageStop(dir, ledger, settled) {
  if (!existsSync(dir)) return null;
  const file = newestCoverage(dir, ledger);
  if (file === null || isSettled(file, settled, ledger)) return null;
  const gaps = parsedOrNull(join(dir, file))?.gaps;
  if (!Array.isArray(gaps)) return `the coverage return ${file} cannot be read`;
  return gaps.length === 0 ? null : `coverage gaps remain: ${gaps.length}, in ${file}`;
}

function retriesStop({ retries }) {
  const exhausted = Object.keys(retries).find((stage) => !(retries[stage]?.used < retries[stage]?.max));
  return exhausted === undefined ? null : `retries are exhausted for ${exhausted}`;
}

// The config files whose hash is not the one recorded: test-config.json and git-config.json, in that order. A missing
// test-config.json counts as changed; acceptedConfigHash, a test-config hash the human accepted since, counts as unchanged.
// git-config.json is tracked only when the unit recorded a hash; then a missing file counts as changed too.
export function changedConfigs({ configHash, gitConfigHash, acceptedConfigHash = null }, root) {
  const differs = (path, ...recorded) => !existsSync(path) || !recorded.includes(fileHash(path));
  return [
    ...(differs(join(root, ".pairingbuddy", "test-config.json"), configHash, ...(acceptedConfigHash === null ? [] : [acceptedConfigHash])) ? ["test-config.json"] : []),
    ...(gitConfigHash !== undefined && differs(gitConfigPath(root), gitConfigHash) ? ["git-config.json"] : []),
  ];
}

const CONFIG_STOPS = { "test-config.json": "the config hash changed during the run", "git-config.json": "the git-config hash changed during the run" };

const configStop = (hashes, root) => CONFIG_STOPS[changedConfigs(hashes, root)[0]] ?? null;

// skipDoubts: the reason as it would stand with every open doubt answered, which is when an auto pass may defer them.
function stopReason(contract, ledger, root, { skipDoubts = false } = {}) {
  if (ledger.stop !== null) return `the run stopped: ${ledger.stop.reason}`;
  const artifacts = artifactsDir(root);
  const settled = settledStages(contract, ledger);
  const doubts = skipDoubts ? null : ambiguityStop(artifacts, ledger, doubtSettledStages(contract, ledger));
  return retriesStop(ledger) ?? configStop(ledger, root) ?? doubts ?? coverageStop(artifacts, ledger, settled) ?? reportStop(taskReportPath(root), ledger);
}

// ---------- the decision ----------

const CLASS_REASONS = {
  decide: "it is a decide gate, which always asks",
  conditional: "no classifier reports certain",
};

function policyReason({ policy: { mode } }) {
  if (mode === "auto") return null;
  return mode === "" ? "no gate policy is recorded" : `the gate policy is ${mode}, not auto`;
}

const SCOPE_GATE = "G:scope";

// A lens survivor counts as open unless it is explicitly non-blocking (blocking: false).
const blockingSurvivors = (report) => (report.survivors ?? []).filter((finding) => finding?.blocking !== false);

const SCOPE_REASON = "the scope lens found the scope may not serve the stated intent";

// The scope lens may flag that the scope does not serve the stated intent; a blocking survivor asks, unless auto with a
// unit open sets it aside as a question for the human (defersScope).
function scopeReason(root, ledger) {
  const report = standingReport(taskReportPath(root), ledger);
  if (report === null) return null;
  const blocked = blockingSurvivors(report).length > 0;
  return blocked ? SCOPE_REASON : null;
}

// The scope lens's blocking findings as doubts for the unit's questions, one per finding.
export function scopeDoubts(root, ledger) {
  const report = standingReport(taskReportPath(root), ledger);
  if (report === null) return [];
  return blockingSurvivors(report).map((finding) => ({
    step: "checking the tidy-up list",
    ambiguity: `A reviewer doubts the tidy-up fits the goal: ${doubtText(String(finding?.message ?? finding?.claim ?? "no reason given"))}. Is the tidy-up list right?`,
  }));
}

const TYPE_GATE = "G:type";

const artifactsDir = (root) => join(root, ".pairingbuddy", "run", "task", "artifacts");

// G:type asks when a runner has no selector_template (for task types that need test selection) or when the classifier is not certain.
function selectorReason(root, ledger, contract) {
  if (!needsTestSelection(contract, ledger.taskType)) return null;
  const advice = selectorAdvice(readTestConfig(root, ledger.configHash));
  if (advice === null) return null;
  return `${advice}. Once the human has added it, the run asks them to accept the changed file at its next test run, and goes on`;
}

// Under auto, a likely type with no question for the human passes: asking at every plan task cost more than it caught. An
// unsure type, or one with a question, still asks, since the type picks the whole workflow and cannot wait for G:publish.
function classifierReason(root, ledger) {
  const content = keptIntakeReturn(artifactsDir(root), ledger.stage.attempt)?.content;
  if (content?.confidence === "certain") return null;
  const quiet = content?.confidence === "likely" && String(content.ambiguity ?? "").trim() === "";
  return quiet && ledger.policy.mode === "auto" ? null : "the classifier does not report certain";
}

function lensReason(root, ledger) {
  const report = standingReport(taskReportPath(root), ledger);
  if (report === null) return null;
  // Intake has one lens, so one kept fix group covers all its findings. G:type is due only after intake is done, and that needs
  // `stage finish`, which the script reaches only after fixStop let it through: a fix still standing then was kept by the course
  // check (a stop before the check asks at every gate first). A rolled-back fix was moved to rejected/, so the kept return is a fix.
  const fixed = keptIntakeReturn(artifactsDir(root), ledger.stage.attempt)?.role === "fix";
  return blockingSurvivors(report).length > 0 && !fixed ? "the classification lens has an open finding" : null;
}

// The confidence a G:type auto pass stood on when it was less than certain, for the gate record and the report; else null.
export function typePassedOn(root, ledger, gate) {
  if (gate !== TYPE_GATE) return null;
  const confidence = keptIntakeReturn(artifactsDir(root), ledger.stage.attempt)?.content?.confidence;
  return confidence === "likely" ? confidence : null;
}

const typeReason = (root, ledger, contract) => selectorReason(root, ledger, contract) ?? classifierReason(root, ledger) ?? lensReason(root, ledger);

const TASK_END_GATE = "G:task-end";

// The final checks the session recorded failed, newest record per id (pb final-check). A failed one is no doubt to set aside:
// G:task-end asks the human under any policy, auto included.
export function failedFinalChecks(ledger) {
  const latest = new Map((Array.isArray(ledger.finalChecks) ? ledger.finalChecks : []).map((check) => [check.id, check]));
  return [...latest.values()].filter(({ result }) => result === "fail");
}

function finalCheckReason(ledger) {
  const failed = failedFinalChecks(ledger).map(({ id }) => id);
  return failed.length === 0 ? null : `a final check failed: ${failed.join(", ")}`;
}

// The reasons only one gate has, by gate name.
const GATE_REASONS = {
  [TASK_END_GATE]: ({ ledger }) => finalCheckReason(ledger),
  [SCOPE_GATE]: ({ root, ledger }) => scopeReason(root, ledger),
  [TYPE_GATE]: ({ root, ledger, contract }) => typeReason(root, ledger, contract),
  [PUBLISH_GATE]: ({ root, ledger, voided }) => publishReason(ledger, root, voided),
};

// A gate with its own reason decides for itself; the class reason is for gates that have none.
const gateOwnReason = (gate, args) => (GATE_REASONS[gate.name] ? GATE_REASONS[gate.name](args) : (CLASS_REASONS[gate.class] ?? null));

// The type the task states for itself on a Type: line, which the planner wrote and the human approved with the plan, or null.
export const statedTypeOf = (contract, ledger) => statedType(ledger.task, contract.migratedTypes);

// G:type with a stated type: that is the type, under any policy, and no doubt on it is asked. Only a stop, or a runner the
// type cannot select tests with, still asks.
const statedTypeReason = (contract, ledger, root) => stopReason(contract, ledger, root, { skipDoubts: true }) ?? selectorReason(root, ledger, contract);

// Why this gate must ask a human, or null when it passes under the recorded policy.
export const askReason = (contract, ledger, gate, root, voided = null, opts = {}) =>
  gate.name === TYPE_GATE && statedTypeOf(contract, ledger) !== null
    ? statedTypeReason(contract, ledger, root)
    : stopReason(contract, ledger, root, opts) ?? gateOwnReason(gate, { root, ledger, voided, contract }) ?? policyReason(ledger);

// Whether askReason gave a gate's open doubts as its reason.
export const isDoubtReason = (reason) => typeof reason === "string" && AMBIGUITY_REASON.test(reason);

// Under auto, a gate whose only reason to ask is open doubts passes, and its doubts wait on the unit's questions until
// G:publish asks them (questions.mjs). Never G:publish itself, the gate that asks them, nor G:type: the type picks the whole
// workflow, so a question on it is asked before any work is built on it.
const NEVER_DEFERS = [PUBLISH_GATE, TYPE_GATE];
export const defersDoubts = (contract, ledger, gate, root, reason) =>
  isDoubtReason(reason) && ledger.policy.mode === "auto" && !NEVER_DEFERS.includes(gate.name) && askReason(contract, ledger, gate, root, null, { skipDoubts: true }) === null;

// Under auto, G:scope's only reason to ask being the scope lens's doubt, the tidy-up goes ahead and the doubt waits on the
// unit's questions like any other: the tidy-up changes no behaviour, and the human's answer can still rework it.
export const defersScope = (contract, ledger, gate, root, reason) =>
  gate.name === SCOPE_GATE && reason === SCOPE_REASON && ledger.policy.mode === "auto" && stopReason(contract, ledger, root) === null;

// ---------- G:publish ----------

export class PublishRefused extends Error {}

// The refusals the binding and the lint can throw: a CLI reports them, and the tap puts them on the gate.
export const isBindingRefusal = (e) => e instanceof PublishRefused || e instanceof PrLintRunRefused || e instanceof PrLintConfigRefused || e instanceof GitConfigRefused;

function currentHead(root) {
  const head = headOf(root);
  if (head === null) throw new PublishRefused("git has no HEAD here, so the publish binding cannot be read");
  return head;
}
const short = (sha) => String(sha).slice(0, 7);

// The lint result as it stands for a body: missing, stale (made for another body), failed or ok.
// The body is the one on disk unless the caller passes the hash of bytes it already read (null: no body).
export function publishLint(root, bodyHash = diskBodyHash(root)) {
  const lint = existsSync(prLintPath(root)) ? parsedOrNull(prLintPath(root)) : null;
  if (lint === null) return { status: "missing", ok: false, failures: [] };
  const failures = Array.isArray(lint.failures) ? lint.failures : [];
  if (lint.bodyHash !== bodyHash) return { status: "stale", ok: false, failures };
  return { status: lint.ok === true ? "ok" : "failed", ok: lint.ok === true, failures };
}

const diskBodyHash = (root) => existsSync(prBodyPath(root)) ? sha256(readFileSync(prBodyPath(root))) : null;

function lintReason(root) {
  const { status, failures } = publishLint(root);
  if (status === "missing") return "the PR lint has not run";
  if (status === "stale") return "the PR lint is stale: it was run for another body than run/pr-body.md";
  if (status === "failed") return `the PR lint failed: ${failures.map(({ rule }) => rule).join(", ")}`;
  return null;
}

// Whether the auto policy passes G:publish by itself: auto mode, an ok lint for the body on disk and the safety-net lens record of every code task.
export const autoPublishPasses = (ledger, root) => !isRefreshRun(ledger) && ledger.policy.mode === "auto" && publishLint(root).status === "ok" && unitHasLensRecords(readUnit(root)) && openQuestions(readUnit(root)).count === 0;

// The doubts auto passes deferred to the unit (questions.mjs): G:publish asks them all, under any policy, before anything goes out.
function questionsReason(ledger, root) {
  if (isRefreshRun(ledger)) return null;
  const { count } = openQuestions(readUnit(root));
  return count === 0 ? null : `questions for you are open: ${count}`;
}

// The unit's questions as the doubts G:publish shows and its record keeps, each with the task that raised it.
export const unitQuestionDoubts = (root) => openQuestions(readUnit(root)).kept.map(({ step, ambiguity, task }) => ({ step, ambiguity, task }));

// Why the publish gate asks whatever the policy says, or null. Under auto it passes once autoPublishPasses holds; any other policy is left to policyReason.
function publishReason(ledger, root, voided) {
  if (voided === null && autoPublishPasses(ledger, root)) return null;
  return voided ?? lintReason(root) ?? questionsReason(ledger, root) ?? (isRefreshRun(ledger) ? "a pull request refresh is approved by a human" : null) ?? (ledger.policy.mode === "auto" ? "no lens record yet for the safety net" : null);
}

const publishRecord = (ledger) => (Object.hasOwn(ledger.gates, PUBLISH_GATE) ? ledger.gates[PUBLISH_GATE] : undefined);

// How G:publish stands in the ledger: a human "approve", a human "keep-local", an auto pass, or no usable record.
export function publishApproval(ledger) {
  const record = publishRecord(ledger);
  if (HUMAN_SOURCES.includes(record?.source)) {
    if (record.answer === "approve") return "human";
    if (record.answer === KEEP_LOCAL) return "keep-local";
  }
  return record?.source === "auto" ? "auto" : "none";
}

// The title and labels of the draft, as an approval binds them: a hash of the title (it becomes the squash-merge
// headline) and the labels as they will be passed to gh.
export const draftBinding = (draft) => ({
  titleHash: sha256(draft.title),
  labels: draft.labels,
  coordinationHash: draft.coordination == null ? null : sha256(draft.coordination),
});

// What an approval is compared with: HEAD, base and target, the body bytes (null when there is no body) and the draft.
export const currentBinding = (root, draft, body) => ({ ...publishFacts(root), bodyHash: body === null ? null : sha256(body), ...draftBinding(draft) });

// Whether a G:publish record carries a binding to HEAD or run/pr-body.md.
const isBound = (record) => record.headSha !== undefined || record.bodyHash !== undefined;

// A human approval, or an auto pass that carries a binding to HEAD or the PR body (a bare auto record is no approval).
export const isPublishApproved = (ledger) => {
  const approval = publishApproval(ledger);
  return approval === "human" || (approval === "auto" && isBound(publishRecord(ledger)));
};

// Why a G:publish approval no longer matches the current binding, or null when it still does.
export function staleBindingReason(record, current) {
  if (!isBound(record)) return "the G:publish approval no longer holds: it carries no binding to HEAD or run/pr-body.md";
  const moved = (name, was, now) => (was === now ? [] : [`${name} changed from ${was ?? "none"} to ${now}`]);
  const changes = [
    ...(record.headSha === current.headSha ? [] : [`HEAD moved from ${short(record.headSha)} to ${short(current.headSha)}`]),
    ...(record.bodyHash === current.bodyHash ? [] : ["run/pr-body.md changed"]),
    ...(record.titleHash === current.titleHash ? [] : ["the PR title changed"]),
    ...(isDeepStrictEqual(record.labels, current.labels) ? [] : ["the PR labels changed"]),
    ...((record.coordinationHash ?? null) === current.coordinationHash ? [] : ["the coordination comment changed"]),
    ...moved("base", record.base, current.base),
    ...moved("target", record.target, current.target),
  ];
  return changes.length === 0 ? null : `the G:publish approval no longer holds: ${changes.join(" and ")}`;
}

// A human or auto approval that no longer matches HEAD, run/pr-body.md or the draft's title and labels does not stand. Null when
// it does, or when there is none. `current` is the binding the caller already read, so one read serves the check and the use.
export function publishVoidReason(ledger, root, current = null) {
  if (!["human", "auto"].includes(publishApproval(ledger))) return null;
  const draft = current === null ? readDraftArtifact(root, ledger.stage) : null;
  const bound = current ?? currentBinding(root, draft, existsSync(prBodyPath(root)) ? readFileSync(prBodyPath(root)) : null);
  return staleBindingReason(publishRecord(ledger), bound);
}

// The stale approval leaves the gates and is kept in voidedGates with the reason, so the audit trail shows it was given and then voided.
export function voidPublish(ledger, reason) {
  const { [PUBLISH_GATE]: record, ...kept } = ledger.gates;
  if (record === undefined) return ledger;
  return { ...ledger, gates: kept, voidedGates: [...(ledger.voidedGates ?? []), { gate: PUBLISH_GATE, record, reason }] };
}

// A model writes the dialog, so its words are the human's only when they are the words the CLI emitted, alone in
// the call. Otherwise it could put "approve" on a description that says something else.
export const isGateQuestionCall = (asked, questions) => asked !== null && Array.isArray(questions) && questions.length === 1 && isDeepStrictEqual(questions[0], asked);

// A choice's word typed alone ("Approve", or "approve" where the question offers publish) says no more than a choice,
// and may be a choice this question does not offer, so it is taken as no answer, never as a note.
const CHOICE_WORDS = new Set([...GATE_OPTIONS, ...PUBLISH_OPTIONS].map(({ label }) => label.toLowerCase()));

// What the human typed in place of a listed choice, or null when they picked a choice or wrote nothing.
function typedText(asked, toolResponse) {
  const answer = toolResponse.answers?.[asked.question];
  if (typeof answer !== "string" || answer.trim() === "") return null;
  if (asked.options.some(({ label }) => label === answer) || CHOICE_WORDS.has(answer.trim().toLowerCase())) return null;
  return answer.trim();
}

// The approve, redo or stop that a finished AskUserQuestion gave the pending gate, or null. Typed words that are none of
// the choices send the step back where redo is a choice, with the words as its note: free text never approves anything.
export function gateAnswer(ledger, toolResponse) {
  const asked = pendingQuestion(ledger);
  if (!isGateQuestionCall(asked, toolResponse?.questions)) return null;
  const answer = toolResponse.answers?.[asked.question];
  if (asked.options.some(({ label }) => label === answer)) return answer;
  return typedText(asked, toolResponse) !== null && asked.options.some(({ label }) => label === "redo") ? "redo" : null;
}

// Typed words this question could not take, since redo is none of its choices, or null. The tap says so, so the
// question is asked again with a listed choice and does not come back unexplained.
export function untakenTypedAnswer(ledger, toolResponse) {
  const asked = pendingQuestion(ledger);
  if (!isGateQuestionCall(asked, toolResponse?.questions) || gateAnswer(ledger, toolResponse) !== null) return null;
  const typed = typedText(asked, toolResponse);
  return typed === null ? null : { typed, labels: asked.options.map(({ label }) => label) };
}

// A redo sends the stage back and leaves no record, so the gate comes due again when the stage finishes.
function reopenStage(ledger, name, gates) {
  const { [name]: _cleared, ...kept } = ledger.gates;
  const stage = gates.find((gate) => gate.name === name).stage;
  // The old run is over; a redone current stage must not offer it for resume.
  const current = ledger.stage.name === stage ? { ...ledger.stage, runId: null } : ledger.stage;
  return withStageStatus({ ...ledger, gates: kept, stage: current }, stage, REDO_STATUS);
}

// What the human is shown at G:publish and what an approval binds to: HEAD, where the unit started and where the PR goes.
export function publishFacts(root) {
  const subject = readPrSubject(root);
  return { headSha: currentHead(root), base: subject.base, target: isRefreshSubject(root) ? subject.base : targetBranch(readGitConfig(root), subject) };
}

// What an approval at G:publish binds to, from a human or from the auto policy: the commit, the body, the title and the labels, and where
// they go. It re-runs the lint, so a human approval also records when it was given over a failed one. `shown` is what gate eval showed
// (needsHuman.shown): whenever it is passed, by a human answer or by the auto pass, HEAD must still be that commit, or what is approved is not what was shown. The body hash is not compared: the human may
// edit the body at the gate (D20), so it binds at answer time, after the lint re-run.
export function publishBinding(root, ledger, shown = null) {
  const facts = publishFacts(root);
  if (shown?.headSha !== undefined && shown.headSha !== facts.headSha) {
    throw new PublishRefused(`HEAD moved since the question: G:publish was shown ${short(shown.headSha)} and HEAD is ${short(facts.headSha)}, so nothing was approved`);
  }
  const draft = readDraftArtifact(root, ledger.stage);
  const lint = runPrLint(root, draft.title);
  const failed = lint.ok ? {} : { lintOk: false, lintFailures: lint.failures };
  return { ...facts, bodyHash: lint.bodyHash, ...draftBinding(draft), ...failed };
}

// The gate record of an approval, from a human or the auto policy. A publish approval carries its binding.
export const approvalRecord = (source, binding = {}) => ({ source, answer: "approve", ...binding });

// The open doubts the question at this gate named, kept on the answer's record so the report can show what was approved past.
const askedDoubts = ({ needsHuman }, name) => (needsHuman?.gate === name && Array.isArray(needsHuman.doubts) && needsHuman.doubts.length > 0 ? { doubts: needsHuman.doubts } : {});

// How long the question at this gate waited on the human, kept on the answer's record: that time is no working time. Only a
// question that recorded when it was asked (needsHuman.askedAt) has a wait; an older ledger's records stay as they were.
const waitedFor = ({ needsHuman }, name, answeredAt) => (needsHuman?.gate === name && typeof needsHuman.askedAt === "string" ? { askedAt: needsHuman.askedAt, answeredAt } : {});

// An answered wait whose gate record goes away or is replaced, kept in gateWaits so the time stays waiting and never reads as work.
const keptWait = (ledger, name, { askedAt, answeredAt }) =>
  typeof askedAt === "string" && typeof answeredAt === "string" ? { ...ledger, gateWaits: [...(ledger.gateWaits ?? []), { gate: name, askedAt, answeredAt }] } : ledger;

// What a human's answer to the asking gate does to the ledger. A publish answer is an approval that carries its binding.
// A redo clears the gate's record; its wait moves to gateWaits.
export function recordAnswer(ledger, name, answer, gates, binding = {}, answeredAt = new Date().toISOString()) {
  const asked = { ...ledger, needsHuman: null };
  const waited = waitedFor(ledger, name, answeredAt);
  if (answer === "redo") return reopenStage(keptWait(asked, name, waited), name, gates);
  if (answer === PUBLISH_LABEL) return { ...asked, gates: { ...ledger.gates, [name]: { ...approvalRecord("human", binding), ...askedDoubts(ledger, name), ...waited } } };
  if (answer === KEEP_LOCAL_LABEL) return { ...asked, gates: { ...ledger.gates, [name]: { source: "human", answer: KEEP_LOCAL, ...waited } } };
  const recorded = { ...asked, gates: { ...ledger.gates, [name]: { source: "human", answer, ...(answer === "approve" ? askedDoubts(ledger, name) : {}), ...waited } } };
  return answer === "stop" ? { ...recorded, stop: { code: HUMAN_STOPPED, reason: `the human answered stop at ${name}`, seq: ledger.seq + 1 } } : recorded;
}

// ---------- redo feedback ----------

function guidanceFile(path) {
  if (!existsSync(path)) return { guidance: [] };
  const file = parsedOrNull(path);
  if (!Array.isArray(file?.guidance)) throw new Error(`${path} holds no guidance list, so a redo's feedback was not added to it`);
  return file;
}

// Only tool_response counts, as for the answer: it holds what the human wrote. A redo with no note still tells the
// next attempt that the last one was sent back.
function redoFeedback(gate, stage, attempt, toolResponse, asked) {
  const notes = toolResponse.annotations?.[asked.question]?.notes;
  const written = [typedText(asked, toolResponse), typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null].filter((text) => text !== null);
  if (written.length > 0) return written.join("\n");
  return `The human sent ${stage} back at ${gate} with no note, after attempt ${attempt}. Do not repeat that result.`;
}

// Stage agents read human-guidance.json, so this is how a redo reaches the next attempt (Data flow step 11).
export function appendRedoFeedback(root, ledger, gates, toolResponse) {
  const gate = ledger.needsHuman.gate;
  const { stage } = gates.find(({ name }) => name === gate);
  const path = join(root, ".pairingbuddy", "human-guidance.json");
  const file = guidanceFile(path);
  const entry = { agent: stage, timestamp: new Date().toISOString(), context: `redo at ${gate}`, feedback: redoFeedback(gate, stage, ledger.stage.attempt, toolResponse, ledger.needsHuman.question) };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ ...file, guidance: [...file.guidance, entry] }, null, 2)}\n`);
  renameSync(temp, path);
}

// A human's way past any answer: it undoes a redo that has not restarted, and the stop this gate's answer set.
export function recordApproval(ledger, name, gates, binding = {}, answeredAt = new Date().toISOString(), source = "human-cli") {
  const reopened = reopenedGate(gates, ledger);
  const restored = reopened?.name === name ? withStageStatus(ledger, reopened.stage, "done") : ledger;
  const stoppedHere = Object.hasOwn(ledger.gates, name) && ledger.gates[name].answer === "stop";
  const kept = keptWait(restored, name, ledger.gates[name] ?? {});
  return { ...kept, needsHuman: null, stop: stoppedHere ? null : ledger.stop, gates: { ...ledger.gates, [name]: { ...approvalRecord(source, binding), ...askedDoubts(ledger, name), ...waitedFor(ledger, name, answeredAt) } } };
}
