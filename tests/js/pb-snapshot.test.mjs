// Scenarios: snapshot-verb, snapshot-subject-and-changed, corpus-sources, corpus-confinement, snapshot-determinism. CLI cases for `pb snapshot`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { VERBS } from "../../cli/pb.mjs";
import { NEAREST_TOTAL_CAP, SUBJECT_DIFF_MAX_LINES, namedFiles, nearestFiles } from "../../shared-node/snapshot.mjs";
import { buildKey } from "../../shared-node/keys.mjs";
import { classOf } from "../../shared-node/verbs.mjs";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { makeRepo, pb, env } from "./cli-repo-fixture.mjs";

// A repo with an open unit and one commit after the unit's base, so HEAD differs from baseSha.
function repoWithOpenUnitAndCommits() {
  const repo = makeRepo({ openTask: false, remote: true });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);
  writeFileSync(join(repo.dir, "b.txt"), "b\n");
  for (const args of [["add", "b.txt"], ["commit", "-q", "-m", "change b"]]) execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" });
  return repo;
}

test("snapshot_verb_is_runner_class", () => {
  assert.equal(classOf("snapshot"), "runner", "snapshot is a runner-class verb");
  assert.equal(typeof VERBS.snapshot, "function", "the CLI VERBS table dispatches snapshot");
});

test("snapshot_refuses_without_open_unit", () => {
  const repo = makeRepo();
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  const before = readdirSync(runDir).sort();

  const result = pb(repo, "snapshot");

  assert.notEqual(result.code, 0, "pb snapshot exits non-zero when no unit is open");
  assert.match(result.stderr, /no unit is open/, "the refusal says no unit is open");
  assert.equal(existsSync(join(runDir, "subject.diff")), false, "no subject.diff is written");
  assert.equal(existsSync(join(runDir, "changed.json")), false, "no changed.json is written");
  assert.equal(existsSync(join(runDir, "corpus.json")), false, "no corpus.json is written");
  assert.deepEqual(readdirSync(runDir).sort(), before, "the run dir is untouched");
});

test("snapshot_refuses_extra_arguments", () => {
  const repo = repoWithOpenUnitAndCommits();
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  const before = readdirSync(runDir).sort();

  const result = pb(repo, "snapshot", "extra");

  assert.notEqual(result.code, 0, "pb snapshot with an argument exits non-zero");
  assert.match(result.stderr, /usage: pb snapshot/, "the failure is a usage message for pb snapshot");
  assert.deepEqual(readdirSync(runDir).sort(), before, "no snapshot files are written");
});

test("snapshot_writes_subject_diff", () => {
  const repo = repoWithOpenUnitAndCommits();
  writeFileSync(join(repo.dir, "a.txt"), "a\nmore\n");
  for (const args of [["add", "a.txt"], ["commit", "-q", "-m", "change a"]]) execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" });

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const diff = readFileSync(join(repo.dir, ".pairingbuddy", "run", "subject.diff"), "utf8");
  assert.match(diff, /diff --git a\/a\.txt b\/a\.txt[\s\S]*\+more/, "subject.diff holds the modified file's diff");
  assert.match(diff, /diff --git a\/b\.txt b\/b\.txt\nnew file mode[\s\S]*\+b/, "subject.diff holds the added file's diff");
});

test("snapshot_writes_changed_json_sorted", () => {
  const repo = repoWithOpenUnitAndCommits();
  writeFileSync(join(repo.dir, "a.txt"), "a\nmore\n");
  writeFileSync(join(repo.dir, "z.txt"), "z\n");
  writeFileSync(join(repo.dir, "m.txt"), "m\n");
  for (const args of [["add", "z.txt", "a.txt", "m.txt"], ["commit", "-q", "-m", "more changes"]]) execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" });

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const changed = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "changed.json"), "utf8"));
  assert.deepEqual(changed, [
    { path: "a.txt", status: "M" },
    { path: "b.txt", status: "A" },
    { path: "m.txt", status: "A" },
    { path: "z.txt", status: "A" },
  ], "changed.json lists each changed path with its status, sorted by path");
});

test("snapshot_empty_change_writes_empty_files", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  assert.equal(readFileSync(join(runDir, "subject.diff"), "utf8"), "", "subject.diff is empty when HEAD equals baseSha");
  assert.deepEqual(JSON.parse(readFileSync(join(runDir, "changed.json"), "utf8")), [], "changed.json is an empty list");
  assert.equal(existsSync(join(runDir, "corpus.json")), true, "corpus.json is still written");
});

test("corpus_includes_in_repo_docs", () => {
  const repo = repoWithOpenUnitAndCommits();
  writeFileSync(join(repo.dir, "guide.md"), "guide\n");
  writeFileSync(join(repo.dir, ".pairingbuddy", "doc-config.json"), JSON.stringify({ in_repo_docs: ["guide.md"] }));

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const corpus = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "corpus.json"), "utf8"));
  assert.ok(corpus.paths.includes("guide.md"), "corpus.json paths include the in_repo_docs entry guide.md");
});

test("corpus_includes_conventions_and_claude_md", () => {
  const repo = repoWithOpenUnitAndCommits();
  writeFileSync(join(repo.dir, "commit-rules.md"), "commit\n");
  writeFileSync(join(repo.dir, "pr-rules.md"), "pr\n");
  writeFileSync(join(repo.dir, "CLAUDE.md"), "claude\n");
  writeFileSync(join(repo.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ commit: { conventions: ["commit-rules.md"] }, pr: { conventions: ["pr-rules.md"] } }));

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const corpus = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "corpus.json"), "utf8"));
  assert.ok(corpus.paths.includes("commit-rules.md"), "corpus.json paths include commit.conventions");
  assert.ok(corpus.paths.includes("pr-rules.md"), "corpus.json paths include pr.conventions");
  assert.ok(corpus.paths.includes("CLAUDE.md"), "corpus.json paths include CLAUDE.md");
});

test("corpus_includes_nearest_files_to_changed_paths", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  const commit = (msg) => { for (const args of [["add", "src"], ["commit", "-q", "-m", msg]]) execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" }); };
  mkdirSync(join(repo.dir, "src", "deep"), { recursive: true });
  writeFileSync(join(repo.dir, "src", "deep", "sibling.js"), "s\n");
  commit("add sibling");
  execFileSync("git", ["push", "-q", "origin", "main"], { cwd: repo.dir, env: env(), stdio: "ignore" });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);
  writeFileSync(join(repo.dir, "src", "deep", "changed.js"), "1\n");
  commit("add changed");

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const corpus = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "corpus.json"), "utf8"));
  assert.ok(corpus.paths.includes("src/deep/sibling.js"), "the sibling of the changed path is in the corpus");
  assert.ok(corpus.paths.includes("a.txt"), "a file at the repo root, two directories up, is in the corpus");
  assert.ok(!corpus.paths.includes("src/deep/changed.js"), "the changed file itself is not in the corpus");
});

test("corpus_nearest_capped_per_changed_path", () => {
  const siblings = ["h", "g", "f", "e", "d", "c", "b", "a"].map((n) => `src/${n}.js`);
  const tracked = [...siblings, "src/changed.js"];

  const nearest = nearestFiles(tracked, ["src/changed.js"]);

  assert.deepEqual(nearest, ["src/a.js", "src/b.js", "src/c.js", "src/d.js", "src/e.js"], "8 siblings give the closest 5 in name order for one changed path");
});

test("corpus_skips_missing_docs", () => {
  const repo = repoWithOpenUnitAndCommits();
  writeFileSync(join(repo.dir, "guide.md"), "guide\n");
  writeFileSync(join(repo.dir, ".pairingbuddy", "doc-config.json"), JSON.stringify({ in_repo_docs: ["guide.md", "missing.md"] }));

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds despite the missing doc, stderr: ${result.stderr}`);
  const corpus = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "corpus.json"), "utf8"));
  assert.ok(!corpus.paths.includes("missing.md"), "the missing configured doc is absent from corpus.json");
  assert.ok(corpus.paths.includes("guide.md"), "the existing configured doc is still in corpus.json");
});

test("corpus_excludes_paths_outside_repo", () => {
  const repo = repoWithOpenUnitAndCommits();
  writeFileSync(join(repo.dir, "guide.md"), "guide\n");
  const outside = join(repo.dir, "..", "outside-doc.md");
  writeFileSync(outside, "outside\n");
  writeFileSync(join(repo.dir, ".pairingbuddy", "doc-config.json"), JSON.stringify({ in_repo_docs: ["guide.md", outside, "../outside-doc.md"] }));

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const corpus = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "corpus.json"), "utf8"));
  assert.ok(corpus.paths.includes("guide.md"), "the in-repo doc is still in the corpus");
  assert.ok(!corpus.paths.includes(outside), "the absolute path outside the repo is excluded");
  assert.ok(!corpus.paths.includes("../outside-doc.md"), "the ../ path outside the repo is excluded");
});

test("corpus_excludes_symlinks_escaping_repo", () => {
  const repo = repoWithOpenUnitAndCommits();
  writeFileSync(join(repo.dir, "real.md"), "real\n");
  const outside = join(repo.dir, "..", "outside-target.md");
  writeFileSync(outside, "outside\n");
  symlinkSync(outside, join(repo.dir, "escape.md"));
  symlinkSync(join(repo.dir, "real.md"), join(repo.dir, "inside.md"));
  writeFileSync(join(repo.dir, ".pairingbuddy", "doc-config.json"), JSON.stringify({ in_repo_docs: ["escape.md", "inside.md"] }));

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const corpus = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "corpus.json"), "utf8"));
  assert.ok(!corpus.paths.includes("escape.md"), "the symlink to a file outside the repo is excluded");
  assert.ok(corpus.paths.includes("inside.md"), "the symlink to a file inside the repo is kept");
});

test("snapshot_byte_identical_on_rerun", () => {
  const files = ["subject.diff", "changed.json", "corpus.json"];
  const snapshotOf = (repo) => {
    writeFileSync(join(repo.dir, "guide.md"), "guide\n");
    writeFileSync(join(repo.dir, ".pairingbuddy", "doc-config.json"), JSON.stringify({ in_repo_docs: ["guide.md"] }));
    const result = pb(repo, "snapshot");
    assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
    return files.map((f) => readFileSync(join(repo.dir, ".pairingbuddy", "run", f), "utf8"));
  };
  const first = repoWithOpenUnitAndCommits();
  const second = repoWithOpenUnitAndCommits();

  const firstRun = snapshotOf(first);
  const rerun = files.map((f) => readFileSync(join(first.dir, ".pairingbuddy", "run", f), "utf8"));
  assert.equal(pb(first, "snapshot").code, 0, "the rerun succeeds");
  const rerunAfter = files.map((f) => readFileSync(join(first.dir, ".pairingbuddy", "run", f), "utf8"));
  const otherPath = snapshotOf(second);

  assert.notEqual(first.dir, second.dir, "the two repos live at different absolute paths");
  assert.deepEqual(rerunAfter, firstRun, "a second pb snapshot on the same repo gives byte-identical files");
  assert.deepEqual(rerun, firstRun, "the files are stable between runs");
  assert.deepEqual(otherPath, firstRun, "a repo at a different absolute path gives the same bytes");
});

test("snapshot_prints_ok_and_the_corpus_paths", () => {
  const repo = repoWithOpenUnitAndCommits();
  writeFileSync(join(repo.dir, "guide.md"), "guide\n");
  writeFileSync(join(repo.dir, ".pairingbuddy", "doc-config.json"), JSON.stringify({ in_repo_docs: ["guide.md"] }));

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const printed = JSON.parse(result.stdout);
  const corpus = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "corpus.json"), "utf8"));
  assert.equal(printed.ok, true, "the output says ok");
  assert.deepEqual(printed.paths, corpus.paths, "the printed paths are the corpus.json paths");
  assert.ok(printed.paths.includes("guide.md"), "the corpus names the configured doc");
});

test("corpus_nearest_capped_at_200_total_closest_first", () => {
  const near = Array.from({ length: 60 }, (_, i) => Array.from({ length: 5 }, (_, j) => `d${i}/s${j}.js`)).flat();
  const changedNear = Array.from({ length: 60 }, (_, i) => `d${i}/changed.js`);
  const tracked = [...near, ...changedNear, "lone/changed.js", "far.md"];
  // lone/changed.js has no sibling, so its closest file is the root one, one directory further out than any other path's.

  const nearest = nearestFiles(tracked, ["lone/changed.js", ...changedNear]);

  assert.equal(NEAREST_TOTAL_CAP, 200, "the total cap is 200");
  assert.equal(nearest.length, 200, "300 siblings are cut to 200");
  assert.equal(new Set(nearest).size, 200, "no file is counted twice");
  assert.ok(!nearest.includes("far.md"), "the root file, the furthest candidate, is the one that is cut");
  assert.ok(nearest.every((p) => p.startsWith("d")), "the 200 closest files are all same-directory siblings");
});

test("corpus_nearest_total_cap_keeps_the_per_path_cap", () => {
  const tracked = Array.from({ length: 8 }, (_, i) => `src/s${i}.js`);

  assert.equal(nearestFiles([...tracked, "src/changed.js"], ["src/changed.js"]).length, 5, "a lone changed path still gets 5");
});

test("snapshot_handles_a_file_name_with_a_space_and_a_non_ascii_character", () => {
  const repo = makeRepo({ openTask: false, remote: true });
  mkdirSync(join(repo.dir, "docs"), { recursive: true });
  writeFileSync(join(repo.dir, "docs", "older résumé.md"), "o\n");
  for (const args of [["add", "docs"], ["commit", "-q", "-m", "add older"], ["push", "-q", "origin", "main"]]) execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);
  writeFileSync(join(repo.dir, "docs", "sibling note.md"), "s\n");
  for (const name of ["räksmörgås & more.js", "plain.js"]) writeFileSync(join(repo.dir, "docs", name), "1\n");
  for (const args of [["add", "docs"], ["commit", "-q", "-m", "add odd names"]]) execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" });
  writeFileSync(join(repo.dir, "docs", "later é.md"), "2\n");
  for (const args of [["add", "docs"], ["commit", "-q", "-m", "add later"]]) execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" });

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  const changed = JSON.parse(readFileSync(join(runDir, "changed.json"), "utf8")).map(({ path }) => path);
  assert.deepEqual(changed, ["docs/later é.md", "docs/plain.js", "docs/räksmörgås & more.js", "docs/sibling note.md"], "changed.json holds the names raw, unquoted and sorted by code point");
  assert.match(readFileSync(join(runDir, "subject.diff"), "utf8"), /diff --git a\/docs\/räksmörgås & more\.js b\/docs\/räksmörgås & more\.js/, "subject.diff names the file unquoted");
  const printed = JSON.parse(result.stdout);
  assert.ok(printed.paths.includes("docs/older résumé.md"), "a tracked neighbour with a space and accents reaches the corpus unquoted");
});

test("corpus_sorts_by_code_point", () => {
  const astral = "docs/\u{1F600}.md";
  const bmp = "docs/\uFF5E.md";
  const tracked = [astral, bmp, "docs/changed.md"];

  const nearest = nearestFiles(tracked, ["docs/changed.md"]);

  assert.deepEqual(nearest, [bmp, astral], "U+FF5E sorts before U+1F600, as its code point does, though its UTF-16 unit sorts after");
});

test("snapshot_prints_ledger_task_type", () => {
  const repo = makeRepo({ openTask: true, remote: true, ledger: { taskType: "refactoring" } });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.ok, true, "the output says ok");
  assert.ok(Array.isArray(printed.paths), "the output still carries the corpus paths");
  assert.equal(printed.taskType, "refactoring", "the printed taskType is the run ledger's taskType");
});

// Scenario: pb-snapshot-rolled-back. pb snapshot reports the rolledBack count derived from the run ledger
// Test case: snapshot-rolled-back-counts-active-stage-only
test("snapshot_rolled_back_counts_active_stage_only", () => {
  const rollback = (stage, item) => ({ key: buildKey({ stage, role: "fix", item, round: 2, attempt: 1 }), kind: "commit", ref: null, sha: "a".repeat(40), base: "b".repeat(40) });
  const rollbacks = [rollback("code-safety-net", "g1"), rollback("code-safety-net", "g2"), rollback("code-config", "g1")];
  const repo = makeRepo({
    openTask: true,
    remote: true,
    ledger: { stage: { name: "code-safety-net", status: "active", runId: "wf_1", attempt: 1, startedAt: null }, fixes: { rollbacks } },
  });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.rolledBack, 2, "rolledBack counts only the active stage's rollbacks");
});

// Test case: snapshot-rolled-back-zero-without-ledger
test("snapshot_rolled_back_zero_without_ledger", () => {
  const repo = repoWithOpenUnitAndCommits();

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.rolledBack, 0, "with no run ledger rolledBack is 0");
});

// Test case: corpus-named-files. Files the task text names reach the corpus, so intake lenses can read them before anything changed.
test("named_files_match_tracked_paths_and_basenames_in_the_task_text", () => {
  const tracked = ["cart.py", "src/util/price.py", "src/other.py", "docs/notes.md", "lib/cart.py.bak"];
  const task = "Add order_total(lines) to `cart.py`: use src/other.py and price.py. Then see ./docs/notes.md.";

  const named = namedFiles(tracked, task);

  assert.deepEqual(named, ["cart.py", "docs/notes.md", "src/other.py", "src/util/price.py"], "repo-relative paths and bare basenames the task names, sorted; partial names do not match");
});

test("snapshot_corpus_holds_files_the_task_names_when_nothing_changed", () => {
  const repo = makeRepo({ openTask: true, remote: true, ledger: { task: "Add a line to a.txt: it returns 30.0" } });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  assert.deepEqual(JSON.parse(readFileSync(join(runDir, "changed.json"), "utf8")), [], "nothing has changed yet");
  const corpus = JSON.parse(readFileSync(join(runDir, "corpus.json"), "utf8"));
  assert.ok(corpus.paths.includes("a.txt"), "the tracked file the task names is in the corpus");
});

// Test case: snapshot-records-untracked-at-start. The stage's untracked files are recorded, so a later rollback can tell
// the files a fix created from the ones that were already there.
test("snapshot_records_the_untracked_files_present_at_stage_start", () => {
  const repo = makeRepo({ openTask: true, remote: true, ledger: { stage: { name: "code-safety-net", status: "active", runId: "wf_1", attempt: 2, startedAt: null } } });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);
  writeFileSync(join(repo.dir, "notes.txt"), "mine\n");

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const ledger = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json"), "utf8"));
  assert.deepEqual(ledger.fixes.untrackedAtStart, { stage: "code-safety-net", attempt: 2, paths: ["notes.txt"] }, "the ledger records the stage attempt and its untracked files");
});

// Test case: snapshot-records-no-untracked-when-idle. With no active stage there is no attempt to tie the record to.
test("snapshot_records_no_untracked_files_without_an_active_stage", () => {
  const repo = makeRepo({ openTask: true, remote: true, ledger: { stage: { name: "", status: "idle", runId: null, attempt: 0, startedAt: null } } });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);
  writeFileSync(join(repo.dir, "notes.txt"), "mine\n");

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const ledger = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json"), "utf8"));
  assert.equal(ledger.fixes?.untrackedAtStart, undefined, "no record without a stage");
});

// Test case: snapshot-untracked-record-is-bounded. Past MAX_UNTRACKED_BASELINE files nothing is recorded.
test("snapshot_records_no_untracked_files_past_the_bound", () => {
  const repo = makeRepo({ openTask: true, remote: true, ledger: { stage: { name: "code-safety-net", status: "active", runId: "wf_1", attempt: 1, startedAt: null } } });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);
  mkdirSync(join(repo.dir, "junk"));
  for (let i = 0; i <= 1000; i += 1) writeFileSync(join(repo.dir, "junk", `f${i}.txt`), "");

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const ledger = JSON.parse(readFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json"), "utf8"));
  assert.equal(ledger.fixes?.untrackedAtStart, undefined, "1001 untracked files are past the bound, so none is recorded");
});

// A unit whose diff is past Node's default 1 MB output buffer: 40 files of 3,000 lines each, about 2 MB of diff.
function repoWithBigDiff() {
  const repo = repoWithOpenUnitAndCommits();
  const lines = Array.from({ length: 3000 }, (_, i) => `line ${i} ${"x".repeat(10)}`).join("\n");
  for (let n = 0; n < 40; n += 1) writeFileSync(join(repo.dir, `big-${String(n).padStart(2, "0")}.txt`), `${lines}\n`);
  for (const args of [["add", "."], ["commit", "-q", "-m", "big change"]]) execFileSync("git", args, { cwd: repo.dir, env: env(), stdio: "ignore" });
  return repo;
}

test("snapshot_survives_a_diff_past_the_default_output_buffer", () => {
  const repo = repoWithBigDiff();

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds on a big diff, stderr: ${result.stderr}`);
});

test("snapshot_bounds_a_big_subject_diff_and_opens_it_with_the_diffstat", () => {
  const repo = repoWithBigDiff();

  const result = pb(repo, "snapshot");

  assert.equal(result.code, 0, `pb snapshot succeeds, stderr: ${result.stderr}`);
  const diff = readFileSync(join(repo.dir, ".pairingbuddy", "run", "subject.diff"), "utf8");
  assert.match(diff.split("\n")[0], /too big to show whole/, "the agents read a note first");
  assert.match(diff, /files? changed, \d+ insertions/, "then the diffstat");
  assert.ok(diff.split("\n").length <= SUBJECT_DIFF_MAX_LINES + 20, "and no more than the bound");
});

// A cut test left in its file fails the full suite, so the safety net takes it out before its review.
test("snapshot_names_each_cut_test_still_in_its_file", () => {
  const selector = (id) => ({ runner_id: "fake", test_file: "test_cut.py", test_function: id });
  const cut = ["t_gone", "t_left"].map((id) => ({ id, reason: "already covered", at: "2026-01-01T00:00:00.000Z", selector: selector(id) }));
  const repo = makeRepo({ openTask: true, remote: true, ledger: { tests: { cut } } });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  assert.equal(opened.code, 0, `setup: pb unit open, stderr: ${opened.stderr}`);
  writeFileSync(join(repo.dir, "test_cut.py"), "def t_left():\n    raise NotImplementedError\n");

  const printed = JSON.parse(pb(repo, "snapshot").stdout);

  assert.deepEqual(printed.cutPresent, [{ id: "t_left", test_file: "test_cut.py", test_function: "t_left" }]);
});
