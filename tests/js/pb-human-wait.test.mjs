// A pb refusal whose way through is a line only the human types is kept at .pairingbuddy/run/human-wait.json, so the
// views show WAITING FOR YOU with that line instead of "working" while nothing moves. The human's next pb human verb, or
// the refused verb going through, clears it.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeRepo, pb, writePlan } from "./cli-repo-fixture.mjs";

const waitPath = (repo) => join(repo.dir, ".pairingbuddy", "run", "human-wait.json");

// A unit whose agent tasks are ticked, one by hand, and whose only unticked tasks are [HUMAN]: pb plan next refuses
// with the human's accept --legacy line.
function handTickedRepo() {
  const repo = makeRepo({ openTask: false });
  writePlan(repo, ["## Tasks", "", "### Tracer 1: Skeleton", "", "#### PR: Release", "", "- [x] **Build it**", "- [x] **Wire it**", "- [ ] **[HUMAN] Sign the release**", ""].join("\n"));
  mkdirSync(join(repo.dir, ".pairingbuddy", "run"), { recursive: true });
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "unit.json"), JSON.stringify({ unit: "Release", plan: "docs/plan.md", tasks: [{ title: "Build it" }] }));
  return repo;
}

test("a-refusal-that-hands-the-human-a-line-is-kept-with-that-line", () => {
  const repo = handTickedRepo();

  const refused = pb(repo, "plan", "next", "docs/plan.md");

  assert.equal(refused.code, 1, refused.stderr);
  const wait = JSON.parse(readFileSync(waitPath(repo), "utf8"));
  assert.equal(wait.verb, "plan next");
  assert.equal(wait.message, refused.stderr.trim().replace(/^pb: /, ""));
  assert.equal(wait.lines.length, 2, JSON.stringify(wait.lines));
  assert.match(wait.lines[0], /^!.* human task done 'Wire it' --plan docs\/plan\.md$/);
  assert.match(wait.lines[1], /^!.* human accept --legacy Release --plan docs\/plan\.md$/);
  assert.ok(Number.isFinite(Date.parse(wait.at)));
  assert.equal(existsSync(waitPath(repo)), true);
});

test("the-humans-next-verb-clears-the-wait", () => {
  const repo = handTickedRepo();
  pb(repo, "plan", "next", "docs/plan.md");
  assert.equal(existsSync(waitPath(repo)), true, "the refusal was kept");
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "config-proposals.json"), JSON.stringify({ proposals: [{ n: 1, file: "git-config.json", key: "pr.title_template", old: null, new: "x", reason: "r", status: "pending" }] }));

  const human = pb(repo, "human", "config", "refuse", "1");

  assert.equal(human.code, 0, human.stderr);
  assert.equal(existsSync(waitPath(repo)), false);
});

test("a-refusal-with-no-typed-line-keeps-nothing", () => {
  const repo = handTickedRepo();
  // A task outside any unit is a format problem: the refusal names it and hands the human no line.
  writeFileSync(join(repo.dir, "docs", "plan.md"), ["## Tasks", "", "- [ ] **Stray**", "", "### Tracer 1: Skeleton", "", "- [ ] **Ship it**", ""].join("\n"));

  const refused = pb(repo, "plan", "next", "docs/plan.md");

  assert.equal(refused.code, 1, refused.stderr);
  assert.doesNotMatch(refused.stderr, /!\S*pb|!cd /);
  assert.equal(existsSync(waitPath(repo)), false);
});
