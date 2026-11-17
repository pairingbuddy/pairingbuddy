// Closing a unit on disk (D19): the I/O half of the unit rules in unit.mjs, which stays pure. Node built-ins only.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The files that belong to one unit: its record and the PR draft's body and lint result.
export const UNIT_FILES = ["unit.json", "pr-body.md", "pr-lint.json"];

// The spike setup a spike run records in run/task once G:type has passed.
export const SPIKE_SETUP_FILE = "spike.json";

function removeNamed(runDir, wanted) {
  const present = existsSync(runDir) ? readdirSync(runDir).filter((name) => name !== ".gitignore") : [];
  const names = wanted === null ? present : present.filter((name) => wanted.includes(name));
  for (const name of names) rmSync(join(runDir, name), { recursive: true, force: true });
  return names;
}

// Abandon: everything under run/ goes, the task included, except run/.gitignore. Commits, branch and refs are not touched.
// Returns the names removed.
export const abandonRun = (runDir) => removeNamed(runDir, null);

// Keep local: only the unit's own files go, so a later unit cannot pick up this one's body or lint result. The task stays.
export const closeUnit = (runDir) => removeNamed(runDir, UNIT_FILES);

// Where an ended run is kept for the report of its whole task: under the reports folder, which task cleanup keeps.
export const KEPT_RUNS = ["reports", "runs"];

const jsonOf = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

// The unit a run belongs to, as the pane names it: its branch and base. Null with no unit open.
const unitKeyOf = (runDir) => {
  const unit = jsonOf(join(runDir, "unit.json"));
  return typeof unit?.branch === "string" ? `${unit.branch} ${unit.baseSha}` : null;
};

// How many ended tasks keep their runs under reports/runs/: older tasks' runs are removed when a run is kept.
export const MAX_KEPT_TASKS = 20;

const keptRecords = (runsDir) =>
  readdirSync(runsDir)
    .map((runId) => ({ runId, kept: jsonOf(join(runsDir, runId, "kept.json")) }))
    .filter(({ kept }) => kept !== null);

const endedAtOf = ({ kept }) => {
  const at = Date.parse(kept.endedAt);
  return Number.isFinite(at) ? at : -Infinity;
};

// A run with no unit is a task of its own.
const taskOf = ({ runId, kept }) => kept.unit ?? `run ${runId}`;

// The kept runs as tasks: the runs that name one unit are one task, dated by its last run; newest first.
function keptTasks(runsDir) {
  const tasks = new Map();
  for (const record of keptRecords(runsDir)) {
    const task = taskOf(record);
    const seen = tasks.get(task) ?? { task, runIds: [], endedAt: -Infinity };
    tasks.set(task, { task, runIds: [...seen.runIds, record.runId], endedAt: Math.max(seen.endedAt, endedAtOf(record)) });
  }
  return [...tasks.values()].sort((a, b) => b.endedAt - a.endedAt);
}

// The task of the run just kept counts first, so it is never the one removed.
function pruneKeptRuns(runsDir, keptRunId) {
  const own = taskOf({ runId: keptRunId, kept: jsonOf(join(runsDir, keptRunId, "kept.json")) });
  const tasks = keptTasks(runsDir);
  const ordered = [...tasks.filter(({ task }) => task === own), ...tasks.filter(({ task }) => task !== own)];
  for (const { runIds } of ordered.slice(MAX_KEPT_TASKS)) {
    for (const runId of runIds) rmSync(join(runsDir, runId), { recursive: true, force: true });
  }
}

// Copies run/task (its ledger and returns) to reports/runs/<runId>/ before the run goes, with kept.json naming its unit and
// what `extra` adds (the pull request a publish opened). Called while unit.json is still there. Best effort: the copy is
// only for the report, so a failed one never stops a run from ending.
export function keepRun(runDir, extra = {}) {
  const taskDir = join(runDir, "task");
  const runId = jsonOf(join(taskDir, "ledger.json"))?.runId;
  if (typeof runId !== "string" || !/^[\w-][\w.-]*$/.test(runId)) return;
  const kept = join(runDir, "..", ...KEPT_RUNS, runId);
  try {
    cpSync(taskDir, kept, { recursive: true });
    writeFileSync(join(kept, "kept.json"), JSON.stringify({ unit: unitKeyOf(runDir), endedAt: new Date().toISOString(), ...extra }));
    pruneKeptRuns(join(kept, ".."), runId);
  } catch {
    // The run still ends; its report shows less.
  }
}

// Ends the run that closed its unit: only run/task and the last question it asked (question.md) go. Used for a publish run,
// which has nothing left to do once the unit is closed.
export const endRun = (runDir) => removeNamed(runDir, ["task", "question.md"]);
