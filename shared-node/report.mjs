// The HTML run report (R5-3): a pure render of a recorded run into one self-contained string.
// No fs, no network, no node: imports, so the mod can import it. Recorded text is escaped.
import { isPassed } from "./gate-passed.mjs";
import { plainName } from "./plain-names.mjs";
import { clock } from "./duration.mjs";
import { gateLine, glance, plural, runStart, stopName, testLabels, currentStep, triesAtStep, isLooping } from "./glance.mjs";
import { readLabel } from "./labels.mjs";
import { stageNamesFor } from "./stage-graph.mjs";
import contract from "./stages-contract.mjs";
import { FINDING_WORDS, distinctFindings, findingGist, lensRound } from "./lens-round.mjs";
import { parseKey } from "./keys.mjs";
import { baselineFailures } from "./baseline.mjs";
import { lensOfFinding } from "./lens-merge.mjs";
import { taskEnded, taskSpend, taskWaited } from "./task-runs.mjs";
import { shortName } from "./now-building.mjs";
import { goalOf } from "./end-state.mjs";
import { permissionLine, withPermissionAsk } from "./permission-wait.mjs";
import { finalCheckRows, isStandingScenarios, newestKeyAmong } from "./standing-scenarios.mjs";

const TASK_END = "G:task-end";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

// One row, as the pane draws it: its label in the left column, what it holds to the right.
const section = (title, body, kind) => `<section${kind ? ` class="${kind}"` : ""}>\n<h2>${title}</h2>\n<div>\n${body}\n</div>\n</section>`;

function outcome(ledger) {
  if (ledger?.stop) return "STOPPED";
  return ledger?.stage?.status === "done" ? "DONE" : "RUNNING";
}

// Where the task is, for the header: waiting on you while a question is asked or the sign-off is not given yet.
function whereItIs(ledger, task) {
  const state = outcome(ledger);
  if (state === "STOPPED") return state;
  return ledger?.needsHuman?.gate || awaitsSignOff(task) ? "WAITING ON YOU" : state;
}

// The task's code run finished and was not signed off.
function awaitsSignOff(task) {
  const code = codeRunIn(task).ledger;
  return outcome(code) === "DONE" && code?.kind !== PUBLISH_KIND && !(code?.gates && isPassed(code, TASK_END));
}

// How the guidance was carried into this task: auto when nobody was asked, so the human can check it afterwards.
function guidanceRow(ledger) {
  const guidance = ledger?.guidance;
  if (!Number.isInteger(guidance?.kept) || !Number.isInteger(guidance?.dropped)) return {};
  return { guidance: `kept ${guidance.kept}, dropped ${guidance.dropped}${guidance.mode === "auto" ? " (auto)" : ""}` };
}

function glanceLabels(ledger) {
  return { type: "Task type", guidance: "Guidance", now: ledger?.stop ? "Where it stopped" : "Where it is", spent: "Spent", waited: "Waited", left: "Left" };
}

// The run's length: endedAt (or the last stage end) minus its start; NaN when either is missing.
// A run that has not ended (no end, no stage end, not DONE/STOPPED) is measured to `now`.
function runSeconds(ledger, endedAt, now) {
  const stages = Array.isArray(ledger?.stages) ? ledger.stages : [];
  const ends = stages.map((stage) => Date.parse(stage?.end)).filter(Number.isFinite);
  const live = outcome(ledger) === "RUNNING" && Number.isFinite(now) ? now : NaN;
  const end = Number.isFinite(Date.parse(endedAt)) ? Date.parse(endedAt) : ends.length > 0 ? Math.max(...ends) : live;
  const seconds = (end - Date.parse(runStart(ledger))) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : NaN;
}

// The task's length: each run's own length added up, as SPENT counts it, so the time between runs (a person doing a [HUMAN]
// task, a new session) is left out. The last run is measured with `ledger` (its permission ask read in) and, when it was not
// kept, the given end. NaN when a run's length is unknown.
function taskSeconds(task, ledger, endedAt, now) {
  const last = task.length - 1;
  return task.reduce((total, run, i) => total + (i === last ? runSeconds(ledger, run.endedAt ?? endedAt, now) : runSeconds(run.ledger, run.endedAt, now)), 0);
}

// Left only means something while the run goes, so a finished run has no such row.
const LIVE_ROWS = ["left"];

// A wait on the human in hours and minutes ("4h 1m"), minutes, or seconds when under one.
function waitWords(seconds) {
  const [h, m] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60];
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m` : `${Math.floor(seconds)}s`;
}

function atAGlance({ ledger, spawns, ranFor, tests, testsComplete, task, taskType, now }) {
  const spend = taskSpend(task);
  // Once every run has ended, the agents are the ones the runs recorded; the session's spawns may be gone.
  const agents = taskEnded(task) ? spend.agents : undefined;
  // Time spent waiting on the human is no working time: Spent leaves it out, and Waited says it apart.
  const waited = taskWaited(task, now);
  const { rows: all } = glance({ ledger: { ...ledger, spend }, spawns, tests, ranFor, testsComplete, agents, waited });
  const done = outcome(ledger) === "DONE";
  const rows = done ? Object.fromEntries(Object.entries(all).filter(([key]) => !LIVE_ROWS.includes(key))) : all;
  if (done) rows.now = "finished";
  if (waited >= 1) rows.waited = `${waitWords(waited)} waiting for you`;
  const labels = glanceLabels(ledger);
  // A type auto mode passed on likely (the G:type record keeps the confidence) reads as not certain, so the human can check it.
  const likely = ledger?.gates?.["G:type"]?.confidence === "likely" ? " (likely, not certain: auto mode went on)" : "";
  const typed = { type: `${plainName(taskType) ?? UNKNOWN}${likely}`, ...guidanceRow(ledger), ...rows };
  const lines = Object.entries(typed).map(([key, text]) => `<p><strong>${labels[key]}</strong> ${escape(text)}</p>`);
  return section("AT A GLANCE", lines.join("\n"), "glance");
}

// The tests the run touched, in order of first appearance, by the same label rule as the pane.
const testsSeen = (spawns) => [...new Set(testLabels(spawns).map((label) => label.item))];

// The one numbering of tests: the plan's `tests` first, then any seen in the run that the plan lacks; first-spawn order when no plan is given.
const numberedTests = (spawns, tests) => [...new Set([...(Array.isArray(tests) ? tests : []), ...testsSeen(spawns)])];

// What a stopped run keeps: the current test is the pane's (the last labelled spawn's), numbered by its place in the tests seen.
function rerunStep(spawns, tests) {
  const rerun = "Re-run /pairingbuddy:code.";
  const step = currentStep(spawns);
  if (!step) return `${rerun} The recorded run does not say which test it stopped on, so what it keeps is unknown.`;
  const current = numberedTests(spawns, tests).indexOf(step.item) + 1;
  if (current === 1) return `${rerun} It continues from test 1.`;
  const kept = current === 2 ? "test 1" : `tests 1 to ${current - 1}`;
  const pronoun = current === 2 ? "its" : "their";
  return `${rerun} It continues from test ${current} and keeps ${kept} and ${pronoun} commits.`;
}


const UNKNOWN = "unknown";
const REVIEW_ROLE = "lens";

// One row per try: a writing spawn (the label's phase is the step) and the runner spawn that follows it on the same test.
// Try n is the pane's count: the run of consecutive tries at the same step on the same test (glance's triesAtStep).
function triesOf(spawns, item) {
  const labels = testLabels(spawns);
  const tries = [];
  let written = 0;
  for (const spawn of Array.isArray(spawns) ? spawns : []) {
    if (spawn?.kind !== "workflow_agent") continue;
    const label = readLabel(spawn.name);
    // Only a test's cycle names a phase, so `written` counts exactly the spawns testLabels keeps (a review round's lens is skipped).
    if (label.unknown || label.item === null || (label.role !== "runner" && label.phase === null)) continue;
    if (label.role === "runner") {
      // The runner ran whether or not its time is known, so `ran` and `running` are apart.
      const last = label.item === item ? tries.at(-1) : undefined;
      if (last && !last.ran) Object.assign(last, { ran: true, running: spawn.seconds });
    } else {
      // A cycle's quick review runs no checks after it, so its running time is none rather than unknown.
      const running = label.role === REVIEW_ROLE ? 0 : undefined;
      if (label.item === item) tries.push({ step: label.phase, stage: label.stage, role: label.role, round: label.round, number: triesAtStep(labels, written), writing: spawn.seconds, running, ran: label.role === REVIEW_ROLE });
      written++;
    }
  }
  return tries;
}

// A record's `passed` says the step's goal was met (RED: the test failed as it should), so the words depend on the step.
const RESULT_WORDS = {
  RED: { met: "failed, as it should", unmet: "passed straight away, refused" },
  GREEN: { met: "passed", unmet: "still failing" },
};

// A record describes the latest try of its step only, and only once that try's runner has run; earlier tries stay unknown.
// (Spawns carry no stage attempt, so the record's own attempt cannot be matched to a try.)
function resultOf(attempt, tries, record, covered) {
  const latest = tries.filter((t) => t.step === attempt.step).at(-1);
  if (latest !== attempt || !attempt.ran) return UNKNOWN;
  return resultWords(attempt.step, record, covered);
}

// The wording for a step's record.
export function resultWords(step, record, covered) {
  const words = RESULT_WORDS[step];
  if (!words || !record || typeof record.passed !== "boolean") return UNKNOWN;
  const exits = Array.isArray(record.exitCodes) ? record.exitCodes.filter((code) => typeof code === "number") : [];
  const codes = exits.length > 0 ? ` (exit ${exits.join(", ")})` : "";
  if (record.timedOut === true) return `timed out${codes}`;
  if (step === "RED" && covered?.done === true) return `already covered, the test passed before any new code${codes}`;
  // On a RED record, passed means the try met the step (the test failed); exit 0 on an unmet try is the test passing at once.
  if (!record.passed && step === "RED" && exits.some((code) => code !== 0)) return `refused, the test did not fail cleanly${codes}`;
  return `${record.passed ? words.met : words.unmet}${codes}`;
}

// The checkpoint a try's return went through, by its key's stage, role, test and round (the spawn's label names the same); the last one wins.
function checkpointOf(attempt, checkpoints) {
  const matches = (key) => key?.stage === attempt.stage && key.role === attempt.role && key.item === attempt.item && key.round === attempt.round;
  return (Array.isArray(checkpoints) ? checkpoints : []).filter((record) => matches(keyOf(record?.key))).at(-1);
}

function keyOf(text) {
  try {
    return parseKey(text);
  } catch {
    return null;
  }
}

// A try's commit: the short sha its checkpoint committed, "no change" for one that committed nothing, unknown with no checkpoint.
function commitCell(checkpoint) {
  if (!checkpoint) return UNKNOWN;
  return checkpoint.committed === true && typeof checkpoint.sha === "string" ? checkpoint.sha.slice(0, SHORT_SHA) : "no change";
}

const REFACTOR = "REFACTOR";

// A REFACTOR try is named by its agent (the quick review, or the tidy of the tests or the code), so the two read apart.
function stepCell({ step, role }) {
  if (step !== REFACTOR || !role) return step;
  return `${REFACTOR}: ${plainName(role === REVIEW_ROLE ? "light-review" : role) ?? role}`;
}

// What a REFACTOR try did: the quick review's count of distinct findings from its return, a tidy's checkpoint (it commits only while
// every closed test still passes); unknown without the record.
function refactorResult(attempt, checkpoint, calls) {
  if (attempt.role === REVIEW_ROLE) {
    const own = (Array.isArray(calls) ? calls : []).filter((call) => {
      const key = keyOf(call?.input?.pb_key);
      return key?.stage === attempt.stage && key.role === REVIEW_ROLE && key.item === attempt.item && key.round === attempt.round;
    });
    const findings = own.at(-1)?.input?.findings;
    if (!Array.isArray(findings)) return UNKNOWN;
    const distinct = distinctFindings(findings.filter((finding) => finding !== null && typeof finding === "object"));
    return distinct.length === 0 ? "no findings" : plural(distinct.length, "finding");
  }
  if (!checkpoint) return UNKNOWN;
  return checkpoint.committed === true ? "tidied, the tests still pass" : "nothing to change";
}

function tryCells(attempt, tries, perTest, checkpoints, calls) {
  const checkpoint = checkpointOf(attempt, checkpoints);
  const times = [clock(attempt.writing + attempt.running), clock(attempt.writing), clock(attempt.running)];
  if (attempt.step === REFACTOR) {
    const commit = attempt.role === REVIEW_ROLE ? "" : commitCell(checkpoint);
    return [stepCell(attempt), attempt.number, ...times, refactorResult(attempt, checkpoint, calls), commit];
  }
  const result = resultOf(attempt, tries, perTest?.[attempt.step.toLowerCase()], perTest?.covered);
  return [attempt.step, attempt.number, ...times, result, commitCell(checkpoint)];
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

// Only a RED that was tried again can say why: the retry itself means the earlier tries did not leave a failing test.
// Only the card of the test the run ended on gets the stop. The count comes from the try labels; "refused" is claimed for the last try only when the run stopped there.
function loopNote(tries, stop) {
  const last = tries.filter((attempt) => attempt.step === "RED").at(-1);
  if (!last || !isLooping(last.number)) return "";
  const count = ORDINALS[last.number - 1] ?? `${last.number}th`;
  const stopName = plainName(stop?.code);
  const ending = stop ? `; the ${count} refused try was the last and the run stopped${stopName ? `: ${escape(stopName)}` : ""}` : " so far";
  return `\n<p><strong>Why it looped</strong> RED must start from a test that fails, so a RED that did not was tried again. It took ${last.number} tries${ending}.</p>`;
}

// The ledger's perTest is the source of truth for a result; a step it recorded that no labelled spawn shows still gets a row (times unknown).
function withLedgerTries(tries, record) {
  const out = [...tries];
  for (const [step, key] of [["RED", "red"], ["GREEN", "green"]]) {
    if (record?.[key] && !out.some((t) => t.step === step)) out.push({ step, number: 1, writing: NaN, running: NaN, ran: true });
  }
  return out;
}

const TRY_COLUMNS = ["Step", "Try", "Total", "Writing", "Running", "Result", "Commit"];
const OPTIONAL_COLUMNS = new Set(["Total", "Writing", "Running", "Commit"]);
const UNKNOWN_CELLS = new Set([UNKNOWN, clock(NaN)]);

function testCard(spawns, item, number, perTest, stop, { checkpoints, calls } = {}) {
  const tries = withLedgerTries(triesOf(spawns, item), perTest?.[item]).map((attempt) => ({ ...attempt, item }));
  const cells = tries.map((attempt) => tryCells(attempt, tries, perTest?.[item], checkpoints, calls));
  // Step, Try and Result always stay; a time or commit column is dropped when it is unknown on every try row.
  const kept = TRY_COLUMNS.map((label, column) => !OPTIONAL_COLUMNS.has(label) || cells.length === 0 || cells.some((row) => !UNKNOWN_CELLS.has(row[column])));
  const rows = cells.map((row) => `<tr>${row.filter((_, column) => kept[column]).map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`);
  const head = `<tr>${TRY_COLUMNS.filter((_, column) => kept[column]).map((label) => `<th>${label}</th>`).join("")}</tr>`;
  const note = !perTest?.[item]?.red && tries.length === 0 ? "\n<p>not reached</p>" : "";
  const looped = loopNote(tries, stop);
  const table = cells.length === 0 ? "" : `\n<table>\n${head}\n${rows.join("\n")}\n</table>`;
  return `<article${looped ? ' class="looped"' : ""}>\n<h3><small>test ${number}</small> ${escape(shortName(item))}</h3>${note}${table}${looped}\n</article>`;
}

function testsSection({ ledger, spawns, tests, calls }) {
  const perTest = ledger?.tests?.perTest ?? {};
  const keys = Object.keys(perTest);
  // Once perTest has results, a legacy-list id with no result and no spawns is dropped; the numbering keeps the existing order rules.
  const seen = new Set([...keys, ...testsSeen(spawns)]);
  const planned = numberedTests(spawns, tests).filter((item) => keys.length === 0 || seen.has(item));
  const order = [...new Set([...planned, ...keys])];
  const items = order;
  const last = currentStep(spawns)?.item;
  const cards = items.map((item) => testCard(spawns, item, order.indexOf(item) + 1, perTest, item === last ? ledger?.stop : null, { checkpoints: ledger?.checkpoints, calls }));
  return section("TESTS", cards.join("\n"), "tests");
}

const NOT_REACHED = "not reached";

const secondsBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 1000;
const stepClock = (seconds) => (Number.isFinite(seconds) && seconds >= 0 ? clock(seconds) : UNKNOWN);

// Only columns with a source are drawn: end and took need a recorded end.
function stepRow(name, record, start, withEnds) {
  const times = record
    ? [stepClock(secondsBetween(start, record.startedAt)), ...(withEnds ? [stepClock(secondsBetween(start, record.end)), stepClock(secondsBetween(record.startedAt, record.end))] : [])]
    : [NOT_REACHED, ...(withEnds ? ["", ""] : [])];
  return `<tr>${[plainName(name), ...times].map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`;
}

const stagesOf = (ledger) => (Array.isArray(ledger?.stages) ? ledger.stages : []);

// One run's steps: the contract's for its kind and type, each with the stage it recorded (the running one included).
function runSteps(ledger) {
  const recorded = new Map(stagesOf(ledger).map((stage) => [stage.name, stage]));
  const running = ledger?.stage;
  if (running?.name && !recorded.has(running.name)) recorded.set(running.name, { name: running.name, startedAt: running.startedAt });
  return stageNamesFor(contract, ledger).map((name) => [name, recorded.get(name)]);
}

// Every step of every run of the task, in run order, timed from the first run's start.
function stepsSection({ task }) {
  const first = task[0].ledger;
  const start = stagesOf(first)[0]?.startedAt ?? first?.stage?.startedAt;
  const withEnds = task.some(({ ledger }) => stagesOf(ledger).some((stage) => Number.isFinite(Date.parse(stage?.end))));
  const labels = withEnds ? ["Step", "Start", "End", "Took"] : ["Step", "Started"];
  const head = `<tr>${labels.map((label) => `<th>${label}</th>`).join("")}</tr>`;
  const rows = task.flatMap(({ ledger }) => runSteps(ledger)).map(([name, record]) => stepRow(name, record, start, withEnds));
  return section("STEPS", `<table>\n${head}\n${rows.join("\n")}\n</table>`);
}

// Every scenario the run stands on, each with its tests under it: the scenarios question folds a long list into this.
// `scenarios` is [{ description, tests: [description] }], as the scenarios gate reads them; absent reads as unknown.
const scenarioItem = ({ description, tests }) => `<li>${escape(description)}\n<ul>\n${tests.map((test) => `<li>${escape(test)}</li>`).join("\n")}\n</ul></li>`;

// The final checks the standing scenarios return names: criteria only a live, paid or manual run can show, so the run built
// no test for them and the human runs them. No section when there are none.
function finalChecksSection({ task }) {
  const calls = task.flatMap((run) => (Array.isArray(run.calls) ? run.calls : []));
  const byKey = new Map(calls.map(({ input }) => [input?.pb_key, input]).filter(([key]) => typeof key === "string"));
  const ledger = codeRunIn(task)?.ledger ?? {};
  const key = newestKeyAmong([...byKey.keys()].map((pbKey) => `${pbKey}.json`), isStandingScenarios(ledger));
  const planned = key === null ? undefined : byKey.get(key)?.final_checks;
  // Each row keeps its check_id (the raw list's, by position), so the result the session recorded can sit beside it.
  const rows = (key === null ? undefined : finalCheckRows(planned))?.map((row, i) => ({ ...row, id: planned[i]?.check_id })) ?? [];
  // A test the human took off the list with pb human cut-test is left to a person too, with their reason.
  const cuts = (Array.isArray(ledger.tests?.cut) ? ledger.tests.cut : []).map(({ id, reason }) => ({ id, description: id, why: `cut by you: ${reason}` }));
  // The results the session recorded with pb final-check, newest per id; a check run that no row names is listed by its id.
  const ran = new Map((Array.isArray(ledger.finalChecks) ? ledger.finalChecks : []).map((check) => [check.id, check]));
  const listed = new Set([...rows, ...cuts].map(({ id }) => id));
  const unlisted = [...ran.keys()].filter((id) => !listed.has(id)).map((id) => ({ id, description: id }));
  const all = [...rows, ...cuts, ...unlisted];
  if (all.length === 0) return "";
  const result = (id) => (ran.has(id) ? ` <strong>${ran.get(id).result === "fail" ? "failed" : "passed"}: ${escape(ran.get(id).note)}</strong>` : "");
  const item = ({ id, description, command, why }) => `<li>${escape(description)}${command ? `: <code>${escape(command)}</code>` : ""}${why ? ` (${escape(why)})` : ""}${result(id)}</li>`;
  return section("FINAL CHECKS", `<p>They need a live, paid or manual run, so they were not built as tests. A result shows where the session ran one; the rest are left to a person.</p>\n<ul>\n${all.map(item).join("\n")}\n</ul>`);
}

// What the full suite already failed before the task changed anything (its baseline): the run did not count these
// against the task's work, so they are listed here once. No section when the baseline was green or not taken.
function alreadyFailingSection({ task }) {
  const rows = baselineFailures(codeRunIn(task)?.ledger?.tests?.baseline);
  if (rows.length === 0) return "";
  const item = ({ runner, failures, broken }) =>
    broken ? `<li>runner ${escape(runner)}: could not run any test</li>` : `<li>runner ${escape(runner)}:\n<ul>\n${failures.map((line) => `<li>${escape(line)}</li>`).join("\n")}\n</ul></li>`;
  return section("ALREADY FAILING", `<p>These failed before the task changed anything, so the run did not count them against its work.</p>\n<ul>\n${rows.map(item).join("\n")}\n</ul>`);
}

function scenariosSection({ scenarios }) {
  const body = Array.isArray(scenarios) ? `<ul>\n${scenarios.map(scenarioItem).join("\n")}\n</ul>` : `<p>${UNKNOWN}</p>`;
  return section("SCENARIOS", body);
}

// Every file run/changed.json lists: the task-done question folds a long list into this. Absent reads as unknown.
function builtSection({ changed }) {
  const body = Array.isArray(changed) ? `<ul>\n${changed.map((path) => `<li>${escape(path)}</li>`).join("\n")}\n</ul>` : `<p>${UNKNOWN}</p>`;
  return section("BUILT", body);
}

// The doubts the human approved past, each with the gate whose record keeps it: the human's answer there settled it.
const isDoubt = (doubt) => typeof doubt?.step === "string" && typeof doubt?.ambiguity === "string";

export function approvedDoubts(task) {
  return task.flatMap(({ ledger }) =>
    Object.entries(ledger?.gates && typeof ledger.gates === "object" ? ledger.gates : {}).flatMap(([gate, record]) =>
      (Array.isArray(record?.doubts) ? record.doubts.filter(isDoubt) : []).map((doubt) => ({ ...doubt, gate })),
    ),
  );
}

const FIX_KEPT = "kept";

// The ids a shown finding stands for: one finding, or every finding said for its lines (samePlaceFindings).
const idsOf = (finding) => (Array.isArray(finding.ids) ? finding.ids : [finding.id]);
const lensesOf = (finding) => idsOf(finding).map((id) => lensOfFinding({ id }));

// How a later fix settled a doubt a refuter raised on one finding: the finding reads fixed by a fix kept in a later round of
// the same review, so the human approved past a doubt that was no longer open. Only a refuter's doubt is about one finding,
// so only it can be settled so; null when it was not.
function settledBy({ ambiguity }, task) {
  for (const run of task) {
    for (const call of Array.isArray(run.calls) ? run.calls : []) {
      const key = keyOf(call?.input?.pb_key);
      if (key?.role !== "refuter" || String(call.input.ambiguity ?? "").trim() !== ambiguity.trim()) continue;
      const stage = stagesOf(run.ledger).find((entry) => entry?.name === key.stage);
      const round = stage === undefined ? undefined : lensRound({ ledger: { stage, fixes: run.ledger.fixes, stop: null }, calls: run.calls, ended: true });
      const found = round?.findings.find((finding) => idsOf(finding).includes(key.item) && finding.verdict === "fixed");
      const fix = found && round.fixes.find((each) => each.outcome === FIX_KEPT && each.round > key.round && each.lens === lensOfFinding({ id: key.item }));
      if (!fix) continue;
      const commit = (Array.isArray(run.ledger?.checkpoints) ? run.ledger.checkpoints : []).find((record) => {
        const at = keyOf(record?.key);
        return record.committed === true && at?.stage === key.stage && at.role === "fix" && at.item === fix.group && at.round === fix.round;
      });
      const sha = typeof commit?.sha === "string" ? ` · ${commit.sha.slice(0, SHORT_SHA)}` : "";
      return `settled by a later fix in the ${round.stage}: ${findingGist(found)}${sha}`;
    }
  }
  return null;
}

// The step name a lens or refuter doubt carries (REVIEWER in gates.mjs, which this pure module cannot import).
const REVIEWER = "a reviewer";

// The stage whose node ends at a gate: where a reviewer's doubt was raised when the doubt does not name its stage.
const gateStage = (gate) => Object.values(contract.taskTypes).flatMap((type) => type.nodes).find((node) => node.gate === gate)?.name;

// A review by its stage's plain name: "the safety-net review", else "the review in <step>".
const reviewOf = (stage) => {
  const name = plainName(stage);
  if (!name) return "a review";
  return /review$/.test(name) ? `the ${name}` : `the review in ${name}`;
};

// Where a doubt was raised, in plain words: while the agent's step ran, or during the review it came from.
const raisedWords = ({ step, stage, gate }) => (step === REVIEWER ? `raised during ${reviewOf(stage ?? gateStage(gate))}` : `raised while ${step}`);

// How a doubt the human approved past was settled: by a later fix, else by the human's answer at its gate.
const settledWords = (doubt, task) => settledBy(doubt, task) ?? `answered at ${gateLine(doubt.gate)}`;

const raisedItem = (task) => (doubt) => `<li>${escape(doubt.ambiguity)} <small>(${escape(raisedWords(doubt))}; ${escape(settledWords(doubt, task))})</small></li>`;

// Every doubt the human answered a gate past: settled once the human answered over it, so How it ran keeps it, not NEEDS YOU.
function doubtsSection({ task }) {
  const doubts = approvedDoubts(task);
  return doubts.length === 0 ? "" : `\n${section("DOUBTS RAISED", `<ul>\n${doubts.map(raisedItem(task)).join("\n")}\n</ul>`)}`;
}

const SHORT_SHA = 7;

// A commit a human made between runs, which the run adopted, says so.
const commitItem = (human) => (commit) => `<li>${escape(String(commit?.sha ?? "").slice(0, SHORT_SHA))} ${escape(commit?.subject)}${human.has(commit?.sha) ? " (made by a human, adopted between runs)" : ""}</li>`;

function commitsSection({ commits, humanCommits = [] }) {
  const human = new Set(humanCommits);
  const body = Array.isArray(commits) ? `<ul>\n${commits.map(commitItem(human)).join("\n")}\n</ul>` : `<p>${UNKNOWN}</p>`;
  return section("COMMITS", body);
}

// Each finding of the review round the pane shows, by its gist (the lens's title, else the claim's first sentence), with
// the full claim under it, where it is and what happens to it in the pane's words.
const findingItem = (finding) =>
  `<li><strong>${escape(findingGist(finding))}</strong> · ${escape(finding.word)}${finding.where ? ` · ${escape(finding.where)}` : ""}<br>${escape(finding.claim)}</li>`;

// A cycle's quick reviews are the TESTS section's REFACTOR rows; every other closed stage's round is a review of the task.
const CYCLE_STAGE = "code-tdd";

// One run's review rounds in the order its stages ran: each closed stage's, read as over, then the current stage's, as the
// pane reads it (over too once the run has ended, as a kept run has).
const typeWord = (type) => plainName(type ?? "") ?? String(type);

// How sure each confidence is, surest first.
const CONFIDENCES = ["certain", "likely", "unsure"];

// How the confidence moved, in plain words; nothing when it did not move or is not known.
function sureWord(before, after) {
  const [was, now] = [CONFIDENCES.indexOf(before?.confidence), CONFIDENCES.indexOf(after.confidence)];
  if (was < 0 || now < 0 || was === now) return "";
  return now > was ? "; less sure than first thought" : "; surer than first thought";
}

// What classifying again changed, from the classification before it and the one the fix returned.
function classifiedWord(before, after) {
  if (before && before.task_type !== after.task_type) return `task type changed: ${typeWord(after.task_type)} (was ${typeWord(before.task_type)})${sureWord(before, after)}`;
  return `task type ${before ? "kept" : "set"}: ${typeWord(after.task_type)}${sureWord(before, after)}`;
}

// A task-type review's fix is the classifier asked again, which mends no code: a finding it answered reads as what that
// classification changed, not "fixed". A fix whose return is no classification keeps its word.
function withClassifiedAgain(round, stage, calls) {
  if (!round || !stage) return round;
  const keyed = calls.map((call) => ({ key: keyOf(call?.input?.pb_key), input: call?.input })).filter(({ key }) => key?.stage === stage.name && key.attempt === stage.attempt);
  const isClassification = (input) => typeof input?.task_type === "string" && typeof input.confidence === "string";
  const findings = round.findings.map((finding) => {
    const fix = finding.verdict === "fixed" ? round.fixes.find((each) => each.outcome === FIX_KEPT && each.lens === lensOfFinding(finding)) : undefined;
    const after = fix && keyed.find(({ key }) => key.role === "fix" && key.item === fix.group && key.round === fix.round)?.input;
    if (!isClassification(after)) return finding;
    const before = keyed.filter(({ key, input }) => key.round < fix.round && isClassification(input)).sort((a, b) => a.key.round - b.key.round).at(-1)?.input;
    return { ...finding, word: classifiedWord(before, after) };
  });
  return { ...round, findings };
}

function runRounds(run, spawns) {
  return reviewRounds(run, spawns).map(({ round }) => round);
}

// Each review round of one run with the stage it reviewed, the run it is of and whether it is over (its stage closed, or the run ended).
function reviewRounds(run, spawns) {
  const { ledger, calls = [], endedAt } = run;
  const current = ledger?.stage?.name;
  const closed = stagesOf(ledger).filter((stage) => stage?.name !== current && stage?.name !== CYCLE_STAGE);
  const of = (stageLedger, ended) => ({ round: withClassifiedAgain(lensRound({ ledger: stageLedger, calls, spawns, ended }), stageLedger?.stage, calls), stage: stageLedger?.stage, run, over: ended });
  const rounds = closed.map((stage) => of({ stage, fixes: ledger.fixes, stop: null }, true));
  return [...rounds, of(ledger, endedAt !== undefined)].filter(({ round }) => Boolean(round));
}

// A round with no finding is one line; one with findings lists them under its stage.
const roundBlock = (round) => {
  if (!round.findings.length) return `<p>${escape(round.stage)} · no issues found</p>`;
  return `<p>${escape(round.stage)}</p>\n<ul class="findings">\n${round.findings.map(findingItem).join("\n")}\n</ul>`;
};

function reviewSection({ task, spawns }) {
  const rounds = task.flatMap((run) => runRounds(run, spawns ?? []));
  if (!rounds.length) return section("REVIEW", "<p>no review round yet</p>");
  return section("REVIEW", rounds.map(roundBlock).join("\n"));
}

// ---------- NEEDS YOU: only what the human must act on or decide ----------

// A finding the review left with the human once its round is over: one still to fix, or one left as is.
const LEFT_WORDS = [FINDING_WORDS.toFix, FINDING_WORDS.leftAsIs];

// The findings a return's key is about: a refuter's one finding, a lens's own findings, a fix group's lens (the fix loop
// groups the upheld findings by lens, in finding order, as g1, g2, ...).
function findingsOfKey(key, findings) {
  if (key.role === "refuter") return findings.filter((finding) => idsOf(finding).includes(key.item));
  if (key.role === "lens") return findings.filter((finding) => lensesOf(finding).includes(key.item));
  if (key.role !== "fix") return [];
  const lenses = [...new Set(findings.filter((finding) => finding.verdict !== "knocked-down").flatMap(lensesOf))];
  const lens = lenses[Number(/^g(\d+)$/.exec(key.item)?.[1]) - 1];
  return lens === undefined ? [] : findings.filter((finding) => lensesOf(finding).includes(lens));
}

// The finding a doubt is about: one left open in a round over whose reviewer, refuter or fix raised that same question.
function findingOfDoubt({ ambiguity }, left) {
  for (const { finding, round } of left) {
    for (const call of Array.isArray(round.run.calls) ? round.run.calls : []) {
      const key = keyOf(call?.input?.pb_key);
      if (key?.stage !== round.stage?.name || String(call.input.ambiguity ?? "").trim() !== ambiguity.trim()) continue;
      if (findingsOfKey(key, round.round.findings).includes(finding)) return finding;
    }
  }
  return undefined;
}

// The review findings left open, each with the questions it left for the human, then the doubts no finding holds.
function leftWithHuman({ ledger, task, spawns }) {
  const left = task.flatMap((run) => reviewRounds(run, spawns ?? []))
    .filter(({ over, stage }) => over && stage?.name !== CYCLE_STAGE)
    .flatMap((round) => round.round.findings.filter((finding) => LEFT_WORDS.includes(finding.word)).map((finding) => ({ finding, round, questions: [] })));
  // Only the question still asked holds open doubts: one the human answered a gate past is settled.
  const pending = Array.isArray(ledger?.needsHuman?.doubts) ? ledger.needsHuman.doubts.map((doubt) => (doubt !== null && typeof doubt === "object" ? { ...doubt, gate: ledger.needsHuman.gate } : doubt)) : [];
  const loose = [];
  for (const doubt of pending) {
    const finding = findingOfDoubt(doubt, left);
    const held = left.find((entry) => entry.finding === finding);
    if (held) held.questions.push(doubt.ambiguity);
    else loose.push(doubt);
  }
  return { findings: left, doubts: loose };
}

const leftItem = ({ finding, questions }) => {
  const where = finding.where ? ` · ${escape(finding.where)}` : "";
  const body = questions.length > 0 ? questions.map((question) => `Decide: ${escape(question)}`).join("<br>") : escape(finding.claim);
  return `<li><strong>${escape(findingGist(finding))}</strong>${where}<br>${body}</li>`;
};

const looseItem = (doubt) => `<li>Decide: ${escape(doubt.ambiguity)} <small>(${escape(raisedWords(doubt))})</small></li>`;

// A stop, in plain words: the step it stopped at, why, and how to go on from it.
function stopItem({ ledger, spawns, tests }) {
  if (!ledger?.stop) return [];
  const step = plainName(ledger.stage?.name);
  const why = stopName(ledger.stop);
  return [`<li>It stopped${step ? ` at ${escape(step)}` : ""}${why ? `: ${escape(why)}` : ""}. ${escape(rerunStep(spawns, tests))}</li>`];
}

// A question pb asked and the human has not answered yet. A finished code run that was not signed off asks for the
// sign-off, whether or not its question is asked yet.
function questionItem({ ledger, task }) {
  const gate = ledger?.needsHuman?.gate;
  const prompt = permissionLine(gate);
  if (prompt) return [`<li>${escape(prompt)}: answer its prompt in the session.</li>`];
  if (gate && gate !== TASK_END) return [`<li>Answer the question waiting for you: ${escape(gateLine(gate))}.</li>`];
  return gate || awaitsSignOff(task) ? ["<li>Review the result and give your sign-off.</li>"] : [];
}

// A test kept though it passed at once, before its code was written (an earlier test's code covered it): it never failed first.
function coveredItems({ task }) {
  const perTest = taskLedgerOf(task).tests.perTest;
  return Object.entries(perTest)
    .filter(([, record]) => record?.covered?.done === true)
    .map(([id]) => `<li>Check by hand: the test ${escape(shortName(id))} passed before any new code was written, so it never failed first.</li>`);
}

const COVERAGE_ROLE = "verify-test-coverage";

// Every coverage check of the task, in the order they ran, each with the gaps it found (a gap sends the build back to add tests).
function coverageChecks(task) {
  return task.flatMap((run) =>
    (Array.isArray(run.calls) ? run.calls : [])
      .map((call) => ({ key: keyOf(call?.input?.pb_key), gaps: Array.isArray(call?.input?.gaps) ? call.input.gaps : [] }))
      .filter(({ key }) => key?.role === COVERAGE_ROLE)
      .sort((a, b) => a.key.attempt - b.key.attempt || a.key.round - b.key.round),
  );
}

// The gaps the last coverage check still found: no more tests were added for them.
function uncoveredItems({ task }) {
  const gaps = coverageChecks(task).at(-1)?.gaps ?? [];
  return gaps.map((gap) => `<li>Check by hand: a scenario has no test: ${escape(gap?.description)}.</li>`);
}

// The doubts an auto pass set aside for the human (a gate record's deferred), still open until the human approves
// G:publish, which asks them all; that answer's record keeps them, and DOUBTS RAISED shows them as answered.
const PUBLISH_GATE_NAME = "G:publish";
const publishAnswered = (task) => task.some(({ ledger }) => ledger?.gates?.[PUBLISH_GATE_NAME]?.answer === "approve");
function deferredItems({ task }) {
  if (publishAnswered(task)) return [];
  return task.flatMap(({ ledger }) =>
    Object.values(ledger?.gates && typeof ledger.gates === "object" ? ledger.gates : {}).flatMap((record) => (Array.isArray(record?.deferred) ? record.deferred.filter(isDoubt) : [])),
  ).map((doubt) => `<li>Decide before the pull request: ${escape(doubt.ambiguity)} <small>(set aside for you so the run went on; asked again before the pull request opens)</small></li>`);
}

function needsYouSection(context) {
  const { findings, doubts } = leftWithHuman(context);
  const items = [...questionItem(context), ...stopItem(context), ...findings.map(leftItem), ...doubts.map(looseItem), ...deferredItems(context), ...coveredItems(context), ...uncoveredItems(context)];
  const nothing = outcome(context.ledger) === "RUNNING" ? "Nothing needs you right now: the run is still going." : "Nothing needs you.";
  const body = items.length > 0 ? `<ul>\n${items.join("\n")}\n</ul>` : `<p>${nothing}</p>`;
  return section("NEEDS YOU", body, "needs");
}

// ---------- DONE: the files and the tests, in plain words (the pull request is STATUS's) ----------

// The task's pull request: the last its runs opened, else the one the caller knows of.
const taskPrUrl = (task, prUrl) => {
  const url = task.findLast((run) => typeof run.prUrl === "string" && run.prUrl !== "")?.prUrl ?? prUrl;
  return typeof url === "string" && url !== "" ? url : undefined;
};

const passes = (record) => record?.green?.passed === true || record?.covered?.done === true;

function doneSection({ task, changed }) {
  const perTest = taskLedgerOf(task).tests.perTest;
  const ids = Object.keys(perTest);
  const passing = ids.filter((id) => passes(perTest[id]));
  const failing = ids.filter((id) => !passes(perTest[id]));
  const names = (list) => list.map((id) => escape(shortName(id))).join(", ");
  const lines = [
    ...(Array.isArray(changed) && changed.length > 0 ? [`Changed ${plural(changed.length, "file")}: ${changed.map(escape).join(", ")}`] : []),
    ...(passing.length > 0 ? [`Added ${plural(passing.length, "test")}, passing: ${names(passing)}`] : []),
    ...(failing.length > 0 ? [`${plural(failing.length, "test")} not passing yet: ${names(failing)}`] : []),
  ];
  return section("DONE", lines.length > 0 ? lines.map((line) => `<p>${line}</p>`).join("\n") : "<p>Nothing yet.</p>");
}

// ---------- CHANGES: only what changed the task materially ----------

const isClassification = (input) => typeof input?.task_type === "string" && typeof input.confidence === "string";

// The task type the first classification gave, when the run the type is recorded on went on with another.
function typeChange(task) {
  const code = codeRunIn(task);
  const first = (Array.isArray(code.calls) ? code.calls : [])
    .map((call) => ({ key: keyOf(call?.input?.pb_key), input: call?.input }))
    .filter(({ key, input }) => key?.stage === "intake" && isClassification(input))
    .sort((a, b) => a.key.attempt - b.key.attempt || a.key.round - b.key.round)[0]?.input;
  const now = code.ledger?.taskType;
  if (!first || typeof now !== "string" || first.task_type === now) return [];
  const rerouted = (Array.isArray(code.ledger?.stages) ? code.ledger.stages : []).some((stage) => stage?.name === "code-config" && stage.retypedTo === now);
  if (rerouted) return [`The config step found this is no config change, so it was built as a ${escape(typeWord(now))}.`];
  return [`The task type changed after a review: now ${escape(typeWord(now))}, was ${escape(typeWord(first.task_type))}.`];
}

// The gaps a coverage check found that a later check was run after: the build went back and added tests for them.
function testsAdded(task) {
  const checks = coverageChecks(task);
  return checks.slice(0, -1).flatMap(({ gaps }) => gaps.map((gap) => `Tests were added because a scenario had none: ${escape(gap?.description)}.`));
}

// The reviews whose fixes change no plan: the task type's (its fix is a new classification, told apart), a cycle's quick
// review (tidying is part of every test) and the pull request text's.
const NOT_THE_WORK = ["intake", CYCLE_STAGE, "pr-draft"];
const reviewName = (stage) => (/review$/.test(stage) ? `The ${stage}` : `The review in ${stage}`);

// Each finding a review had fixed in the work itself.
function forcedFixes(task, spawns) {
  return task.flatMap((run) => reviewRounds(run, spawns ?? []))
    .filter(({ stage }) => !NOT_THE_WORK.includes(stage?.name))
    .flatMap(({ round }) => round.findings.filter((finding) => finding.word === FINDING_WORDS.fixed).map((finding) => `${escape(reviewName(round.stage))} had this fixed: ${escape(findingGist(finding))}${finding.where ? ` · ${escape(finding.where)}` : ""}`));
}

function changesSection({ task, spawns }) {
  const items = [...typeChange(task), ...testsAdded(task), ...forcedFixes(task, spawns)];
  return items.length === 0 ? "" : `\n${section("CHANGES", `<ul>\n${items.map((item) => `<li>${item}</li>`).join("\n")}\n</ul>`)}`;
}

// STATUS as the pane's STATUS row reads it: the state's mark and word, in its colour, then what about; the pull request linked once.
const STATUS_LOOKS = {
  DONE: { head: "✓ DONE", tone: "done" },
  STOPPED: { head: "✕ STOPPED", tone: "stopped" },
  "WAITING ON YOU": { head: "▲ NEEDS YOU", tone: "needs-you" },
  RUNNING: { head: "● working", tone: "working" },
};

function statusWhat(state, ledger, task) {
  if (state === "STOPPED") return stopName(ledger.stop);
  if (state === "WAITING ON YOU") return gateLine(ledger?.needsHuman?.gate ?? (awaitsSignOff(task) ? TASK_END : undefined));
  if (state === "RUNNING") return plainName(ledger?.stage?.name);
  return undefined;
}

function statusSection({ ledger, task, url }) {
  const state = whereItIs(ledger, task);
  const look = STATUS_LOOKS[state];
  const number = url ? prNumber(url) : undefined;
  const pr = url ? `<a href="${escape(url)}">${number ? `PR #${number}` : "PR"}</a> opened` : undefined;
  const what = statusWhat(state, ledger, task);
  const parts = [`<strong class="${look.tone}">${look.head}</strong>`, what ? escape(what) : undefined, pr].filter(Boolean);
  return section("STATUS", `<p>${parts.join(" · ")}</p>`);
}

const prNumber = (url) => /\/pull\/(\d+)\/?$/.exec(url)?.[1];

// The pane's look, in the browser: one monospace face at one size, each row a label column and what it holds. GOAL and STATUS
// lead with bold labels as the pane's first glance does; every other label is dim. STATUS takes the pane's colour for its state.
const STYLE = `:root{color-scheme:light dark;--bg:#15161a;--fg:#e3e4e8;--muted:#8a8d96;--rule:#2b2d34;--link:#39c5cf;--done:#e3e4e8;--working:#39c5cf;--needs-you:#e3b341;--stopped:#f0605a;--amber:#e3b341}
@media (prefers-color-scheme:light){:root{--bg:#fbfbf9;--fg:#1c1d21;--muted:#696c74;--rule:#e1e2e5;--link:#0a6f78;--done:#1c1d21;--working:#0a6f78;--needs-you:#8a5a00;--stopped:#c2322c;--amber:#8a5a00}}
*{font-size:inherit}
body{background:var(--bg);color:var(--fg);font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:0 auto;padding:48px 32px 64px;max-width:96ch}
h2,h3,p,ul{margin:0}
section{display:grid;grid-template-columns:12ch minmax(0,1fr);column-gap:2ch;margin:0 0 18px}
section>div{min-width:0;overflow-x:auto}
h2{font-weight:400;color:var(--muted)}
header{border-bottom:1px solid var(--rule);padding-bottom:6px;margin-bottom:24px}
header section{margin-bottom:12px}
header h2{font-weight:700;color:var(--fg)}
strong{font-weight:700}
small{color:var(--muted)}
a{color:var(--link);text-underline-offset:3px}
.done{color:var(--done)}
.working{color:var(--working)}
.needs-you{color:var(--needs-you)}
.stopped{color:var(--stopped)}
ul{list-style:none;padding:0}
li+li{margin-top:2px}
.findings{margin:2px 0 8px 2ch}
.findings li+li,.needs li+li{margin-top:8px}
ul ul{padding-left:2ch;margin-top:2px}
ul ul li+li{margin-top:2px}
details{margin-top:32px}
summary{cursor:pointer;color:var(--muted);list-style:none;margin-bottom:18px}
summary::-webkit-details-marker{display:none}
summary::before{content:"\\25B8\\00A0"}
details[open]>summary::before{content:"\\25BE\\00A0"}
summary:hover{color:var(--fg)}
details:not([open])>summary{margin-bottom:0}
section>div>p+p{margin-top:2px}
.task p+p{margin-top:10px}
.glance p{display:grid;grid-template-columns:18ch minmax(0,1fr);column-gap:2ch}
.glance strong{font-weight:400;color:var(--muted)}
article+article{margin-top:16px}
h3{font-weight:700}
h3 small{font-weight:400;margin-right:1ch}
table{border-collapse:collapse;margin-top:4px}
th{text-align:left;color:var(--muted);font-weight:400;padding:0 3ch 0 0;white-space:nowrap}
td{padding:0 3ch 0 0;vertical-align:top}
.tests{grid-template-columns:minmax(0,1fr)}
.tests h2{margin-bottom:2px}
.tests th,.tests td{padding-right:1.5ch}
.tests th:last-child,.tests td:last-child{padding-right:0}
.tests td:first-child{white-space:nowrap}
.looped p{margin-top:6px}
.looped p strong{color:var(--amber);margin-right:1ch}
@media (max-width:600px){body{padding:28px 16px 48px}section{grid-template-columns:minmax(0,1fr)}h2{margin-bottom:2px}.glance p{grid-template-columns:17ch minmax(0,1fr);column-gap:1ch}td,th{padding-right:2ch}}`;

// The GOAL row: the task's goal sentence alone, as the pane's GOAL row reads it; a dash with no task.
const goalSection = (task) => section("GOAL", `<p>${escape(goalOf(task) || "—")}</p>`);

// The whole task, each paragraph (split on blank lines) its own: How it ran keeps the context the GOAL row leaves out,
// and has no such row when the task is its goal alone.
function taskSection(task) {
  if (typeof task !== "string" || task.trim() === "" || task.trim() === goalOf(task)) return "";
  return `${section("TASK", task.split(/\n\s*\n/).map((paragraph) => `<p>${escape(paragraph.trim())}</p>`).join("\n"), "task")}\n`;
}

const PUBLISH_KIND = "publish";

// The task's runs, oldest first: `runs` when given ({ ledger, endedAt?, calls?, scenarios?, prUrl? } each, as pb kept them
// under reports/runs/ and the live one last), else the one run the ledger is.
function taskRunsOf({ runs, ledger, calls, scenarios, endedAt }) {
  const given = Array.isArray(runs) ? runs.filter((run) => run?.ledger) : [];
  return given.length > 0 ? given : [{ ledger, calls, scenarios, endedAt }];
}

// What the TESTS section reads across the task's runs: every run's test records (a later one wins) and checkpoints, and the last run's stop.
function taskLedgerOf(task) {
  const ledger = task.at(-1).ledger;
  const perTest = Object.assign({}, ...task.map((run) => run.ledger?.tests?.perTest ?? {}));
  return { ...ledger, tests: { ...ledger?.tests, perTest }, checkpoints: task.flatMap((run) => (Array.isArray(run.ledger?.checkpoints) ? run.ledger.checkpoints : [])) };
}

// The run that says what the task was: its code run, the first that is no publish run.
const codeRunIn = (task) => task.find((run) => run.ledger?.kind !== PUBLISH_KIND) ?? task[0];

export function renderReport({ ledger: given, spawns, calls, timing, commits, tests, testsComplete, endedAt, now, scenarios, changed, runs, prUrl } = {}) {
  const task = taskRunsOf({ runs, ledger: given, calls, scenarios, endedAt });
  const last = task.at(-1);
  // Claude Code's permission prompt, while it stands, is the question waiting on the human.
  const ledger = withPermissionAsk(last.ledger);
  const code = codeRunIn(task).ledger;
  const ranFor = taskSeconds(task, ledger, endedAt, now);
  const url = taskPrUrl(task, prUrl);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Run report</title>
<style>
${STYLE}
</style></head>
<body>
<header>
${goalSection(code?.task ?? ledger?.task)}
${statusSection({ ledger, task, url })}
</header>
${needsYouSection({ ledger, task, spawns, tests })}
${finalChecksSection({ task })}${alreadyFailingSection({ task })}${doneSection({ task, changed })}${changesSection({ task, spawns })}
<details>
<summary>HOW IT RAN</summary>
${taskSection(code?.task ?? ledger?.task)}${atAGlance({ ledger, spawns, ranFor: Number.isFinite(ranFor) ? ranFor : timing?.seconds, tests, testsComplete, task, taskType: code?.taskType, now })}${doubtsSection({ task })}
${stepsSection({ task })}
${scenariosSection({ scenarios: task.find((run) => Array.isArray(run.scenarios))?.scenarios })}
${testsSection({ ledger: taskLedgerOf(task), spawns, tests, calls: task.flatMap((run) => run.calls ?? []) })}
${builtSection({ changed })}
${reviewSection({ task: runs ? task : [{ ...task[0], endedAt: undefined }], spawns })}
${commitsSection({ commits, humanCommits: task.flatMap((run) => run.ledger?.humanCommits ?? []) })}
</details>
</body></html>`;
}
