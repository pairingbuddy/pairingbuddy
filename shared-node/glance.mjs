// The five "at a glance" rows, as plain sentences (docs/design/progress-mod/DIRECTION.md).
// Pure; tolerates missing or partial input. What cannot be known is shown as "unknown", never invented.
import { plainName } from "./plain-names.mjs";
import { readLabel } from "./labels.mjs";
import { MAX_TRIES } from "./limits.mjs";

const UNKNOWN = "unknown";
const TIME_UNKNOWN = "time unknown";
const AGENT_KINDS = ["Agent", "workflow_agent"];
const RUNNER_ROLE = "runner";
const SAFETY_NET = "the safety-net review and your sign-off";

function ordinal(n) {
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10] ?? "th";
  return `${n}${suffix}`;
}

// The current step is the last agent spawn on a test, runner checkpoints aside. Its try is the run of
// consecutive trailing spawns with the same role and test (a run of one is try 1).
function currentStep(spawns) {
  const labels = spawns
    .filter((spawn) => spawn && spawn.kind === "workflow_agent")
    .map((spawn) => readLabel(spawn.name))
    .filter((label) => !label.unknown && label.item !== null && label.role !== RUNNER_ROLE);
  const last = labels.at(-1);
  if (!last) return undefined;
  let tries = 0;
  for (let i = labels.length - 1; i >= 0 && labels[i].role === last.role && labels[i].item === last.item; i--) tries++;
  return { ...last, tries };
}

const testPosition = (step, tests) => tests.indexOf(step?.item) + 1;
const agentCount = (spawns) => spawns.filter((spawn) => spawn && AGENT_KINDS.includes(spawn.kind)).length;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isLooping = (step) => step.tries >= MAX_TRIES;

// What is left after the current test: "N more tests" / "this test". `more` says whether to word it "N more tests" or "N tests".
function remainingTests(step, tests, { more }) {
  const position = testPosition(step, tests);
  if (position === 0) return undefined;
  const count = tests.length - position;
  if (count === 0) return "this test";
  return more ? `${count} more test${count === 1 ? "" : "s"}` : plural(count, "test");
}

function elapsed(startedAt, now) {
  const seconds = Math.floor((now - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return TIME_UNKNOWN;
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// The run began at the first stage's start; before any stage closes, that is the current stage's. A closed stage
// that lacks its start leaves the run's start unknown, never the current stage's.
const runStart = (ledger) => (ledger?.stages?.length > 0 ? ledger.stages[0].startedAt : ledger?.stage?.startedAt);

function spentRow({ ledger, spawns, now }) {
  const agents = agentCount(spawns);
  const tokens = ledger?.spend?.tokensKnown === true ? `${ledger.spend.tokens} tokens` : "tokens unknown";
  return `${agents} ${agents === 1 ? "agent" : "agents"} · ${elapsed(runStart(ledger), now)} · ${tokens} · % of plan unknown`;
}

function nowRow(step, tests, ledger) {
  if (ledger?.stop) return "stopped";
  if (!step) return plainName(ledger?.stage?.name) ?? UNKNOWN;
  const position = testPosition(step, tests);
  const where = position > 0 ? ` · test ${position} of ${tests.length}` : "";
  const retry = step.tries > 1 ? `, ${ordinal(step.tries)} try` : "";
  return `${plainName(step.role) ?? UNKNOWN} for ${step.item.replace(/[-_]/g, " ")}${where}${retry}`;
}

function leftRow(step, tests) {
  const remaining = remainingTests(step, tests, { more: true });
  return remaining ? `${remaining}, then ${SAFETY_NET}` : UNKNOWN;
}

function loopingRow(step) {
  if (!step) return UNKNOWN;
  return isLooping(step) ? `yes: ${step.tries} tries at the same step` : `no · this step: try ${step.tries} of ${MAX_TRIES}`;
}

const SEPARATOR = " │ ";
const PERCENT_PART = / · ≈.*$/;

function bandWhere(step, tests, ledger) {
  const position = testPosition(step, tests);
  if (!step || position === 0) return plainName(ledger?.stage?.name) ?? UNKNOWN;
  return `${step.phase} · test ${position} of ${tests.length}`;
}

function bandLeft(step, tests) {
  return `left: ${remainingTests(step, tests, { more: false }) ?? UNKNOWN}${testPosition(step, tests) > 0 ? " + review" : ""}`;
}

function bandSpent({ ledger, spawns, now }) {
  const agents = agentCount(spawns);
  return `${elapsed(runStart(ledger), now)} · ${agents} ${agents === 1 ? "agent" : "agents"}`;
}

// A gate reads by its plain name; a stop reads "stopped", with no reason or code (stable stop codes are Task 58).
function bandNeedsYou(ledger) {
  const gate = ledger?.needsHuman?.gate;
  if (gate) return `needs you: ${plainName(gate) ?? gate}`;
  return ledger?.stop ? "needs you: stopped" : "needs you: no";
}

function bandSegments({ ledger, spawns, tests, now }, step) {
  const looping = step ? (isLooping(step) ? "yes" : "no") : UNKNOWN;
  return [
    { id: "where", text: bandWhere(step, tests, ledger) },
    { id: "spent", text: bandSpent({ ledger, spawns, now }) },
    { id: "left", text: bandLeft(step, tests) },
    { id: "looping", text: `looping: ${looping}` },
    { id: "offTrack", text: `off track: ${UNKNOWN}` },
    { id: "needsYou", text: bandNeedsYou(ledger) },
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
// If it still does not fit, truncate segment texts with an ellipsis, last (lowest priority) first;
// as a last resort drop trailing segments, so the band is never wider than the columns.
export function fitBand(segments, columns) {
  const withoutLeft = segments.filter((segment) => segment.id !== "left");
  const withoutPercent = withText(withoutLeft, "spent", (text) => text.replace(PERCENT_PART, ""));
  const attempts = [segments, withoutLeft, withoutPercent, withText(withoutPercent, "needsYou", (text) => text.replace(/^needs you:/, "you:"))];
  const fitting = attempts.find((attempt) => bandWidth(attempt) <= columns);
  if (fitting) return fitting;

  let band = attempts.at(-1);
  for (let i = band.length - 1; i >= 0 && bandWidth(band) > columns; i--) {
    band = withText(band, band[i].id, (text) => truncate(text, bandWidth(band) - columns));
  }
  while (bandWidth(band) > columns && band.length > 1) band = band.slice(0, -1);
  return bandWidth(band) > columns ? withText(band, band[0].id, (text) => text.slice(0, Math.max(columns, 0))) : band;
}

// The raw names of workflow agents whose label does not read: shown as they are and counted, never dropped.
function unknownLabels(spawns) {
  return spawns
    .filter((spawn) => spawn && spawn.kind === "workflow_agent" && readLabel(spawn.name).unknown)
    .map((spawn) => String(spawn.name));
}

export function glance({ ledger, spawns, tests, now } = {}) {
  const list = Array.isArray(spawns) ? spawns : [];
  const names = Array.isArray(tests) ? tests : [];
  const step = currentStep(list);
  const rows = {
    now: nowRow(step, names, ledger),
    spent: spentRow({ ledger, spawns: list, now }),
    left: leftRow(step, names),
    looping: loopingRow(step),
    offTrack: UNKNOWN,
  };
  return { rows, band: bandSegments({ ledger, spawns: list, tests: names, now }, step), unknownLabels: unknownLabels(list) };
}
