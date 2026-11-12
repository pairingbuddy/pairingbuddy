// Scenario: pb-plan-next-cli. Drives the `pb plan next` verb through the real CLI in a temp git repo, using the cli-repo-fixture helpers.
// Never use { skip } here: the JS suite treats skipped tests as failures.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeRepo, pb } from "./cli-repo-fixture.mjs";

const PLAN = [
  "# Plan",
  "",
  "## Requirements",
  "",
  "### Not a unit",
  "",
  "## Tasks",
  "",
  "### Tracer 1: Skeleton",
  "",
  "#### PR: Parser",
  "",
  "- [x] **Parse units**",
  "- [ ] **Parse tasks**",
  "",
  "  Read the task lines.",
  "",
  "#### PR: Verb",
  "",
  "- [ ] **Parse tasks**",
  "",
].join("\n");

// Every file and directory under dir (including .git and .pairingbuddy) as path -> contents and mtime (directories as { dir: true }).
function snapshot(dir) {
  const files = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        files[path.slice(dir.length) + "/"] = { dir: true };
        walk(path);
      } else files[path.slice(dir.length)] = { content: readFileSync(path).toString("base64"), mtimeMs: statSync(path).mtimeMs };
    }
  };
  walk(dir);
  return files;
}

// Writes content to docs/plan.md in the repo, creating docs/ when needed.
function writePlan(repo, content) {
  mkdirSync(join(repo.dir, "docs"), { recursive: true });
  writeFileSync(join(repo.dir, "docs", "plan.md"), content);
}

describe("pb-plan-next-cli", () => {
  // --dry-run prints ok, dryRun, units, next and problems as JSON, exits 0 even with format problems, and leaves the plan file and .pairingbuddy untouched
  test("dry-run-reports-and-writes-nothing", () => {
    const repo = makeRepo({ openTask: false });
    writePlan(repo, PLAN);
    const before = snapshot(repo.dir);

    const result = pb(repo, "plan", "next", "docs/plan.md", "--dry-run");

    assert.equal(result.code, 0, `exit code (stderr: ${result.stderr})`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true, "ok");
    assert.equal(out.dryRun, true, "dryRun");
    assert.equal(out.plan, "docs/plan.md", "plan");
    assert.deepEqual(
      out.units,
      [
        { unit: "Parser", tracer: "Tracer 1: Skeleton", pr: null, legacy: false, tasks: [{ title: "Parse units", checked: true }, { title: "Parse tasks", checked: false }] },
        { unit: "Verb", tracer: "Tracer 1: Skeleton", pr: null, legacy: false, tasks: [{ title: "Parse tasks", checked: false }] },
      ],
      "units with their tasks, the Requirements heading not a unit",
    );
    assert.deepEqual(out.next, { unit: "Parser", tracer: "Tracer 1: Skeleton", title: "Parse tasks", body: "Read the task lines." }, "next is the first unchecked task");
    assert.equal(out.problems.length, 1, "one format problem, the duplicate title");
    assert.match(out.problems[0], /Parse tasks/, "the problem names the duplicate title");
    assert.deepEqual(snapshot(repo.dir), before, "nothing under the repo changed: files, directories, contents and mtimes");
  });

  // Without --dry-run, a plan with format problems exits 1 naming every problem; a clean plan prints ok, plan and next and writes nothing
  test("refuses-on-format-problems-without-dry-run", () => {
    const repo = makeRepo({ openTask: false });
    const broken = ["## Tasks", "", "- [ ] **Stray task**", "", "### Tracer 1: Skeleton", "", "- [ ] **Same title**", "- [ ] **Same title**", ""].join("\n");
    writePlan(repo, broken);
    const before = snapshot(repo.dir);

    const refused = pb(repo, "plan", "next", "docs/plan.md");

    assert.equal(refused.code, 1, `exit code (stderr: ${refused.stderr})`);
    assert.match(refused.stderr, /Stray task/, "stderr names the stray task");
    assert.match(refused.stderr, /Same title/, "stderr names the duplicate title");
    assert.deepEqual(snapshot(repo.dir), before, "nothing written when refusing");

    writePlan(repo, ["## Tasks", "", "### Tracer 1: Skeleton", "", "- [ ] **Only task**", "", "  Do it.", ""].join("\n"));
    const cleanBefore = snapshot(repo.dir);
    const clean = pb(repo, "plan", "next", "docs/plan.md");

    assert.equal(clean.code, 0, `clean exit code (stderr: ${clean.stderr})`);
    assert.deepEqual(JSON.parse(clean.stdout), { ok: true, plan: "docs/plan.md", next: { unit: "Tracer 1: Skeleton", tracer: "Tracer 1: Skeleton", title: "Only task", body: "Do it." } }, "ok, plan and next only");
    assert.deepEqual(snapshot(repo.dir), cleanBefore, "nothing written for a clean plan");
  });

  // Editing an unchecked task in the plan file between two calls changes the next task reported by the second call
  test("rereads-plan-edits-between-calls", () => {
    const repo = makeRepo({ openTask: false });
    writePlan(repo, ["## Tasks", "", "### Tracer 1: Skeleton", "", "- [x] **Done task**", "- [ ] **Old name**", "", "  Old body.", ""].join("\n"));

    const first = pb(repo, "plan", "next", "docs/plan.md");
    writePlan(repo, ["## Tasks", "", "### Tracer 1: Skeleton", "", "- [x] **Done task**", "- [ ] **New name**", "", "  New body.", ""].join("\n"));
    const second = pb(repo, "plan", "next", "docs/plan.md");

    assert.equal(first.code, 0, `first exit code (stderr: ${first.stderr})`);
    assert.equal(JSON.parse(first.stdout).next.title, "Old name", "first call reports the original task");
    assert.equal(second.code, 0, `second exit code (stderr: ${second.stderr})`);
    assert.deepEqual(JSON.parse(second.stdout).next, { unit: "Tracer 1: Skeleton", tracer: "Tracer 1: Skeleton", title: "New name", body: "New body." }, "second call reflects the edited title and body");
  });

  // No plan path or an unknown flag exits 2; a missing plan or a path outside the repo refuses with PlanRefused (exit 1)
  test("usage-and-outside-repo-refusal", () => {
    const repo = makeRepo({ openTask: false });
    writePlan(repo, PLAN);
    const outside = join(repo.dir, "..", "outside.md");
    writeFileSync(outside, PLAN);
    const usage = "usage: pb plan next <plan.md> [--dry-run]";

    try {
      const noPath = pb(repo, "plan", "next");
      const unknownFlag = pb(repo, "plan", "next", "docs/plan.md", "--bogus");
      const twoPaths = pb(repo, "plan", "next", "docs/plan.md", "docs/other.md");
      const missing = pb(repo, "plan", "next", "docs/missing.md");
      const outsideRepo = pb(repo, "plan", "next", "../outside.md");

      assert.equal(noPath.code, 2, `no path exit code (stderr: ${noPath.stderr})`);
      assert.ok(noPath.stderr.includes(usage), `no path prints the usage (stderr: ${noPath.stderr})`);
      assert.equal(unknownFlag.code, 2, `unknown flag exit code (stderr: ${unknownFlag.stderr})`);
      assert.ok(unknownFlag.stderr.includes(usage), `unknown flag prints the usage (stderr: ${unknownFlag.stderr})`);
      assert.equal(twoPaths.code, 2, `two paths exit code (stderr: ${twoPaths.stderr})`);
      assert.ok(twoPaths.stderr.includes(usage), `two paths print the usage (stderr: ${twoPaths.stderr})`);
      assert.equal(missing.code, 1, `missing plan exit code (stderr: ${missing.stderr})`);
      assert.match(missing.stderr, /cannot be read/, "missing plan says it cannot be read");
      assert.equal(outsideRepo.code, 1, `outside path exit code (stderr: ${outsideRepo.stderr})`);
      assert.match(outsideRepo.stderr, /outside the repo/, "outside path says it is outside the repo");
    } finally {
      rmSync(outside, { force: true });
    }
  });
});
