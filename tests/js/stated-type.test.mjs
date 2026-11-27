import { test } from "node:test";
import assert from "node:assert/strict";

import { statedType } from "../../shared-node/stated-type.mjs";

const TYPES = ["new_feature", "bug_fix", "refactoring", "config_change", "spike"];

test("stated-type-reads-a-plan-task-type-line", () => {
  const task = "Task 7: Cache the build output\n\nOnly files under `.ci/` change.\n  Type: config_change. Only CI files change.\n";

  assert.equal(statedType(task, TYPES), "config_change", "the plan task's Type: line names the type");
});

test("stated-type-ignores-a-type-that-is-not-a-task-type", () => {
  assert.equal(statedType("Task 3: Tidy\n\nType: chore.\n", TYPES), null, "a stated word that is no task type is no stated type");
});

test("stated-type-is-null-without-a-type-line", () => {
  assert.equal(statedType("Task 3: Add a cache\n\nThe type of cache is up to you.\n", TYPES), null, "a task with no Type: line states no type");
});
