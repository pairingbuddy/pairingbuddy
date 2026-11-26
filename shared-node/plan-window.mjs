// The window the pane's PLAN block shows of a plan's tree: pure, no I/O, no node: imports.
import { plural } from "./glance.mjs";

// The PLAN block's most rows, whatever the plan's size: the focus's unit with all its facts and several rows of context
// either side fit, and the pane stays short enough to read beside its other rows. A plan of up to this many rows reads whole.
export const PLAN_ROWS = 24;

// The most rows the plan's problems take of PLAN_ROWS: past it, the first ones and a count of the rest.
export const PLAN_PROBLEM_ROWS = 3;

// The problem rows the PLAN block shows: every one while they fit PLAN_PROBLEM_ROWS, else the first ones and how many more.
export function problemRows(problems) {
  if (problems.length <= PLAN_PROBLEM_ROWS) return problems;
  const first = problems.slice(0, PLAN_PROBLEM_ROWS - 1);
  return [...first, `… ${problems.length - first.length} more plan problems`];
}

// A tree's words, shared by the pane's PLAN block and the page /pb-plan writes, so both tell each state alike.
export const TASK_MARKS = { ticked: "✓", unticked: "○", inProgress: "▸" };
export const STATE_SEPARATOR = " · ";
export const WAITING_ON_PERSON = "waiting on a person";
export const NEEDS_PERSON = "needs a person";

// The plan's first unticked task: the one the plan has reached, which a run halts at when it is a [HUMAN] task; null once every box is ticked.
export const firstUnticked = (units) => units.flatMap(({ tasks }) => tasks).find((task) => !task.checked) ?? null;

// A [HUMAN] task's words: waiting on a person for the one the plan is stopped on (reached: firstUnticked), needs a person for
// every other unticked one, so each reads as a person's work however far off; none for a ticked or agent task.
export function humanWords(task, reached) {
  if (!task.human || task.checked) return "";
  return task === reached ? WAITING_ON_PERSON : NEEDS_PERSON;
}

// A unit's state in plain words: unitStates' "open" (it has boxes left) reads open only for the unit pb has open; any
// other unit with boxes left has its work to do.
// "unpublished" (every box ticked, no PR yet) says what happens: the open unit's pull request is being written while a
// publish run is live, else it is not opened yet.
export function unitWords(state, isOpen, publishing) {
  if (state === "open" && !isOpen) return "to do";
  if (state === "unpublished") return isOpen && publishing ? "writing the pull request" : "pull request not opened yet";
  return state;
}

// Whether a unit holds the task the live run builds: such a unit reads as the open unit does, record or not.
export const holdsBuilding = (unit, building) => Boolean(building) && unit.tasks.some((task) => !task.checked && task.title === building);

// A task's mark: ▸ for the one being built, as STEPS marks its running step.
export const taskMark = (task, inProgress) => (task.checked ? TASK_MARKS.ticked : inProgress ? TASK_MARKS.inProgress : TASK_MARKS.unticked);

// The open unit's most commit rows: a unit of many commits shows its latest, the earlier ones counted on one row.
export const OPEN_COMMIT_ROWS = 4;

// How the window shares its room around the focus: two rows below for each above, as what is to do matters more than what
// is done.
const BELOW_PER_ABOVE = 2;

// The shown rows in tree order, with at most one ellipsis row at each end of the block and one inside the focus's unit,
// each counting the tasks it hides, how many are ticked, and the first and last rows it stands for.
// Above the focus every hidden row of another unit is told by one row that opens the block ("above"), so the rows go to
// what is shown. The focus unit's own hidden tasks keep one row where they are cut, between its facts and its shown tasks:
// without it the unit's first shown task would read as its first. It opens the block itself ("above") when nothing shows
// before it. Every hidden row after the focus is one row that ends the block ("below").
function entriesOf(rows, shown, focus) {
  const group = rows[focus].group;
  const newGap = (row) => ({ tasks: 0, done: 0, first: row, last: row });
  const count = (gap, row) => {
    gap.last = row;
    if (rows[row].task) {
      gap.tasks += 1;
      if (rows[row].task.checked) gap.done += 1;
    }
  };
  let above = null;
  let inUnit = null;
  let below = null;
  const entries = [];
  for (const row of rows.keys()) {
    if (shown.has(row)) {
      entries.push({ row });
      continue;
    }
    if (row > focus) count((below ??= newGap(row)), row);
    else if (rows[row].task && rows[row].group === group) {
      if (!inUnit) entries.push({ gap: (inUnit = newGap(row)) });
      count(inUnit, row);
    } else count((above ??= newGap(row)), row);
  }
  if (above) entries.unshift({ gap: { ...above, edge: "above" } });
  else if (inUnit && "gap" in entries[0]) inUnit.edge = "above";
  if (below) entries.push({ gap: { ...below, edge: "below" } });
  return entries;
}

// The next task row from `from` in the direction `step` (1 down, -1 up), or -1 when there is none: the window grows by
// tasks, each with the rows it needs, so no tracer or unit row shows with none of its tasks under it.
function nextTask(rows, from, step) {
  for (let row = from + step; row >= 0 && row < rows.length; row += step) if (rows[row].task) return row;
  return -1;
}

// Which rows of the tree to show in `room` rows around the focus row: all of them when they fit; else a window grown from the
// focus (each row with the rows it needs; a task row's group, its unit, comes whole when the window grows up into it), an ellipsis row standing for each run of rows left out, the whole never more than `room`.
export function windowRows(rows, { focus, room }) {
  if (rows.length <= room) return rows.map((_, row) => ({ row }));
  const shown = new Set();
  // A row comes with the rows it needs (a task its unit's and tracer's rows), so it never shows out of its context.
  const withNeeds = (row) => [row, ...rows[row].needs].filter((needed) => !shown.has(needed));
  for (const row of withNeeds(focus)) shown.add(row);
  const edges = { above: focus, below: focus };
  const grown = { above: 0, below: 0 };
  const open = new Set(["above", "below"]);
  while (open.size > 0) {
    // The side behind its share grows next; a side that can grow no more leaves the room to the other.
    const behind = grown.above * BELOW_PER_ABOVE < grown.below ? "above" : "below";
    const side = open.has(behind) ? behind : [...open][0];
    const next = nextTask(rows, edges[side], side === "above" ? -1 : 1);
    if (next === -1) {
      open.delete(side);
      continue;
    }
    // Up into another group (a unit), the group comes whole or not at all, so the window's top is never a cut unit.
    const entering = side === "above" && rows[next].group !== rows[edges.above].group;
    const taken = entering ? rows.flatMap((row, index) => (row.task && row.group === rows[next].group ? [index] : [])) : [next];
    const added = [...new Set(taken.flatMap(withNeeds))];
    for (const row of added) shown.add(row);
    if (entriesOf(rows, shown, focus).length > room) {
      for (const row of added) shown.delete(row);
      open.delete(side);
      continue;
    }
    edges[side] = Math.min(next, ...taken);
    grown[side] += added.length;
  }
  return entriesOf(rows, shown, focus);
}

// An ellipsis row's words: the tasks it hides, done or to do (or how many of them are done), and where it cuts.
export function gapWords({ tasks, done, edge }) {
  const where = edge ? ` ${edge}` : "";
  const count = plural(tasks, "task");
  if (done === tasks) return `… ${count} done${where}`;
  if (done === 0) return `… ${count} to do${where}`;
  return `… ${count}${where}, ${done} done`;
}

// Where the window is: the open unit whose pull request is being written or not opened yet (publishing, its index), at its
// last task; else the unticked task the live run builds (building, its title), else the plan's next unticked task (a
// [HUMAN] one waits on a person), else, all ticked, the plan's last task. As { unit, task } indices; null with no task.
export function planFocus(units, building, publishing) {
  const published = publishing === undefined ? undefined : units[publishing];
  if (published?.tasks.length) return { unit: publishing, task: published.tasks.length - 1 };
  const at = (match) => {
    for (const [u, { tasks }] of units.entries()) {
      const t = tasks.findIndex(match);
      if (t !== -1) return { unit: u, task: t };
    }
    return null;
  };
  const built = building === undefined ? null : at((task) => !task.checked && task.title === building);
  const last = units.findLastIndex(({ tasks }) => tasks.length > 0);
  return built ?? at((task) => !task.checked) ?? (last === -1 ? null : { unit: last, task: units[last].tasks.length - 1 });
}

// The open unit's commit rows in a PLAN block short of its target (a short pane): the earlier ones counted, and the latest.
export const SHORT_COMMIT_ROWS = 2;

// The commit rows the open unit shows, oldest first: every one while they fit `most` (OPEN_COMMIT_ROWS), else a count of the
// earlier ones and the latest that fit beside it.
export function commitRows(commits, most = OPEN_COMMIT_ROWS) {
  if (commits.length <= most) return commits.map((sha) => ({ sha }));
  const latest = commits.slice(commits.length - (most - 1));
  return [{ earlier: commits.length - latest.length }, ...latest.map((sha) => ({ sha }))];
}
