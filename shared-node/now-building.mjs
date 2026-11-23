// The TESTS and TEST rows' data: folds per-test progress into marks (done, covered, current, waiting) and fits the progress row
// to a width budget. Pure; no node: imports.
import { currentStep, elapsed, stageOf } from "./glance.mjs";
import { PHASES, refactorsPerCycle } from "./labels.mjs";

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
// pausedAt: where a stopped or waiting run's clock stopped (glance's pausedAtOf), so the age freezes there as SPENT does.
export const stepAge = ({ spawns, now, stage, pausedAt }) => elapsed(currentStep(spawns, stage)?.startedAt, Number.isFinite(pausedAt) && pausedAt < now ? pausedAt : now);
