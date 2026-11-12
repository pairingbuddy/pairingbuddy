// Scenario: plan-step-rule. The pure rule planStep(units, records) in shared-node/plan.mjs decides skip, stop or next
// from the PR line, Legacy: accepted, the checkboxes and the task records. Each of the three stop tests also proves a stop
// blocks skipping ahead, because a later unit with an unchecked task is present and next stays null.
// Never use { skip } here: the JS suite treats skipped tests as failures.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parsePlan, planStep } from "../../shared-node/plan.mjs";

describe("plan-step-rule", () => {
  test("pr-line-unit-skipped-regardless-of-boxes", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Published",
      "",
      "PR: https://example.test/pull/1 branch: a",
      "",
      "- [ ] **Left unchecked**",
      "",
      "#### PR: Open",
      "",
      "- [ ] **Next task**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);

    const result = planStep(units, { plan: "docs/plans/p.md", openUnit: null });

    assert.deepEqual(result, { next: { unit: "Open", tracer: "Tracer 1: Skeleton", title: "Next task", body: "" }, stop: null }, "the published unit is skipped and the next unit's first unchecked task is next");
  });
  test("legacy-accepted-unit-skipped", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Old",
      "",
      "Legacy: accepted",
      "",
      "- [x] **Finished task**",
      "",
      "#### PR: Next",
      "",
      "- [ ] **Next task**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);

    const result = planStep(units, { plan: "docs/plans/p.md", openUnit: null });

    assert.deepEqual(result, { next: { unit: "Next", tracer: "Tracer 1: Skeleton", title: "Next task", body: "" }, stop: null }, "a fully checked unit with Legacy: accepted is skipped and the next unit's first unchecked task is next");
  });
  test("fully-checked-with-all-records-stops-unpublished", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Built",
      "",
      "- [x] **First task**",
      "- [x] **Second task**",
      "",
      "#### PR: Later",
      "",
      "- [ ] **Later task**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);
    const openUnit = { unit: "Built", plan: "docs/plans/p.md", tasks: [{ title: "First task" }, { title: "Second task" }] };

    const result = planStep(units, { plan: "docs/plans/p.md", openUnit });

    assert.deepEqual(result, { next: null, stop: { reason: "unpublished", unit: "Built" } }, "a fully checked unit whose tasks all have records but no PR line stops as unpublished and nothing after it is next");
  });
  test("fully-checked-without-records-stops-legacy", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Done",
      "",
      "- [x] **Finished task**",
      "",
      "#### PR: Later",
      "",
      "- [ ] **Later task**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);

    const result = planStep(units, { plan: "docs/plans/p.md", openUnit: null });

    assert.deepEqual(result, { next: null, stop: { reason: "legacy", unit: "Done" } }, "a fully checked unit with no PR line and no Legacy line stops as legacy and nothing after it is next");

    const twoTasks = parsePlan(["## Tasks", "", "### Tracer 1: Skeleton", "", "#### PR: Pair", "", "- [x] **One**", "- [x] **Two**", ""].join("\n"));
    const partial = planStep(twoTasks.units, { plan: "docs/plans/p.md", openUnit: { unit: "Pair", plan: "docs/plans/p.md", tasks: [{ title: "One" }] } });

    assert.deepEqual(partial.stop, { reason: "legacy", unit: "Pair" }, "a record for only one of two checked tasks still stops as legacy, every task needs a record");
  });
  test("partly-done-hand-ticked-task-stops", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Half",
      "",
      "- [x] **One**",
      "- [x] **Two**",
      "- [ ] **Three**",
      "",
      "#### PR: Later",
      "",
      "- [ ] **Later task**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);
    const openUnit = { unit: "Half", plan: "docs/plans/p.md", tasks: [{ title: "One" }] };

    const result = planStep(units, { plan: "docs/plans/p.md", openUnit });

    assert.deepEqual(result, { next: null, stop: { reason: "hand-ticked", unit: "Half", tasks: ["Two"] } }, "a checked task with no record in a partly done unit stops as hand-ticked, names the task and nothing after it is next");
  });
  test("partly-done-with-records-next-is-first-unchecked", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Half",
      "",
      "- [x] **One**",
      "- [ ] **Two**",
      "- [ ] **Three**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);
    const openUnit = { unit: "Half", plan: "docs/plans/p.md", tasks: [{ title: "One" }] };

    const result = planStep(units, { plan: "docs/plans/p.md", openUnit });

    assert.deepEqual(result, { next: { unit: "Half", tracer: "Tracer 1: Skeleton", title: "Two", body: "" }, stop: null }, "a recorded checked task is fine and the first unchecked task is next");
  });
  test("records-only-count-for-matching-unit-and-plan", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Built",
      "",
      "- [x] **First task**",
      "- [x] **Second task**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);
    const tasks = [{ title: "First task" }, { title: "Second task" }];

    const otherUnit = planStep(units, { plan: "docs/plans/p.md", openUnit: { unit: "Other", plan: "docs/plans/p.md", tasks } });
    const otherPlan = planStep(units, { plan: "docs/plans/p.md", openUnit: { unit: "Built", plan: "docs/plans/other.md", tasks } });
    const samePlanOtherSpelling = planStep(units, { plan: "docs/plans/p.md", openUnit: { unit: "Built", plan: "./docs/plans/p.md", tasks } });

    const nullPlan = planStep(units, { plan: "docs/plans/p.md", openUnit: { unit: "Built", plan: null, tasks } });

    assert.deepEqual(nullPlan.stop, { reason: "legacy", unit: "Built" }, "a record with no plan set (as newUnit writes it) does not count and does not throw");
    assert.deepEqual(otherUnit.stop, { reason: "legacy", unit: "Built" }, "records of a different unit do not count");
    assert.deepEqual(otherPlan.stop, { reason: "legacy", unit: "Built" }, "records of a different plan do not count");
    assert.deepEqual(samePlanOtherSpelling.stop, { reason: "unpublished", unit: "Built" }, "the same plan path written differently still matches, paths compare normalised");
  });
});
