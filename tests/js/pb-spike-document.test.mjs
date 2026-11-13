import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { env, makeRepo } from "./cli-repo-fixture.mjs";
import { pbFrom, spikePlugin } from "./spike-plugin-fixture.mjs";

// Placeholders for the spike document verbs: pb spike state (findings), pb spike write, and pb task end on a spike.
// CLI level, real tests run on temp repos via spike-plugin-fixture.mjs.

// Scenario spike-state-findings: pb spike state lists the recorded explore returns and stops refusing once the document stage is active.

const unit = (id) => ({ id, name: id, description: `Explore ${id}`, execution: { language: "node", run_command: "node x.mjs", working_directory: `spike/${id}` } });
const SPIKE = { goal: "Learn X", code_location: "spike", exploration_mode: "questions", doc_path: "docs/spikes/learn-x.md", units: [unit("u1"), unit("u2")] };
const keyOf = (unitId, attempt) => `code-spike-unit.explore-spike-unit.${unitId}.r1.a${attempt}`;
const checkpoint = (unitId, attempt) => ({ key: keyOf(unitId, attempt), step: "spike-unit", committed: false, stage: "code-spike-unit", attempt });

function documentStageRepo({ attempt = 4, checkpoints = [], spike = SPIKE, ledger: overrides = {} } = {}) {
  const repo = makeRepo({
    ledger: {
      taskType: "spike",
      stage: { name: "code-spike-document", status: "active", runId: "wf_1", attempt, startedAt: null },
      stages: [{ name: "code-spike-unit", status: "done", explored: ["u1", "u2"] }, { name: "code-spike-document", status: "active" }],
      checkpoints,
      ...overrides,
    },
  });
  writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "spike.json"), JSON.stringify(spike));
  return repo;
}

function documentStageState(plugin, checkpoints = []) {
  return pbFrom(plugin, documentStageRepo({ checkpoints }), "spike", "state");
}

test("state-prints-findings-newest-per-unit", (t) => {
  const plugin = spikePlugin(t);

  const r = documentStageState(plugin, [checkpoint("u2", 1), checkpoint("u1", 2), checkpoint("u2", 3)]);

  assert.equal(r.code, 0, `spike state succeeds, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout).findings, [`.pairingbuddy/run/task/artifacts/${keyOf("u1", 2)}.json`, `.pairingbuddy/run/task/artifacts/${keyOf("u2", 3)}.json`], "findings are the newest checkpoint's artifact per unit, in unit order");
});
test("state-document-active-prints-next-null", (t) => {
  const plugin = spikePlugin(t);

  const r = documentStageState(plugin);

  assert.equal(r.code, 0, `spike state does not refuse while the document stage is active, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).next, null, "every unit is explored, so next is null");
});


// Scenario spike-write-verb: pb spike write commits the newest standing document to doc_path and records a spike-doc checkpoint.

const DOC_PATH = "docs/spikes/x.md";
const KEY = "code-spike-document.document-spike.-.r1.a1";
const writeRepo = ({ attempt = 1, ledger } = {}) => documentStageRepo({ attempt, spike: { ...SPIKE, doc_path: DOC_PATH }, ledger });
const putDocument = (repo, key, fields) => writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${key}.json`), JSON.stringify({ pb_key: key, ambiguity: "", finding_map: [], ...fields }));
const gitIn = (repo) => {
  const raw = (...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), encoding: "utf8" });
  return { raw, git: (...args) => raw(...args).trim() };
};
const spikeDocCheckpoints = (repo) => repo.ledger().checkpoints.filter(({ step }) => step === "spike-doc");

test("write-commits-doc-and-records-checkpoint", (t) => {
  const plugin = spikePlugin(t);
  const DOCUMENT = "# X\n\nWhat the spike found.\n";
  const repo = writeRepo();
  putDocument(repo, KEY, { document: DOCUMENT });
  mkdirSync(join(repo.dir, "notes"), { recursive: true });
  writeFileSync(join(repo.dir, "notes", "unrelated.txt"), "keep me out\n");
  const { raw, git } = gitIn(repo);
  const before = git("rev-parse", "HEAD");

  const r = pbFrom(plugin, repo, "spike", "write");

  const head = git("rev-parse", "HEAD");
  assert.equal(r.code, 0, `spike write succeeds, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.equal(git("rev-list", "--count", `${before}..HEAD`), "1", "exactly one new commit");
  assert.equal(git("log", "-1", "--format=%s"), `docs: record the spike findings in ${DOC_PATH}`, "commit subject names the doc path");
  assert.equal(git("show", "--name-only", "--format=", "HEAD"), DOC_PATH, "the commit touches only the doc path");
  assert.equal(raw("show", `HEAD:${DOC_PATH}`), DOCUMENT, "the committed file is the document, exactly");
  assert.equal(git("status", "--porcelain", "--", "notes/unrelated.txt"), "?? notes/unrelated.txt", "the unrelated file stays untracked");
  assert.deepEqual(spikeDocCheckpoints(repo), [{ key: KEY, step: "spike-doc", stage: "code-spike-document", attempt: 1, committed: true, sha: head }], "a spike-doc checkpoint records the commit");
});
test("write-uses-newest-standing-document-of-attempt", (t) => {
  const plugin = spikePlugin(t);
  const repo = writeRepo({ attempt: 2 });
  putDocument(repo, "code-spike-document.document-spike.-.r1.a2", { document: "A\n" });
  putDocument(repo, "code-spike-document.fix.g1.r2.a2", { document: "B\n" });
  putDocument(repo, "code-spike-document.document-spike.-.r3.a1", { document: "OLD\n" });
  const { raw } = gitIn(repo);

  const r = pbFrom(plugin, repo, "spike", "write");

  assert.equal(r.code, 0, `spike write succeeds, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.equal(raw("show", `HEAD:${DOC_PATH}`), "B\n", "the later fix's document is committed, not the first draft nor an earlier attempt's");
});
test("write-refuses-without-standing-document", async (t) => {
  const plugin = spikePlugin(t);
  const cases = [
    { label: "no return stands", put: null, message: /no document-spike return stands/ },
    { label: "the standing return's document is empty", put: { document: "" }, message: /document.*non-empty string/ },
    { label: "the standing return's document is not a string", put: { document: 42 }, message: /document.*non-empty string/ },
  ];
  for (const { label, put, message } of cases) {
    await t.test(label, () => {
      const repo = writeRepo();
      if (put !== null) putDocument(repo, KEY, put);
      const { git } = gitIn(repo);
      const before = git("rev-parse", "HEAD");

      const r = pbFrom(plugin, repo, "spike", "write");

      assert.equal(r.code, 1, `spike write refuses, stdout ${r.stdout}, stderr ${r.stderr}`);
      assert.match(r.stderr, message, `the refusal names the cause, stderr ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /unexpected failure/, "a refusal, not the catch-all");
      assert.equal(existsSync(join(repo.dir, DOC_PATH)), false, "nothing is written at doc_path");
      assert.equal(git("rev-parse", "HEAD"), before, "HEAD is unchanged");
      assert.deepEqual(spikeDocCheckpoints(repo), [], "no spike-doc checkpoint is recorded");
    });
  }
});
test("write-refuses-on-wrong-stage-or-task-type", async (t) => {
  const plugin = spikePlugin(t);
  const cases = [
    { label: "spike task with code-spike-unit active", ledger: { stage: { name: "code-spike-unit", status: "active", runId: "wf_1", attempt: 1, startedAt: null } }, message: /active stage is code-spike-unit/ },
    { label: "spike task with no active stage", ledger: { stage: { name: "code-spike-document", status: "done", runId: "wf_1", attempt: 1, startedAt: null } }, message: /no stage is active/ },
    { label: "non-spike task with code-spike-document active", ledger: { taskType: "refactoring" }, message: /spike only, and this task is refactoring/ },
  ];
  for (const { label, ledger, message } of cases) {
    await t.test(label, () => {
      const repo = writeRepo({ ledger });
      putDocument(repo, KEY, { document: "# X\n" });
      const { git } = gitIn(repo);
      const before = git("rev-parse", "HEAD");
      const checkpointsBefore = repo.ledger().checkpoints;

      const r = pbFrom(plugin, repo, "spike", "write");

      assert.equal(r.code, 1, `spike write refuses, stdout ${r.stdout}, stderr ${r.stderr}`);
      assert.match(r.stderr, message, `the refusal names the cause, stderr ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /unexpected failure/, "a refusal, not the catch-all");
      assert.equal(existsSync(join(repo.dir, DOC_PATH)), false, "nothing is written at doc_path");
      assert.equal(git("rev-parse", "HEAD"), before, "HEAD is unchanged");
      assert.deepEqual(repo.ledger().checkpoints, checkpointsBefore, "no checkpoint is recorded");
    });
  }
});
test("write-refuses-dirty-doc-path", async (t) => {
  const plugin = spikePlugin(t);
  const THEIRS = "# Someone else's notes\n\nNot yet committed.\n";
  const cases = [
    { label: "doc_path committed, then modified in the worktree", committed: "# Committed\n" },
    { label: "doc_path untracked with foreign content", committed: null },
  ];
  for (const { label, committed } of cases) {
    await t.test(label, () => {
      const repo = writeRepo();
      putDocument(repo, KEY, { document: "# X\n\nWhat the spike found.\n" });
      const { git } = gitIn(repo);
      mkdirSync(join(repo.dir, "docs", "spikes"), { recursive: true });
      if (committed !== null) {
        writeFileSync(join(repo.dir, DOC_PATH), committed);
        git("add", DOC_PATH);
        git("commit", "-m", "docs: an earlier spike note");
      }
      writeFileSync(join(repo.dir, DOC_PATH), THEIRS);
      const before = git("rev-parse", "HEAD");

      const r = pbFrom(plugin, repo, "spike", "write");

      assert.equal(r.code, 1, `spike write refuses, stdout ${r.stdout}, stderr ${r.stderr}`);
      assert.match(r.stderr, new RegExp(`${DOC_PATH}.*(uncommitted|changes)|(uncommitted|changes).*${DOC_PATH}`), `the refusal names doc_path and its uncommitted changes, stderr ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /unexpected failure/, "a refusal, not the catch-all");
      assert.equal(readFileSync(join(repo.dir, DOC_PATH), "utf8"), THEIRS, "the file stays exactly as the other person left it");
      assert.equal(git("rev-parse", "HEAD"), before, "HEAD is unchanged");
      assert.deepEqual(spikeDocCheckpoints(repo), [], "no spike-doc checkpoint is recorded");
    });
  }
});
test("write-unchanged-records-committed-false", (t) => {
  const plugin = spikePlugin(t);
  const DOCUMENT = "# X\n\nWhat the spike found.\n";
  const repo = writeRepo();
  putDocument(repo, KEY, { document: DOCUMENT });
  const { git } = gitIn(repo);
  mkdirSync(join(repo.dir, "docs", "spikes"), { recursive: true });
  writeFileSync(join(repo.dir, DOC_PATH), DOCUMENT);
  git("add", DOC_PATH);
  git("commit", "-m", "docs: the standing spike document");
  const before = git("rev-parse", "HEAD");

  const r = pbFrom(plugin, repo, "spike", "write");

  assert.equal(r.code, 0, `spike write succeeds, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.equal(git("rev-parse", "HEAD"), before, "no commit is made");
  assert.deepEqual(spikeDocCheckpoints(repo), [{ key: KEY, step: "spike-doc", stage: "code-spike-document", attempt: 1, committed: false, sha: null }], "a spike-doc checkpoint records committed false in the shared no-change shape");
});

// Scenario spike-close-no-publish: pb task end on a spike closes the unit locally with no publish.

test("task-end-spike-closes-kept-local", (t) => {
  const plugin = spikePlugin(t);
  const repo = makeRepo({
    remote: true,
    ledger: {
      taskType: "spike",
      stage: { name: "code-spike-document", status: "done", runId: "wf_1", attempt: 1, startedAt: null },
      stages: [{ name: "code-spike-unit", status: "done", explored: ["u1", "u2"] }, { name: "code-spike-document", status: "done" }],
      plan: { path: "", title: "" },
      gates: { "G:unit": { source: "auto" }, "G:task-end": { source: "auto" } },
    },
  });
  const { git } = gitIn(repo);
  const opened = pbFrom(plugin, repo, "unit", "open", "--type", "docs", "--slug", "learn-x");
  assert.equal(opened.code, 0, `unit open succeeds, stderr ${opened.stderr}`);
  writeFileSync(join(repo.dir, "finding.txt"), "found\n");
  git("add", "finding.txt");
  git("commit", "-q", "-m", "docs: record the spike findings");
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  writeFileSync(join(runDir, "pr-body.md"), "body\n");
  writeFileSync(join(runDir, "pr-lint.json"), "{}\n");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const head = git("rev-parse", "HEAD");

  const r = pbFrom(plugin, repo, "task", "end");

  assert.equal(r.code, 0, `task end succeeds, stdout ${r.stdout}, stderr ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.closed, "kept-local", "the spike unit is closed kept-local");
  assert.ok(out.reason.includes(branch), `the reason names the branch ${branch}, reason ${out.reason}`);
  for (const name of ["unit.json", "pr-body.md", "pr-lint.json"]) assert.equal(existsSync(join(runDir, name)), false, `run/${name} is removed`);
  assert.equal(existsSync(join(runDir, "task")), false, "run/task is removed");
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD"), branch, "the branch is still checked out");
  assert.equal(git("rev-parse", "HEAD"), head, "HEAD is unchanged");
  assert.equal(git("--git-dir", repo.remoteDir, "branch", "--list", branch), "", "nothing was pushed: the remote has no such branch");

  const publish = pbFrom(plugin, repo, "run", "open", "--kind", "publish");

  assert.equal(publish.code, 1, `run open --kind publish refuses, stdout ${publish.stdout}, stderr ${publish.stderr}`);
  assert.match(publish.stderr, /no unit is open \(.*unit\.json is missing\)/, `the refusal names the missing unit record, stderr ${publish.stderr}`);
  assert.doesNotMatch(publish.stderr, /unexpected failure/, `the refusal is an expected one, stderr ${publish.stderr}`);
});
test("task-end-other-types-unchanged", (t) => {
  const plugin = spikePlugin(t);
  const repo = makeRepo({
    remote: true,
    ledger: {
      taskType: "refactoring",
      stage: { name: "code-safety-net", status: "done", runId: "wf_1", attempt: 1, startedAt: null },
      stages: ["code-refactor-scope", "code-refactor-apply", "code-safety-net"].map((name) => ({ name, status: "done", attempt: 1 })),
      plan: { path: "", title: "" },
      gates: { "G:unit": { source: "auto" }, "G:scope": { source: "auto" }, "G:task-end": { source: "auto" } },
    },
  });
  const { git } = gitIn(repo);
  const opened = pbFrom(plugin, repo, "unit", "open", "--type", "refactor", "--slug", "tidy");
  assert.equal(opened.code, 0, `unit open succeeds, stderr ${opened.stderr}`);
  const runDir = join(repo.dir, ".pairingbuddy", "run");

  const r = pbFrom(plugin, repo, "task", "end");

  assert.equal(r.code, 0, `task end succeeds, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.equal("closed" in JSON.parse(r.stdout), false, `a non-spike task end has no closed field, stdout ${r.stdout}`);
  assert.equal(existsSync(join(runDir, "unit.json")), true, "the unit record is still present, so publish can follow");
  assert.equal(existsSync(join(runDir, "task")), false, "run/task is removed as before");
  assert.equal(git("status", "--porcelain", "--", "."), "", "the tree is clean");
});

// Late safeguards.

test("write-refuses-an-unreadable-standing-return-cleanly", async (t) => {
  const plugin = spikePlugin(t);
  const cases = [
    { label: "corrupt JSON", content: "{ not json" },
    { label: "a pb_key naming another key", content: JSON.stringify({ pb_key: "code-spike-document.document-spike.-.r9.a1", document: "# X\n" }) },
  ];
  for (const { label, content } of cases) {
    await t.test(label, () => {
      const repo = writeRepo();
      writeFileSync(join(repo.dir, ".pairingbuddy", "run", "task", "artifacts", `${KEY}.json`), content);
      const { git } = gitIn(repo);
      const before = git("rev-parse", "HEAD");

      const r = pbFrom(plugin, repo, "spike", "write");

      assert.equal(r.code, 1, `spike write refuses, stdout ${r.stdout}, stderr ${r.stderr}`);
      assert.match(r.stderr, /cannot be read/, `the refusal says the return cannot be read, stderr ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /unexpected failure/, "a refusal, not the catch-all");
      assert.equal(existsSync(join(repo.dir, DOC_PATH)), false, "nothing is written at doc_path");
      assert.equal(git("rev-parse", "HEAD"), before, "HEAD is unchanged");
      assert.deepEqual(spikeDocCheckpoints(repo), [], "no spike-doc checkpoint is recorded");
    });
  }
});
test("write-accepts-a-doc-path-already-holding-the-standing-document", (t) => {
  const plugin = spikePlugin(t);
  const DOCUMENT = "# X\n\nWhat the spike found.\n";
  const repo = writeRepo();
  putDocument(repo, KEY, { document: DOCUMENT });
  const { raw, git } = gitIn(repo);
  mkdirSync(join(repo.dir, "docs", "spikes"), { recursive: true });
  writeFileSync(join(repo.dir, DOC_PATH), DOCUMENT);
  const before = git("rev-parse", "HEAD");

  const r = pbFrom(plugin, repo, "spike", "write");

  assert.equal(r.code, 0, `spike write succeeds on pb's own leftover, stdout ${r.stdout}, stderr ${r.stderr}`);
  assert.equal(git("rev-list", "--count", `${before}..HEAD`), "1", "the leftover is committed");
  assert.equal(raw("show", `HEAD:${DOC_PATH}`), DOCUMENT, "the committed file is the document");
  assert.equal(spikeDocCheckpoints(repo).length, 1, "a spike-doc checkpoint records it");
  assert.equal(spikeDocCheckpoints(repo)[0].committed, true, "as committed");
});
test("task-end-spike-names-the-unit-branch-not-the-checked-out-one", (t) => {
  const plugin = spikePlugin(t);
  const repo = makeRepo({
    remote: true,
    ledger: {
      taskType: "spike",
      stage: { name: "code-spike-document", status: "done", runId: "wf_1", attempt: 1, startedAt: null },
      stages: [{ name: "code-spike-unit", status: "done", explored: ["u1", "u2"] }, { name: "code-spike-document", status: "done" }],
      plan: { path: "", title: "" },
      gates: { "G:unit": { source: "auto" }, "G:task-end": { source: "auto" } },
    },
  });
  const { git } = gitIn(repo);
  const opened = pbFrom(plugin, repo, "unit", "open", "--type", "docs", "--slug", "learn-x");
  assert.equal(opened.code, 0, `unit open succeeds, stderr ${opened.stderr}`);
  const unitBranch = git("rev-parse", "--abbrev-ref", "HEAD");
  writeFileSync(join(repo.dir, "finding.txt"), "found\n");
  git("add", "finding.txt");
  git("commit", "-q", "-m", "docs: record the spike findings");
  git("checkout", "-q", "-b", "somewhere-else");
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  writeFileSync(join(runDir, "pr-body.md"), "body\n");
  writeFileSync(join(runDir, "pr-lint.json"), "{}\n");

  const r = pbFrom(plugin, repo, "task", "end");

  assert.equal(r.code, 0, `task end succeeds, stdout ${r.stdout}, stderr ${r.stderr}`);
  const { reason } = JSON.parse(r.stdout);
  assert.ok(reason.includes(unitBranch), `the reason names the unit's branch ${unitBranch}, reason ${reason}`);
  assert.ok(!reason.includes("somewhere-else"), `the reason does not name the checked-out branch, reason ${reason}`);
});
