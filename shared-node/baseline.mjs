// The failures a task's full suite already had before the task changed anything (its baseline, recorded by pb test
// --baseline in intake), and the rule that judges a later full run against it. Pure: pb, the gate facts and the report
// read it alike.

// The runner name test-run.mjs gives a lint check.
const LINT_RUNNER = "lint";

// A run is the same check as a baseline run when it is the same runner (a lint check: the same command).
export const runKey = ({ runner, argv = [] }) => (runner === LINT_RUNNER ? `${LINT_RUNNER} ${argv.join(" ")}` : runner);
export const failed = ({ exitCode, timedOut }) => exitCode !== 0 || timedOut === true;

// A failing run the baseline excuses: the same check failed at baseline too, and every test it names failed then. A run
// that names no failing test (it could not start, or its runner's output is not read) is excused only when its baseline
// run named none either and exited the same way: a broken runner, still broken the same way.
function excused(run, baseRun) {
  if (baseRun === undefined || !failed(baseRun)) return false;
  const now = run.failures ?? [];
  const then = baseRun.failures ?? [];
  if (now.length === 0) return then.length === 0 && baseRun.exitCode === run.exitCode && baseRun.timedOut === run.timedOut;
  return now.every((line) => then.includes(line));
}

// The failures a baseline excuses, per check: broken when the check names no failing test (it could not run any).
const preexistingRow = (run) => ({ runner: runKey(run), failures: run.failures ?? [], broken: (run.failures ?? []).length === 0 });

// The baseline's own failing checks, as the report and the question list them.
export const baselineFailures = (baseline) => (Array.isArray(baseline?.runs) ? baseline.runs.filter(failed).map(preexistingRow) : []);

// A full-suite record judged against the task's baseline: it passes when every failing run is excused, and lists the
// excused ones, so the human still sees them. No baseline (a run opened before there was one) judges as before.
export function judgedRecord(record, baseline) {
  if (!Array.isArray(baseline?.runs)) return record;
  const byKey = new Map(baseline.runs.map((run) => [runKey(run), run]));
  const failing = record.runs.filter(failed);
  const kept = failing.filter((run) => excused(run, byKey.get(runKey(run))));
  if (kept.length === 0) return record;
  return { ...record, passed: kept.length === failing.length, preexisting: kept.map(preexistingRow) };
}
