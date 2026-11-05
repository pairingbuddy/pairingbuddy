// The HTML run report (R5-3): a pure render of a recorded run into one self-contained string.
// No fs, no network, no node: imports, so the mod can import it. Recorded text is escaped.
import { isPassed } from "./gate-passed.mjs";
import { plainName } from "./plain-names.mjs";
import { clock } from "./duration.mjs";
import { glance, runStart, testLabels, currentStep, triesAtStep, isLooping } from "./glance.mjs";
import { readLabel } from "./labels.mjs";
import { stageNamesFor } from "./stage-graph.mjs";
import contract from "./stages-contract.mjs";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

const section = (title, body) => `<section>\n<h2>${title}</h2>\n${body}\n</section>`;

function outcome(ledger) {
  if (ledger?.stop) return "STOPPED";
  return ledger?.stage?.status === "done" ? "DONE" : "RUNNING";
}

function glanceLabels(ledger) {
  return { now: ledger?.stop ? "Where it stopped" : "Where it is", spent: "Spent", left: "Left", looping: "Looping", offTrack: "Off track" };
}

// The run's length: endedAt (or the last stage end) minus the first start; NaN when either is missing.
// A run that has not ended (no end, no stage end, not DONE/STOPPED) is measured to `now`.
function runSeconds(ledger, endedAt, now) {
  const stages = Array.isArray(ledger?.stages) ? ledger.stages : [];
  const ends = stages.map((stage) => Date.parse(stage?.end)).filter(Number.isFinite);
  const live = outcome(ledger) === "RUNNING" && Number.isFinite(now) ? now : NaN;
  const end = Number.isFinite(Date.parse(endedAt)) ? Date.parse(endedAt) : ends.length > 0 ? Math.max(...ends) : live;
  const seconds = (end - Date.parse(runStart(ledger))) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : NaN;
}

function atAGlance({ ledger, spawns, ranFor, tests }) {
  const { rows } = glance({ ledger, spawns, tests, ranFor });
  if (outcome(ledger) === "DONE") rows.now = "finished";
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

// One row per try: a writing spawn (the label's phase is the step) and the runner spawn that follows it on the same test.
// Try n is the pane's count: the run of consecutive tries at the same step on the same test (glance's triesAtStep).
function triesOf(spawns, item) {
  const labels = testLabels(spawns);
  const tries = [];
  let written = 0;
  for (const spawn of Array.isArray(spawns) ? spawns : []) {
    if (spawn?.kind !== "workflow_agent") continue;
    const label = readLabel(spawn.name);
    if (label.unknown || label.item === null) continue;
    if (label.role === "runner") {
      const last = label.item === item ? tries.at(-1) : undefined;
      if (last && last.running === undefined) last.running = spawn.seconds;
    } else {
      if (label.item === item) tries.push({ step: label.phase, number: triesAtStep(labels, written), writing: spawn.seconds });
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
  const words = RESULT_WORDS[attempt.step];
  if (latest !== attempt || attempt.running === undefined || !words || !record || typeof record.passed !== "boolean") return UNKNOWN;
  const exits = Array.isArray(record.exitCodes) ? record.exitCodes.filter((code) => typeof code === "number") : [];
  const codes = exits.length > 0 ? ` (exit ${exits.join(", ")})` : "";
  if (record.timedOut === true) return `timed out${codes}`;
  if (attempt.step === "RED" && covered?.done === true) return `already covered, the test passed before any new code${codes}`;
  // On a RED record, passed means the try met the step (the test failed); exit 0 on an unmet try is the test passing at once.
  if (!record.passed && attempt.step === "RED" && exits.some((code) => code !== 0)) return `refused, the test did not fail cleanly${codes}`;
  return `${record.passed ? words.met : words.unmet}${codes}`;
}

function tryCells(attempt, tries, perTest) {
  const result = resultOf(attempt, tries, perTest?.[attempt.step.toLowerCase()], perTest?.covered);
  return [attempt.step, attempt.number, clock((attempt.writing ?? NaN) + (attempt.running ?? NaN)), clock(attempt.writing), clock(attempt.running), result, UNKNOWN];
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
    if (record?.[key] && !out.some((t) => t.step === step)) out.push({ step, number: 1, writing: NaN, running: NaN });
  }
  return out;
}

const TRY_COLUMNS = ["Step", "Try", "Total", "Writing", "Running", "Result", "Commit"];
const OPTIONAL_COLUMNS = new Set(["Total", "Writing", "Running", "Commit"]);
const UNKNOWN_CELLS = new Set([UNKNOWN, clock(NaN)]);

function testCard(spawns, item, number, perTest, stop) {
  const tries = withLedgerTries(triesOf(spawns, item), perTest?.[item]);
  const cells = tries.map((attempt) => tryCells(attempt, tries, perTest?.[item]));
  // Step, Try and Result always stay; a time or commit column is dropped when it is unknown on every try row.
  const kept = TRY_COLUMNS.map((label, column) => !OPTIONAL_COLUMNS.has(label) || cells.length === 0 || cells.some((row) => !UNKNOWN_CELLS.has(row[column])));
  const rows = cells.map((row) => `<tr>${row.filter((_, column) => kept[column]).map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`);
  const head = `<tr>${TRY_COLUMNS.filter((_, column) => kept[column]).map((label) => `<th>${label}</th>`).join("")}</tr>`;
  const note = !perTest?.[item]?.red && tries.length === 0 ? "\n<p>not reached</p>" : "";
  const looped = loopNote(tries, stop);
  const table = cells.length === 0 ? "" : `\n<table>\n${head}\n${rows.join("\n")}\n</table>`;
  return `<article${looped ? ' class="looped"' : ""}>\n<h3>${number > 0 ? `<small>test ${number}</small> ` : ""}${escape(item)}</h3>${note}${table}${looped}\n</article>`;
}

function testsSection({ ledger, spawns, tests }) {
  const perTest = ledger?.tests?.perTest ?? {};
  const keys = Object.keys(perTest);
  // Once perTest has results, a legacy-list id with no result and no spawns is dropped; the numbering keeps the existing order rules.
  const seen = new Set([...keys, ...testsSeen(spawns)]);
  const planned = numberedTests(spawns, tests).filter((item) => keys.length === 0 || seen.has(item));
  const order = [...new Set([...planned, ...keys])];
  const items = order;
  const last = currentStep(spawns)?.item;
  const cards = items.map((item) => testCard(spawns, item, order.indexOf(item) + 1, perTest, item === last ? ledger?.stop : null));
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

function stepsSection({ ledger }) {
  const stages = Array.isArray(ledger?.stages) ? ledger.stages : [];
  const recorded = new Map(stages.map((stage) => [stage.name, stage]));
  const start = stages[0]?.startedAt;
  const withEnds = stages.some((stage) => Number.isFinite(Date.parse(stage?.end)));
  const labels = withEnds ? ["Step", "Start", "End", "Took"] : ["Step", "Started"];
  const head = `<tr>${labels.map((label) => `<th>${label}</th>`).join("")}</tr>`;
  const rows = stageNamesFor(contract, ledger).map((name) => stepRow(name, recorded.get(name), start, withEnds));
  return section("STEPS", `<table>\n${head}\n${rows.join("\n")}\n</table>`);
}

const SHORT_SHA = 7;

const commitItem = (commit) => `<li>${escape(String(commit?.sha ?? "").slice(0, SHORT_SHA))} ${escape(commit?.subject)}</li>`;

function commitsSection({ commits }) {
  const body = Array.isArray(commits) ? `<ul>\n${commits.map(commitItem).join("\n")}\n</ul>` : `<p>${UNKNOWN}</p>`;
  return section("COMMITS", body);
}

function whatYouCanDo({ ledger, spawns, tests }) {
  const step = NEXT_STEP[outcome(ledger)]({ ledger, spawns, tests });
  return section("WHAT YOU CAN DO", `<p>1. ${escape(step)}</p>`);
}

// R5-3's dark design: one inline stylesheet, monospace; the outcome badge is red, green or amber by outcome, and a looped test's "Why it looped" label is amber.
const STYLE = `:root{color-scheme:dark}
body{background:#1c1d21;color:#e6e6e6;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:40px 56px;max-width:1100px}
header p{color:#9a9ca3;margin:6px 0}
.badge{color:#1c1d21;padding:2px 10px;border-radius:4px}
.badge.stopped{background:#ff6b81}
.badge.done{background:#5fd38d}
.badge.running{background:#ffc933}
h1{font:700 22px/1.3 system-ui,sans-serif;margin:0}
h2{color:#9a9ca3;font-size:12px;letter-spacing:.12em;border-bottom:1px solid #3a3c44;padding-bottom:6px;margin:32px 0 12px}
h3{font-size:14px;margin:0 0 8px}
p{margin:4px 0}
section p strong{color:#9a9ca3;display:inline-block;min-width:150px;text-transform:uppercase;font-size:12px}
article{border:1px solid #3a3c44;border-radius:8px;padding:12px 16px;margin:12px 0}
table{border-collapse:collapse;width:100%}
th{text-align:left;color:#9a9ca3;font-weight:400;padding:4px 12px 4px 0}
td{padding:4px 12px 4px 0;vertical-align:top}
ul{list-style:none;padding:0}
li{margin:2px 0}
.looped p strong{color:#ffc933;min-width:0;text-transform:none;font-size:inherit}
footer{color:#6b6d75;margin-top:40px;font-size:12px}`;

// The task's paragraphs (split on blank lines) stay visibly apart inside the title.
function title(task) {
  if (typeof task !== "string") return escape(task);
  return task.split(/\n\s*\n/).map((paragraph) => escape(paragraph.trim())).join("<br>");
}

export function renderReport({ ledger, spawns, timing, commits, tests, endedAt, now } = {}) {
  const ranFor = runSeconds(ledger, endedAt, now);
  const state = outcome(ledger);
  const taskType = plainName(ledger?.taskType) ?? "unknown type";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Run report</title>
<style>
${STYLE}
</style></head>
<body>
<header>
<h1>${title(ledger?.task)}</h1>
<p><strong class="badge ${state.toLowerCase()}">${state}</strong> · ${escape(taskType)} · ${clock(Number.isFinite(ranFor) ? ranFor : timing?.seconds)}</p>
</header>
${atAGlance({ ledger, spawns, ranFor: Number.isFinite(ranFor) ? ranFor : timing?.seconds, tests })}
${stepsSection({ ledger })}
${testsSection({ ledger, spawns, tests })}
${commitsSection({ commits })}
${whatYouCanDo({ ledger, spawns, tests })}
<footer>Written by Pairing Buddy from the run's ledger and agent labels. One self-contained file, nothing loaded from the network.</footer>
</body></html>`;
}
