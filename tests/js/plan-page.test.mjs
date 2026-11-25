// Scenario plan-page: the pane's PLAN block shows a window of the plan; /pb-plan writes the whole tree as a page, with the
// same states the pane gives each tracer, unit and task, and opens it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePlan } from "../../shared-node/plan.mjs";
import { renderPlanPage } from "../../shared-node/plan-page.mjs";

// A plan of `tracers` tracers, each with two PR units of five tasks; the first `ticked` tasks are ticked.
function bigPlan(tracers, ticked) {
  const lines = ["# Big", "", "## Tasks", ""];
  let task = 0;
  for (let t = 1; t <= tracers; t++) {
    lines.push(`### T${t}: Tracer ${t}`, "");
    for (const part of ["a", "b"]) {
      lines.push(`#### PR: T${t}${part} Unit`, "");
      for (let i = 0; i < 5; i++) {
        task += 1;
        lines.push(`- [${task <= ticked ? "x" : " "}] Task ${task}: Do step ${task}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

// The page's text, tags dropped, one line per tree row.
const textOf = (html) => html.replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

test("the page holds every tracer, unit and task of a 150-task plan, in plan order, with its tick", () => {
  const plan = parsePlan(bigPlan(15, 100));

  const text = textOf(renderPlanPage({ plan, path: "docs/plans/big.md" }));

  for (let task = 1; task <= 150; task++) assert.ok(text.includes(`${task <= 100 ? "✓" : "○"} Task ${task}: Do step ${task}`), `task ${task} is on the page`);
  assert.ok(text.indexOf("T1: Tracer 1") < text.indexOf("T1a Unit") && text.indexOf("T1b Unit") < text.indexOf("T2: Tracer 2"), "tracers lead their units, in plan order");
  assert.ok(!text.includes("…"), "nothing is cut");
});

const STATES_PLAN = [
  "# Shop", "", "## Tasks", "",
  "### T1: Cart", "", "#### PR: Add", "", "PR: https://github.com/o/r/pull/7", "", "- [x] Task 1: Add an item", "",
  "#### PR: Pay", "", "Depends on: Add", "", "- [x] Task 2: Take payment", "- [ ] Task 3: Refund", "- [ ] Task 4: [HUMAN] Check it", "",
  "#### PR: Receipt", "", "- [ ] Task 5: [HUMAN] Approve the receipt", "",
].join("\n");
const OPEN_PAY = { unit: "Pay", branch: "feat/pay", base: "feat/add", commits: ["1".repeat(40), "2".repeat(40), "3".repeat(40), "4".repeat(40), "5".repeat(40), "6".repeat(40)] };

test("the page tells each unit and task as the pane does: states, PR links, the open unit's facts in full, ▸ and waiting", () => {
  const plan = parsePlan(STATES_PLAN);
  const html = renderPlanPage({ plan, states: ["published", "open", "open"], open: OPEN_PAY, building: "Task 3: Refund" });
  const text = textOf(html);

  assert.ok(text.includes("Add · published") && html.includes('<a href="https://github.com/o/r/pull/7">'), "a published unit with its PR link");
  assert.ok(text.includes("Pay · open"), "the open unit");
  assert.ok(text.includes("Receipt · to do"), "a unit pb has not opened has its work to do");
  for (const fact of ["based on Add", "branch feat/pay", "base feat/add", "commit 1111111", "commit 6666666"]) assert.ok(text.includes(fact), `the open unit's ${fact}`);
  assert.match(html, /<li class="building" id="now">▸ Task 3: Refund<\/li>/, "the task being built, which the page opens at");
  assert.match(html, /<li class="waiting">○ Task 4: \[HUMAN\] Check it · needs a person<\/li>/, "a [HUMAN] task the plan has not reached is lit and needs a person");
  assert.match(html, /<li class="waiting">○ Task 5: \[HUMAN\] Approve the receipt · needs a person<\/li>/, "every unticked [HUMAN] task reads alike, not just its unit's next");
  assert.ok(!text.includes("waiting on a person"), "no [HUMAN] task waits while the plan is on an agent task");
});

test("the [HUMAN] task the plan is stopped on waits on a person; the ones after it still need a person", () => {
  const plan = parsePlan(STATES_PLAN.replace("- [ ] Task 3", "- [x] Task 3"));

  const html = renderPlanPage({ plan, states: ["published", "open", "open"], open: OPEN_PAY });

  assert.match(html, /<li class="waiting" id="now">○ Task 4: \[HUMAN\] Check it · waiting on a person<\/li>/, "the plan's first unticked task is a [HUMAN] one");
  assert.match(html, /<li class="waiting">○ Task 5: \[HUMAN\] Approve the receipt · needs a person<\/li>/, "a later [HUMAN] task is not waited on yet");
});

test("while the publish run writes the open unit's pull request, the page says so, as the pane does", () => {
  const plan = parsePlan(STATES_PLAN.replace("- [ ] Task 3", "- [x] Task 3").replace("- [ ] Task 4", "- [x] Task 4"));

  const text = textOf(renderPlanPage({ plan, states: ["published", "unpublished", "open"], open: OPEN_PAY, publishing: true }));

  assert.ok(text.includes("Pay · writing the pull request"));
});
