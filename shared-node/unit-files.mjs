// Closing a unit on disk (D19): the I/O half of the unit rules in unit.mjs, which stays pure. Node built-ins, and the pure questions list.
import { addQuestions, answerQuestion, openQuestions, QuestionRefused, REWORKS_PER_UNIT, reworkCount, reworkTask, settleQuestion } from "./questions.mjs";
import { insertTaskInUnit } from "./plan-text.mjs";
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The files that belong to one unit: its record and the PR draft's body and lint result.
// home-repo.json and the leak files hold for one unit only (shared-node/repo-boundary.mjs, shared-node/leak-check.mjs).
export const UNIT_FILES = ["unit.json", "pr-body.md", "pr-lint.json", "home-repo.json", "leak-findings.json", "leak-allowed.json"];

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
const keyOf = (unit) => (typeof unit?.branch === "string" ? `${unit.branch} ${unit.baseSha}` : null);
const unitKeyOf = (runDir) => keyOf(jsonOf(join(runDir, "unit.json")));

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

// The test-config hash the human last accepted in this unit's kept runs: the acceptances are followed from the unit's own
// hash, run by run in the order they ended, so only a chain that starts at the unit counts. Null when there is none. Runs
// of other units never count.
export function keptAcceptedConfigHash(root, unit) {
  const runsDir = join(root, ".pairingbuddy", ...KEPT_RUNS);
  const key = keyOf(unit);
  if (key === null || !existsSync(runsDir)) return null;
  const acceptances = keptRecords(runsDir)
    .filter(({ kept }) => kept.unit === key)
    .sort((a, b) => endedAtOf(a) - endedAtOf(b))
    .flatMap(({ runId }) => {
      const recorded = jsonOf(join(runsDir, runId, "ledger.json"))?.configAcceptances;
      return Array.isArray(recorded) ? [...recorded].sort((a, b) => a?.seq - b?.seq) : [];
    });
  const last = acceptances.reduce((hash, accepted) => (accepted?.oldHash === hash && typeof accepted.newHash === "string" ? accepted.newHash : hash), unit.configHash);
  return last === unit.configHash ? null : last;
}

// An open unit's record that cannot take the accepted test-config. The run's ledger has pinned it already.
export class UnitConfigRefused extends Error {}

const unitRecordFor = (path) => {
  const why = "the unit cannot pin the accepted test-config. The run's ledger has pinned it";
  let unit;
  try {
    unit = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new UnitConfigRefused(`run/unit.json is unreadable, so ${why}: ${e.message}`);
  }
  if (!Array.isArray(unit?.tasks)) throw new UnitConfigRefused(`run/unit.json has no tasks list, so ${why}`);
  return unit;
};

// A test-config the human accepted while a unit is open is pinned in the unit too, so its hash never falls behind the
// run's ledger and pb publish does not refuse it. pb human accept and the tap's Accept both come here.
export function acceptConfigInUnit(root, { newHash, seq }) {
  const path = join(root, ".pairingbuddy", "run", "unit.json");
  if (!existsSync(path)) return;
  const unit = unitRecordFor(path);
  if (unit.configHash === newHash) return;
  const configAcceptances = [...(unit.configAcceptances ?? []), { oldHash: unit.configHash, newHash, seq }];
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ ...unit, configHash: newHash, configAcceptances }, null, 2)}\n`);
  renameSync(temp, path);
}

// A git-config change the human applied (pb human config apply) is pinned in the open unit, so pb publish does not read it
// as changed since the unit opened. A unit that never recorded a git-config hash is left as it is.
export function pinGitConfigInUnit(root, newHash) {
  const path = join(root, ".pairingbuddy", "run", "unit.json");
  if (!existsSync(path)) return;
  const unit = JSON.parse(readFileSync(path, "utf8"));
  if (unit.gitConfigHash === undefined || unit.gitConfigHash === newHash) return;
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ ...unit, gitConfigHash: newHash }, null, 2)}\n`);
  renameSync(temp, path);
}

// The doubts an auto pass deferred, added to the open unit's questions so G:publish asks them before anything goes out.
// With no unit open there is nowhere to keep them: the gate asks them then and there (unitIsOpen).
export function deferQuestionsInUnit(root, { gate, task, doubts }) {
  const path = join(root, ".pairingbuddy", "run", "unit.json");
  const unit = JSON.parse(readFileSync(path, "utf8"));
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(addQuestions(unit, { gate, task, doubts }), null, 2)}\n`);
  renameSync(temp, path);
}

// The human approved G:publish over the unit's questions: they are answered, so they leave the unit. The gate record keeps
// them (askedDoubts). No unit open, or none held, writes nothing.
export function clearQuestionsInUnit(root) {
  const path = join(root, ".pairingbuddy", "run", "unit.json");
  if (!existsSync(path)) return;
  const { questions, questionsMore, ...unit } = JSON.parse(readFileSync(path, "utf8"));
  if (questions === undefined && questionsMore === undefined) return;
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(unit, null, 2)}\n`);
  renameSync(temp, path);
}

const writeJson = (path, value) => {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
};

// The human answered question n of the open unit (pb human answer, from /pb-questions): the answer lands on the question, and as
// guidance every step that starts from now reads, so it takes effect between steps and never mid-step. Returns the
// question and how many stay open. Throws a QuestionRefused with no unit open, no such question or no answer.
export function answerQuestionInUnit(root, n, text, at = new Date().toISOString()) {
  const path = join(root, ".pairingbuddy", "run", "unit.json");
  if (!existsSync(path)) throw new QuestionRefused("no unit is open, so there is no question for you to answer");
  const unit = answerQuestion(JSON.parse(readFileSync(path, "utf8")), n, text, at);
  writeJson(path, unit);
  const question = unit.questions[n - 1];
  const guidancePath = join(root, ".pairingbuddy", "human-guidance.json");
  const file = existsSync(guidancePath) ? JSON.parse(readFileSync(guidancePath, "utf8")) : { guidance: [] };
  const entry = { agent: "all", timestamp: at, context: `answer to a question for you, raised at ${question.gate} in ${question.task}`, feedback: `Question: ${question.ambiguity}\nAnswer: ${question.answer}` };
  writeJson(guidancePath, { ...file, guidance: [...(Array.isArray(file.guidance) ? file.guidance : []), entry] });
  return { question, open: openQuestions(unit).count };
}

// The session settled the human's answer to question n at a task boundary: "keep" only records it, as the answer already
// guides the steps; "rework" adds a task to the unit in the plan, before its next task, that changes the work already done.
// At most REWORKS_PER_UNIT per unit: past that it is refused, for the human to say whether the unit has become a re-plan.
export function settleQuestionInUnit(root, n, how) {
  const path = join(root, ".pairingbuddy", "run", "unit.json");
  if (!existsSync(path)) throw new QuestionRefused("no unit is open, so there is no answer to settle");
  const unit = JSON.parse(readFileSync(path, "utf8"));
  if (how === "keep") {
    writeJson(path, settleQuestion(unit, n, "keep"));
    return { settled: "keep" };
  }
  settleQuestion(unit, n, "keep"); // refuses an unknown, unanswered or settled question before anything is written
  if (typeof unit.plan !== "string" || unit.plan === "") throw new QuestionRefused(`unit ${unit.unit} names no plan, so a rework task has nowhere to go`);
  const reworks = reworkCount(unit);
  if (reworks >= REWORKS_PER_UNIT) throw new QuestionRefused(`unit ${unit.unit} already has ${reworks} rework tasks from answers, its cap of ${REWORKS_PER_UNIT}. Show the human the answer and ask whether the unit has become a re-plan`);
  const { title, text } = reworkTask(unit.unit, reworks + 1, unit.questions[n - 1]);
  const settled = settleQuestion(unit, n, "rework", title);
  const planPath = join(root, unit.plan);
  writeFileSync(planPath, insertTaskInUnit(readFileSync(planPath, "utf8"), unit.unit, text));
  writeJson(path, settled);
  return { settled: "rework", task: title };
}

export const unitIsOpen = (root) => existsSync(join(root, ".pairingbuddy", "run", "unit.json"));

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
