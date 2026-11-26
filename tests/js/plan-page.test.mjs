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

test("the page tells each unit and task as the pane does: states, PR links, the open unit's facts, ▸ and waiting", () => {
  const plan = parsePlan(STATES_PLAN);
  const html = renderPlanPage({ plan, states: ["published", "open", "open"], open: OPEN_PAY, building: "Task 3: Refund" });
  const text = textOf(html);

  assert.ok(text.includes("Add · published") && html.includes('<a href="https://github.com/o/r/pull/7">'), "a published unit with its PR link");
  assert.ok(text.includes("Pay · open"), "the open unit");
  assert.ok(text.includes("Receipt · to do"), "a unit pb has not opened has its work to do");
  for (const fact of ["based on Add", "branch feat/pay", "base feat/add", "6 commits"]) assert.ok(text.includes(fact), `the open unit's ${fact}`);
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

const DRILL_PLAN = [
  "# Shop", "", "## Tasks", "",
  "### T1: Cart", "", "**Goal:** A shopper fills a cart.", "", "**Verification:** `npm test` passes.", "",
  "#### PR: Add", "",
  "- [x] **Task 1: Add an item**", "",
  "  **Goal:** An item lands in the cart.", "",
  "  **Acceptance criteria:**", "  - The cart shows the item.", "  - The total grows.", "",
  "  **Files likely involved:** `cart.mjs`", "",
  "- [ ] **Task 2: Remove an item**", "",
  "  **Goal:** An item leaves the cart.", "",
  "### T2: Pay", "", "**Goal:** A shopper pays.", "",
  "#### PR: Charge", "",
  "- [ ] **Task 3: Charge the card**", "",
  "  **Goal:** The card is charged.", "",
].join("\n");

test("a task with a body is a row that opens to its explanation: Goal, criteria as a list, files", () => {
  const plan = parsePlan(DRILL_PLAN);

  const html = renderPlanPage({ plan });

  const task1 = html.slice(html.indexOf("Task 1: Add an item") - 200, html.indexOf("Task 2: Remove an item"));
  assert.match(task1, /<details[^>]*>\s*<summary>✓ Task 1: Add an item<\/summary>/, "the task's row is the summary of its own details");
  assert.ok(task1.includes("<strong>Goal:</strong> An item lands in the cart."), "its Goal, with the label in bold");
  assert.match(task1, /<ul>\s*<li>The cart shows the item\.<\/li>\s*<li>The total grows\.<\/li>\s*<\/ul>/, "its criteria as a list");
  assert.ok(task1.includes("<code>cart.mjs</code>"), "inline code");
});

test("a tracer opens to its Goal and Verification, then its units; a unit opens to its tasks", () => {
  const plan = parsePlan(DRILL_PLAN);

  const html = renderPlanPage({ plan });

  const t1 = html.slice(html.indexOf("T1: Cart") - 200, html.indexOf("T2: Pay"));
  assert.match(t1, /<details[^>]*>\s*<summary><h2>T1: Cart[^<]*<\/h2><\/summary>/, "the tracer's title is the summary of its details");
  assert.ok(t1.includes("<strong>Goal:</strong> A shopper fills a cart.") && t1.includes("<strong>Verification:</strong> <code>npm test</code> passes."), "its Goal and Verification");
  assert.match(t1, /<details[^>]*>\s*<summary><h3>Add[^<]*<\/h3><\/summary>/, "each unit is a details of its own, under the tracer");
});

test("the page opens on the path to the task being built; every other tracer, unit and task starts folded", () => {
  const plan = parsePlan(DRILL_PLAN);

  const html = renderPlanPage({ plan, building: "Task 2: Remove an item" });

  const opened = [...html.matchAll(/<details( open)?>\s*<summary>(?:<h[23]>)?([^<]*)/g)].filter(([, open]) => open).map(([, , head]) => head.trim());
  assert.deepEqual(opened, ["T1: Cart · 1 of 2 done", "Add", "▸ Task 2: Remove an item"], "the focus's tracer, unit and task, and only those");
});

test("a folded tracer still tells how far it is: its tasks done out of its tasks", () => {
  const plan = parsePlan(DRILL_PLAN);

  const html = renderPlanPage({ plan });

  assert.match(html, /<summary><h2>T1: Cart · 1 of 2 done<\/h2><\/summary>/);
  assert.match(html, /<summary><h2>T2: Pay · 0 of 1 done<\/h2><\/summary>/);
});

test("plan text never reaches the page as markup: tags in a body, a Goal or code are shown as text", () => {
  const plan = parsePlan(DRILL_PLAN.replace("An item leaves the cart.", '<img src=x onerror=alert(1)> **<b>bold</b>** `<i>`').replace("A shopper pays.", "<script>alert(1)</script>"));

  const html = renderPlanPage({ plan });

  assert.ok(!/<img|<b>|<i>|<script>alert/.test(html), "no tag from the plan");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt; <strong>&lt;b&gt;bold&lt;/b&gt;</strong> <code>&lt;i&gt;</code>"), "shown as text, bold and code still read");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "a tracer's Goal too");
});

test("Expand all and Collapse all show only where script runs; without it the page still folds and opens by hand", () => {
  const html = renderPlanPage({ plan: parsePlan(DRILL_PLAN) });

  assert.match(html, /<p class="controls" hidden><button type="button" data-open="true">Expand all<\/button> <button type="button" data-open="false">Collapse all<\/button><\/p>/, "the controls start hidden");
  assert.match(html, /<script>[^<]*removeAttribute\("hidden"\)[^<]*<\/script>/, "the page's own script shows them");
});

test("the unit holding the task being built reads open, as the pane's open unit does, even with no unit record", () => {
  const plan = parsePlan(DRILL_PLAN);

  const html = renderPlanPage({ plan, states: ["open", "open"], building: "Task 2: Remove an item" });

  assert.match(html, /<summary><h3>Add · open<\/h3><\/summary>/, "the unit being built is never to do");
  assert.match(html, /<summary><h3>Charge · to do<\/h3><\/summary>/, "a unit with no task being built still has its work to do");
});

test("the open unit's commits sit in one folded row, newest first, each with its subject; a commit with no subject shows its hash", () => {
  const plan = parsePlan(STATES_PLAN);
  const subjects = { ["1".repeat(40)]: "feat: take <b>payment</b>", ["6".repeat(40)]: "fix: refund rounding" };

  const html = renderPlanPage({ plan, states: ["published", "open", "open"], open: OPEN_PAY, subjects });

  assert.ok(!/<li class="facts">commit /.test(html), "no bare commit row among the unit's facts");
  assert.match(html, /<details class="commits">\s*<summary>6 commits<\/summary>/, "one fold, folded, that counts them");
  const fold = html.slice(html.indexOf('<details class="commits">'), html.indexOf("</details>", html.indexOf('<details class="commits">')));
  const rows = [...fold.matchAll(/<li>([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]+>[^<]*)*)<\/li>/g)].map(([, row]) => row);
  assert.deepEqual(rows, ["6666666 fix: refund rounding", "5555555", "4444444", "3333333", "2222222", "1111111 feat: take &lt;b&gt;payment&lt;/b&gt;"]);
});

test("when the unit record tells each task's last commit, the commits fold groups them under their task, newest task first", () => {
  const plan = parsePlan(STATES_PLAN);
  const sha = (digit) => digit.repeat(40);
  const open = { ...OPEN_PAY, tasks: [{ title: "Task 2: Take payment", headSha: sha("2") }, { title: "Task 3: Refund", headSha: sha("5") }] };

  const html = renderPlanPage({ plan, states: ["published", "open", "open"], open });

  const fold = html.slice(html.indexOf('<details class="commits">'), html.indexOf("</details>", html.indexOf('<details class="commits">')));
  const lines = fold.replace(/<[^>]+>/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(lines, ["6 commits", "after the last finished task", "6666666", "Task 3: Refund", "5555555", "4444444", "3333333", "Task 2: Take payment", "2222222", "1111111"]);
});

test("the open unit lists the questions set aside for you, each with its task, and counts those past the bound", () => {
  const plan = parsePlan(STATES_PLAN);
  const questions = [{ gate: "G:task-end", task: "Task 2: Take payment", step: "a reviewer", ambiguity: "Refund <all> or part?" }];

  const html = renderPlanPage({ plan, states: ["published", "open", "open"], open: { ...OPEN_PAY, questions, questionsMore: 3 } });
  const text = textOf(html);

  assert.ok(text.includes("4 questions for you, asked before the pull request"), `the count, got ${text}`);
  assert.ok(html.includes("Refund &lt;all&gt; or part? (Task 2: Take payment)"), "each question, escaped, with its task");
  assert.ok(text.includes("+3 more in the report"), "the rest are counted");
});

test("a question recorded with its task's whole plan text names the task by title on the page", () => {
  const plan = parsePlan(STATES_PLAN);
  const questions = [{ gate: "G:unit", task: "Task 2: Take payment\n\n**Goal:** Money moves.", step: "a reviewer", ambiguity: "Refund?" }];

  const html = renderPlanPage({ plan, states: ["published", "open", "open"], open: { ...OPEN_PAY, questions } });

  assert.ok(html.includes("Refund? (Task 2: Take payment)"));
  assert.ok(!html.includes("Money moves."));
});
