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

// What the whole task spent, from each run's own record: the agents and tokens summed, the tokens known only when each run
// knew its own. A reload empties the session's spawns; these records outlive it.
export function taskSpend(runs) {
  const spends = runs.map((run) => run.ledger?.spend);
  const sum = (field) => spends.reduce((total, spend) => total + (Number(spend?.[field]) || 0), 0);
  return { ...spends.at(-1), agents: sum("agents"), tokens: sum("tokens"), tokensKnown: spends.every((spend) => spend?.tokensKnown === true) };
}

// Every run of the task has ended (pb kept it, or the session saw it end), so its records are whole.
export const taskEnded = (runs) => runs.length > 0 && runs.every((run) => Number.isFinite(Date.parse(run.endedAt)));

// What the pane shows of a task once every run of it has ended, from the runs pb kept (taskRuns): what it spent, from its
// first run's start to its last run's end, every return its runs kept, which the review is read from, and the pull request
// its publish run opened. Null while a run of it has not ended, or when no run is kept.
export function endedTaskFacts(runs) {
  if (!Array.isArray(runs) || !taskEnded(runs)) return null;
  const prUrl = runs.findLast((run) => typeof run.prUrl === "string" && run.prUrl !== "")?.prUrl ?? null;
  return { spend: taskSpend(runs), startedAt: runStart(runs[0].ledger) ?? null, endedAt: runs.at(-1).endedAt, calls: runs.flatMap((run) => (Array.isArray(run.calls) ? run.calls : [])), prUrl };
}
