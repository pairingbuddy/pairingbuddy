// Scenario pane-height: the pane's body shows only so many rows (the room the platform gives it), and the platform draws no
// "more" hint. The pane folds its longest detail rows, in a fixed order, so the PLAN block still shows, and says how many
// rows are below when even that does not fit.
import { test } from "node:test";
import assert from "node:assert/strict";

import { hiddenRows, moreRowsLine, PLAN_FLOOR, PLAN_TARGET, paneBudget } from "../../shared-node/pane-height.mjs";
import { PLAN_ROWS } from "../../shared-node/plan-window.mjs";

// STEPS, TESTS and REVIEW, in the order they fold: each row's lines in full and folded.
const sections = (...heights) => heights.map(([full, folded]) => ({ full, folded }));

test("with the room not known the pane keeps today's layout: nothing folds and the plan has its most rows", () => {
  const budget = paneBudget({ room: undefined, fixed: 8, sections: sections([5, 1], [5, 1], [5, 1]), plan: 30 });

  assert.deepEqual(budget, { fold: [false, false, false], planRoom: PLAN_ROWS });
});

test("a room short of the plan's floor folds STEPS first, and only STEPS when that gives the plan its floor", () => {
  // A plan block of 7 rows, its floor and its target alike: 8 + 5 + 5 + 5 + 7 rows do not fit 29; with STEPS on one line they do.
  const budget = paneBudget({ room: 29, fixed: 8, sections: sections([5, 1], [5, 1], [5, 1]), plan: 7 });

  assert.deepEqual(budget.fold, [true, false, false]);
});

test("the plan gets the rows the others leave, up to its most", () => {
  const short = paneBudget({ room: 29, fixed: 8, sections: sections([5, 1], [5, 1], [5, 1]), plan: 30 });
  const tall = paneBudget({ room: 200, fixed: 8, sections: sections([5, 1], [5, 1], [5, 1]), plan: 30 });

  assert.equal(short.planRoom, 14, "29 rows less 8 fixed, STEPS and TESTS on one line each, and 5 for REVIEW");
  assert.equal(tall.planRoom, PLAN_ROWS, "a tall room gives the plan no more than its most");
});

test("a shorter room folds TESTS next, then REVIEW, and with all three folded the plan still keeps its floor", () => {
  const two = paneBudget({ room: 25, fixed: 8, sections: sections([5, 1], [5, 2], [5, 1]), plan: 7 });
  const tiny = paneBudget({ room: 12, fixed: 8, sections: sections([5, 1], [5, 2], [5, 1]), plan: 30 });

  assert.deepEqual(two.fold, [true, true, false], "8 + 1 + 2 + 5 + 7 fits 25");
  assert.deepEqual(tiny.fold, [true, true, true]);
  assert.equal(tiny.planRoom, PLAN_FLOOR, "the plan keeps its floor though the pane then runs past the room");
});

test("a plan shorter than the floor needs only its own rows, and with no plan nothing folds that fits", () => {
  const small = paneBudget({ room: 26, fixed: 8, sections: sections([5, 1], [5, 1], [5, 1]), plan: 3 });
  const none = paneBudget({ room: 23, fixed: 8, sections: sections([5, 1], [5, 1], [5, 1]), plan: 0 });

  assert.deepEqual(small.fold, [false, false, false]);
  assert.deepEqual(none.fold, [false, false, false]);
});

test("rows past the room are counted on the last row it shows, which the count itself takes", () => {
  assert.equal(hiddenRows(30, undefined), 0, "the room not known hides nothing");
  assert.equal(hiddenRows(30, 30), 0, "a pane that fits hides nothing");
  assert.equal(hiddenRows(31, 30), 2, "29 rows show, then the count row; the 30th and 31st are below");
});

test("the count row says how to reach the rows below: give the pane the keys, then the arrows; once it has them, the arrows", () => {
  assert.equal(moreRowsLine(12, false), "↓ 12 more rows · ctrl+x tab, then arrows");
  assert.equal(moreRowsLine(1, false), "↓ 1 more row · ctrl+x tab, then arrows");
  assert.equal(moreRowsLine(12, true), "↓ 12 more rows · arrows scroll");
});

test("past the floor the details go on folding while the plan would get fewer than PLAN_TARGET rows", () => {
  // 8 + 1 + 5 + 5 leaves the plan 10 of 29 rows: its floor, not its target; with TESTS folded too it gets 14.
  const budget = paneBudget({ room: 29, fixed: 8, sections: sections([5, 1], [5, 1], [5, 1]), plan: 30 });

  assert.equal(PLAN_TARGET, 12);
  assert.deepEqual(budget, { fold: [true, true, false], planRoom: 14 });
});

test("a row that may fold only for the floor (TESTS while the build runs) stays whole for the target, folds for the floor", () => {
  const building = [{ full: 5, folded: 1 }, { full: 5, folded: 2, forTarget: false }, { full: 5, folded: 1 }];

  const target = paneBudget({ room: 29, fixed: 8, sections: building, plan: 30 });
  const floor = paneBudget({ room: 21, fixed: 8, sections: building, plan: 30 });

  assert.deepEqual(target.fold, [true, false, true], "TESTS is passed over; REVIEW folds instead");
  assert.deepEqual(floor.fold, [true, true, true], "short of the floor TESTS folds too");
});
