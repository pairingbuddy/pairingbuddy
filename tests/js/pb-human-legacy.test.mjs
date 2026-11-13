// Scenario: human-accept-legacy. pb human accept --legacy <unit> --plan <plan.md> records Legacy: accepted under the unit
// heading, in a temp repo (tests/js/cli-repo-fixture.mjs).
// Never use { skip } here: the JS suite treats skipped tests as failures.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";

import { makeRepo, pb, writePlan } from "./cli-repo-fixture.mjs";

const PLAN_LINES = [
  "# Plan",
  "",
  "## Requirements",
  "",
  "### Done",
  "",
  "## Tasks",
  "",
  "### Tracer 1: Skeleton",
  "",
  "#### PR: Done",
  "",
  "- [x] **One**",
  "- [x] **Two**",
  "",
  "#### PR: Next",
  "",
  "- [ ] **Build it**",
  "",
];

// Returns the plan text with `line` inserted directly after the first line equal to `heading`.
function withLineAfter(heading, line) {
  const lines = PLAN_LINES.slice();
  lines.splice(lines.indexOf(heading) + 1, 0, line);
  return lines.join("\n");
}

describe("human-accept-legacy", () => {
  // The human command writes "Legacy: accepted" directly under the unit's own heading (not the decoy in Requirements), and plan next then goes on to the next unit
  test("accept-legacy-writes-line-and-plan-next-goes-on", () => {
    const repo = makeRepo({ openTask: false });
    writePlan(repo, PLAN_LINES.join("\n"));

    const stopped = pb(repo, "plan", "next", "docs/plan.md");
    const accepted = pb(repo, "human", "accept", "--legacy", "Done", "--plan", "docs/plan.md");
    const text = readFileSync(join(repo.dir, "docs", "plan.md"), "utf8");
    const next = pb(repo, "plan", "next", "docs/plan.md");

    const expected = withLineAfter("#### PR: Done", "Legacy: accepted");
    assert.equal(stopped.code, 1, `plan next stops on the legacy unit (stderr: ${stopped.stderr})`);
    assert.equal(accepted.code, 0, `accept exit code (stderr: ${accepted.stderr})`);
    assert.deepEqual(JSON.parse(accepted.stdout), { ok: true, unit: "Done", plan: "docs/plan.md", legacy: "accepted" }, "accept output");
    assert.equal(text, expected, "the plan gains only the Legacy line, directly under the unit heading");
    assert.equal(next.code, 0, `plan next exit code after accept (stderr: ${next.stderr})`);
    assert.equal(JSON.parse(next.stdout).next.title, "Build it", "plan next goes on to the next unit");
  });

  // Each bad target exits 1 with the reason on stderr and leaves the plan file byte-identical
  test("accept-legacy-refuses-bad-targets", () => {
    // Renaming "Build it" to "One" gives the plan two tasks titled "One", which is a format problem
    const duplicateTitlePlan = PLAN_LINES.map((line) => (line === "- [ ] **Build it**" ? "- [ ] **One**" : line)).join("\n");
    const cases = [
      { name: "unchecked", unit: "Next", plan: PLAN_LINES.join("\n"), reason: /not fully checked/ },
      { name: "published", unit: "Done", plan: withLineAfter("#### PR: Done", "PR: https://example.com/pr/1 branch: done"), reason: /already published/ },
      { name: "unknown", unit: "Nope", plan: PLAN_LINES.join("\n"), reason: /no unit named "Nope"/ },
      { name: "duplicate-title", unit: "Done", plan: duplicateTitlePlan, reason: /format problems/ },
    ];

    for (const { name, unit, plan, reason } of cases) {
      const repo = makeRepo({ openTask: false });
      writePlan(repo, plan);

      const refused = pb(repo, "human", "accept", "--legacy", unit, "--plan", "docs/plan.md");
      const text = readFileSync(join(repo.dir, "docs", "plan.md"), "utf8");

      assert.equal(refused.code, 1, `${name}: exit code (stderr: ${refused.stderr})`);
      assert.match(refused.stderr, reason, `${name}: stderr says why`);
      assert.equal(text, plan, `${name}: the plan file is untouched`);
    }
  });

  // Each malformed --legacy form exits 2 with the usage line on stderr and leaves the plan file byte-identical
  test("accept-legacy-usage-errors", () => {
    const plan = PLAN_LINES.join("\n");
    const forms = [
      { name: "no unit", args: ["--legacy"] },
      { name: "flag where the unit goes", args: ["--legacy", "--plan", "docs/plan.md"] },
      { name: "no --plan", args: ["--legacy", "Done"] },
      { name: "--plan without a path", args: ["--legacy", "Done", "--plan"] },
      { name: "flag as the unit with --plan", args: ["--legacy", "-x", "--plan", "docs/plan.md"] },
      { name: "flag as the plan path", args: ["--legacy", "Done", "--plan", "-x"] },
      { name: "unknown first flag", args: ["--bogus", "Done", "--plan", "docs/plan.md"] },
      { name: "unknown second flag", args: ["--legacy", "Done", "--bogus", "docs/plan.md"] },
      { name: "extra argument", args: ["--legacy", "Done", "--plan", "docs/plan.md", "--bogus"] },
    ];

    for (const { name, args } of forms) {
      const repo = makeRepo({ openTask: false });
      writePlan(repo, plan);

      const refused = pb(repo, "human", "accept", ...args);
      const text = readFileSync(join(repo.dir, "docs", "plan.md"), "utf8");

      assert.equal(refused.code, 2, `${name}: exit code (stderr: ${refused.stderr})`);
      assert.match(refused.stderr, /usage: pb human accept \[--legacy <unit> --plan <plan\.md>\]/, `${name}: stderr shows the usage`);
      assert.equal(text, plan, `${name}: the plan file is untouched`);
    }
  });

  // A unit that already carries Legacy: accepted is reported as already accepted and the plan file is not rewritten
  test("accept-legacy-already-accepted-writes-nothing", () => {
    const repo = makeRepo({ openTask: false });
    const plan = withLineAfter("#### PR: Done", "Legacy: accepted");
    writePlan(repo, plan);
    const planPath = join(repo.dir, "docs", "plan.md");
    const past = new Date("2020-01-01T00:00:00Z");
    utimesSync(planPath, past, past);
    const mtimeBefore = statSync(planPath).mtimeMs;

    const accepted = pb(repo, "human", "accept", "--legacy", "Done", "--plan", "docs/plan.md");
    const text = readFileSync(planPath, "utf8");

    assert.equal(accepted.code, 0, `accept exit code (stderr: ${accepted.stderr})`);
    assert.deepEqual(JSON.parse(accepted.stdout), { ok: true, unit: "Done", plan: "docs/plan.md", legacy: "already accepted" }, "accept output");
    assert.equal(text, plan, "the plan file is byte-identical");
    assert.equal(statSync(planPath).mtimeMs, mtimeBefore, "the plan file is not rewritten");
  });
});
