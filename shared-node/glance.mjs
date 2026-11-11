// The five "at a glance" rows, as plain sentences (docs/design/progress-mod/DIRECTION.md).
// Pure; tolerates missing or partial input. What cannot be known is shown as "unknown", never invented.
import { plainName } from "./plain-names.mjs";
import { readLabel } from "./labels.mjs";
import { MAX_TRIES } from "./limits.mjs";
import { clock } from "./duration.mjs";
import { TOKENS_UNIT } from "./spent-line.mjs";

const UNKNOWN = "unknown";
const AGENT_KINDS = ["Agent", "workflow_agent"];
const RUNNER_ROLE = "runner";
const SAFETY_NET = "the safety-net review and your sign-off";

function ordinal(n) {
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10] ?? "th";
  return `${n}${suffix}`;
}

// The labels of the agent spawns that sit on a test, in order, runner checkpoints aside. One rule for the pane and the report.
export function testLabels(spawns) {
  return (Array.isArray(spawns) ? spawns : [])
    .filter((spawn) => spawn && spawn.kind === "workflow_agent")
    .map((spawn) => ({ ...readLabel(spawn.name), startedAt: spawn.startedAt }))
    .filter((label) => !label.unknown && label.item !== null && label.role !== RUNNER_ROLE);
}

// The one rule for "tries at the same step": the run of consecutive spawns, ending at labels[index], with the same role and test
// (a run of one is try 1). Shared by the pane's current step and the report's per-step numbering.
export function triesAtStep(labels, index) {
  const at = labels[index];
  let tries = 0;
  for (let i = index; i >= 0 && labels[i].role === at.role && labels[i].item === at.item; i--) tries++;
  return tries;
}

// The current step is the last agent spawn on a test, with its tries at that step.
export function currentStep(spawns) {
  const labels = testLabels(spawns);
  const last = labels.at(-1);
  if (!last) return undefined;
  return { ...last, tries: triesAtStep(labels, labels.length - 1) };
}

// The one rule for "looping", from a count of tries at the same step. Shared by the pane and the report.
export const isLooping = (tries) => tries >= MAX_TRIES;

const testPosition = (step, tests) => tests.indexOf(step?.item) + 1;
const agentCount = (spawns) => spawns.filter((spawn) => spawn && AGENT_KINDS.includes(spawn.kind)).length;
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
export function elapsed(startedAt, now, ranFor) {
  return clock(Number.isFinite(ranFor) ? ranFor : (now - Date.parse(startedAt)) / 1000);
}

// The run began at the first stage's start; before any stage closes, that is the current stage's. A closed stage
// that lacks its start leaves the run's start unknown, never the current stage's.
export const runStart = (ledger) => (ledger?.stages?.length > 0 ? ledger.stages[0].startedAt : ledger?.stage?.startedAt);

function spentRow({ ledger, spawns, now, ranFor }) {
  const agents = agentCount(spawns);
  const tokens = ledger?.spend?.tokensKnown === true ? `${ledger.spend.tokens} ${TOKENS_UNIT}` : "tokens unknown";
  return `${plural(agents, "agent")} · ${elapsed(runStart(ledger), now, ranFor)} · ${tokens} · % of plan unknown`;
}

function nowRow(step, tests, ledger, complete) {
  if (ledger?.stop) return stopLine(ledger.stop);
  if (!step) return plainName(ledger?.stage?.name) ?? UNKNOWN;
  const position = testPosition(step, tests);
  const where = position > 0 ? ` · test ${position}${complete ? ` of ${tests.length}` : ""}` : "";
  const retry = step.tries > 1 ? `, ${ordinal(step.tries)} try` : "";
  return `${plainName(step.role) ?? UNKNOWN} for ${step.item.replace(/[-_]/g, " ")}${where}${retry}`;
}

function leftRow(step, tests, complete) {
  const remaining = remainingTests(step, tests, { more: true, complete });
  return remaining ? `${remaining}, then ${SAFETY_NET}` : UNKNOWN;
}

function loopingRow(step) {
  if (!step) return UNKNOWN;
  return isLooping(step.tries) ? `yes: ${step.tries} tries at the same step` : `no · this step: try ${step.tries} of ${MAX_TRIES}`;
}

export const SEPARATOR = " │ ";
export const SEPARATOR_WIDTH = SEPARATOR.length;
const PERCENT_PART = / · ≈.*$/;

function bandWhere(step, tests, ledger, complete) {
  const position = testPosition(step, tests);
  if (!step || position === 0) return plainName(ledger?.stage?.name) ?? UNKNOWN;
  return `${step.phase} · test ${position}${complete ? ` of ${tests.length}` : ""}`;
}

function bandLeft(step, tests, complete) {
  const remaining = remainingTests(step, tests, { more: false, complete });
  return `left: ${remaining ?? UNKNOWN}${remaining ? " + review" : ""}`;
}

function bandSpent({ ledger, spawns, now }) {
  const agents = agentCount(spawns);
  return `${elapsed(runStart(ledger), now)} · ${plural(agents, "agent")}`;
}

const STOPPED = "stopped";

// A stop reads by the plain name of its code, or undefined when the code has none.
function stopName(stop) {
  return plainName(stop?.code);
}

// The one wording for a stop, shared by the pane, the band and the status line: "stopped: <name>", or bare "stopped" when the code has no plain name.
export function stopLine(stop) {
  const name = stopName(stop);
  return name ? `${STOPPED}: ${name}` : STOPPED;
}

// A gate reads by its plain name; a gate with no plain name falls back to its id as given.
export const gateLine = (gate) => plainName(gate) ?? gate;

// The one wording for a gate waiting on the human, shared by the band and the status line.
export const needsYouLine = (gate) => `needs you: ${gateLine(gate)}`;

// A gate reads by its plain name; a stop reads by the plain name of its code, never the code itself.
function bandNeedsYou(ledger) {
  const gate = ledger?.needsHuman?.gate;
  if (gate) return { id: "needsYou", text: needsYouLine(gate), standing: true };
  if (!ledger?.stop) return { id: "needsYou", text: "needs you: no" };
  return { id: "needsYou", text: `needs you: ${stopName(ledger.stop) ?? STOPPED}`, standing: true };
}

function bandSegments({ ledger, spawns, tests, now, complete }, step) {
  const looping = step ? (isLooping(step.tries) ? "yes" : "no") : UNKNOWN;
  return [
    { id: "where", text: bandWhere(step, tests, ledger, complete) },
    { id: "spent", text: bandSpent({ ledger, spawns, now }) },
    { id: "left", text: bandLeft(step, tests, complete) },
    { id: "looping", text: `looping: ${looping}` },
    { id: "offTrack", text: `off track: ${UNKNOWN}` },
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

// Narrowing order: drop "left:", then the "≈ %" of spent, then shorten "needs you:" to "you:".
// If it still does not fit, drop whole segments, last (lowest priority) first; a segment is never cut unless it is the only one left.
// When an event stands (its segment carries standing: true), needs-you is kept whole: it is shortened only if that alone fits,
// the other segments give first, and it is cut only as a last resort. The band is never wider than the columns.
export function fitBand(segments, columns) {
  const withoutLeft = segments.filter((segment) => segment.id !== "left");
  const withoutPercent = withText(withoutLeft, "spent", (text) => text.replace(PERCENT_PART, ""));
  const shortened = withText(withoutPercent, "needsYou", (text) => text.replace(/^needs you:/, "you:"));
  const fitting = [segments, withoutLeft, withoutPercent, shortened].find((attempt) => bandWidth(attempt) <= columns);
  if (fitting) return fitting;

  const standing = segments.some((segment) => segment.id === "needsYou" && segment.standing);
  let band = standing ? withoutPercent : shortened;
  while (bandWidth(band) > columns && band.length > 1) {
    const last = band.findLastIndex((segment) => !standing || segment.id !== "needsYou");
    band = band.filter((_, i) => i !== last);
  }
  if (standing && bandWidth(band) > columns) {
    const short = withText(band, "needsYou", (text) => text.replace(/^needs you:/, "you:"));
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
export function glance({ ledger, spawns, tests, now, ranFor, testsComplete = false } = {}) {
  const list = Array.isArray(spawns) ? spawns : [];
  const names = Array.isArray(tests) ? tests : [];
  const step = currentStep(list);
  const rows = {
    now: nowRow(step, names, ledger, testsComplete),
    spent: spentRow({ ledger, spawns: list, now, ranFor }),
    left: leftRow(step, names, testsComplete),
    looping: loopingRow(step),
    offTrack: UNKNOWN,
  };
  return { rows, band: bandSegments({ ledger, spawns: list, tests: names, now, complete: testsComplete }, step), unknownLabels: unknownLabels(list) };
}
