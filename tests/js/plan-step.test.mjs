// Scenario: plan-step-rule. The pure rule planStep(units, records) in shared-node/plan.mjs decides skip, stop or next
// from the PR line, Legacy: accepted, the checkboxes and the task records. Each of the three stop tests also proves a stop
// blocks skipping ahead, because a later unit with an unchecked task is present and next stays null.
// Never use { skip } here: the JS suite treats skipped tests as failures.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parsePlan, planStep, unitStates } from "../../shared-node/plan.mjs";

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
  test("unchecked-human-task-stops-with-reason-human", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Needs a person",
      "",
      "- [x] **Task 1: Built by agent**",
      "- [ ] **Task 2: [HUMAN] Create the account**",
      "  1. Open the console.",
      "  2. Create the account and tick this box.",
      "",
      "#### PR: Later",
      "",
      "- [ ] **Later agent task**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);
    const openUnit = { unit: "Needs a person", plan: "docs/plans/p.md", tasks: [{ title: "Task 1: Built by agent" }] };

    const result = planStep(units, { plan: "docs/plans/p.md", openUnit });

    assert.deepEqual(result, { next: null, stop: { reason: "human", unit: "Needs a person", title: "Task 2: [HUMAN] Create the account", body: "1. Open the console.\n2. Create the account and tick this box." } }, "the unchecked human task stops the plan with its unit, title and body, and the later unit's agent task is not next");
  });
  test("checked-human-task-needs-no-record", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Mixed",
      "",
      "- [x] **Task 1: Built by agent**",
      "- [x] **Task 2: [HUMAN] Create the account**",
      "  1. Open the console.",
      "- [ ] **Task 3: Wire it up**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);
    const openUnit = { unit: "Mixed", plan: "docs/plans/p.md", tasks: [{ title: "Task 1: Built by agent" }] };

    const result = planStep(units, { plan: "docs/plans/p.md", openUnit });

    assert.deepEqual(result, { next: { unit: "Mixed", tracer: "Tracer 1: Skeleton", title: "Task 3: Wire it up", body: "" }, stop: null }, "a checked human task with no record is not hand-ticked, the unit stays open and the following unchecked task is next");
  });
  test("all-human-fully-checked-unit-reads-legacy", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Only people",
      "",
      "- [x] **Task 1: [HUMAN] Create the account**",
      "- [x] **Task 2: [HUMAN] Add the secret**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);

    const states = unitStates(units, { plan: "docs/plans/p.md", openUnit: null });

    assert.deepEqual(states, ["legacy"], "an all-human checked unit has no records to show so it reads legacy");
  });
  test("fully-checked-unit-needs-records-only-for-agent-tasks", () => {
    const plan = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Recorded and human",
      "",
      "- [x] **Task 1: Built by agent**",
      "- [x] **Task 2: [HUMAN] Create the account**",
      "",
      "#### PR: Unrecorded agent task",
      "",
      "- [x] **Task 1: Agent task with no record**",
      "- [x] **Task 2: [HUMAN] Add the secret**",
      "",
    ].join("\n");
    const { units } = parsePlan(plan);
    const openUnit = { unit: "Recorded and human", plan: "docs/plans/p.md", tasks: [{ title: "Task 1: Built by agent" }] };

    const states = unitStates(units, { plan: "docs/plans/p.md", openUnit });

    assert.equal(states[0], "unpublished", "a recorded agent task plus a checked human task is unpublished since human tasks need no record");
    assert.equal(states[1], "legacy", "a checked human task never makes a unit unpublished on its own, so an agent task with no record reads legacy");
  });
  test("hand-ticked-stop-flags-only-human-remaining", () => {
    const humanOnly = [
      "## Tasks",
      "",
      "### Tracer 1: Skeleton",
      "",
      "#### PR: Half",
      "",
      "- [x] **Task 1: Built by agent**",
      "- [x] **Task 2: Ticked by hand**",
      "- [ ] **Task 3: [HUMAN] Create the account**",
      "  1. Open the console.",
      "",
    ].join("\n");
    const withAgent = humanOnly + "- [ ] **Task 4: Wire it up**\n";
    const openUnit = { unit: "Half", plan: "docs/plans/p.md", tasks: [{ title: "Task 1: Built by agent" }] };

    const onlyHuman = planStep(parsePlan(humanOnly).units, { plan: "docs/plans/p.md", openUnit });
    const agentLeft = planStep(parsePlan(withAgent).units, { plan: "docs/plans/p.md", openUnit });

    assert.deepEqual(onlyHuman.stop, { reason: "hand-ticked", unit: "Half", tasks: ["Task 2: Ticked by hand"], humanLeft: ["Task 3: [HUMAN] Create the account"] }, "when every unticked task is human the hand-ticked stop lists their titles in humanLeft");
    assert.deepEqual(agentLeft.stop, { reason: "hand-ticked", unit: "Half", tasks: ["Task 2: Ticked by hand"] }, "an unticked agent task means the stop has no humanLeft field");
  });
});
