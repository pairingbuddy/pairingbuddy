// Task 31: pb task end. Every test drives the real CLI, and the real gate where it matters, as subprocesses in a temp
// git repo with a real ledger.
//
// Output contract: a task that ends prints one JSON object with ok: true and exits 0. A refusal exits 1, prints nothing
// to stdout and changes nothing. Bad arguments exit 2.
import "./isolated-tmpdir.mjs";
import { withIntake } from "./ledger-fixture.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { COMMIT_FAILED, HUMAN_STOPPED } from "../../shared-node/verbs.mjs";
import { makeRepo as makeRepoWithRemote, recordCleanLensReturns } from "./cli-repo-fixture.mjs";
import { readUnitRecord, unitFile } from "./publish-fixture.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const CONFIG = "code-config";
const NET = "code-safety-net";
const GATE = "G:task-end";
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const TEST_CONFIG = { source_directory: ".", runners: { fake: { name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [] } }, default_runner: "fake" };
const IN_PARALLEL = { concurrency: 8 };

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

const NO_HOME = makeDir("pb-no-home-");
const env = (extra = {}) => ({ ...process.env, ...ISOLATED_GIT, HOME: NO_HOME, XDG_CONFIG_HOME: NO_HOME, CLAUDE_PLUGIN_ROOT: ROOT, ...extra });
const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: env(), stdio: ["ignore", "pipe", "pipe"] }).trim();

const DONE_STAGES = [{ name: CONFIG, status: "done", attempt: 1 }, { name: NET, status: "done", attempt: 1 }];
const FINISHED = {
  stage: { name: NET, status: "done", runId: "wf_2", attempt: 1, startedAt: null },
  stages: DONE_STAGES,
  gates: { [GATE]: { source: "auto" } },
};

// configGlobs: the config_globs written to git-config.json; a config_change task may end only on files they cover.
function makeRepo({ ledger = FINISHED, tracked = {}, ignored = ".pairingbuddy/\n", configGlobs = ["**"] } = {}) {
  const dir = makeDir("pb-task-end-");
  git(dir, "init", "-q", "-b", "feature");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, ".gitignore"), ignored);
  writeFileSync(join(dir, "a.txt"), "a\n");
  writeFileSync(join(dir, "fake.mjs"), "");
  for (const [path, text] of Object.entries(tracked)) writeFileSync(join(dir, path), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  const configText = JSON.stringify(TEST_CONFIG);
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), configText);
  writeFileSync(join(dir, ".pairingbuddy", "human-guidance.json"), "{}\n");
  if (configGlobs) writeFileSync(join(dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ config_globs: configGlobs }));
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, withIntake({
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "Task 31", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "auto", source: "permission_mode" },
    stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null }, stages: [], gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    ...ledger,
  }));
  return { dir, taskDir, ledgerPath, ledger: () => readLedger(ledgerPath) };
}

const pb = (repo, ...args) => spawnSync("node", [CLI, ...args], { cwd: repo.dir, encoding: "utf8", env: env() });
const taskEnd = (repo) => pb(repo, "task", "end");

function ok(repo) {
  const result = taskEnd(repo);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertRefused(result, pattern, code = 1) {
  assert.equal(result.status, code, result.stdout);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, pattern);
}

function assertRunKept(repo) {
  assert.ok(existsSync(repo.ledgerPath), "the ledger stays");
  assert.ok(existsSync(join(repo.taskDir, "artifacts")), "the returns stay");
}

describe("a finished task ends", IN_PARALLEL, () => {
  test("run/task goes, and everything around it stays", () => {
    const repo = makeRepo();

    const printed = ok(repo);

    assert.equal(printed.ok, true);
    assert.equal(existsSync(repo.taskDir), false, "run/task is removed");
    assert.ok(existsSync(join(repo.dir, ".pairingbuddy", "run", ".gitignore")), "run/ itself stays");
    assert.ok(existsSync(join(repo.dir, ".pairingbuddy", "test-config.json")), "project config stays");
    assert.ok(existsSync(join(repo.dir, ".pairingbuddy", "human-guidance.json")), "human guidance stays");
    assert.equal(git(repo.dir, "status", "--porcelain"), "");
  });
});

describe("a dirty tree is refused, with the list, and nothing moves", IN_PARALLEL, () => {
  function dirtied() {
    const repo = makeRepo({ tracked: { "b.txt": "b\n", "c.txt": "c\n" } });
    writeFileSync(join(repo.dir, "a.txt"), "changed\n");
    writeFileSync(join(repo.dir, "b.txt"), "staged\n");
    git(repo.dir, "add", "b.txt");
    rmSync(join(repo.dir, "c.txt"));
    writeFileSync(join(repo.dir, "new.txt"), "new\n");
    return repo;
  }

  test("every remaining file is listed", () => {
    const repo = dirtied();

    const result = taskEnd(repo);

    assertRefused(result, /dirty/);
    for (const path of ["a.txt", "b.txt", "c.txt", "new.txt"]) assert.ok(result.stderr.includes(path), `${path} is listed`);
  });

  test("the run and the files stay exactly as they were", () => {
    const repo = dirtied();
    const before = git(repo.dir, "status", "--porcelain");
    const ledgerBytes = readFileSync(repo.ledgerPath, "utf8");

    taskEnd(repo);

    assertRunKept(repo);
    assert.equal(readFileSync(repo.ledgerPath, "utf8"), ledgerBytes);
    assert.equal(git(repo.dir, "status", "--porcelain"), before, "nothing is stashed, staged or removed");
    assert.equal(readFileSync(join(repo.dir, "new.txt"), "utf8"), "new\n");
    assert.equal(git(repo.dir, "stash", "list"), "");
  });

  test("ignored files are not leftovers", () => {
    const repo = makeRepo();
    writeFileSync(join(repo.dir, ".pairingbuddy", "notes.json"), "{}\n");

    ok(repo);
  });

  test("the state directory is no leftover in a repo that neither ignores nor tracks it", () => {
    const repo = makeRepo({ ignored: "" });

    ok(repo);

    assert.equal(existsSync(repo.taskDir), false);
  });

  test("a changed tracked file in the state directory is no leftover either", () => {
    const repo = makeRepo({ ignored: "" });
    git(repo.dir, "add", "-f", ".pairingbuddy/human-guidance.json");
    git(repo.dir, "commit", "-q", "-m", "track guidance");
    writeFileSync(join(repo.dir, ".pairingbuddy", "human-guidance.json"), '{"more":1}\n');

    ok(repo);
  });

  test("a file beside the state directory still counts", () => {
    const repo = makeRepo({ ignored: "" });
    writeFileSync(join(repo.dir, ".pairingbuddy-notes"), "x\n");

    assertRefused(taskEnd(repo), /\.pairingbuddy-notes/);
    assertRunKept(repo);
  });
});

describe("what the ledger recorded must still stand", IN_PARALLEL, () => {
  const headOf = (repo) => git(repo.dir, "rev-parse", "HEAD");

  function committed(repo, text = "committed\n") {
    writeFileSync(join(repo.dir, "a.txt"), text);
    git(repo.dir, "commit", "-q", "-am", "a checkpoint");
    return headOf(repo);
  }

  const withLedger = (repo, fields) => writeLedger(repo.ledgerPath, { ...repo.ledger(), ...fields });

  test("a commit that left HEAD's history is refused by name, and the record stays", () => {
    const repo = makeRepo();
    const lost = committed(repo);
    withLedger(repo, { commits: [lost] });
    git(repo.dir, "reset", "-q", "--hard", "HEAD~1");

    assertRefused(taskEnd(repo), new RegExp(lost));
    assertRunKept(repo);
  });

  test("only the missing commits are named", () => {
    const repo = makeRepo();
    const kept = committed(repo, "kept\n");
    const lost = committed(repo, "lost\n");
    withLedger(repo, { commits: [kept, lost] });
    git(repo.dir, "reset", "-q", "--hard", "HEAD~1");

    const result = taskEnd(repo);

    assertRefused(result, new RegExp(lost));
    assert.ok(!result.stderr.includes(kept), "a commit still on HEAD is not named");
  });

  test("a commit git no longer knows counts as missing", () => {
    const repo = makeRepo();
    const gone = "0123456789abcdef0123456789abcdef01234567";
    withLedger(repo, { commits: [gone] });

    assertRefused(taskEnd(repo), new RegExp(gone));
  });

  test("commits still on HEAD pass, with later commits on top", () => {
    const repo = makeRepo();
    const kept = committed(repo);
    withLedger(repo, { commits: [kept] });
    committed(repo, "later\n");

    ok(repo);
  });

  const greenRun = (head, over = {}) => ({ stage: NET, attempt: 1, passed: true, red: false, runs: [], head, ...over });

  test("a commit after the green run is refused, naming both, what a human can type, and nothing moves", () => {
    const repo = makeRepo();
    const tested = headOf(repo);
    withLedger(repo, { tests: { full: greenRun(tested) } });
    const moved = committed(repo);

    const result = taskEnd(repo);

    assertRefused(result, new RegExp(`${tested}.*${moved}`));
    assert.match(result.stderr, /test --full/);
    assertRunKept(repo);
  });

  test("the suite a human re-runs on the new HEAD lets the task end", () => {
    const repo = makeRepo({ ledger: FINISHED });
    withLedger(repo, { tests: { full: greenRun(headOf(repo)) } });
    committed(repo);
    assertRefused(taskEnd(repo), /test --full/);

    assert.equal(pb(repo, "test", "--full").status, 0);

    ok(repo);
  });

  test("a failed run on the current HEAD is refused", () => {
    const repo = makeRepo();
    withLedger(repo, { tests: { full: greenRun(headOf(repo), { passed: false }) } });

    assertRefused(taskEnd(repo), /full suite/);
    assertRunKept(repo);
  });

  test("the green run's own HEAD passes", () => {
    const repo = makeRepo();
    withLedger(repo, { tests: { full: greenRun(headOf(repo)) } });

    ok(repo);
  });

  test("the commit check comes before the dirty tree, so a reset is named first", () => {
    const repo = makeRepo();
    const lost = committed(repo);
    withLedger(repo, { commits: [lost] });
    git(repo.dir, "reset", "-q", "--hard", "HEAD~1");
    writeFileSync(join(repo.dir, "leftover.txt"), "x\n");

    const result = taskEnd(repo);

    assertRefused(result, new RegExp(lost));
    assert.ok(!result.stderr.includes("leftover.txt"));
  });
});

describe("gates and stages come first", IN_PARALLEL, () => {
  const stageAt = (name, status) => ({ name, status, runId: "wf_2", attempt: 1, startedAt: null });

  for (const [name, ledger, pattern] of [
    ["no stage has run", { stage: stageAt("", ""), stages: [], gates: {} }, /code-config.*not done|not finished/],
    ["config is done and safety-net never ran", { stage: stageAt(CONFIG, "done"), stages: [DONE_STAGES[0]], gates: {} }, /code-safety-net/],
    ["safety-net is active", { stage: stageAt(NET, "active"), stages: [DONE_STAGES[0]], gates: {} }, /code-safety-net/],
    ["safety-net failed", { stage: stageAt(NET, "failed"), stages: [DONE_STAGES[0], { ...DONE_STAGES[1], status: "failed" }], gates: {} }, /code-safety-net/],
    ["a human sent safety-net back", { stage: stageAt(NET, "redo"), stages: [DONE_STAGES[0], { ...DONE_STAGES[1], status: "redo" }], gates: {} }, /code-safety-net/],
  ]) {
    test(`refused when ${name}`, () => {
      const repo = makeRepo({ ledger });

      assertRefused(taskEnd(repo), pattern);
      assertRunKept(repo);
    });
  }

  for (const [name, ledger, pattern] of [
    ["the gate has not been evaluated", { ...FINISHED, gates: {} }, /G:task-end/],
    ["the gate waits for a human", { ...FINISHED, gates: {}, needsHuman: { gate: GATE, reason: "the gate policy is default, not auto", seq: 1 } }, /G:task-end/],
    ["a human answered stop", { ...FINISHED, gates: { [GATE]: { source: "human", answer: "stop" } }, stop: { reason: "the human answered stop at G:task-end", seq: 1, code: HUMAN_STOPPED } }, /stop/],
    ["the run has stopped", { ...FINISHED, stop: { reason: "the commit could not be signed", seq: 1, code: COMMIT_FAILED } }, /could not be signed/],
  ]) {
    test(`refused when ${name}`, () => {
      const repo = makeRepo({ ledger });

      assertRefused(taskEnd(repo), pattern);
      assertRunKept(repo);
    });
  }

  test("a human approval counts as passing the gate", () => {
    const repo = makeRepo({ ledger: { ...FINISHED, gates: { [GATE]: { source: "human-cli", answer: "approve" } } } });

    ok(repo);
  });

  test("an unpassed gate is reported before a dirty tree", () => {
    const repo = makeRepo({ ledger: { ...FINISHED, gates: {} } });
    writeFileSync(join(repo.dir, "leftover.txt"), "x\n");

    const result = taskEnd(repo);

    assertRefused(result, /G:task-end/);
    assert.ok(!result.stderr.includes("leftover.txt"), "the gate speaks first");
  });

  test("an unfinished stage is reported before the gate", () => {
    const repo = makeRepo({ ledger: { stage: stageAt(NET, "active"), stages: [DONE_STAGES[0]], gates: {} } });

    const result = taskEnd(repo);

    assertRefused(result, /code-safety-net/);
    assert.ok(!result.stderr.includes("G:task-end"), "the stage speaks first");
  });

  test("a hand-edited ledger is refused", () => {
    const repo = makeRepo();
    writeFileSync(repo.ledgerPath, readFileSync(repo.ledgerPath, "utf8").replace('"task": "Task 31"', '"task": "Edited"'));

    assertRefused(taskEnd(repo), /human accept/);
    assertRunKept(repo);
  });

  test("no run here", () => {
    const dir = makeDir("pb-no-run-");
    git(dir, "init", "-q", "-b", "feature");

    assertRefused(pb({ dir }, "task", "end"), /no run here/);
  });

  test("arguments are refused", () => {
    const repo = makeRepo();

    assertRefused(pb(repo, "task", "end", "--force"), /usage: pb task end/, 2);
    assertRunKept(repo);
  });
});

const PLAN_PATH = "plan.md";
const TITLE = "Task 2: The second task";
const PLAN_TEXT = ["# Plan", "", "- [x] **Task 1: The first task**", "", "  **Goal:** done.", "", `- [ ] **${TITLE}**`, "", "- [ ] **Task 3: The third task**", ""].join("\n");
const planLedger = (title = TITLE, path = PLAN_PATH) => ({ ...FINISHED, plan: { path, title } });
const planOf = (repo) => readFileSync(join(repo.dir, PLAN_PATH), "utf8");
const untouchedPlanRepo = (ledger = planLedger(), text = PLAN_TEXT) => makeRepo({ ledger, tracked: { [PLAN_PATH]: text } });

describe("the plan checkbox", IN_PARALLEL, () => {
  test("the box with this title is ticked, and nothing else in the plan changes", () => {
    const repo = untouchedPlanRepo();

    const printed = ok(repo);

    assert.equal(planOf(repo), PLAN_TEXT.replace(`- [ ] **${TITLE}**`, `- [x] **${TITLE}**`));
    assert.deepEqual(printed.plan, { path: PLAN_PATH, title: TITLE, ticked: true });
    assert.equal(existsSync(repo.taskDir), false);
  });

  test("a title with no bold still matches", () => {
    const repo = untouchedPlanRepo(planLedger("Plain"), "- [ ] Plain\n- [ ] Other\n");

    ok(repo);

    assert.equal(planOf(repo), "- [x] Plain\n- [ ] Other\n");
  });

  test("a title holding regex characters is taken literally", () => {
    const title = "Task (1): a.b*";
    const repo = untouchedPlanRepo(planLedger(title), `- [ ] **Task (1): aXbbb**\n- [ ] **${title}**\n`);

    ok(repo);

    assert.equal(planOf(repo), `- [ ] **Task (1): aXbbb**\n- [x] **${title}**\n`);
  });

  test("a box already ticked is left alone, so a repeat after a crash still ends the task", () => {
    const text = PLAN_TEXT.replace(`- [ ] **${TITLE}**`, `- [x] **${TITLE}**`);
    const repo = untouchedPlanRepo(planLedger(), text);

    const printed = ok(repo);

    assert.equal(planOf(repo), text);
    assert.equal(printed.plan.ticked, false);
    assert.equal(existsSync(repo.taskDir), false);
  });

  test("no plan writes nothing about one", () => {
    const repo = makeRepo({ tracked: { [PLAN_PATH]: PLAN_TEXT } });

    const printed = ok(repo);

    assert.equal(planOf(repo), PLAN_TEXT);
    assert.equal(printed.plan, null);
  });

  for (const [name, repoOf, pattern] of [
    ["no box has the title", () => untouchedPlanRepo(planLedger("Task 9: Gone")), /Task 9: Gone/],
    ["two boxes have the title", () => untouchedPlanRepo(planLedger(), `${PLAN_TEXT}- [ ] **${TITLE}**\n`), /2 boxes/],
    ["the plan file is gone", () => makeRepo({ ledger: planLedger() }), /plan\.md/],
    ["the plan is outside the repo", () => makeRepo({ ledger: planLedger(TITLE, "../plan.md") }), /outside the repo/],
  ]) {
    test(`refused when ${name}, with the run kept`, () => {
      const repo = repoOf();

      assertRefused(taskEnd(repo), pattern);
      assertRunKept(repo);
    });
  }

  test("a plan linked to a file outside the repo is refused, and that file is left alone", () => {
    const outside = join(makeDir("pb-plan-outside-"), "plan.md");
    writeFileSync(outside, PLAN_TEXT);
    const repo = makeRepo({ ledger: planLedger() });
    symlinkSync(outside, join(repo.dir, PLAN_PATH));
    git(repo.dir, "add", PLAN_PATH);
    git(repo.dir, "commit", "-q", "-m", "link the plan");

    assertRefused(taskEnd(repo), /symlink/);

    assertRunKept(repo);
    assert.equal(readFileSync(outside, "utf8"), PLAN_TEXT);
  });

  test("a dirty tree leaves the box unticked", () => {
    const repo = untouchedPlanRepo();
    writeFileSync(join(repo.dir, "leftover.txt"), "x\n");

    assertRefused(taskEnd(repo), /leftover\.txt/);
    assert.equal(planOf(repo), PLAN_TEXT);
  });

  test("an unpassed gate leaves the box unticked", () => {
    const repo = untouchedPlanRepo({ ...planLedger(), gates: {} });

    assertRefused(taskEnd(repo), /G:task-end/);
    assert.equal(planOf(repo), PLAN_TEXT);
  });

  test("a ledger.plan title naming a human task is refused by name, and nothing is touched", () => {
    const humanTitle = "Task 4: [HUMAN] Sign it";
    const humanPlan = `${PLAN_TEXT}- [ ] **${humanTitle}**\n`;
    const repo = untouchedPlanRepo(planLedger(humanTitle), humanPlan);
    const unitPath = unitFile(repo);
    const unitText = JSON.stringify({ base: "feature", baseSha: git(repo.dir, "rev-parse", "HEAD"), tasks: [], commits: [] });
    writeFileSync(unitPath, unitText);

    const result = taskEnd(repo);

    assertRefused(result, /Task 4: \[HUMAN\] Sign it/);
    assert.match(result.stderr, /human task/);
    assert.match(result.stderr, /only a person ticks/);
    assert.equal(planOf(repo), humanPlan);
    assertRunKept(repo);
    assert.equal(readFileSync(unitPath, "utf8"), unitText);
  });
});

describe("pb task end is the only checkbox writer", IN_PARALLEL, () => {
  const GATE_HOOK = join(ROOT, "hooks", "gate-boot.mjs");
  const SOURCE_DIRS = ["cli", "hooks", "shared-node"];
  const WRITER = "shared-node/plan-boxes.mjs";

  function gateCall(repo, payload) {
    const input = JSON.stringify({ session_id: "s1", cwd: repo.dir, permission_mode: "auto", ...payload });
    return JSON.parse(spawnSync("node", [GATE_HOOK], { input, encoding: "utf8", env: env() }).stdout || "{}").hookSpecificOutput;
  }

  const tickingWrite = (repo) => ({ tool_name: "Write", tool_input: { file_path: join(repo.dir, PLAN_PATH), content: PLAN_TEXT.replace(`- [ ] **${TITLE}**`, `- [x] **${TITLE}**`) } });

  test("the gate denies a tool that ticks the box, and pb task end ticks it", () => {
    const repo = untouchedPlanRepo();

    assert.equal(gateCall(repo, tickingWrite(repo)).permissionDecision, "deny");
    assert.equal(planOf(repo), PLAN_TEXT);

    ok(repo);

    assert.match(planOf(repo), /- \[x\] \*\*Task 2/);
  });

  test("the gate denies a subagent too", () => {
    const repo = untouchedPlanRepo();

    assert.equal(gateCall(repo, { ...tickingWrite(repo), agent_id: "a1", agent_type: "pairingbuddy:apply-config-change" }).permissionDecision, "deny");
  });

  test("the runner cannot end a task", () => {
    const repo = untouchedPlanRepo();
    const payload = { tool_name: "Bash", tool_input: { command: `node ${CLI} task end` }, agent_id: "a1", agent_type: "pairingbuddy:runner" };

    const decision = gateCall(repo, payload);

    assert.equal(decision.permissionDecision, "deny");
    assert.match(decision.permissionDecisionReason, /main context/);
  });

  test("only the plan-box module ticks, and only pb task end calls it", () => {
    const sources = SOURCE_DIRS.flatMap((dir) => readdirSync(join(ROOT, dir)).filter((name) => name.endsWith(".mjs")).map((name) => `${dir}/${name}`));
    const callers = sources.filter((path) => path !== WRITER && readFileSync(join(ROOT, path), "utf8").includes("tickPlanBox("));

    assert.deepEqual(callers, ["cli/pb.mjs"]);
    const cli = readFileSync(CLI, "utf8");
    assert.equal(cli.split("tickPlanBox(").length - 1, 1, "one call site");
    assert.match(cli, /function tickedPlan[^]*tickPlanBox\([^]*function taskEnd/, "it sits in the task end path");
  });
});

describe("the real verbs carry a no-change docs step to the end", () => {
  const key = (stage, role) => `${stage}.${role}.-.r1.a1`;
  const CONFIG_KEY = key(CONFIG, "apply-config-change");
  const DOCS_KEY = key(NET, "update-documentation");

  const writeReturn = (repo, pbKey, fields) => writeFileSync(join(repo.taskDir, "artifacts", `${pbKey}.json`), JSON.stringify({ pb_key: pbKey, ...fields }));

  function run(repo, ...args) {
    const result = pb(repo, ...args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    return JSON.parse(result.stdout);
  }

  test("one commit, a passed gate and a clean end", () => {
    const repo = makeRepo({ ledger: { stage: { name: CONFIG, status: "active", runId: "wf_1", attempt: 1, startedAt: null } } });
    const before = git(repo.dir, "rev-list", "--count", "HEAD");
    writeFileSync(join(repo.dir, "a.txt"), "changed\n");
    writeReturn(repo, CONFIG_KEY, { ambiguity: "", commit_subject: "set a", files_changed: ["a.txt"] });

    assert.equal(run(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY).committed, true);
    run(repo, "stage", "finish");

    const ledger = repo.ledger();
    writeLedger(repo.ledgerPath, { ...ledger, stage: { name: NET, status: "active", runId: "wf_2", attempt: 1, startedAt: null } });
    writeReturn(repo, DOCS_KEY, { commit_subject: "", files_changed: [] });

    assert.equal(run(repo, "checkpoint", "--step", "docs", "--from", DOCS_KEY).committed, false);
    run(repo, "test", "--full");
    recordCleanLensReturns(repo, NET, "config_change", 1);
    run(repo, "stage", "finish");
    assert.equal(run(repo, "gate", "eval").result, "auto-pass");
    run(repo, "task", "end");

    assert.equal(existsSync(repo.taskDir), false);
    assert.equal(Number(git(repo.dir, "rev-list", "--count", "HEAD")) - Number(before), 1);
    assert.equal(git(repo.dir, "log", "-1", "--format=%s"), "chore: set a");
  });

  test("a no-change config step with an ambiguity reaches the gate, which asks a human", () => {
    const repo = makeRepo({ ledger: { stage: { name: CONFIG, status: "active", runId: "wf_1", attempt: 1, startedAt: null } } });
    writeReturn(repo, CONFIG_KEY, { ambiguity: "The edit was refused.", commit_subject: "", files_changed: [] });

    assert.equal(run(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY).committed, false);
    run(repo, "stage", "finish");

    const ledger = repo.ledger();
    writeLedger(repo.ledgerPath, { ...ledger, stage: { name: NET, status: "active", runId: "wf_2", attempt: 1, startedAt: null } });
    writeReturn(repo, DOCS_KEY, { commit_subject: "", files_changed: [] });
    run(repo, "checkpoint", "--step", "docs", "--from", DOCS_KEY);
    run(repo, "test", "--full");
    run(repo, "stage", "finish");

    const gate = run(repo, "gate", "eval");

    assert.equal(gate.result, "needs-human");
    assert.match(gate.reason, /ambiguity/);
  });
});

describe("the task record carries the full-suite result", IN_PARALLEL, () => {
  // A repo whose task is finished and whose unit is open, with the full-suite result pb test --full records.
  function finishedTaskInUnit(extraLedger = {}) {
    const repo = makeRepoWithRemote({ openTask: false, remote: true });
    const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
    assert.equal(opened.status, 0, `unit open: ${opened.stderr}`);
    const run = pb(repo, "run", "open", "--kind", "code");
    assert.equal(run.status, 0, `run open: ${run.stderr}`);
    const head = git(repo.dir, "rev-parse", "HEAD");
    const configText = readFileSync(join(repo.dir, ".pairingbuddy", "test-config.json"), "utf8");
    writeLedger(join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json"), withIntake({
      ...repo.ledger(),
      task: "Task A",
      configHash: createHash("sha256").update(configText).digest("hex"),
      ...FINISHED,
      tests: { full: { stage: NET, attempt: 1, passed: true, red: false, runs: [], head } },
      ...extraLedger,
    }));
    return { repo, head };
  }

  test("task-end-records-full-suite-result", () => {
    const { repo, head } = finishedTaskInUnit();

    ok(repo);

    const [record] = readUnitRecord(repo).tasks;
    assert.deepEqual(record.fullSuite, { passed: true, head }, "the task record carries the full-suite result of the task ledger");
  });

  test("task_end_record_carries_lenses", () => {
    const lenses = { "safety-net": { stage: NET, attempt: 1, lenses: [{ name: "config-fit", model: "sonnet" }], survivors: 0, refuted: 0, unrefuted: 0, uncovered: [] } };
    const { repo } = finishedTaskInUnit({ lenses });

    ok(repo);

    const [record] = readUnitRecord(repo).tasks;
    assert.deepEqual(record.lenses, lenses, "the task record carries the lens record of the task ledger");
  });
});
