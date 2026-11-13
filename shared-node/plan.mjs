// Plan parser: turns plan markdown into units (one per PR: group, or per tracer that has no PR group) with their tasks.
// It does no I/O itself: it imports only node:path's posix normalise and the plan-boxes heading, title and unit name
// rules, so the titles and names it reports are the ones pb task end and pb publish look for.
import { posix } from "node:path";
import { boxesTitled, boxLabel, checkboxes, HEADING, headingName, isPrHeading, PR_LINE } from "./plan-boxes.mjs";

const FENCE = /^\s*(```|~~~)/;
const LEGACY_LINE = /^Legacy: accepted\s*$/;
const DEPENDS_LINE = /^Depends on:\s*(.+?)\s*$/;
const TRACER_LEVEL = 3;
const SECTION_LEVEL = 2;
const TASKS_SECTION = "Tasks";
const NON_TASK_SECTIONS = ["Requirements", "Architecture"];
const HUMAN_TITLE = /^(?:Task\s+[^:\s]+:\s*)?\[HUMAN\]/; // [HUMAN] opens a title, or follows a leading "Task <id>:"
export const isHumanTitle = (title) => HUMAN_TITLE.test(title);

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

// A unit waiting for its first box: its name and the PR: / Legacy / Depends on lines seen under its heading.
// When a unit has more than one Depends on line the first wins: dependsOn keeps it, and the other checks judge it;
// repeatedDepends only records that a later line was seen, so the repeat is reported as a problem.
const opening = (name, direct, headingLine) => ({ name, direct, headingLine, pr: null, legacy: false, dependsOn: null, repeatedDepends: false });

// What a heading opens: { direct, name } for a PR: group (direct false) or a level-3 tracer (direct true), or null when it
// opens neither. The name may be empty.
function unitHeading({ level, text }) {
  if (isPrHeading(text)) return { direct: false, name: headingName(text) };
  return level === TRACER_LEVEL ? { direct: true, name: headingName(text) } : null;
}

// Records the PR: / Legacy / Depends on lines seen under a pending unit's heading.
function notePendingLine(pending, line) {
  const pr = PR_LINE.exec(line)?.[1];
  if (pr) pending.pr = pr;
  if (LEGACY_LINE.test(line)) pending.legacy = true;
  const dependsOn = DEPENDS_LINE.exec(line)?.[1];
  if (!dependsOn) return;
  if (pending.dependsOn) pending.repeatedDepends = true;
  else pending.dependsOn = dependsOn;
}

// A task body runs through blank and indented lines; a non-indented line, including a top-level fence, ends it.
function continuesBody(line) {
  return !line.trim() || isIndented(line);
}

// A task as the plan reports it: with its unit and tracer.
const taskInUnit = ({ unit, tracer }, { title, body }) => ({ unit, tracer, title, body });

const firstUncheckedTask = (unit) => unit.tasks.find(({ checked }) => !checked);

// The first unchecked task in document order with its unit and tracer, or null when every task is checked.
function firstUnchecked(units) {
  for (const unit of units) {
    const task = firstUncheckedTask(unit);
    if (task) return taskInUnit(unit, task);
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

// One problem per unit whose Depends on names no unit of the plan, naming the unit and the missing dependency.
function unknownDependencyProblems(units, position) {
  return units
    .filter(({ dependsOn }) => dependsOn && !position.has(dependsOn))
    .map(({ unit, dependsOn }) => `the unit "${unit}" depends on "${dependsOn}", which is not a unit of the plan`);
}

// One problem per unit with more than one Depends on line, naming the unit.
function repeatedDependencyProblems(units, repeatedDepends) {
  return units
    .filter((unit) => repeatedDepends.has(unit))
    .map(({ unit }) => `the unit "${unit}" has more than one Depends on line; a unit depends on at most one unit`);
}

// One problem per unit whose Depends on names the unit itself.
function selfDependencyProblems(units) {
  return units
    .filter(({ unit, dependsOn }) => dependsOn === unit)
    .map(({ unit }) => `the unit "${unit}" depends on itself`);
}

// One problem per unit whose Depends on names a unit that comes later in the plan.
// Unknown names fall out because their position is undefined, and undefined > n is false.
function laterDependencyProblems(units, position) {
  return units
    .filter(({ unit, dependsOn }) => position.get(dependsOn) > position.get(unit))
    .map(({ unit, dependsOn }) => `the unit "${unit}" depends on "${dependsOn}", which comes later in the plan; a dependency must come first`);
}

// Format problems, by group: placement (a box outside any tracer, or directly under a tracer that also has PR: groups),
// duplicates (task titles, unit names), dependencies (unknown, self, later, repeated Depends on line) and an empty plan.
function formatProblems(strays, misplacedUnits, units, repeatedDepends, text) {
  const problems = strays.map((title) => `the task "${title}" is not under a tracer`);
  for (const { tracer, tasks } of misplacedUnits) {
    for (const { title } of tasks) problems.push(`the task "${title}" is under the tracer "${tracer}" but outside its PR: groups`);
  }
  const found = strays.length + [...misplacedUnits, ...units].reduce((sum, { tasks }) => sum + tasks.length, 0);
  if (found === 0) problems.push("the plan has no tasks");
  const position = new Map(units.map(({ unit }, index) => [unit, index]));
  return [
    ...problems,
    ...duplicateUnitProblems(units),
    ...unknownDependencyProblems(units, position),
    ...repeatedDependencyProblems(units, repeatedDepends),
    ...selfDependencyProblems(units),
    ...laterDependencyProblems(units, position),
    ...duplicateTitleProblems(units, text),
  ];
}

export function parsePlan(text) {
  const units = [];
  const strays = [];
  const directUnits = []; // { opened, owner } for each unit a tracer heading opened
  const repeatedDepends = new Set(); // opened units that had a second Depends on line
  const groupedTracers = new Set(); // tracer occurrences (not names) that own PR: groups
  let tracer = null;
  let unit = null;
  let pending = null;
  let section = null;
  let openBody = null;
  const lines = linesWithFences(text);
  const hasTasks = lines.some(({ line, fenced }) => !fenced && isTasksHeading(headingOf(line)));
  const openUnit = (waiting, owner) => {
    const opened = { unit: waiting.name, tracer: owner?.name ?? null, pr: waiting.pr, legacy: waiting.legacy, dependsOn: waiting.dependsOn, headingLine: waiting.headingLine, tasks: [] };
    units.push(opened);
    if (waiting.repeatedDepends) repeatedDepends.add(opened);
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
    const title = boxLabel(box.label);
    if (!unit) {
      strays.push(title);
      continue;
    }
    const task = { title, checked: box.ticked, human: isHumanTitle(title), body: "" };
    unit.tasks.push(task);
    openBody = { task, lines: [] };
  }
  closeBody();
  const misplaced = directUnits.filter(({ owner }) => groupedTracers.has(owner)).map(({ opened }) => opened);
  const unitsOut = units.filter((u) => !misplaced.includes(u));
  return { units: unitsOut, next: firstUnchecked(unitsOut), problems: formatProblems(strays, misplaced, unitsOut, repeatedDepends, text) };
}

// Titles of the tasks recorded for a unit: the open unit's records count only for that unit, in the same plan (paths compare normalised).
function recordedTitles(unit, plan, openUnit) {
  const matches = openUnit?.unit === unit.unit && typeof openUnit.plan === "string" && posix.normalize(openUnit.plan) === posix.normalize(plan);
  return new Set((matches ? openUnit.tasks : []).map((task) => task.title));
}

// Titles of the checked non-human tasks of a unit that have no record: a box ticked by hand earns nothing, but a [HUMAN] task is the human's to tick.
const handTicked = (unit, recorded) => unit.tasks.filter((task) => task.checked && !task.human && !recorded.has(task.title)).map((task) => task.title);

// What a hand-ticked stop adds: the hand-ticked task titles, and the unchecked titles when every unchecked task is a human's.
function handTickedStop(unit, recorded) {
  const stop = { tasks: handTicked(unit, recorded) };
  const unchecked = unit.tasks.filter(({ checked }) => !checked);
  if (unchecked.every(({ human }) => human)) stop.humanLeft = unchecked.map(({ title }) => title);
  return stop;
}

// The per-unit state:
//   published   - the unit has a PR: line.
//   open        - it has unchecked tasks and every checked non-human one has a record.
//   hand-ticked - it has a checked non-human task with no record, next to unchecked ones.
//   accepted    - it is fully checked and marked Legacy: accepted.
//   unpublished - it is fully checked, has an agent task, and every agent task is recorded (human tasks need no record).
//   legacy      - it is fully checked and an agent task has no record, or it has no agent task.
function unitState(unit, recorded) {
  if (unit.pr) return "published";
  if (unit.tasks.some((task) => !task.checked)) return handTicked(unit, recorded).length > 0 ? "hand-ticked" : "open";
  if (unit.legacy) return "accepted";
  const agentTasks = unit.tasks.filter((task) => !task.human);
  return agentTasks.length > 0 && agentTasks.every((task) => recorded.has(task.title)) ? "unpublished" : "legacy";
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
  if (state === "open") {
    const task = firstUncheckedTask(unit);
    if (task.human) return { next: null, stop: { reason: "human", unit: unit.unit, title: task.title, body: task.body } };
    return { next: taskInUnit(unit, task), stop: null };
  }
  const stop = { reason: state, unit: unit.unit };
  if (state === "hand-ticked") Object.assign(stop, handTickedStop(unit, recordedTitles(unit, context.plan, context.openUnit)));
  return { next: null, stop };
}
