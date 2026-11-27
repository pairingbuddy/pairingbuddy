// Scenario tracer-context: the band and the pane say which tracer bullet the task being built belongs to, before the task.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePlan } from "../../shared-node/plan.mjs";
import { tracerGoal, tracerOf } from "../../shared-node/tracer-context.mjs";

const PLAN = parsePlan(`# Plan

## Tasks

### TB2: Cache the build output (candidate)

- [x] Task 3: Restore the cache
- [ ] Task 4: Save the cache on main

### TB1: Measure the baseline

- [ ] Task 1: Read the run history
`);

test("the-tracer-of-a-task-is-the-tracer-heading-its-unit-sits-under", () => {
  assert.equal(tracerOf(PLAN, "Task 4: Save the cache on main"), "TB2: Cache the build output (candidate)");
  assert.equal(tracerOf(PLAN, "Task 1: Read the run history"), "TB1: Measure the baseline");
});

const TRACER = "TB12: CI stack 4: docker build cost on PRs (candidate)";
const TASK = "Task 32: Fetch dependencies from the lockfile alone";

test("the-goal-line-names-the-tracer-before-the-task-when-it-fits", () => {
  assert.equal(tracerGoal(TRACER, TASK, 200), `TB12 · CI stack 4: docker build cost on PRs (candidate) › ${TASK}`);
});

test("short-of-room-the-tracer-name-is-cut-first-and-its-id-stays", () => {
  const cut = tracerGoal(TRACER, TASK, 80);
  assert.ok([...cut].length <= 80, cut);
  assert.ok(cut.startsWith("TB12 · CI stack 4"), cut);
  assert.ok(cut.endsWith(` › ${TASK}`), cut);
  assert.ok(cut.includes("… › "), cut);
  assert.equal(tracerGoal(TRACER, TASK, 60), `TB12 › ${TASK}`);
});

test("with-no-tracer-the-goal-line-is-the-task-alone", () => {
  assert.equal(tracerGoal(null, TASK, 80), TASK);
});

test("a-tracer-heading-with-no-id-is-cut-as-a-whole-before-the-task", () => {
  assert.equal(tracerGoal("Baseline", TASK, 200), `Baseline › ${TASK}`);
});
