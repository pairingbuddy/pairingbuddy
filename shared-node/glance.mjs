// The "at a glance" rows (where, spent, left), as plain sentences (docs/design/progress-mod/DIRECTION.md).
// Pure; tolerates missing or partial input. What cannot be known is never invented: the rows say "unknown" (the report
// shows them so), the pane leaves unknown parts out with leaveOutUnknown, and the band leaves unknown segments out.
import { plainName } from "./plain-names.mjs";
import { readLabel } from "./labels.mjs";
import { MAX_TRIES } from "./limits.mjs";
import { clock } from "./duration.mjs";
import { TOKENS_UNIT } from "./spent-line.mjs";
import { permissionLine } from "./permission-wait.mjs";
import { strandedLine } from "./stranded.mjs";

const UNKNOWN = "unknown";
const AGENT_KINDS = ["Agent", "workflow_agent"];
const RUNNER_ROLE = "runner";
const SAFETY_NET = "the safety-net review and your sign-off";

// The labels of the agent spawns that sit on a test, in order, runner checkpoints aside. One rule for the pane and the report.
// Only a test's cycle names a phase: a review round's items (a finding, a fix group, a lens) are no tests. Given a stage,
// only that stage's spawns count, so a step of an earlier stage is never the current one.
export function testLabels(spawns, stage) {
  return (Array.isArray(spawns) ? spawns : [])
    .filter((spawn) => spawn && spawn.kind === "workflow_agent")
    .map((spawn) => ({ ...readLabel(spawn.name), startedAt: spawn.startedAt }))
    .filter((label) => !label.unknown && label.item !== null && label.phase !== null && label.role !== RUNNER_ROLE)
    .filter((label) => !stage || label.stage === stage);
}

// The stage the ledger names, or undefined when it names none.
export const stageOf = (ledger) => (typeof ledger?.stage?.name === "string" && ledger.stage.name !== "" ? ledger.stage.name : undefined);

// The one rule for "tries at the same step": the run of consecutive spawns, ending at labels[index], with the same role and test
// (a run of one is try 1). Shared by the pane's current step and the report's per-step numbering.
export function triesAtStep(labels, index) {
  const at = labels[index];
  let tries = 0;
  for (let i = index; i >= 0 && labels[i].role === at.role && labels[i].item === at.item; i--) tries++;
  return tries;
}

// The current step is the last agent spawn on a test (in the given stage, when one is given), with its tries at that step.
export function currentStep(spawns, stage) {
  const labels = testLabels(spawns, stage);
  const last = labels.at(-1);
  if (!last) return undefined;
  return { ...last, tries: triesAtStep(labels, labels.length - 1) };
}

// The one rule for "looping", from a count of tries at the same step: the report's "Why it looped" note reads it.
export const isLooping = (tries) => tries >= MAX_TRIES;

const testPosition = (step, tests) => tests.indexOf(step?.item) + 1;
const agentCount = (spawns) => spawns.filter((spawn) => spawn && AGENT_KINDS.includes(spawn.kind)).length;
// The agents the runs recorded when given (an ended task's); else the task's earlier runs', the ledger's closed stage
// attempts and the session's spawns of the attempt running now.
function agentsOf(spawns, recorded, ledger, earlier) {
  if (Number.isInteger(recorded) && recorded >= 0) return recorded;
  const closed = ledger?.spend?.agents;
  const before = Number.isInteger(earlier) && earlier > 0 ? earlier : 0;
  return before + (Number.isInteger(closed) && closed >= 0 ? closed + agentCount(attemptSpawns(spawns, ledger)) : agentCount(spawns));
}

// The spawns of the stage attempt running now, by their label's stage and not started before the attempt: the ledger counts an
// attempt's agents only once it closes, and every closed one's whatever the session saw.
function attemptSpawns(spawns, ledger) {
  if (ledger?.stage?.status !== "active") return [];
  const start = Date.parse(ledger.stage.startedAt);
  return spawns.filter((spawn) => readLabel(spawn?.name).stage === ledger.stage.name && !(Date.parse(spawn.startedAt) < start));
}
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What is left after the current test: "N more tests" / "this test". `more` says whether to word it "N more tests" or "N tests".
function remainingTests(step, tests, { more, complete }) {
  if (!complete) return undefined;
  const position = testPosition(step, tests);
  if (position === 0) return undefined;
  const count = tests.length - position;
  if (count === 0) return "this test";
  return more ? plural(count, "more test") : plural(count, "test");
}

// A recorded run knows how long it ran (ranFor, seconds) even when its start was not kept; otherwise it is now minus the start.
// waited: the seconds of it spent waiting on the human, which are no working time.
export function elapsed(startedAt, now, ranFor, waited = 0) {
  return clock((Number.isFinite(ranFor) ? ranFor : (now - Date.parse(startedAt)) / 1000) - waited);
}


// Every wait as [from, to] in ms: answered questions, the one still asked, permission prompts and stops (stopWaits), an
// open one up to `until`. A record with no usable times is no interval.
function waitIntervals(ledger, until) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const gates = ledger?.gates && typeof ledger.gates === "object" ? Object.values(ledger.gates) : [];
  const answered = [...gates, ...list(ledger?.gateWaits)].filter((record) => typeof record?.askedAt === "string").map(({ askedAt, answeredAt }) => [Date.parse(askedAt), Date.parse(answeredAt)]);
  const asked = typeof ledger?.needsHuman?.askedAt === "string" ? [[Date.parse(ledger.needsHuman.askedAt), until]] : [];
  const openable = [...list(ledger?.permissionWaits), ...list(ledger?.stopWaits)].filter((wait) => typeof wait?.askedAt === "string").map(({ askedAt, answeredAt }) => [Date.parse(askedAt), answeredAt === undefined ? until : Date.parse(answeredAt)]);
  return [...answered, ...asked, ...openable].filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from);
}

// The seconds of the waits since `from`, each moment once: a question asked while the run is stopped is one wait. An open
// wait runs to `until`; an answered one counts whole unless clipEnd also cuts it there (a step's age, which ends at until).
export function waitedBetween(ledger, from, until, { clipEnd = false } = {}) {
  const clipped = waitIntervals(ledger, until).map(([a, b]) => [Math.max(a, from), clipEnd ? Math.min(b, until) : b]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of clipped) {
    const start = Math.max(a, end);
    if (b > start) total += b - start;
    end = Math.max(end, b);
  }
  return total / 1000;
}

// The seconds a run waited on the human: its questions, each answered one from askedAt to answeredAt (kept on its gate's
// record, or in gateWaits once a redo removed the record) and the one still asked from its askedAt to `until`, Claude
// Code's permission prompts (permissionWaits) and its stops (stopWaits) the same way. A ledger written before these stamps waited 0.
export function waitedSeconds(ledger, until) {
  return waitedBetween(ledger, -Infinity, until);
}

// When the live run stopped working, in ms, or undefined while it works or when nothing says. A run that stopped or waits on
// the human runs nothing, so SPENT's clock stops there: the question's askedAt, an open permission prompt's, else the
// pausedAt the views' own overlays (a stranded stage, the safety checks off) or the mod (the ledger's last write) set.
export function pausedAtOf(ledger) {
  if (!ledger?.stop && !ledger?.needsHuman) return undefined;
  const prompt = (Array.isArray(ledger.permissionWaits) ? ledger.permissionWaits : []).findLast((wait) => wait?.answeredAt === undefined)?.askedAt;
  const stopped = ledger.stop ? (Array.isArray(ledger.stopWaits) ? ledger.stopWaits : []).findLast((wait) => wait?.answeredAt === undefined)?.askedAt : undefined;
  const at = [ledger.needsHuman?.askedAt, prompt, stopped, ledger.pausedAt].map((time) => (typeof time === "string" ? Date.parse(time) : time)).find(Number.isFinite);
  return at;
}

// The word SPENT's time carries while its clock is stopped.
export const PAUSED = "paused";

// The run began at the first stage's start; before any stage closes, that is the current stage's. A closed stage
// that lacks its start leaves the run's start unknown, never the current stage's.
export const runStart = (ledger) => (ledger?.stages?.length > 0 ? ledger.stages[0].startedAt : ledger?.stage?.startedAt);

// leaveOutUnknown drops the parts that are not measured (the pane's choice); the report keeps them, saying "unknown".
function spentRow({ ledger, spawns, agents: recorded, earlierAgents, now, ranFor, since, waited, paused, leaveOutUnknown }) {
  const agents = agentsOf(spawns, recorded, ledger, earlierAgents);
  const known = ledger?.spend?.tokensKnown === true;
  const tokens = known ? `${ledger.spend.tokens} ${TOKENS_UNIT}` : "tokens unknown";
  const parts = [plural(agents, "agent"), spentTime(since ?? runStart(ledger), now, ranFor, waited, paused), tokens];
  return (leaveOutUnknown ? parts.filter((part) => !part.endsWith(UNKNOWN)) : parts).join(" · ");
}

// A retry in plain words: nothing on a first try, "try N of 3" on a later one, and on the last allowed try a word that the
// human may be needed soon. A try past the limit (the human let it go on) is only counted.
function retryPart(tries) {
  if (tries < 2) return "";
  if (tries > MAX_TRIES) return ` · try ${tries}`;
  return ` · try ${tries} of ${MAX_TRIES}${tries === MAX_TRIES ? " · last try before it asks you" : ""}`;
}

function nowRow(step, tests, ledger, complete) {
  if (ledger?.stop) return stopLine(ledger.stop);
  if (!step) return plainName(ledger?.stage?.name) ?? UNKNOWN;
  const position = testPosition(step, tests);
  const where = position > 0 ? ` · test ${position}${complete ? ` of ${tests.length}` : ""}` : "";
  return `${plainName(step.role) ?? UNKNOWN} for ${step.item.replace(/[-_]/g, " ")}${where}${retryPart(step.tries)}`;
}

function leftRow(step, tests, complete) {
  const remaining = remainingTests(step, tests, { more: true, complete });
  return remaining ? `${remaining}, then ${SAFETY_NET}` : UNKNOWN;
}

export const SEPARATOR = " │ ";
export const SEPARATOR_WIDTH = SEPARATOR.length;
const PERCENT_PART = / · ≈.*$/;

function bandWhere(step, tests, ledger, complete) {
  const position = testPosition(step, tests);
  if (!step || position === 0) return plainName(ledger?.stage?.name) ?? UNKNOWN;
  return `${step.phase} · test ${position}${complete ? ` of ${tests.length}` : ""}`;
}

// Undefined when nothing left can be counted: the band leaves the segment out.
function bandLeft(step, tests, complete) {
  const remaining = remainingTests(step, tests, { more: false, complete });
  return remaining ? `left: ${remaining} + review` : undefined;
}

// The run time is left out when it is unknown; the agent count always stands.
// The time part, with "paused" after it while the clock is stopped; an unknown time stays unknown, so it is left out.
function spentTime(startedAt, now, ranFor, waited, paused) {
  const time = elapsed(startedAt, now, ranFor, waited);
  return paused && !time.endsWith(UNKNOWN) ? `${time} ${PAUSED}` : time;
}

function bandSpent({ ledger, spawns, agents: recorded, earlierAgents, now, since, waited, paused }) {
  const agents = agentsOf(spawns, recorded, ledger, earlierAgents);
  return [spentTime(since ?? runStart(ledger), now, undefined, waited, paused), plural(agents, "agent")].filter((part) => !part.endsWith(UNKNOWN)).join(" · ");
}

const STOPPED = "stopped";

// A stop reads by the plain name of its code, or undefined when the code has none.
export function stopName(stop) {
  return plainName(stop?.code);
}

// The one wording for a stop, shared by the pane, the band and the status line: "stopped: <name>", or bare "stopped" when the code has no plain name.
export function stopLine(stop) {
  const name = stopName(stop);
  return name ? `${STOPPED}: ${name}` : STOPPED;
}

// A gate reads by its plain name, Claude Code's permission prompt by what it asks, a stranded stage by what to do; a gate with neither falls back to its id as given.
export const gateLine = (gate) => plainName(gate) ?? permissionLine(gate) ?? strandedLine(gate) ?? gate;

// The one wording for a gate waiting on the human, shared by the band and the status line.
export const needsYouLine = (gate) => `needs you: ${gateLine(gate)}`;

// A gate reads by its plain name; a stop reads by the plain name of its code, never the code itself.
function bandNeedsYou(ledger) {
  const gate = ledger?.needsHuman?.gate;
  if (gate) return { id: "needsYou", text: needsYouLine(gate), standing: true };
  if (!ledger?.stop) return { id: "needsYou", text: "needs you: no" };
  return { id: "needsYou", text: `needs you: ${stopName(ledger.stop) ?? STOPPED}`, standing: true };
}

// A band segment only when its value is known; an unknown one says nothing, so it is left out.
const known = (id, text) => (text === undefined ? [] : [{ id, text }]);

// A retry is told where the step is (NOW, the pane's STATUS), so the band has no looping segment.
function bandSegments({ ledger, spawns, agents, earlierAgents, tests, now, since, waited, paused, complete }, step) {
  return [
    { id: "where", text: bandWhere(step, tests, ledger, complete) },
    { id: "spent", text: bandSpent({ ledger, spawns, agents, earlierAgents, now, since, waited, paused }) },
    ...known("left", bandLeft(step, tests, complete)),
    bandNeedsYou(ledger),
  ];
}

const bandWidth = (segments) => segments.map((segment) => segment.text).join(SEPARATOR).length;

const withText = (segments, id, change) => segments.map((segment) => (segment.id === id ? { ...segment, text: change(segment.text) } : segment));

// Cut `overflow` characters from the text, ending in an ellipsis; never below the ellipsis alone.
function truncate(text, overflow) {
  const cut = Math.min(overflow, text.length - 1);
  return cut <= 0 ? text : `${text.slice(0, text.length - cut - 1)}…`;
}

// needs-you's short form: the one it carries (short), else "needs you:" shortened to "you:".
const shortNeedsYou = (segments) => segments.map((segment) => (segment.id === "needsYou" ? { ...segment, text: segment.short ?? segment.text.replace(/^needs you:/, "you:") } : segment));

// Narrowing order: drop "left:", then the "≈ %" of spent, then shorten needs-you (shortNeedsYou).
// If it still does not fit, drop whole segments, last (lowest priority) first; a segment is never cut unless it is the only one left,
// and then it takes its shorter forms (shorter, longest first) before any cut.
// When an event stands (its segment carries standing: true), needs-you is kept whole: it is shortened only if that alone fits,
// the other segments give first, and it is cut only as a last resort. The band is never wider than the columns.
export function fitBand(segments, columns) {
  const withoutLeft = segments.filter((segment) => segment.id !== "left");
  const withoutPercent = withText(withoutLeft, "spent", (text) => text.replace(PERCENT_PART, ""));
  const shortened = shortNeedsYou(withoutPercent);
  const fitting = [segments, withoutLeft, withoutPercent, shortened].find((attempt) => bandWidth(attempt) <= columns);
  if (fitting) return fitting;

  const standing = segments.some((segment) => segment.id === "needsYou" && segment.standing);
  let band = standing ? withoutPercent : shortened;
  while (bandWidth(band) > columns && band.length > 1) {
    const last = band.findLastIndex((segment) => !standing || segment.id !== "needsYou");
    band = band.filter((_, i) => i !== last);
  }
  // A lead segment alone and still too wide takes the longest of its shorter forms that fits (the current test's name cut at a
  // word, then its number), before the last-resort cut.
  const shorter = !standing && bandWidth(band) > columns && band[0].shorter?.find((text) => text.length <= columns);
  if (shorter) band = withText(band, band[0].id, () => shorter);
  if (standing && bandWidth(band) > columns) {
    const short = shortNeedsYou(band);
    band = withText(short, "needsYou", (text) => truncate(text, bandWidth(short) - columns));
  }
  return bandWidth(band) > columns ? withText(band, band[0].id, (text) => text.slice(0, Math.max(columns, 0))) : band;
}

// The raw names of workflow agents whose label does not read: shown as they are and counted, never dropped.
function unknownLabels(spawns) {
  return spawns
    .filter((spawn) => spawn && spawn.kind === "workflow_agent" && readLabel(spawn.name).unknown)
    .map((spawn) => String(spawn.name));
}

// testsComplete: false says the list is only the tests seen so far, so no total ("of M") and no count left is claimed.
// leaveOutUnknown: true leaves the unknown parts out of SPENT, for the pane.
// since: the unit's start, when known, so the time spent counts the whole unit and not only this run.
// agents: the agents the task's runs recorded, once they have ended; otherwise the ledger's and the running attempt's spawns.
// earlierAgents: what the task's earlier runs recorded (the kept code run, while the publish run is live), added to those.
// waited: the seconds the time spent waited on the human, left out of it; by default the ledger's own waits (waitedSeconds).
// pausedAt: when a live run stopped working (pausedAtOf), in ms; SPENT's time stops there and says "paused".
export function glance({ ledger, spawns, agents, earlierAgents, tests, now, ranFor, since, waited, pausedAt, testsComplete = false, leaveOutUnknown = false } = {}) {
  const list = Array.isArray(spawns) ? spawns : [];
  const names = Array.isArray(tests) ? tests : [];
  const step = currentStep(list, stageOf(ledger));
  // A pause before the run began says nothing of it (a file time from another clock, say), so the clock runs on.
  const paused = Number.isFinite(pausedAt) && !(pausedAt < Date.parse(since ?? runStart(ledger)));
  const until = paused && Number.isFinite(now) ? Math.min(now, pausedAt) : now;
  const wait = Number.isFinite(waited) ? waited : waitedSeconds(ledger, until);
  const spent = { ledger, spawns: list, agents, earlierAgents, now: until, since, waited: wait, paused };
  const rows = {
    now: nowRow(step, names, ledger, testsComplete),
    spent: spentRow({ ...spent, ranFor, leaveOutUnknown }),
    left: leftRow(step, names, testsComplete),
  };
  return { rows, band: bandSegments({ ...spent, tests: names, complete: testsComplete }, step), unknownLabels: unknownLabels(list) };
}
