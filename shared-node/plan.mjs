// Plan parser: turns plan markdown into units (one per PR: group, or per tracer that has no PR group) with their tasks.
// It does no I/O itself: it imports only node:path's posix normalise and the plan-boxes heading, title and unit name
// rules, so the titles and names it reports are the ones pb task end and pb publish look for.
import { posix } from "node:path";
import { boxesTitled, boxLabel, checkboxes, HEADING, headingName, isPrHeading, PR_LINE } from "./plan-boxes.mjs";

const FENCE = /^\s*(```|~~~)/;
const LEGACY_LINE = /^Legacy: accepted\s*$/;
const TRACER_LEVEL = 3;
const SECTION_LEVEL = 2;
const TASKS_SECTION = "Tasks";
const NON_TASK_SECTIONS = ["Requirements", "Architecture"];

// A level-1/2 heading opens a section; the task area is ## Tasks, or without it everything but Requirements and Architecture.
function inTaskArea(section, hasTasks) {
  return hasTasks ? section === TASKS_SECTION : !NON_TASK_SECTIONS.includes(section);
}

function isTasksHeading(heading) {
  return heading?.level === SECTION_LEVEL && heading.text === TASKS_SECTION;
}

// A heading line as { level, text }, or null for any other line.
function headingOf(line) {
  const match = HEADING.exec(line);
  return match && { level: match[1].length, text: match[2] };
}

// Every line with whether it is a fence line or inside a fenced code block (``` or ~~~); fenced lines hide headings and boxes.
function linesWithFences(text) {
  let fence = null;
  return text.split("\n").map((line) => {
    const marker = FENCE.exec(line)?.[1];
    if (!marker) return { line, fenced: fence !== null };
    if (fence === null) fence = marker[0];
    else if (marker[0] === fence) fence = null;
    return { line, fenced: true };
  });
}

// The task body: lines with the common indentation removed and blank ends trimmed.
function bodyText(bodyLines) {
  const first = bodyLines.findIndex((line) => line.trim());
  if (first === -1) return "";
  const last = bodyLines.findLastIndex((line) => line.trim());
  const kept = bodyLines.slice(first, last + 1);
  const common = Math.min(...kept.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)[0].length));
  return kept.map((line) => line.slice(common)).join("\n");
}

const isIndented = (line) => /^\s/.test(line);

// A unit waiting for its first box: its name and the PR: / Legacy lines seen under its heading.
const opening = (name, direct, headingLine) => ({ name, direct, headingLine, pr: null, legacy: false });

// What a heading opens: { direct, name } for a PR: group (direct false) or a level-3 tracer (direct true), or null when it
// opens neither. The name may be empty.
function unitHeading({ level, text }) {
  if (isPrHeading(text)) return { direct: false, name: headingName(text) };
  return level === TRACER_LEVEL ? { direct: true, name: headingName(text) } : null;
}

// Records the PR: / Legacy lines seen under a pending unit's heading.
function notePendingLine(pending, line) {
  const pr = PR_LINE.exec(line)?.[1];
  if (pr) pending.pr = pr;
  if (LEGACY_LINE.test(line)) pending.legacy = true;
}

// A task body runs through blank and indented lines; a non-indented line, including a top-level fence, ends it.
function continuesBody(line) {
  return !line.trim() || isIndented(line);
}

// The first unchecked task in document order with its unit and tracer, or null when every task is checked.
function firstUnchecked(units) {
  for (const { unit, tracer, tasks } of units) {
    const task = tasks.find(({ checked }) => !checked);
    if (task) return { unit, tracer, title: task.title, body: task.body };
  }
  return null;
}

// The values that occur more than once, each with its count.
function repeats(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1);
}

// One problem per task title that more than one box in the plan carries, counted the way pb task end counts them.
function duplicateTitleProblems(units, text) {
  const titles = new Set(units.flatMap(({ tasks }) => tasks.map(({ title }) => title)));
  return [...titles]
    .map((title) => [title, boxesTitled(text, title).length])
    .filter(([, count]) => count > 1)
    .map(([title, count]) => `${count} tasks are titled "${title}"; task titles identify tasks, so each must be unique`);
}

// One problem per unit name used more than once, naming the unit once with its count.
function duplicateUnitProblems(units) {
  return repeats(units.map(({ unit }) => unit)).map(([name, count]) => `${count} units are named "${name}"; unit names identify units, so each must be unique`);
}

// Format problems: a box outside any tracer, boxes directly under a tracer that also has PR: groups, repeated task titles
// and unit names, and a plan with no task at all.
function formatProblems(strays, misplacedUnits, units, text) {
  const problems = strays.map((title) => `the task "${title}" is not under a tracer`);
  for (const { tracer, tasks } of misplacedUnits) {
    for (const { title } of tasks) problems.push(`the task "${title}" is under the tracer "${tracer}" but outside its PR: groups`);
  }
  const found = strays.length + [...misplacedUnits, ...units].reduce((sum, { tasks }) => sum + tasks.length, 0);
  if (found === 0) problems.push("the plan has no tasks");
  return [...problems, ...duplicateUnitProblems(units), ...duplicateTitleProblems(units, text)];
}

export function parsePlan(text) {
  const units = [];
  const strays = [];
  const directUnits = []; // { opened, owner } for each unit a tracer heading opened
  const groupedTracers = new Set(); // tracer occurrences (not names) that own PR: groups
  let tracer = null;
  let unit = null;
  let pending = null;
  let section = null;
  let openBody = null;
  const lines = linesWithFences(text);
  const hasTasks = lines.some(({ line, fenced }) => !fenced && isTasksHeading(headingOf(line)));
  const openUnit = (waiting, owner) => {
    const opened = { unit: waiting.name, tracer: owner?.name ?? null, pr: waiting.pr, legacy: waiting.legacy, headingLine: waiting.headingLine, tasks: [] };
    units.push(opened);
    if (waiting.direct) directUnits.push({ opened, owner });
    else if (owner) groupedTracers.add(owner);
    return opened;
  };
  const closeBody = () => {
    if (openBody) openBody.task.body = bodyText(openBody.lines);
    openBody = null;
  };
  for (const [index, { line, fenced }] of lines.entries()) {
    const heading = fenced ? null : headingOf(line);
    const [box] = fenced || isIndented(line) ? [] : checkboxes(line);
    if (openBody && continuesBody(line)) {
      openBody.lines.push(line);
      continue;
    }
    closeBody();
    if (heading && heading.level <= SECTION_LEVEL) {
      section = heading.text;
      tracer = null;
      unit = null;
      pending = null;
    }
    if (!inTaskArea(section, hasTasks)) continue;
    const opens = heading && unitHeading(heading);
    if (opens) {
      const { direct, name } = opens;
      if (direct) tracer = { name };
      pending = direct || tracer ? opening(name, direct, index) : null; // a PR: group with no tracer opens no unit; any unit heading ends the previous one
      unit = null;
    }
    if (pending && !fenced) notePendingLine(pending, line);
    if (!box) continue;
    if (!unit && pending) unit = openUnit(pending, tracer);
    if (!unit) {
      strays.push(boxLabel(box.label));
      continue;
    }
    const task = { title: boxLabel(box.label), checked: box.ticked, body: "" };
    unit.tasks.push(task);
    openBody = { task, lines: [] };
  }
  closeBody();
  const misplaced = directUnits.filter(({ owner }) => groupedTracers.has(owner)).map(({ opened }) => opened);
  const unitsOut = units.filter((u) => !misplaced.includes(u));
  return { units: unitsOut, next: firstUnchecked(unitsOut), problems: formatProblems(strays, misplaced, unitsOut, text) };
}

// Titles of the tasks recorded for a unit: the open unit's records count only for that unit, in the same plan (paths compare normalised).
function recordedTitles(unit, plan, openUnit) {
  const matches = openUnit?.unit === unit.unit && typeof openUnit.plan === "string" && posix.normalize(openUnit.plan) === posix.normalize(plan);
  return new Set((matches ? openUnit.tasks : []).map((task) => task.title));
}

// Titles of the checked tasks of a unit that have no record: a box ticked by hand earns nothing.
const handTicked = (unit, recorded) => unit.tasks.filter((task) => task.checked && !recorded.has(task.title)).map((task) => task.title);

// The per-unit state:
//   published   - the unit has a PR: line.
//   open        - it has unchecked tasks and every checked one has a record.
//   hand-ticked - it has a checked task with no record, next to unchecked ones.
//   accepted    - it is fully checked and marked Legacy: accepted.
//   unpublished - it is fully checked and every task is recorded.
//   legacy      - it is fully checked and a task has no record.
function unitState(unit, recorded) {
  if (unit.pr) return "published";
  if (unit.tasks.some((task) => !task.checked)) return handTicked(unit, recorded).length > 0 ? "hand-ticked" : "open";
  if (unit.legacy) return "accepted";
  return unit.tasks.every((task) => recorded.has(task.title)) ? "unpublished" : "legacy";
}

// The state of every unit, in order, under the same records planStep uses.
export function unitStates(units, { plan, openUnit }) {
  return units.map((unit) => unitState(unit, recordedTitles(unit, plan, openUnit)));
}

// The pure rule behind pb plan next: which task is next and whether anything stops the plan.
export function planStep(units, context) {
  const states = unitStates(units, context);
  const at = states.findIndex((state) => state !== "published" && state !== "accepted");
  if (at === -1) return { next: null, stop: null };
  const [unit, state] = [units[at], states[at]];
  if (state === "open") return { next: firstUnchecked([unit]), stop: null };
  const stop = { reason: state, unit: unit.unit };
  if (state === "hand-ticked") stop.tasks = handTicked(unit, recordedTitles(unit, context.plan, context.openUnit));
  return { next: null, stop };
}
