// The "now building" block's data: folds per-test progress into marks (done, covered, current, waiting), builds the legend key line
// for those marks, and fits the progress row, legend and looping tries to a width budget. Pure; no node: imports.
import { currentStep, elapsed, isLooping } from "./glance.mjs";
import { resultWords } from "./report.mjs";
import { PHASES, readLabel, refactorsPerCycle } from "./labels.mjs";

const SHOWN = 3;

export function progressRow({ tests, perTest, spawns, testsComplete = false }) {
  const current = currentStep(spawns)?.item ?? null;
  const entries = (Array.isArray(tests) ? tests : []).map((test) => {
    const id = test.test_id;
    const done = Boolean(perTest?.[id]?.green?.passed);
    const covered = Boolean(perTest?.[id]?.covered?.done);
    return { id, mark: done ? "done" : id === current ? "current" : covered ? "covered" : "waiting" };
  });
  if (entries.length <= SHOWN) return { entries };
  const waitingOrCurrent = entries.filter((entry) => entry.mark !== "done" && entry.mark !== "covered");
  const folded = entries.filter((entry) => entry.mark === "done").length;
  const coveredFolded = entries.filter((entry) => entry.mark === "covered").length;
  const more = waitingOrCurrent.length - SHOWN;
  return {
    ...(folded > 0 && { folded }),
    ...(coveredFolded > 0 && { coveredFolded }),
    entries: waitingOrCurrent.slice(0, SHOWN),
    ...(testsComplete && more > 0 && { more }),
  };
}

const MARKS = { done: "✓", current: "▸", waiting: "·", covered: "◌" };
const GAP = "   ";

// No width budget means it fits; width counts code points, not UTF-16 units.
const fitsWidth = (text, columns) => !(columns > 0) || [...text].length <= columns;

const LEGEND = [
  ["done", "made to pass"],
  ["covered", "already passed, nothing to fix"],
  ["current", "now"],
  ["waiting", "to do"],
];

// The key to the progress marks as one line, glyphs taken from MARKS. Whole entries drop from the end until it fits the width.
export function fitLegend(columns) {
  const entries = LEGEND.map(([mark, words]) => `${MARKS[mark]} ${words}`);
  const fits = (count) => fitsWidth(entries.slice(0, count).join(GAP), columns);
  let count = entries.length;
  while (count > 1 && !fits(count)) count -= 1;
  return entries.slice(0, count).join(GAP);
}

const rowText = ({ folded = 0, coveredFolded = 0, entries, more = 0 }) => {
  const parts = entries.map((entry) => `${MARKS[entry.mark]} ${entry.name}`);
  if (coveredFolded) parts.unshift(`${MARKS.covered} ${coveredFolded} covered`);
  if (folded) parts.unshift(`${MARKS.done} ${folded} done`);
  if (more) parts.push(`+${more} more`);
  return parts.join(GAP);
};

// The progress row as one line of text. With a width budget, whole items fold until it fits: trailing waiting items drop into
// "+ n more" (counted only when progress.known), then done and covered items collapse into "✓ n done" and "◌ m covered"; the current item always stays.
export function fitProgress(progress, columns) {
  const fits = (row) => fitsWidth(rowText(row), columns);
  let row = { folded: progress.folded ?? 0, coveredFolded: progress.coveredFolded ?? 0, entries: [...progress.entries], more: progress.more ?? 0 };
  const dropWaiting = () => {
    const index = row.entries.findLastIndex((entry) => entry.mark === "waiting");
    if (index < 0) return false;
    row = { ...row, entries: row.entries.filter((_, at) => at !== index), more: progress.known ? row.more + 1 : row.more };
    return true;
  };
  while (!fits(row) && dropWaiting());
  if (!fits(row)) {
    const finished = (entry) => entry.mark === "done" || entry.mark === "covered";
    const count = (mark) => row.entries.filter((entry) => entry.mark === mark).length;
    row = {
      ...row,
      folded: row.folded + count("done"),
      coveredFolded: row.coveredFolded + count("covered"),
      entries: row.entries.filter((entry) => !finished(entry)),
    };
  }
  return rowText(row);
}

// The looping tries as one line that fits the width budget where it can. What gives way, in order: older tries fold into
// "+n earlier ·", then that prefix goes, then " at STEP" leaves the latest try (the LOOPING row above names the step). The latest
// try's result words stay whole; only if they alone overflow is the final cut left to the Text's truncate-end.
export function fitTries(tries, columns) {
  const last = tries.length - 1;
  const text = (hidden, { prefix = true, step = true } = {}) => {
    const shown = tries.slice(hidden).map((t, at) => `try ${t.number}${step || hidden + at < last ? ` at ${t.step}` : ""}: ${t.result}`);
    return `  ${hidden && prefix ? `+${hidden} earlier · ` : ""}${shown.join(" · ")}`;
  };
  const folds = Array.from({ length: tries.length }, (_, hidden) => text(hidden));
  const candidates = [...folds, text(last, { prefix: false }), text(last, { prefix: false, step: false })];
  return candidates.find((line) => fitsWidth(line, columns)) ?? candidates.at(-1);
}

const spaced = (id) => String(id).replaceAll("-", " ");

const list = (value) => (Array.isArray(value) ? value : []);
const isText = (value) => typeof value === "string" && value !== "";

// Narrows the parsed tests.json and scenarios.json to { test id: description }; anything malformed reads as no name.
export function testNames({ tests, scenarios } = {}) {
  const descriptions = {};
  for (const scenario of list(scenarios?.scenarios)) {
    for (const testCase of list(scenario?.test_cases)) {
      if (isText(testCase?.test_case_id) && isText(testCase?.description)) descriptions[testCase.test_case_id] ??= testCase.description;
    }
  }
  const names = {};
  for (const entry of list(tests?.tests)) {
    const description = descriptions[entry?.test_case_id];
    if (isText(entry?.test_id) && description !== undefined) names[entry.test_id] ??= description;
  }
  return names;
}

// The description for a test id from a names map, else the id spaced out.
export const nameOf = (names, testId) => (isText(testId) && Object.hasOwn(names ?? {}, testId) ? names[testId] : spaced(testId));

export const testName = ({ testId, tests, scenarios }) => nameOf(testNames({ tests, scenarios }), testId);

// The RED/GREEN/REFACTOR marker as data the pane colours: a bullet before the current step, a chevron before the rest.
export function cycleMarker({ spawns, ledger }) {
  const current = currentStep(spawns)?.phase;
  const phases = refactorsPerCycle(ledger?.taskType) ? PHASES : PHASES.filter((name) => name !== "REFACTOR");
  return { steps: phases.map((name) => ({ name, lit: name === current, mark: name === current ? "●" : "›" })) };
}

// How long the current step has run, as a run-time clock; unknown when the spawn or the clock carries no time.
export const stepAge = ({ spawns, now }) => elapsed(currentStep(spawns)?.startedAt, now);

// The ledger's record is the latest try's only once that try's runner has spawned. Where earlier tries had runners, the latest
// try has one too before its result counts; where no runner is labelled at all, the record is taken as the latest try's.
function latestHasRun(spawns, current) {
  const runners = (Array.isArray(spawns) ? spawns : [])
    .map((spawn) => readLabel(spawn?.name))
    .filter((label) => !label.unknown && label.role === "runner" && label.item === current.item && label.phase === current.phase).length;
  return runners === 0 || runners >= current.tries;
}

// Once the current step has looped, every try at it with its result; the ledger's record describes the latest try only.
export function loopingTries({ spawns, perTest }) {
  const current = currentStep(spawns);
  if (!current || !isLooping(current.tries)) return undefined;
  const step = current.phase;
  const record = perTest?.[current.item];
  return Array.from({ length: current.tries }, (_, index) => {
    const number = index + 1;
    const latest = number === current.tries && latestHasRun(spawns, current);
    const result = latest ? resultWords(step, record?.[step?.toLowerCase()], record?.covered) : resultWords(step, undefined);
    return { step, number, result };
  });
}

// A spawn is only seen to finish when it carries an agentId, so that one check splits the active count from the unknown count.
const hasAgentId = (spawn) => spawn?.agentId !== undefined;

// How many spawned agents are still running: spawns with an agentId not yet marked finished.
export const activeAgents = ({ spawns }) => (spawns ?? []).filter((spawn) => hasAgentId(spawn) && !spawn.finished).length;

// How many spawns carry no agentId, so cannot be seen to finish.
export const unknownAgents = ({ spawns }) => (spawns ?? []).filter((spawn) => !hasAgentId(spawn)).length;
