// The HTML run report (R5-3): a pure render of a recorded run into one self-contained string.
// No fs, no network, no node: imports, so the mod can import it. Recorded text is escaped.
import { isPassed } from "./gate-passed.mjs";
import { plainName } from "./plain-names.mjs";
import { clock } from "./duration.mjs";
import { gateLine, glance, plural, runStart, testLabels, currentStep, triesAtStep, isLooping } from "./glance.mjs";
import { readLabel } from "./labels.mjs";
import { stageNamesFor } from "./stage-graph.mjs";
import contract from "./stages-contract.mjs";
import { findingGist, lensRound } from "./lens-round.mjs";
import { parseKey } from "./keys.mjs";
import { lensOfFinding } from "./lens-merge.mjs";
import { taskEnded, taskSpend } from "./task-runs.mjs";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

const section = (title, body) => `<section>\n<h2>${title}</h2>\n${body}\n</section>`;

function outcome(ledger) {
  if (ledger?.stop) return "STOPPED";
  return ledger?.stage?.status === "done" ? "DONE" : "RUNNING";
}

function glanceLabels(ledger) {
  return { now: ledger?.stop ? "Where it stopped" : "Where it is", spent: "Spent", left: "Left" };
}

// The run's length: endedAt (or the last stage end) minus the first start; NaN when either is missing.
// A run that has not ended (no end, no stage end, not DONE/STOPPED) is measured to `now`.
// A task of several runs is measured from its first run's start (`first`) to its last run's end.
function runSeconds(ledger, endedAt, now, first = ledger) {
  const stages = Array.isArray(ledger?.stages) ? ledger.stages : [];
  const ends = stages.map((stage) => Date.parse(stage?.end)).filter(Number.isFinite);
  const live = outcome(ledger) === "RUNNING" && Number.isFinite(now) ? now : NaN;
  const end = Number.isFinite(Date.parse(endedAt)) ? Date.parse(endedAt) : ends.length > 0 ? Math.max(...ends) : live;
  const seconds = (end - Date.parse(runStart(first))) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : NaN;
}

// Left only means something while the run goes, so a finished run has no such row.
const LIVE_ROWS = ["left"];

function atAGlance({ ledger, spawns, ranFor, tests, testsComplete, task }) {
  const spend = taskSpend(task);
  // Once every run has ended, the agents are the ones the runs recorded; the session's spawns may be gone.
  const agents = taskEnded(task) ? spend.agents : undefined;
  const { rows: all } = glance({ ledger: { ...ledger, spend }, spawns, tests, ranFor, testsComplete, agents });
  const done = outcome(ledger) === "DONE";
  const rows = done ? Object.fromEntries(Object.entries(all).filter(([key]) => !LIVE_ROWS.includes(key))) : all;
  if (done) rows.now = "finished";
  const labels = glanceLabels(ledger);
  const lines = Object.entries(rows).map(([key, text]) => `<p><strong>${labels[key]}</strong> ${escape(text)}</p>`);
  return section("AT A GLANCE", lines.join("\n"));
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

const NEXT_STEP = {
  STOPPED: ({ spawns, tests }) => rerunStep(spawns, tests),
  DONE: ({ ledger }) => (ledger?.gates && isPassed(ledger, "G:task-end") ? "Nothing to do: the run is done." : "Review the result and give your sign-off."),
  RUNNING: () => "Nothing to do yet: the run is still going.",
};

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

// What a REFACTOR try did: the quick review's count of findings from its return, a tidy's checkpoint (it commits only while
// every closed test still passes); unknown without the record.
function refactorResult(attempt, checkpoint, calls) {
  if (attempt.role === REVIEW_ROLE) {
    const own = (Array.isArray(calls) ? calls : []).filter((call) => {
      const key = keyOf(call?.input?.pb_key);
      return key?.stage === attempt.stage && key.role === REVIEW_ROLE && key.item === attempt.item && key.round === attempt.round;
    });
    const findings = own.at(-1)?.input?.findings;
    if (!Array.isArray(findings)) return UNKNOWN;
    return findings.length === 0 ? "no findings" : plural(findings.length, "finding");
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
  return `<article${looped ? ' class="looped"' : ""}>\n<h3><small>test ${number}</small> ${escape(item)}</h3>${note}${table}${looped}\n</article>`;
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
  return section("TESTS", cards.join("\n"));
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

function scenariosSection({ scenarios }) {
  const body = Array.isArray(scenarios) ? `<ul>\n${scenarios.map(scenarioItem).join("\n")}\n</ul>` : `<p>${UNKNOWN}</p>`;
  return section("SCENARIOS", body);
}

// Every file run/changed.json lists: the task-done question folds a long list into this. Absent reads as unknown.
function builtSection({ changed }) {
  const body = Array.isArray(changed) ? `<ul>\n${changed.map((path) => `<li>${escape(path)}</li>`).join("\n")}\n</ul>` : `<p>${UNKNOWN}</p>`;
  return section("BUILT", body);
}

// Every open doubt the pending question names, in full, as run/question.md holds them too.
// A question with no doubt to name has no section.
// A doubt a human approved past stays open: its gate's record keeps it, and the item names the gate.
const isDoubt = (doubt) => typeof doubt?.step === "string" && typeof doubt?.ambiguity === "string";

export function approvedDoubts(task) {
  return task.flatMap(({ ledger }) =>
    Object.entries(ledger?.gates && typeof ledger.gates === "object" ? ledger.gates : {}).flatMap(([gate, record]) =>
      (Array.isArray(record?.doubts) ? record.doubts.filter(isDoubt) : []).map((doubt) => ({ ...doubt, gate })),
    ),
  );
}

const FIX_KEPT = "kept";

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
      const found = round?.findings.find((finding) => finding.id === key.item && finding.verdict === "fixed");
      const fix = found && round.fixes.find((each) => each.outcome === FIX_KEPT && each.round > key.round && each.lens === lensOfFinding(found));
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

// The doubts the human approved past, apart by whether a later fix settled them.
function approvedDoubtsByState(task) {
  const doubts = approvedDoubts(task).map((doubt) => ({ ...doubt, settled: settledBy(doubt, task) }));
  return { open: doubts.filter(({ settled }) => settled === null), settled: doubts.filter(({ settled }) => settled !== null) };
}

const doubtItem = ({ step, ambiguity, gate }) => `<li>${escape(step)}: ${escape(ambiguity)}${gate ? ` <small>(approved past at ${escape(gateLine(gate))})</small>` : ""}</li>`;
const settledItem = ({ step, ambiguity, settled }) => `<li>${escape(step)}: ${escape(ambiguity)} <small>(${escape(settled)})</small></li>`;

function doubtsSection({ ledger, task }) {
  const pending = Array.isArray(ledger?.needsHuman?.doubts) ? ledger.needsHuman.doubts : [];
  const { open, settled } = approvedDoubtsByState(task);
  const doubts = [...open, ...pending];
  const openPart = doubts.length === 0 ? "" : `\n${section("OPEN DOUBTS", `<ul>\n${doubts.map(doubtItem).join("\n")}\n</ul>`)}`;
  const settledPart = settled.length === 0 ? "" : `\n${section("SETTLED DOUBTS", `<ul>\n${settled.map(settledItem).join("\n")}\n</ul>`)}`;
  return `${openPart}${settledPart}`;
}

const SHORT_SHA = 7;

const commitItem = (commit) => `<li>${escape(String(commit?.sha ?? "").slice(0, SHORT_SHA))} ${escape(commit?.subject)}</li>`;

function commitsSection({ commits }) {
  const body = Array.isArray(commits) ? `<ul>\n${commits.map(commitItem).join("\n")}\n</ul>` : `<p>${UNKNOWN}</p>`;
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

// What classifying again changed, from the classification before it and the one the fix returned.
function classifiedWord(before, after) {
  const confidence = before && before.confidence !== after.confidence ? `, confidence ${after.confidence} (was ${before.confidence})` : before ? ", same confidence" : `, confidence ${after.confidence}`;
  if (before && before.task_type !== after.task_type) return `classified again: now ${typeWord(after.task_type)} (was ${typeWord(before.task_type)})${confidence}`;
  return `classified again: ${before ? "still " : ""}${typeWord(after.task_type)}${confidence}`;
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

function runRounds({ ledger, calls = [], endedAt }, spawns) {
  const current = ledger?.stage?.name;
  const closed = stagesOf(ledger).filter((stage) => stage?.name !== current && stage?.name !== CYCLE_STAGE);
  const of = (stageLedger, ended) => withClassifiedAgain(lensRound({ ledger: stageLedger, calls, spawns, ended }), stageLedger?.stage, calls);
  const rounds = closed.map((stage) => of({ stage, fixes: ledger.fixes, stop: null }, true));
  return [...rounds, of(ledger, endedAt !== undefined)].filter(Boolean);
}

const roundBlock = (round) => {
  const body = round.findings.length ? `<ul>\n${round.findings.map(findingItem).join("\n")}\n</ul>` : "<p>no issues found</p>";
  return `<p>${escape(round.stage)}</p>\n${body}`;
};

function reviewSection({ task, spawns }) {
  const rounds = task.flatMap((run) => runRounds(run, spawns ?? []));
  if (!rounds.length) return section("REVIEW", "<p>no review round yet</p>");
  return section("REVIEW", rounds.map(roundBlock).join("\n"));
}

const prNumber = (url) => /\/pull\/(\d+)\/?$/.exec(url)?.[1];

// A finished task's own next actions: review the pull request it opened, then decide each doubt it was approved past.
function doneActions(task, prUrl) {
  const url = task.findLast((run) => typeof run.prUrl === "string" && run.prUrl !== "")?.prUrl ?? prUrl;
  const number = typeof url === "string" ? prNumber(url) : undefined;
  const review = typeof url === "string" && url !== "" ? [number ? `Review pull request #${number}: ${url}` : `Review the pull request: ${url}`] : [];
  return [...review, ...approvedDoubtsByState(task).open.map(({ ambiguity }) => `Decide the open doubt: ${ambiguity}`)];
}

function whatYouCanDo({ ledger, spawns, tests, task, prUrl }) {
  const own = outcome(ledger) === "DONE" ? doneActions(task, prUrl) : [];
  // The sign-off is the code run's task-end gate, wherever the task now stands.
  const steps = own.length > 0 ? own : [NEXT_STEP[outcome(ledger)]({ ledger: codeRunIn(task).ledger, spawns, tests })];
  return section("WHAT YOU CAN DO", steps.map((step, i) => `<p>${i + 1}. ${escape(step)}</p>`).join("\n"));
}

// R5-3's dark design: one inline stylesheet, monospace; the outcome badge is red, green or amber by outcome, and a looped test's "Why it looped" label is amber.
const STYLE = `:root{color-scheme:light dark;--bg:#1c1d21;--fg:#e6e6e6;--muted:#9a9ca3;--rule:#3a3c44;--faint:#6b6d75;--amber:#ffc933;--badge-ink:#1c1d21;--stopped:#ff6b81;--done:#5fd38d;--running:#ffc933}
@media (prefers-color-scheme:light){:root{--bg:#fafafa;--fg:#1c1d21;--muted:#5c5f66;--rule:#c9cbd1;--faint:#62646b;--amber:#8a5a00;--badge-ink:#ffffff;--stopped:#c62828;--done:#1a7f37;--running:#8a5a00}}
body{background:var(--bg);color:var(--fg);font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:40px 56px;max-width:1100px}
header p{color:var(--muted);margin:6px 0}
.badge{color:var(--badge-ink);padding:2px 10px;border-radius:4px}
.badge.stopped{background:var(--stopped)}
.badge.done{background:var(--done)}
.badge.running{background:var(--running)}
h1{font:700 22px/1.3 system-ui,sans-serif;margin:0}
h2{color:var(--muted);font-size:12px;letter-spacing:.12em;border-bottom:1px solid var(--rule);padding-bottom:6px;margin:32px 0 12px}
h3{font-size:14px;margin:0 0 8px}
p{margin:4px 0}
section p strong{color:var(--muted);display:inline-block;min-width:150px;text-transform:uppercase;font-size:12px}
article{border:1px solid var(--rule);border-radius:8px;padding:12px 16px;margin:12px 0}
table{border-collapse:collapse;width:100%}
th{text-align:left;color:var(--muted);font-weight:400;padding:4px 12px 4px 0}
td{padding:4px 12px 4px 0;vertical-align:top}
ul{list-style:none;padding:0}
li{margin:2px 0}
ul ul{padding-left:2ch}
.looped p strong{color:var(--amber);min-width:0;text-transform:none;font-size:inherit}
footer{color:var(--faint);margin-top:40px;font-size:12px}`;

// The task's paragraphs (split on blank lines) stay visibly apart inside the title.
function title(task) {
  if (typeof task !== "string") return escape(task);
  return task.split(/\n\s*\n/).map((paragraph) => escape(paragraph.trim())).join("<br>");
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
  const ledger = last.ledger;
  const code = codeRunIn(task).ledger;
  const ranFor = runSeconds(ledger, last.endedAt ?? endedAt, now, task[0].ledger);
  const state = outcome(ledger);
  const taskType = plainName(code?.taskType) ?? "unknown type";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Run report</title>
<style>
${STYLE}
</style></head>
<body>
<header>
<h1>${title(code?.task ?? ledger?.task)}</h1>
<p><strong class="badge ${state.toLowerCase()}">${state}</strong> · ${escape(taskType)} · ${clock(Number.isFinite(ranFor) ? ranFor : timing?.seconds)}</p>
</header>
${atAGlance({ ledger, spawns, ranFor: Number.isFinite(ranFor) ? ranFor : timing?.seconds, tests, testsComplete, task })}${doubtsSection({ ledger, task })}
${stepsSection({ task })}
${scenariosSection({ scenarios: task.find((run) => Array.isArray(run.scenarios))?.scenarios })}
${testsSection({ ledger: taskLedgerOf(task), spawns, tests, calls: task.flatMap((run) => run.calls ?? []) })}
${builtSection({ changed })}
${reviewSection({ task: runs ? task : [{ ...task[0], endedAt: undefined }], spawns })}
${commitsSection({ commits })}
${whatYouCanDo({ ledger, spawns, tests, task, prUrl })}
<footer>Written by Pairing Buddy from the run's ledger and agent labels. One self-contained file, nothing loaded from the network.</footer>
</body></html>`;
}
