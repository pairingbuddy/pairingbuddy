// The TESTS and TEST rows' data: folds per-test progress into marks (done, covered, current, waiting) and fits the progress row and
// the looping tries to a width budget. Pure; no node: imports.
import { currentStep, elapsed, isLooping, stageOf } from "./glance.mjs";
import { resultWords } from "./report.mjs";
import { PHASES, readLabel, refactorsPerCycle } from "./labels.mjs";

const SHOWN = 3;

// settled: the build is over, so the list is no longer folded around a current test: the tests that did not pass lead, then
// the rest, the first few shown and the others counted.
export function progressRow({ tests, perTest, spawns, stage, settled = false }) {
  const current = currentStep(spawns, stage)?.item ?? null;
  const entries = (Array.isArray(tests) ? tests : []).map((test) => {
    const id = test.test_id;
    const done = Boolean(perTest?.[id]?.green?.passed);
    const covered = Boolean(perTest?.[id]?.covered?.done);
    // The test a step is on is current until the next test's step starts, though its GREEN passed: REFACTOR is still its cycle.
    return { id, mark: id === current ? "current" : done ? "done" : covered ? "covered" : "waiting" };
  });
  if (entries.length <= SHOWN) return { entries };
  if (settled) {
    const finished = (entry) => entry.mark === "done" || entry.mark === "covered";
    const ordered = [...entries.filter((entry) => !finished(entry)), ...entries.filter(finished)];
    return { entries: ordered.slice(0, SHOWN), more: ordered.length - SHOWN };
  }
  const waitingOrCurrent = entries.filter((entry) => entry.mark !== "done" && entry.mark !== "covered");
  const folded = entries.filter((entry) => entry.mark === "done").length;
  const coveredFolded = entries.filter((entry) => entry.mark === "covered").length;
  const more = waitingOrCurrent.length - SHOWN;
  return {
    ...(folded > 0 && { folded }),
    ...(coveredFolded > 0 && { coveredFolded }),
    entries: waitingOrCurrent.slice(0, SHOWN),
    ...(more > 0 && { more }),
  };
}

// How many of the planned tests passed their GREEN (done) or were already covered: the TESTS row's count.
export function testCounts({ tests, perTest }) {
  const ids = (Array.isArray(tests) ? tests : []).map((test) => test.test_id);
  return {
    total: ids.length,
    done: ids.filter((id) => perTest?.[id]?.green?.passed).length,
    covered: ids.filter((id) => !perTest?.[id]?.green?.passed && perTest?.[id]?.covered?.done).length,
  };
}

const MARKS = { done: "✓", current: "▸", waiting: "·", covered: "◌" };
const GAP = "   ";

// No width budget means it fits; width counts code points, not UTF-16 units.
const fitsWidth = (text, columns) => !(columns > 0) || [...text].length <= columns;

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
// try's result words stay whole; if they alone overflow, the pane wraps them.
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

// A test's short name: its id spaced out ("order-total-sums-two-lines" reads "order total sums two lines"). The pane and the
// band name a test so; its whole scenario sentence is the report's SCENARIOS'.
export const shortName = (testId) => String(testId).replace(/[-_]/g, " ");


// The RED/GREEN/REFACTOR marker as data the pane colours: a tick before the steps this test passed, a bullet before the
// current step, a chevron before the steps to come. No steps at all when the current step names no phase of the cycle.
export function cycleMarker({ spawns, ledger }) {
  const current = currentStep(spawns, stageOf(ledger))?.phase;
  const phases = refactorsPerCycle(ledger?.taskType) ? PHASES : PHASES.filter((name) => name !== "REFACTOR");
  const at = phases.indexOf(current);
  if (at < 0) return { steps: [] };
  const mark = (index) => (index < at ? "✓" : index === at ? "●" : "›");
  return { steps: phases.map((name, index) => ({ name, lit: name === current, mark: mark(index) })) };
}

// How long the current step has run, as a run-time clock; unknown when the spawn or the clock carries no time.
export const stepAge = ({ spawns, now, stage }) => elapsed(currentStep(spawns, stage)?.startedAt, now);

// The ledger's record is the latest try's only once that try's runner has spawned. Where earlier tries had runners, the latest
// try has one too before its result counts; where no runner is labelled at all, the record is taken as the latest try's.
function latestHasRun(spawns, current) {
  const runners = (Array.isArray(spawns) ? spawns : [])
    .map((spawn) => readLabel(spawn?.name))
    .filter((label) => !label.unknown && label.role === "runner" && label.item === current.item && label.phase === current.phase).length;
  return runners === 0 || runners >= current.tries;
}

// Once the current step has looped, every try at it with its result; the ledger's record describes the latest try only.
export function loopingTries({ spawns, perTest, stage }) {
  const current = currentStep(spawns, stage);
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
