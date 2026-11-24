// Scenario plan-window: the pane's PLAN block has a fixed most rows, whatever the plan's size. It shows a window around the
// focus (the task being built, else the next unticked one, else the plan's end), keeps the focus's tracer and unit rows,
// and marks each cut with an ellipsis row that counts what it hides. The whole plan is in the page /pb-plan opens.
import { test } from "node:test";
import assert from "node:assert/strict";

import { commitRows, gapWords, planFocus, SHORT_COMMIT_ROWS, windowRows } from "../../shared-node/plan-window.mjs";

// A flat list of tree rows, each a task (ticked or not) with nothing it needs shown beside it.
const tasks = (checks) => checks.map((checked) => ({ needs: [], task: { checked } }));

test("a tree that fits the room is shown whole, with no cut", () => {
  const rows = tasks([true, false, false]);

  assert.deepEqual(windowRows(rows, { focus: 1, room: 3 }), [{ row: 0 }, { row: 1 }, { row: 2 }]);
});

// The rows shown, as their indices, and each cut as `…` with the tasks it hides and how many of them are ticked.
const shape = (entries) => entries.map((entry) => ("row" in entry ? entry.row : `…${entry.gap.tasks}/${entry.gap.done}`));

test("a tree too long for the room shows a window around the focus, an ellipsis row at each cut end, in the room", () => {
  const rows = tasks([...Array(60).fill(true), ...Array(40).fill(false)]);

  const shown = windowRows(rows, { focus: 60, room: 10 });

  assert.equal(shown.length, 10, "the window and its ellipsis rows fill the room, no more");
  assert.deepEqual(shape(shown), ["…58/58", 58, 59, 60, 61, 62, 63, 64, 65, "…34/0"], "a few done tasks above the focus, more to do below it");
});

test("a row is shown with the rows it needs, so the focus keeps its tracer and unit rows however far above they are", () => {
  // A tracer row, its unit's row and 50 tasks under them; each task needs both.
  const rows = [{ needs: [] }, { needs: [0] }, ...tasks([...Array(30).fill(true), ...Array(20).fill(false)]).map((row) => ({ ...row, needs: [0, 1] }))];

  const shown = windowRows(rows, { focus: 32, room: 10 });

  assert.equal(shown.length, 10);
  assert.deepEqual(shape(shown), [0, 1, "…28/28", 30, 31, 32, 33, 34, 35, "…16/0"], "the unit's tasks are windowed under its rows, each cut marked");
});

test("a cut at the top of the tree is above, one at its bottom below, and one between shown rows neither", () => {
  const rows = [{ needs: [] }, { needs: [0] }, ...tasks([...Array(30).fill(true), ...Array(20).fill(false)]).map((row) => ({ ...row, needs: [0, 1] }))];
  const edgesOf = (entries) => entries.filter((entry) => "gap" in entry).map(({ gap }) => gap.edge);

  assert.deepEqual(edgesOf(windowRows(rows, { focus: 32, room: 10 })), [undefined, "below"], "the cut under the unit's rows is between shown rows");
  assert.deepEqual(edgesOf(windowRows(tasks([...Array(60).fill(true), ...Array(40).fill(false)]), { focus: 60, room: 10 })), ["above", "below"]);
});

test("an ellipsis row counts the tasks it hides in plain words: how many, whether done or to do, and where", () => {
  assert.equal(gapWords({ tasks: 58, done: 58, edge: "above" }), "… 58 tasks done above");
  assert.equal(gapWords({ tasks: 34, done: 0, edge: "below" }), "… 34 tasks to do below");
  assert.equal(gapWords({ tasks: 28, done: 28 }), "… 28 tasks done", "a cut between shown rows says no place");
  assert.equal(gapWords({ tasks: 34, done: 3, edge: "below" }), "… 34 tasks below, 3 done", "some done, some to do");
  assert.equal(gapWords({ tasks: 1, done: 1, edge: "above" }), "… 1 task done above");
});

// Plan units as parsePlan gives them, by their tasks' titles and ticks.
const unit = (name, ...titled) => ({ unit: name, tasks: titled.map(([title, checked]) => ({ title, checked, human: title.includes("[HUMAN]") })) });
const UNITS = [unit("A", ["Task 1", true], ["Task 2", true]), unit("B", ["Task 3: [HUMAN] Check it", false], ["Task 4", false]), unit("C", ["Task 5", false])];

test("the focus is the task being built, else the next unticked one, a [HUMAN] one too, else the plan's last task", () => {
  assert.deepEqual(planFocus(UNITS, "Task 4"), { unit: 1, task: 1 }, "the task the live run builds");
  assert.deepEqual(planFocus(UNITS, undefined), { unit: 1, task: 0 }, "no task is being built: the next unticked one, waiting on a person");
  assert.deepEqual(planFocus(UNITS, "Task 1"), { unit: 1, task: 0 }, "a ticked task is built no more");
  const allTicked = UNITS.map((planned) => ({ ...planned, tasks: planned.tasks.map((task) => ({ ...task, checked: true })) }));
  assert.deepEqual(planFocus(allTicked, undefined), { unit: 2, task: 0 }, "all ticked: the end of the plan");
  assert.equal(planFocus([], undefined), null, "a plan with no units has no focus");
});

test("the window grows by tasks, so a tracer or unit row is never shown with none of its tasks under it", () => {
  // Units of two tasks each, every unit under its own tracer: tracer, unit, task, task.
  const rows = [];
  for (let u = 0; u < 10; u++) {
    const tracer = rows.push({ needs: [] }) - 1;
    const unitRow = rows.push({ needs: [tracer] }) - 1;
    for (let t = 0; t < 2; t++) rows.push({ needs: [tracer, unitRow], task: { checked: u < 5 } });
  }

  const shown = windowRows(rows, { focus: 22, room: 11 });
  const last = shown.at(-2);

  assert.ok(shown.length <= 11);
  assert.ok(rows[last.row].task, `the last shown row before the cut below is a task, got ${JSON.stringify(shape(shown))}`);
});

test("an ellipsis row names the first and last rows it stands for, so the pane can indent it to what it hides", () => {
  const gaps = windowRows(tasks([...Array(60).fill(true), ...Array(40).fill(false)]), { focus: 60, room: 10 }).filter((entry) => "gap" in entry);

  assert.deepEqual(gaps.map(({ gap }) => [gap.first, gap.last]), [[0, 57], [66, 99]]);
});

test("growing up into another unit takes the unit whole or not at all, so the top of the window is never a cut unit", () => {
  // Units of four tasks each, every unit under its own tracer: tracer, unit, four tasks. The focus is the last unit's first task.
  const rows = [];
  for (let u = 0; u < 6; u++) {
    const tracer = rows.push({ needs: [] }) - 1;
    const unitRow = rows.push({ needs: [tracer] }) - 1;
    for (let t = 0; t < 4; t++) rows.push({ needs: [tracer, unitRow], task: { checked: u < 5 }, group: u });
  }

  // Room for the last unit, the whole unit above it, and one task of the unit above that with its rows, not the whole of it.
  const shown = shape(windowRows(rows, { focus: 32, room: 17 }));

  assert.deepEqual(shown, ["…16/16", 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35], "the unit above is whole; the one above that does not fit, so none of it shows");
});

test("above the focus the cut rows collapse into one at the top; the focus unit's own cut tasks keep one row of their own", () => {
  // Tracer A with two units of two tasks, then tracer B with a unit of four tasks and the focus unit of twenty.
  const rows = [];
  const unitOf = (tracer, group, checks) => {
    const unitRow = rows.push({ needs: [tracer] }) - 1;
    for (const checked of checks) rows.push({ needs: [tracer, unitRow], task: { checked }, group });
  };
  const a = rows.push({ needs: [] }) - 1;
  unitOf(a, 0, [true, true]);
  unitOf(a, 1, [true, true]);
  const b = rows.push({ needs: [] }) - 1;
  unitOf(b, 2, [true, true, true, true]);
  unitOf(b, 3, [...Array(12).fill(true), ...Array(8).fill(false)]);
  const focus = rows.findIndex((row) => row.group === 3 && !row.task.checked);

  const shown = windowRows(rows, { focus, room: 12 });
  const gaps = shown.filter((entry) => "gap" in entry).map(({ gap }) => [gap.edge, gap.tasks]);

  assert.ok(shown.length <= 12);
  assert.deepEqual(shown[0], { gap: shown[0].gap }, "the block opens with the one cut above");
  assert.deepEqual(gaps.map(([edge]) => edge), ["above", undefined, "below"], "one cut above, one inside the focus unit, one below");
  assert.equal(gaps[0][1], 8, "the cut above counts every hidden task of the other units: tracer A's four and tracer B's first unit's four");
});

test("a unit whose pull request is being written, or waits to be opened, is the focus: its last task", () => {
  const unitA = { ...UNITS[0] };
  assert.deepEqual(planFocus([unitA, UNITS[1], UNITS[2]], undefined, 0), { unit: 0, task: 1 }, "unit A is ticked; its last task, not unit B's next one");
  assert.deepEqual(planFocus(UNITS, "Task 4", undefined), { unit: 1, task: 1 }, "with no such unit, as before");
});

test("in a short PLAN block the open unit's commits take fewer rows: the count of the earlier ones and the latest", () => {
  const commits = ["a", "b", "c", "d", "e", "f"];

  assert.deepEqual(commitRows(commits, SHORT_COMMIT_ROWS), [{ earlier: 5 }, { sha: "f" }]);
  assert.deepEqual(commitRows(["a", "b"], SHORT_COMMIT_ROWS), [{ sha: "a" }, { sha: "b" }], "two fit whole");
  assert.equal(commitRows(commits).length, 4, "by default, OPEN_COMMIT_ROWS");
});
