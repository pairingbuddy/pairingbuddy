// Scenario: pb-plan-next-cli. Drives the `pb plan next` verb through the real CLI in a temp git repo, using the cli-repo-fixture helpers.
// Never use { skip } here: the JS suite treats skipped tests as failures.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeRepo, pb, pbWithEnv, writePlan } from "./cli-repo-fixture.mjs";

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

// Writes .pairingbuddy/run/unit.json in the repo: the record of the unit's tasks (by title) that were done through the workflow, creating the directory when needed.
function writeUnitJson(repo, unit, titles) {
  mkdirSync(join(repo.dir, ".pairingbuddy", "run"), { recursive: true });
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), JSON.stringify({ unit, plan: "docs/plan.md", tasks: titles.map((title) => ({ title })) }));
}

describe("pb-plan-next-cli", () => {
  // Without --dry-run a stop exits 1 writing nothing: a fully checked unit with no PR: line names the human command, a hand-ticked task and an unpublished unit say so, and a unit with a PR: line is skipped
  test("plan-next-stop-refuses-with-human-command", () => {
    const heading = (name) => ["## Tasks", "", "### Tracer 1: Skeleton", "", `#### PR: ${name}`, ""];

    const legacyRepo = makeRepo({ openTask: false });
    writePlan(legacyRepo, [...heading("Done"), "- [x] **One**", "- [x] **Two**", ""].join("\n"));
    const legacyBefore = snapshot(legacyRepo.dir);
    const legacy = pb(legacyRepo, "plan", "next", "docs/plan.md");

    const tickedRepo = makeRepo({ openTask: false });
    writePlan(tickedRepo, [...heading("Half"), "- [x] **One**", "- [x] **Two**", "- [ ] **Three**", ""].join("\n"));
    writeUnitJson(tickedRepo, "Half", ["One"]);
    const tickedBefore = snapshot(tickedRepo.dir);
    const ticked = pb(tickedRepo, "plan", "next", "docs/plan.md");

    const unpublishedRepo = makeRepo({ openTask: false });
    writePlan(unpublishedRepo, [...heading("Done"), "- [x] **One**", "- [x] **Two**", ""].join("\n"));
    writeUnitJson(unpublishedRepo, "Done", ["One", "Two"]);
    const unpublishedBefore = snapshot(unpublishedRepo.dir);
    const unpublished = pb(unpublishedRepo, "plan", "next", "docs/plan.md");

    const skipRepo = makeRepo({ openTask: false });
    writePlan(skipRepo, [...heading("First"), "PR: https://example.com/pr/1 branch: first", "", "- [x] **One**", "", "#### PR: Second", "", "- [x] **Two**", "- [ ] **Three**", ""].join("\n"));
    writeUnitJson(skipRepo, "Second", ["Two"]);
    const skipped = pb(skipRepo, "plan", "next", "docs/plan.md");

    const spacedRepo = makeRepo({ openTask: false });
    writePlan(spacedRepo, [...heading("Two words"), "- [x] **One**", "", ""].join("\n"));
    const spaced = pb(spacedRepo, "plan", "next", "docs/plan.md");

    assert.equal(spaced.code, 1, `spaced-name exit code (stderr: ${spaced.stderr})`);
    assert.ok(spaced.stderr.includes("--legacy 'Two words' --plan docs/plan.md"), `a unit name with a space is shell-quoted in the human command (stderr: ${spaced.stderr})`);
    assert.equal(legacy.code, 1, `legacy exit code (stderr: ${legacy.stderr})`);
    assert.match(legacy.stderr, /unit "Done"/, "legacy stderr names the unit");
    assert.match(legacy.stderr, /no PR: line/, "legacy stderr says it has no PR: line");
    assert.match(legacy.stderr, /!cd .* && node .*pb\.mjs human accept --legacy Done --plan docs\/plan\.md/, "legacy stderr gives the exact human command");
    assert.deepEqual(snapshot(legacyRepo.dir), legacyBefore, "legacy stop writes nothing");
    assert.equal(ticked.code, 1, `hand-ticked exit code (stderr: ${ticked.stderr})`);
    assert.match(ticked.stderr, /Half/, "hand-ticked stderr names the unit");
    assert.match(ticked.stderr, /no task record: Two\./, "hand-ticked stderr lists only the task ticked without a record");
    assert.deepEqual(snapshot(tickedRepo.dir), tickedBefore, "hand-ticked stop writes nothing");
    assert.equal(unpublished.code, 1, `unpublished exit code (stderr: ${unpublished.stderr})`);
    assert.match(unpublished.stderr, /unit "Done"/, "unpublished stderr names the unit");
    assert.match(unpublished.stderr, /done but not published/, "unpublished stderr says the unit is done but not published");
    assert.match(unpublished.stderr, /run open --kind publish/, "unpublished stderr names the publish command");
    assert.deepEqual(snapshot(unpublishedRepo.dir), unpublishedBefore, "unpublished stop writes nothing");
    assert.equal(skipped.code, 0, `skip exit code (stderr: ${skipped.stderr})`);
    assert.equal(JSON.parse(skipped.stdout).next.title, "Three", "the published unit is skipped, next is the second unit's task");
  });

  // --dry-run names every unit's state in order and reports the first stop with next null (a stop means no skip-ahead), writing nothing
  test("plan-next-dry-run-reports-stop-and-unit-states", () => {
    const repo = makeRepo({ openTask: false });
    const unit = (name, lines) => [`#### PR: ${name}`, "", ...lines, ""];
    writePlan(
      repo,
      [
        "## Tasks",
        "",
        "### Tracer 1: Skeleton",
        "",
        ...unit("Shipped", ["PR: https://example.com/pr/1 branch: shipped", "", "- [x] **S one**"]),
        ...unit("Old", ["Legacy: accepted", "", "- [x] **O one**"]),
        ...unit("Done", ["- [x] **D one**"]),
        ...unit("Also done", ["- [x] **A one**"]),
        ...unit("Todo", ["- [ ] **T one**"]),
      ].join("\n"),
    );
    const before = snapshot(repo.dir);

    const result = pb(repo, "plan", "next", "docs/plan.md", "--dry-run");

    assert.equal(result.code, 0, `exit code (stderr: ${result.stderr})`);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(
      out.units.map((u) => [u.unit, u.state]),
      [["Shipped", "published"], ["Old", "accepted"], ["Done", "legacy"], ["Also done", "legacy"], ["Todo", "open"]],
      "every unit's state, in document order",
    );
    assert.deepEqual(out.stop, { reason: "legacy", unit: "Done" }, "the first stop is the first legacy unit");
    assert.equal(out.next, null, "a stop means no skip-ahead, even in the report");
    assert.deepEqual(snapshot(repo.dir), before, "nothing under the repo changed");
  });

  // The plan argument may be an absolute path: it still matches unit.json's repo-relative plan, so a recorded unit is done-but-not-published, not legacy
  test("plan-next-absolute-plan-path-finds-the-records", () => {
    const repo = makeRepo({ openTask: false });
    writePlan(repo, ["## Tasks", "", "### Tracer 1: Skeleton", "", "#### PR: Done", "", "- [x] **One**", "- [x] **Two**", ""].join("\n"));
    writeUnitJson(repo, "Done", ["One", "Two"]);
    const before = snapshot(repo.dir);

    const result = pb(repo, "plan", "next", join(repo.dir, "docs", "plan.md"));

    assert.equal(result.code, 1, `exit code (stderr: ${result.stderr})`);
    assert.match(result.stderr, /unit "Done"/, "stderr names the unit");
    assert.match(result.stderr, /done but not published/, "stderr says the unit is done but not published, not legacy");
    assert.deepEqual(snapshot(repo.dir), before, "the stop writes nothing");
  });

  // --dry-run prints ok, dryRun, units, next and problems as JSON, exits 0 even with format problems, and leaves the plan file and .pairingbuddy untouched. The unit.json record covers Parser's ticked "Parse units", so no stop applies, both units are open and next is the first unchecked task
  test("dry-run-reports-and-writes-nothing", () => {
    const repo = makeRepo({ openTask: false });
    writePlan(repo, PLAN);
    writeUnitJson(repo, "Parser", ["Parse units"]);
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
        { unit: "Parser", tracer: "Tracer 1: Skeleton", pr: null, legacy: false, state: "open", tasks: [{ title: "Parse units", checked: true, human: false }, { title: "Parse tasks", checked: false, human: false }] },
        { unit: "Verb", tracer: "Tracer 1: Skeleton", pr: null, legacy: false, state: "open", tasks: [{ title: "Parse tasks", checked: false, human: false }] },
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
    writePlan(repo, ["## Tasks", "", "### Tracer 1: Skeleton", "", "- [ ] **Old name**", "", "  Old body.", ""].join("\n"));

    const first = pb(repo, "plan", "next", "docs/plan.md");
    writePlan(repo, ["## Tasks", "", "### Tracer 1: Skeleton", "", "- [ ] **New name**", "", "  New body.", ""].join("\n"));
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
      writePlan(repo, ["## Tasks", "", "### Tracer 1: Skeleton", "", "#### PR: Solo", "", "- [ ] **Only task**", ""].join("\n"));
      mkdirSync(join(repo.dir, ".pairingbuddy", "run"), { recursive: true });
      const unitPath = join(repo.dir, ".pairingbuddy", "run", "unit.json");
      writeFileSync(unitPath, "{}");
      const noTasks = pb(repo, "plan", "next", "docs/plan.md");
      writeFileSync(unitPath, "{not json");
      const badJson = pb(repo, "plan", "next", "docs/plan.md");

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
      assert.equal(noTasks.code, 1, `unit.json without tasks exit code (stderr: ${noTasks.stderr})`);
      assert.match(noTasks.stderr, /no tasks list/, "unit.json of {} says it has no tasks list");
      assert.equal(badJson.code, 1, `invalid unit.json exit code (stderr: ${badJson.stderr})`);
      assert.match(badJson.stderr, /unreadable/, "invalid unit.json says it is unreadable");
    } finally {
      rmSync(outside, { force: true });
    }
  });

  // With PAIRINGBUDDY_SOLO=true (and without it), an unchecked [HUMAN] task stops pb plan next: exit 1, no next task, stderr names the unit and task title, prints the task's body steps, says only a person does it and ticks the box; the repo is unchanged
  test("human-stop-refuses-under-solo-and-writes-nothing", () => {
    const repo = makeRepo({ openTask: false });
    writePlan(
      repo,
      ["## Tasks", "", "### Tracer 1: Skeleton", "", "#### PR: Release", "", "- [ ] **[HUMAN] Sign the release**", "", "  1. Open the signing console.", "  2. Approve the build artifact.", ""].join("\n"),
    );
    const before = snapshot(repo.dir);

    const solo = pbWithEnv(repo, { PAIRINGBUDDY_SOLO: "true" }, "plan", "next", "docs/plan.md");
    const plain = pbWithEnv(repo, { PAIRINGBUDDY_SOLO: "" }, "plan", "next", "docs/plan.md");

    for (const [label, result] of [["solo", solo], ["not solo", plain]]) {
      assert.equal(result.code, 1, `${label} exit code (stderr: ${result.stderr})`);
      assert.equal(result.stdout, "", `${label} prints no next task`);
      assert.match(result.stderr, /unit "Release"/, `${label} stderr names the unit`);
      assert.ok(result.stderr.includes("[HUMAN] Sign the release"), `${label} stderr names the task title (stderr: ${result.stderr})`);
      assert.ok(result.stderr.includes("1. Open the signing console."), `${label} stderr prints the first body step (stderr: ${result.stderr})`);
      assert.ok(result.stderr.includes("2. Approve the build artifact."), `${label} stderr prints the second body step (stderr: ${result.stderr})`);
      assert.match(result.stderr, /only a person/i, `${label} stderr says only a person does the task`);
      assert.match(result.stderr, /tick/i, `${label} stderr says the person ticks the box`);
    }
    assert.deepEqual(snapshot(repo.dir), before, "the human stop writes nothing, solo or not");
  });

  // A hand-ticked unit whose only unticked tasks are [HUMAN] still says a hand-ticked box earns nothing, names the human tasks and prints both options (accept --legacy after doing them, or untick the hand-ticked tasks); with an unticked agent task left it prints no accept --legacy. Both exit 1 and write nothing
  test("hand-ticked-stop-prints-human-options-when-only-human-tasks-remain", () => {
    const unitLines = (tasks) => ["## Tasks", "", "### Tracer 1: Skeleton", "", "#### PR: Release", "", ...tasks, ""];
    const humanOnly = makeRepo({ openTask: false });
    writePlan(humanOnly, unitLines(["- [x] **Build it**", "- [x] **Wire it**", "- [ ] **[HUMAN] Sign the release**", "- [ ] **[HUMAN] Announce it**"]).join("\n"));
    writeUnitJson(humanOnly, "Release", ["Build it"]);
    const humanBefore = snapshot(humanOnly.dir);
    const withAgent = makeRepo({ openTask: false });
    writePlan(withAgent, unitLines(["- [x] **Build it**", "- [x] **Wire it**", "- [ ] **Ship it**", "- [ ] **[HUMAN] Sign the release**"]).join("\n"));
    writeUnitJson(withAgent, "Release", ["Build it"]);
    const agentBefore = snapshot(withAgent.dir);

    const onlyHuman = pb(humanOnly, "plan", "next", "docs/plan.md");
    const agentLeft = pb(withAgent, "plan", "next", "docs/plan.md");

    assert.equal(onlyHuman.code, 1, `human-only exit code (stderr: ${onlyHuman.stderr})`);
    assert.equal(onlyHuman.stdout, "", "human-only prints no next task");
    assert.match(onlyHuman.stderr, /earns nothing/, "human-only stderr still says a box ticked by hand earns nothing");
    assert.match(onlyHuman.stderr, /no task record: Wire it\./, `human-only stderr lists only the task ticked without a record as hand-ticked (stderr: ${onlyHuman.stderr})`);
    assert.ok(onlyHuman.stderr.includes("[HUMAN] Sign the release"), `human-only stderr names the first human task (stderr: ${onlyHuman.stderr})`);
    assert.ok(onlyHuman.stderr.includes("[HUMAN] Announce it"), `human-only stderr names the second human task (stderr: ${onlyHuman.stderr})`);
    assert.ok(onlyHuman.stderr.includes("human accept --legacy Release --plan docs/plan.md"), `human-only stderr prints the exact accept --legacy command (stderr: ${onlyHuman.stderr})`);
    assert.match(onlyHuman.stderr, /untick Wire it so they run again/, `human-only untick option names only the task ticked without a record (stderr: ${onlyHuman.stderr})`);
    assert.deepEqual(snapshot(humanOnly.dir), humanBefore, "the human-only stop writes nothing");
    assert.equal(agentLeft.code, 1, `agent-left exit code (stderr: ${agentLeft.stderr})`);
    assert.match(agentLeft.stderr, /earns nothing/, "agent-left stderr says a box ticked by hand earns nothing");
    assert.ok(!agentLeft.stderr.includes("accept --legacy"), `agent-left stderr prints no accept --legacy (stderr: ${agentLeft.stderr})`);
    assert.deepEqual(snapshot(withAgent.dir), agentBefore, "the agent-left stop writes nothing");
  });

  // --dry-run exits 0 and each task summary is { title, checked, human }; with one agent and one [HUMAN] task the stop is { reason: "human", unit, title, body } naming the human task, next is null, and nothing is written
  test("dry-run-lists-human-tasks-and-names-the-stop", () => {
    const repo = makeRepo({ openTask: false });
    writePlan(
      repo,
      ["## Tasks", "", "### Tracer 1: Skeleton", "", "#### PR: Release", "", "- [ ] **[HUMAN] Sign the release**", "", "  1. Open the signing console.", "  2. Approve the build artifact.", "", "- [ ] **Build it**", ""].join("\n"),
    );
    const before = snapshot(repo.dir);

    const result = pb(repo, "plan", "next", "docs/plan.md", "--dry-run");

    assert.equal(result.code, 0, `exit code (stderr: ${result.stderr})`);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(
      out.units[0].tasks,
      [{ title: "[HUMAN] Sign the release", checked: false, human: true }, { title: "Build it", checked: false, human: false }],
      "each task summary says whether it is human",
    );
    assert.deepEqual(
      out.stop,
      { reason: "human", unit: "Release", title: "[HUMAN] Sign the release", body: "1. Open the signing console.\n2. Approve the build artifact." },
      "the stop names the human task and its steps",
    );
    assert.equal(out.next, null, "a stop means no next task");
    assert.deepEqual(snapshot(repo.dir), before, "nothing under the repo changed");
  });
});
