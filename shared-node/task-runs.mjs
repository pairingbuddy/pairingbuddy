// The runs one task's report describes: the runs pb kept under reports/runs/ when they ended (keepRun in unit-files.mjs),
// joined by the unit they name, so a code run and the publish run after it read as one task. Pure; no node: imports.
import { runStart } from "./glance.mjs";

// A kept run is { ledger, unit, endedAt?, prUrl?, calls?, scenarios? }; the reported run is the live or last polled ledger.
// unitKey: the open unit as the pane last saw it, for a live run that is not kept yet. Returns the runs oldest first.
export function taskRuns({ ledger, kept = [], unitKey = null, calls, scenarios, endedAt, prUrl } = {}) {
  const runs = (Array.isArray(kept) ? kept : []).filter((run) => run?.ledger);
  const id = ledger?.runId;
  // With no ledger to go by (a new session after the task ended), the run that ended last is the one reported.
  const own = ledger ? runs.find((run) => id !== undefined && run.ledger.runId === id) : [...runs].sort((a, b) => endOf(a) - endOf(b)).at(-1);
  const current = own ?? { ledger, calls, scenarios, endedAt, prUrl };
  const unit = own?.unit ?? unitKey;
  const others = unit == null ? [] : runs.filter((run) => run !== own && run.unit === unit);
  return [...others, current].filter((run) => run.ledger).sort((a, b) => startOf(a) - startOf(b));
}

// A run whose start is not known sorts last, as the live run is.
const startOf = (run) => {
  const start = Date.parse(runStart(run.ledger));
  return Number.isFinite(start) ? start : Infinity;
};

const endOf = (run) => {
  const end = Date.parse(run.endedAt);
  return Number.isFinite(end) ? end : -Infinity;
};

// The commits of the whole task, in run order, each once.
export const taskCommitShas = (runs) => [...new Set(runs.flatMap((run) => (Array.isArray(run.ledger?.commits) ? run.ledger.commits : [])))];
