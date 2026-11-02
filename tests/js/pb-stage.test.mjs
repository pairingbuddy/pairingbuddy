// Task 30: pb stage finish, stage report, stage fail, artifact check and status. Every test drives the real CLI and the
// real hooks as subprocesses, in a temp git repo with a real ledger.
//
// Output contract: each verb prints one JSON object with ok: true and exits 0. A refusal exits 1 and prints nothing to
// stdout. Bad arguments exit 2.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { loadStages, pipelineAgents, validateStages } from "../../shared-node/stages.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const GATE = join(ROOT, "hooks", "gate-boot.mjs");
const TAP = join(ROOT, "hooks", "tap.mjs");
const CONFIG = "code-config";
const NET = "code-safety-net";
const ATTEMPT = 2;
const key = (stage, role, attempt = ATTEMPT, round = 1) => `${stage}.${role}.-.r${round}.a${attempt}`;
const CONFIG_KEY = key(CONFIG, "apply-config-change");
const DOCS_KEY = key(NET, "update-documentation");
const RUNNER_AGENT = "pairingbuddy:runner";
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

// A plugin of its own, so that a test can start a stage with no real agents behind its bundle.
function makePlugin() {
  const dir = makeDir("pb-plugin-");
  cpSync(join(ROOT, "contracts"), join(dir, "contracts"), { recursive: true });
  mkdirSync(join(dir, "workflows"));
  for (const stage of [CONFIG, NET]) writeFileSync(join(dir, "workflows", `${stage}.js`), `// ${stage}\n`);
  return dir;
}

const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: env(), stdio: ["ignore", "pipe", "pipe"] }).trim();

const activeStage = (name = CONFIG, attempt = ATTEMPT) => ({ name, status: "active", runId: "wf_1", attempt, startedAt: null });

function makeRepo({ stage = activeStage(), ledger = {}, tests = "" } = {}) {
  const dir = makeDir("pb-stage-");
  git(dir, "init", "-q", "-b", "feature");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, "a.txt"), "a\n");
  writeFileSync(join(dir, "fake.mjs"), tests);
  git(dir, "add", "a.txt", "fake.mjs");
  git(dir, "commit", "-q", "-m", "seed");
  const seed = git(dir, "rev-parse", "HEAD");
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  const configText = JSON.stringify(TEST_CONFIG);
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), configText);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "Task 30", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(configText).digest("hex"), policy: { mode: "auto", source: "permission_mode" },
    stage, stages: [], gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    ...ledger,
    tests: Object.fromEntries(Object.entries(ledger.tests ?? {}).map(([name, record]) => [name, { head: seed, ...record }])),
  });
  return {
    dir, taskDir, ledgerPath,
    ledger: () => readLedger(ledgerPath),
    reportPath: join(taskDir, "report.json"),
    report: () => JSON.parse(readFileSync(join(taskDir, "report.json"), "utf8")),
  };
}

function writeReturn(repo, pbKey, fields = {}) {
  writeFileSync(join(repo.taskDir, "artifacts", `${pbKey}.json`), JSON.stringify({ pb_key: pbKey, ambiguity: "", commit_subject: "set a", files_changed: ["a.txt"], ...fields }));
}

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: env() });
  return { code: status, stdout, stderr };
}

function ok(repo, ...args) {
  const result = pb(repo, ...args);
  assert.equal(result.code, 0, `pb ${args.join(" ")}, stderr: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assertRefused(result, pattern, code = 1) {
  assert.equal(result.code, code, `exits ${code}: stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.equal(result.stdout, "", "prints no result");
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /unexpected failure/, "it is not a crash");
}

function hook(file, payload, pluginRoot = ROOT) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [file], { cwd: payload.cwd, input: JSON.stringify(payload), encoding: "utf8", timeout: 30_000, env: env({ CLAUDE_PLUGIN_ROOT: pluginRoot }) });
  assert.equal(status, 0, `hook exit, stderr: ${stderr}`);
  return stdout;
}

const payload = (repo, tool, toolInput, extra = {}) => ({ session_id: "s1", cwd: repo.dir, permission_mode: "auto", tool_name: tool, tool_input: toolInput, ...extra });

function decision(stdout) {
  if (stdout === "") return { kind: "none", reason: "" };
  const { permissionDecision, permissionDecisionReason } = JSON.parse(stdout).hookSpecificOutput;
  return { kind: permissionDecision, reason: permissionDecisionReason };
}

function startStage(repo, plugin, stage, attempt) {
  return decision(hook(GATE, payload(repo, "Workflow", { name: `pairingbuddy:${stage}`, args: { pluginRoot: plugin, attempt } }), plugin));
}

// The agent the key names, unless a test says otherwise.
function deliverReturn(repo, pbKey, fields = {}, agent = { agent_id: "a1", agent_type: `pairingbuddy:${pbKey.split(".")[1]}` }) {
  hook(TAP, payload(repo, "StructuredOutput", { pb_key: pbKey, ambiguity: "", ...fields }, agent));
}

function recordRun(repo, stage, attempt, runId) {
  hook(TAP, payload(repo, "Workflow", { name: `pairingbuddy:${stage}`, args: { attempt } }, { tool_response: { runId } }));
}

const artifactExists = (repo, pbKey) => existsSync(join(repo.taskDir, "artifacts", `${pbKey}.json`));

function finishableConfig(over = {}) {
  const repo = makeRepo(over);
  writeReturn(repo, CONFIG_KEY);
  writeFileSync(join(repo.dir, "a.txt"), "changed\n");
  ok(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY);
  return repo;
}

function finishedConfig(over = {}) {
  const repo = finishableConfig(over);
  ok(repo, "stage", "finish");
  return repo;
}

// config done at attempt 1, and the ledger at the given safety-net stage.
const atSafetyNet = (stage) => makeRepo({ stage, ledger: { stages: [{ name: CONFIG, status: "done", attempt: 1 }] } });

const fullRun = (over = {}) => ({ stage: NET, attempt: ATTEMPT, passed: true, red: false, runs: [{ runner: "fake", argv: ["node"], exitCode: 0, signal: null, timedOut: false, durationMs: 1, excerpt: "all good", excerptTruncated: false }], ...over });

// ---------- the contract ----------

const docsCheckpoint = { step: "docs", key: DOCS_KEY, committed: false, sha: null, stage: NET, attempt: ATTEMPT };

describe("evidence entries are machine-checked", () => {
  const withEvidence = (entry) => {
    const contract = structuredClone(loadStages(ROOT));
    contract.taskTypes.config_change.nodes[0].evidence = [entry];
    return contract;
  };

  test("the real contract's entries are all known, and its roles are real agents", () => {
    const nodes = loadStages(ROOT).taskTypes.config_change.nodes;
    assert.deepEqual(validateStages(loadStages(ROOT)), []);
    const roles = nodes.flatMap((node) => node.evidence).filter((entry) => entry.startsWith("artifact:")).map((entry) => entry.slice("artifact:".length));
    assert.ok(roles.length > 0);
    for (const role of roles) assert.ok(pipelineAgents(ROOT).has(role), `${role} is an agent`);
  });

  for (const entry of ["checkpoint", "checkpoint:lunch", "artifact:", "artifact:No Such", "tests:", "tests:some", "tests", "whatever", 3]) {
    test(`the entry ${JSON.stringify(entry)} is refused`, () => {
      assert.match(validateStages(withEvidence(entry)).join("\n"), /unknown evidence/);
    });
  }

  for (const entry of ["checkpoint:config", "artifact:runner", "tests:full", "tests:selected"]) {
    test(`the entry ${entry} is accepted`, () => {
      assert.deepEqual(validateStages(withEvidence(entry)), []);
    });
  }

  test("the contract states maxAgents", () => {
    assert.ok(Number.isInteger(loadStages(ROOT).maxAgents));
  });
});

// ---------- stage finish ----------

describe("stage finish refuses without its evidence, and leaves a stop", IN_PARALLEL, () => {
  function assertStops(repo, pattern) {
    const before = repo.ledger().stage;
    assertRefused(pb(repo, "stage", "finish"), pattern);
    const ledger = repo.ledger();
    assert.match(ledger.stop.reason, pattern);
    assert.deepEqual(ledger.stage, before, "the stage stays as it was");
    assert.equal(ledger.stages.length, 0, "no stage is recorded done");
    assert.equal(existsSync(repo.reportPath), false, "no report is written");
  }

  test("a missing artifact", () => {
    const repo = makeRepo();
    assertStops(repo, /artifact:apply-config-change/);
  });

  test("an artifact from another attempt, naming that attempt", () => {
    const repo = makeRepo();
    writeReturn(repo, key(CONFIG, "apply-config-change", ATTEMPT - 1));
    assertStops(repo, /attempt 1.*attempt 2|attempt 2.*attempt 1/);
  });

  test("an artifact from another stage at this attempt", () => {
    const repo = makeRepo();
    writeReturn(repo, key(NET, "apply-config-change"));
    assertStops(repo, /artifact:apply-config-change/);
  });

  test("an artifact that cannot be read", () => {
    const repo = makeRepo();
    writeFileSync(join(repo.taskDir, "artifacts", `${CONFIG_KEY}.json`), "{nope");
    assertStops(repo, /artifact:apply-config-change/);
  });

  test("an artifact whose pb_key is not its name", () => {
    const repo = makeRepo();
    writeFileSync(join(repo.taskDir, "artifacts", `${CONFIG_KEY}.json`), JSON.stringify({ pb_key: key(CONFIG, "apply-config-change", 1) }));
    assertStops(repo, /artifact:apply-config-change/);
  });

  test("no checkpoint", () => {
    const repo = makeRepo();
    writeReturn(repo, CONFIG_KEY);
    assertStops(repo, /checkpoint:config/);
  });

  test("a checkpoint from another attempt", () => {
    const repo = makeRepo({ ledger: { checkpoints: [{ step: "config", key: key(CONFIG, "apply-config-change", 1), stage: CONFIG, attempt: 1, committed: false, sha: null }] } });
    writeReturn(repo, CONFIG_KEY);
    assertStops(repo, /checkpoint:config/);
  });

  test("a checkpoint whose tests failed is no evidence", () => {
    const repo = makeRepo({ tests: "process.exit(1);" });
    writeReturn(repo, CONFIG_KEY);
    writeFileSync(join(repo.dir, "a.txt"), "changed\n");
    assertRefused(pb(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY), /tests failed/);
    assertStops(repo, /checkpoint:config/);
  });

  const docsRepo = (full) => {
    const repo = makeRepo({ stage: activeStage(NET), ledger: { tests: full === undefined ? {} : { full } } });
    writeReturn(repo, DOCS_KEY);
    return repo;
  };

  test("no docs checkpoint", () => {
    const repo = makeRepo({ stage: activeStage(NET), ledger: { tests: { full: fullRun() } } });
    writeReturn(repo, DOCS_KEY);
    assertStops(repo, /checkpoint:docs/);
  });

  test("no full suite", () => assertStops(docsRepo(), /tests:full/));

  test("a full suite from another attempt", () => assertStops(docsRepo(fullRun({ attempt: 1 })), /tests:full/));

  test("a full suite from another stage", () => assertStops(docsRepo(fullRun({ stage: CONFIG })), /tests:full/));

  test("a full suite that failed", () => assertStops(docsRepo(fullRun({ passed: false })), /tests:full/));

  test("a full suite that ran before HEAD moved, naming both", () => {
    const repo = docsRepo(fullRun());
    const stale = git(repo.dir, "rev-parse", "HEAD");
    git(repo.dir, "commit", "-q", "--allow-empty", "-m", "a commit from the main context");
    writeLedgerField(repo, { checkpoints: [docsCheckpoint] });

    assertStops(repo, new RegExp(`tests:full.*${stale}.*${git(repo.dir, "rev-parse", "HEAD")}`));
  });

  test("a full suite with no recorded HEAD", () => {
    const repo = docsRepo(fullRun({ head: null }));
    writeLedgerField(repo, { checkpoints: [docsCheckpoint] });

    assertStops(repo, /tests:full/);
  });

  test("a missing docs return, with the rest of the evidence in place", () => {
    const repo = makeRepo({ stage: activeStage(NET), ledger: { checkpoints: [docsCheckpoint], tests: { full: fullRun() } } });

    assertStops(repo, /artifact:update-documentation/);
  });

  test("a stage with no recorded run, whatever its returns", () => {
    const repo = makeRepo({ stage: { ...activeStage(), runId: null } });
    writeReturn(repo, CONFIG_KEY);
    assertStops(repo, /no recorded run/);
  });

  test("every gap is named at once", () => {
    const repo = makeRepo();
    assertStops(repo, /artifact:apply-config-change.*checkpoint:config/);
  });
});

describe("safety-net's own order keeps its green run", IN_PARALLEL, () => {
  test("a docs commit, then the full suite, then finish", () => {
    const repo = makeRepo({ stage: activeStage(NET) });
    writeReturn(repo, DOCS_KEY);
    writeFileSync(join(repo.dir, "a.txt"), "documented\n");

    assert.equal(ok(repo, "checkpoint", "--step", "docs", "--from", DOCS_KEY).committed, true);
    const { head } = ok(repo, "test", "--full");
    ok(repo, "stage", "finish");

    assert.equal(head, git(repo.dir, "rev-parse", "HEAD"));
    assert.equal(repo.ledger().stage.status, "done");
  });

  test("a stage fail after HEAD moved runs safety-net again from the new HEAD", () => {
    const plugin = makePlugin();
    const repo = makeRepo({ stage: activeStage(NET, 1), ledger: { stages: [{ name: CONFIG, status: "done", attempt: 1 }] } });
    const firstKey = key(NET, "update-documentation", 1);
    writeReturn(repo, firstKey, { files_changed: [] });
    ok(repo, "checkpoint", "--step", "docs", "--from", firstKey);
    ok(repo, "test", "--full");
    git(repo.dir, "commit", "-q", "--allow-empty", "-m", "a commit from the main context");
    assertRefused(pb(repo, "stage", "finish"), /tests:full/);

    ok(repo, "stage", "fail");
    startStage(repo, plugin, NET, 2);
    recordRun(repo, NET, 2, "wf_2");
    writeReturn(repo, DOCS_KEY, { files_changed: [] });
    ok(repo, "checkpoint", "--step", "docs", "--from", DOCS_KEY);
    ok(repo, "test", "--full");

    ok(repo, "stage", "finish");
    assert.equal(repo.ledger().stage.status, "done");
  });
});

describe("stage finish", IN_PARALLEL, () => {
  test("marks the stage done at this attempt and stamps the report", () => {
    const repo = finishableConfig();

    const result = ok(repo, "stage", "finish");

    assert.equal(result.stage, CONFIG);
    assert.equal(result.attempt, ATTEMPT);
    const ledger = repo.ledger();
    assert.equal(ledger.stage.status, "done");
    assert.equal(ledger.stop, null);
    const [entry] = ledger.stages;
    assert.deepEqual([entry.name, entry.status, entry.attempt], [CONFIG, "done", ATTEMPT]);
    const report = repo.report();
    assert.deepEqual([report.stage, report.attempt, report.runId], [CONFIG, ATTEMPT, "wf_1"]);
  });

  test("a config checkpoint with no change is evidence when the return says why", () => {
    const repo = makeRepo();
    writeReturn(repo, CONFIG_KEY, { files_changed: [], ambiguity: "Which file did the task mean?" });
    assert.equal(ok(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY).committed, false);

    ok(repo, "stage", "finish");

    assert.deepEqual(repo.report().ran.checkpoints.map(({ committed }) => committed), [false]);
    assert.equal(repo.ledger().stage.status, "done");
  });

  test("a docs checkpoint with no change is evidence as it stands", () => {
    const repo = makeRepo({ stage: activeStage(NET), ledger: { stages: [{ name: CONFIG, status: "done", attempt: 1 }], tests: { full: fullRun() } } });
    writeReturn(repo, DOCS_KEY, { files_changed: [] });
    assert.equal(ok(repo, "checkpoint", "--step", "docs", "--from", DOCS_KEY).committed, false);

    ok(repo, "stage", "finish");

    assert.equal(repo.ledger().stage.status, "done");
  });

  for (const [name, arrange] of [
    ["a return listing a file the refused edit never changed", (repo) => writeReturn(repo, CONFIG_KEY)],
    ["a return saying nothing about its empty list", (repo) => writeReturn(repo, CONFIG_KEY, { files_changed: [] })],
    ["no return at all", () => {}],
  ]) {
    test(`${name} leaves code-config short of done until stage fail clears it`, () => {
      const repo = makeRepo();
      arrange(repo);

      const refused = pb(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY);

      assert.equal(refused.code, 1, refused.stdout);
      assert.notEqual(repo.ledger().stop, null, "the run stopped");
      assertRefused(pb(repo, "stage", "finish"), /stopped/);
      assert.equal(repo.ledger().stage.status, "active");
      assert.deepEqual(repo.ledger().stages.filter(({ status }) => status === "done"), []);

      ok(repo, "stage", "fail");

      assert.equal(repo.ledger().stop, null);
      assert.equal(repo.ledger().stage.status, "failed");
    });
  }

  test("takes the stage from the ledger, so it takes no argument", () => {
    for (const args of [["--stage", NET], [CONFIG], ["--attempt", "1"]]) {
      const repo = finishableConfig();
      const before = repo.ledger();
      assertRefused(pb(repo, "stage", "finish", ...args), /usage: pb stage finish/, 2);
      assert.deepEqual(repo.ledger(), before);
    }
  });

  test("refuses on a stopped run and keeps the stop", () => {
    const repo = finishableConfig();
    const stop = { reason: "signing failed", seq: 1 };
    writeLedgerField(repo, { stop });
    assertRefused(pb(repo, "stage", "finish"), /signing failed/);
    assert.equal(repo.ledger().stop.reason, stop.reason);
    assert.equal(repo.ledger().stage.status, "active");
  });

  for (const [state, prepare] of [
    ["a stage already done", (repo) => ok(repo, "stage", "finish")],
    ["a failed stage", (repo) => ok(repo, "stage", "fail")],
  ]) {
    test(`on ${state} it refuses and sets no stop, so an orphan cannot halt the run`, () => {
      const repo = finishableConfig();
      prepare(repo);
      const before = repo.ledger();
      assertRefused(pb(repo, "stage", "finish"), /no stage is active/);
      assert.deepEqual(repo.ledger(), before);
    });
  }

  test("refuses when nothing has started", () => {
    const repo = makeRepo({ stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null } });
    assertRefused(pb(repo, "stage", "finish"), /no stage is active/);
    assert.equal(repo.ledger().stop, null);
  });
});

function writeLedgerField(repo, fields) {
  writeLedger(repo.ledgerPath, { ...repo.ledger(), ...fields });
}

// ---------- stage order ----------

describe("stage order follows finish and fail through the real gate", IN_PARALLEL, () => {
  test("after finish the next stage opens at attempt 1", () => {
    const plugin = makePlugin();
    const repo = finishedConfig();

    assert.notEqual(startStage(repo, plugin, CONFIG, ATTEMPT + 1).kind, "none");
    assert.equal(startStage(repo, plugin, NET, 1).kind, "none");

    assert.deepEqual([repo.ledger().stage.name, repo.ledger().stage.status, repo.ledger().stage.attempt], [NET, "active", 1]);
  });

  test("after fail the same stage restarts at attempt+1, and nothing else starts", () => {
    const plugin = makePlugin();
    const repo = makeRepo();
    ok(repo, "stage", "fail");

    assert.match(startStage(repo, plugin, CONFIG, ATTEMPT).reason, /Use attempt 3/);
    assert.match(startStage(repo, plugin, NET, 1).reason, /next stage is pairingbuddy:code-config/);
    assert.equal(startStage(repo, plugin, CONFIG, ATTEMPT + 1).kind, "none");

    assert.deepEqual([repo.ledger().stage.status, repo.ledger().stage.attempt], ["active", ATTEMPT + 1]);
  });

  test("a fail after a redo restarts one attempt further on", () => {
    const plugin = makePlugin();
    const repo = makeRepo({ stage: { ...activeStage(), attempt: 3 }, ledger: { stages: [{ name: CONFIG, status: "redo", attempt: 2 }] } });
    ok(repo, "stage", "fail");

    assert.equal(startStage(repo, plugin, CONFIG, 4).kind, "none");
  });
});

// ---------- stage fail ----------

describe("stage fail", IN_PARALLEL, () => {
  test("clears a stranded stage", () => {
    const repo = makeRepo();

    const result = ok(repo, "stage", "fail");

    assert.deepEqual([result.stage, result.attempt, result.nextAttempt], [CONFIG, ATTEMPT, ATTEMPT + 1]);
    const ledger = repo.ledger();
    assert.equal(ledger.stage.status, "failed");
    const [entry] = ledger.stages;
    assert.deepEqual([entry.name, entry.status, entry.attempt], [CONFIG, "failed", ATTEMPT]);
  });

  test("clears a stage that never recorded a run", () => {
    const repo = makeRepo({ stage: { ...activeStage(), runId: null } });
    ok(repo, "stage", "fail");
    assert.equal(repo.ledger().stage.status, "failed");
  });

  test("clears the stop a missing-evidence refusal left, so the run can go on", () => {
    const plugin = makePlugin();
    const repo = makeRepo();
    assertRefused(pb(repo, "stage", "finish"), /artifact:apply-config-change/);
    const { reason } = repo.ledger().stop;

    const result = ok(repo, "stage", "fail");

    assert.equal(result.clearedStop, reason);
    assert.equal(repo.ledger().stop, null);
    assert.equal(repo.ledger().stages[0].clearedStop, reason, "the ledger keeps what was cleared");
    assert.equal(startStage(repo, plugin, CONFIG, ATTEMPT + 1).kind, "none");
  });

  test("clears the stop a checkpoint left", () => {
    const repo = makeRepo({ ledger: { stop: { reason: "the commit could not be signed", seq: 1 } } });
    ok(repo, "stage", "fail");
    assert.equal(repo.ledger().stop, null);
  });

  test("leaves a human's stop alone, and says who can clear it", () => {
    const repo = makeRepo({
      stage: activeStage(NET),
      ledger: {
        stages: [{ name: CONFIG, status: "done", attempt: 1 }, { name: NET, status: "done", attempt: 1 }],
        gates: { "G:task-end": { source: "human", answer: "stop" } },
        stop: { reason: "the human answered stop at G:task-end", seq: 1 },
      },
    });
    const before = repo.ledger();

    assertRefused(pb(repo, "stage", "fail"), /human approve G:task-end/);

    assert.deepEqual(repo.ledger(), before);
  });

  for (const [state, stage] of [
    ["a done stage", { ...activeStage(), status: "done" }],
    ["a failed stage", { ...activeStage(), status: "failed" }],
    ["a stage a human sent back", { ...activeStage(), status: "redo" }],
    ["no stage", { name: "", status: "", runId: null, attempt: 0, startedAt: null }],
  ]) {
    test(`refuses on ${state}`, () => {
      const repo = makeRepo({ stage });
      const before = repo.ledger();
      assertRefused(pb(repo, "stage", "fail"), /no stage is active/);
      assert.deepEqual(repo.ledger(), before);
    });
  }

  const RAISED = { reason: "the commit failed: lint", seq: 1 };

  for (const [state, stage] of [
    ["a done stage", { ...activeStage(), status: "done" }],
    ["a failed stage", { ...activeStage(), status: "failed" }],
    ["a stage a human sent back", { ...activeStage(), status: "redo" }],
    ["no stage", { name: "", status: "", runId: null, attempt: 0, startedAt: null }],
  ]) {
    test(`clears a run-raised stop on ${state}, and closes nothing`, () => {
      const repo = makeRepo({ stage, ledger: { stop: RAISED } });

      const result = ok(repo, "stage", "fail");

      assert.equal(result.clearedStop, RAISED.reason);
      assert.equal(result.nextAttempt, null, "nothing was failed, so nothing restarts");
      assert.equal(repo.ledger().stop, null);
      assert.deepEqual(repo.ledger().stage, stage);
    });
  }

  test("a stop cleared on a done stage leaves that stage done, and says what was cleared", () => {
    const repo = makeRepo({ stage: { ...activeStage(), status: "done" }, ledger: { stages: [{ name: CONFIG, status: "done", attempt: ATTEMPT }], stop: RAISED } });

    ok(repo, "stage", "fail");

    const [entry] = repo.ledger().stages;
    assert.deepEqual([entry.status, entry.clearedStop], ["done", RAISED.reason]);
  });

  test("a human's stop stays refused once the stage is done", () => {
    const repo = makeRepo({
      stage: { ...activeStage(NET), status: "done" },
      ledger: {
        stages: [{ name: CONFIG, status: "done", attempt: 1 }, { name: NET, status: "done", attempt: ATTEMPT }],
        gates: { "G:task-end": { source: "human", answer: "stop" } },
        stop: { reason: "the human answered stop at G:task-end", seq: 1 },
      },
    });
    const before = repo.ledger();

    assertRefused(pb(repo, "stage", "fail"), /human approve G:task-end/);

    assert.deepEqual(repo.ledger(), before);
  });

  test("takes no argument", () => {
    const repo = makeRepo();
    assertRefused(pb(repo, "stage", "fail", "--stage", NET), /usage: pb stage fail/, 2);
    assert.equal(repo.ledger().stage.status, "active");
  });

  test("still counts what the failed attempt spent", () => {
    const repo = makeRepo();
    writeReturn(repo, CONFIG_KEY);
    ok(repo, "stage", "fail");
    assert.equal(repo.ledger().spend.agents, 1);
    assert.equal(repo.ledger().stages[0].spend.agents, 1);
  });
});

// ---------- late returns ----------

describe("a failed attempt stays void", IN_PARALLEL, () => {
  test("a late return at the failed attempt is not captured", () => {
    const repo = makeRepo();
    ok(repo, "stage", "fail");

    deliverReturn(repo, CONFIG_KEY);

    assert.equal(artifactExists(repo, CONFIG_KEY), false);
    assert.match(readFileSync(join(repo.taskDir, "tap-errors.log"), "utf8"), /voided/);
  });

  test("a late return is not captured once the next attempt has started", () => {
    const plugin = makePlugin();
    const repo = makeRepo();
    ok(repo, "stage", "fail");
    startStage(repo, plugin, CONFIG, ATTEMPT + 1);

    deliverReturn(repo, CONFIG_KEY);

    assert.equal(artifactExists(repo, CONFIG_KEY), false);
  });

  test("the last runner's return still lands after finish", () => {
    const repo = finishedConfig();
    const runnerKey = key(CONFIG, "runner", ATTEMPT, 2);

    deliverReturn(repo, runnerKey);

    assert.equal(artifactExists(repo, runnerKey), true);
  });

  test("returns from the failed attempt are no evidence at the next one", () => {
    const plugin = makePlugin();
    const repo = finishableConfig();
    ok(repo, "stage", "fail");
    startStage(repo, plugin, CONFIG, ATTEMPT + 1);

    assertRefused(pb(repo, "stage", "finish"), /artifact:apply-config-change.*checkpoint:config/);
  });

  test("a checkpoint cannot commit from the failed attempt", () => {
    const repo = makeRepo();
    writeReturn(repo, CONFIG_KEY);
    ok(repo, "stage", "fail");
    assertRefused(pb(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY), /no stage is active/);
  });

  const gateAsks = (repo) => {
    const result = ok(repo, "gate", "eval");
    return result.result === "needs-human" ? result.reason : null;
  };

  const doneNet = (attempt) => ({
    stage: { ...activeStage(NET, attempt), status: "done" },
    ledger: { stages: [{ name: CONFIG, status: "done", attempt: 1 }, { name: NET, status: "done", attempt }] },
  });

  test("a voided attempt's ambiguity stops counting in the gate", () => {
    const repo = makeRepo(doneNet(ATTEMPT));
    writeReturn(repo, key(NET, "update-documentation", ATTEMPT - 1), { ambiguity: "which file?" });
    assert.equal(gateAsks(repo), null);
    assert.equal(repo.ledger().gates["G:task-end"].source, "auto");
  });

  test("a voided attempt's unreadable return stops counting too", () => {
    const repo = makeRepo(doneNet(ATTEMPT));
    writeFileSync(join(repo.taskDir, "artifacts", `${key(NET, "update-documentation", ATTEMPT - 1)}.json`), "{nope");
    assert.equal(gateAsks(repo), null);
  });

  test("the standing attempt's ambiguity still asks", () => {
    const repo = makeRepo(doneNet(ATTEMPT));
    writeReturn(repo, DOCS_KEY, { ambiguity: "which file?" });
    assert.match(gateAsks(repo), /ambiguity/);
  });

  test("an earlier stage's standing ambiguity still asks at a later gate", () => {
    const repo = makeRepo(doneNet(ATTEMPT));
    writeReturn(repo, key(CONFIG, "apply-config-change", 1), { ambiguity: "which file?" });
    assert.match(gateAsks(repo), /ambiguity/);
  });

  test("an earlier stage's voided ambiguity does not", () => {
    const repo = makeRepo({ ...doneNet(ATTEMPT), ledger: { stages: [{ name: CONFIG, status: "done", attempt: 2 }, { name: NET, status: "done", attempt: ATTEMPT }] } });
    writeReturn(repo, key(CONFIG, "apply-config-change", 1), { ambiguity: "which file?" });
    assert.equal(gateAsks(repo), null);
  });

  test("a report stamped with a voided attempt stops counting", () => {
    const repo = makeRepo(doneNet(ATTEMPT));
    writeFileSync(repo.reportPath, JSON.stringify({ stage: NET, attempt: ATTEMPT - 1, gaps: ["g1"] }));
    assert.equal(gateAsks(repo), null);
  });

  test("a report stamped with the standing attempt counts", () => {
    const repo = makeRepo(doneNet(ATTEMPT));
    writeFileSync(repo.reportPath, JSON.stringify({ stage: NET, attempt: ATTEMPT, gaps: ["g1"] }));
    assert.match(gateAsks(repo), /coverage gaps/);
  });

  test("the failed attempt itself no longer counts, before any restart", () => {
    const repo = makeRepo({
      stage: { ...activeStage(NET), status: "failed" },
      ledger: { stages: [{ name: "x", status: "done", attempt: 1 }] },
    });
    writeReturn(repo, DOCS_KEY, { ambiguity: "which file?" });
    assertRefused(pb(repo, "artifact", "check", DOCS_KEY), /void/);
  });
});

// ---------- orphans ----------

// fake.mjs waits while .git/hold exists, once, so the checkpoint that started it is orphaned by what the test does next.
const HOLDING_TESTS = `
import { existsSync, rmSync, writeFileSync } from "node:fs";
if (existsSync(".git/hold")) {
  rmSync(".git/hold");
  writeFileSync(".git/held", "");
  const deadline = Date.now() + 30_000;
  while (!existsSync(".git/release") && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
}
`;

async function until(condition, what) {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `waited for ${what}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

function pbInBackground(repo, ...args) {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: repo.dir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((done) => child.on("close", (code) => done({ code, stdout, stderr })));
}

async function heldCheckpoint(repo, step, pbKey, marker = "held") {
  const running = pbInBackground(repo, "checkpoint", "--step", step, "--from", pbKey);
  await until(() => existsSync(join(repo.dir, ".git", marker)), "the checkpoint to reach its wait");
  return { finished: running };
}

const release = (repo) => writeFileSync(join(repo.dir, ".git", "release"), "");

function preCommitHook(repo, body) {
  const path = join(repo.dir, ".git", "hooks", "pre-commit");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

const WAIT_IN_HOOK = 'touch .git/in-hook\ni=0\nwhile [ ! -f .git/release ] && [ $i -lt 1500 ]; do sleep 0.02; i=$((i+1)); done';

// The next attempt, reached the way a run reaches it, through stage fail, the gate and the tap.
function restartAtTwo(repo, plugin, stage, role) {
  ok(repo, "stage", "fail");
  assert.equal(startStage(repo, plugin, stage, 2).kind, "none");
  recordRun(repo, stage, 2, "wf_2");
  const pbKey = key(stage, role, 2);
  deliverReturn(repo, pbKey, { commit_subject: "", files_changed: [], ambiguity: stage === CONFIG ? "Nothing is left to do at this attempt." : "" });
  return pbKey;
}

describe("a checkpoint orphaned by stage fail", { concurrency: 4 }, () => {
  const KEY_ONE = key(CONFIG, "apply-config-change", 1);

  function orphanable() {
    const repo = makeRepo({ stage: activeStage(CONFIG, 1), tests: HOLDING_TESTS });
    writeReturn(repo, KEY_ONE);
    writeFileSync(join(repo.dir, "a.txt"), "changed\n");
    return repo;
  }

  const head = (repo) => git(repo.dir, "rev-parse", "HEAD");

  test("commits nothing, raises no stop and is no evidence for the next attempt", async () => {
    const plugin = makePlugin();
    const repo = orphanable();
    const seed = head(repo);
    writeFileSync(join(repo.dir, ".git", "hold"), "");
    const orphan = await heldCheckpoint(repo, "config", KEY_ONE);
    restartAtTwo(repo, plugin, CONFIG, "apply-config-change");

    release(repo);
    const result = await orphan.finished;

    assertRefused(result, /attempt 1.*attempt 2/);
    assert.equal(head(repo), seed, "the void attempt committed nothing");
    assert.equal(repo.ledger().stop, null);
    assert.deepEqual(repo.ledger().checkpoints ?? [], []);
    assertRefused(pb(repo, "stage", "finish"), /checkpoint:config/);
  });

  test("whose attempt ended while its commit hook ran raises no stop when that commit fails", async () => {
    const repo = orphanable();
    preCommitHook(repo, `${WAIT_IN_HOOK}\nexit 1`);
    const orphan = await heldCheckpoint(repo, "config", KEY_ONE, "in-hook");
    ok(repo, "stage", "fail");

    release(repo);
    const result = await orphan.finished;

    assertRefused(result, /attempt|active/);
    assert.equal(repo.ledger().stop, null);
  });

  test("whose attempt ended while its commit hook ran is refused, and its commit is recorded but is no evidence", async () => {
    const plugin = makePlugin();
    const repo = orphanable();
    preCommitHook(repo, `[ -f .git/hook-once ] || { touch .git/hook-once; ${WAIT_IN_HOOK.replaceAll("\n", "; ")}; }\nexit 0`);
    const orphan = await heldCheckpoint(repo, "config", KEY_ONE, "in-hook");
    restartAtTwo(repo, plugin, CONFIG, "apply-config-change");

    release(repo);
    const result = await orphan.finished;

    assertRefused(result, /attempt 1.*attempt 2/);
    const ledger = repo.ledger();
    assert.deepEqual(ledger.commits, [head(repo)], "the commit happened, so the ledger says so");
    assert.deepEqual(ledger.checkpoints ?? [], []);
    assert.equal(ledger.stop, null);
  });

  test("that fails after the stage is done cannot wedge the task", async () => {
    const plugin = makePlugin();
    const firstKey = key(NET, "update-documentation", 1);
    const repo = makeRepo({ stage: activeStage(NET, 1), tests: HOLDING_TESTS, ledger: { stages: [{ name: CONFIG, status: "done", attempt: 1 }] } });
    writeReturn(repo, firstKey);
    writeFileSync(join(repo.dir, "a.txt"), "changed\n");
    preCommitHook(repo, "echo lint failed >&2\nexit 1");
    writeFileSync(join(repo.dir, ".git", "hold"), "");
    const orphan = await heldCheckpoint(repo, "docs", firstKey);
    const docsKey = restartAtTwo(repo, plugin, NET, "update-documentation");
    ok(repo, "checkpoint", "--step", "docs", "--from", docsKey);
    ok(repo, "test", "--full");
    ok(repo, "stage", "finish");
    assert.equal(ok(repo, "gate", "eval").result, "auto-pass");

    release(repo);
    assertRefused(await orphan.finished, /stage|attempt/);

    assert.equal(repo.ledger().stop, null);
    git(repo.dir, "checkout", "--", "a.txt");
    ok(repo, "task", "end");
  });

  test("a checkpoint of the current attempt still raises its stop", async () => {
    const repo = orphanable();
    preCommitHook(repo, "echo lint failed >&2\nexit 1");

    assertRefused(pb(repo, "checkpoint", "--step", "config", "--from", KEY_ONE), /lint failed/);

    assert.match(repo.ledger().stop.reason, /lint failed/);
  });
});

describe("a return counts only from the agent its key names", IN_PARALLEL, () => {
  test("a plain agent's return is not captured, so stage finish refuses", () => {
    const repo = makeRepo();
    writeFileSync(join(repo.dir, "a.txt"), "changed\n");

    deliverReturn(repo, CONFIG_KEY, { commit_subject: "set a", files_changed: ["a.txt"] }, { agent_id: "a1", agent_type: "general-purpose" });

    assert.equal(artifactExists(repo, CONFIG_KEY), false);
    assertRefused(pb(repo, "stage", "finish"), /artifact:apply-config-change/);
  });

  test("the named agent's return is captured and carries the stage to its finish", () => {
    const repo = makeRepo();

    deliverReturn(repo, CONFIG_KEY, { commit_subject: "", files_changed: [], ambiguity: "Which file did the task mean?" });
    ok(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY);

    ok(repo, "stage", "finish");
  });
});

describe("the report states what ran and what was not covered", IN_PARALLEL, () => {
  test("what ran", () => {
    const repo = makeRepo({ stage: activeStage(NET), ledger: { checkpoints: [docsCheckpoint], tests: { full: fullRun() } } });
    writeReturn(repo, DOCS_KEY);
    ok(repo, "stage", "finish");

    const { ran } = repo.report();

    assert.deepEqual(ran.returns, [DOCS_KEY]);
    assert.deepEqual(ran.tests.map(({ key: name, passed }) => [name, passed]), [["full", true]]);
    assert.equal(ran.tests[0].runs[0].excerpt, "all good", "the excerpt reaches the report");
  });

  test("a test run from an earlier attempt is not reported as run", () => {
    const repo = makeRepo({ stage: activeStage(NET), ledger: { checkpoints: [docsCheckpoint], tests: { full: fullRun(), selected: fullRun({ attempt: 1 }) } } });
    writeReturn(repo, DOCS_KEY);
    ok(repo, "stage", "finish");
    assert.deepEqual(repo.report().ran.tests.map(({ key: name }) => name), ["full"]);
  });

  test("what was voided", () => {
    const repo = finishableConfig();
    const voided = key(CONFIG, "apply-config-change", 1);
    writeReturn(repo, voided);
    ok(repo, "stage", "finish");
    assert.deepEqual(repo.report().ran.voided, [voided]);
  });

  test("what was not covered", () => {
    const repo = finishedConfig();

    const { notCovered } = repo.report();

    assert.ok(notCovered.some((line) => /full suite/.test(line)), JSON.stringify(notCovered));
    assert.ok(notCovered.some((line) => /lens/.test(line)), JSON.stringify(notCovered));
    assert.ok(notCovered.some((line) => /output tokens/.test(line)), JSON.stringify(notCovered));
  });

  test("a stage that ran the full suite does not claim otherwise, and says what exit codes cannot show", () => {
    const repo = makeRepo({ stage: activeStage(NET), ledger: { checkpoints: [docsCheckpoint], tests: { full: fullRun() } } });
    writeReturn(repo, DOCS_KEY);
    ok(repo, "stage", "finish");
    const { notCovered } = repo.report();
    assert.equal(notCovered.some((line) => /full suite/.test(line)), false);
    assert.ok(notCovered.some((line) => /exit code/.test(line)), JSON.stringify(notCovered));
  });

  test("what the returns found reaches the keys the gate reads, and open doubts are listed", () => {
    const repo = makeRepo({ stage: activeStage(NET), ledger: { checkpoints: [docsCheckpoint], tests: { full: fullRun() } } });
    writeReturn(repo, DOCS_KEY, { ambiguity: "which file?", gaps: ["g1"], survivors: [{ class: "decide" }], refuted: [{ id: "f1" }], uncovered: ["lens-a"], unrefuted: [{ severity: "high" }] });
    ok(repo, "stage", "finish");

    const report = repo.report();

    assert.deepEqual(report.gaps, ["g1"]);
    assert.deepEqual(report.survivors, [{ class: "decide" }]);
    assert.deepEqual(report.refuted, [{ id: "f1" }]);
    assert.deepEqual(report.unrefuted, [{ severity: "high" }]);
    assert.deepEqual(report.uncovered, ["lens-a"]);
    assert.deepEqual(report.ambiguities, [{ key: DOCS_KEY, ambiguity: "which file?" }]);
    assert.ok(report.notCovered.includes("lens-a"));
    assert.equal(report.notCovered.some((line) => /lens round/.test(line)), false);
  });

  test("stage report prints it, with the gate sources", () => {
    const repo = finishedConfig({ ledger: { gates: { "G:x": { source: "auto" } } } });

    const result = ok(repo, "stage", "report");

    assert.deepEqual(result.report, repo.report());
    assert.deepEqual(result.gates, { "G:x": { source: "auto" } });
  });

  test("stage report refuses a report from before this attempt", () => {
    const repo = finishableConfig();
    writeFileSync(repo.reportPath, JSON.stringify({ stage: CONFIG, attempt: ATTEMPT - 1 }));
    assertRefused(pb(repo, "stage", "report"), /no report for code-config at attempt 2/);
  });

  test("stage report refuses with no report at all, and says a failed stage has none", () => {
    const repo = makeRepo();
    ok(repo, "stage", "fail");
    assertRefused(pb(repo, "stage", "report"), /failed/);
  });

  test("stage report takes no argument", () => {
    const repo = finishedConfig();
    assertRefused(pb(repo, "stage", "report", CONFIG), /usage: pb stage report/, 2);
  });
});

// ---------- artifact check ----------

describe("artifact check", IN_PARALLEL, () => {
  test("prints a return of the current attempt", () => {
    const repo = makeRepo();
    writeReturn(repo, CONFIG_KEY, { commit_subject: "large" });

    const result = ok(repo, "artifact", "check", CONFIG_KEY);

    assert.equal(result.key, CONFIG_KEY);
    assert.equal(result.path, join(repo.taskDir, "artifacts", `${CONFIG_KEY}.json`));
    assert.equal(result.artifact.commit_subject, "large");
  });

  test("reads an earlier stage's standing return", () => {
    const repo = atSafetyNet(activeStage(NET));
    const earlier = key(CONFIG, "apply-config-change", 1);
    writeReturn(repo, earlier);
    assert.equal(ok(repo, "artifact", "check", earlier).key, earlier);
  });

  test("refuses a return from another attempt", () => {
    const repo = makeRepo();
    const stale = key(CONFIG, "apply-config-change", 1);
    writeReturn(repo, stale);
    assertRefused(pb(repo, "artifact", "check", stale), /void/);
  });

  test("refuses a key with no return, and one that cannot be read", () => {
    const repo = makeRepo();
    assertRefused(pb(repo, "artifact", "check", CONFIG_KEY), /no return/);
    writeFileSync(join(repo.taskDir, "artifacts", `${CONFIG_KEY}.json`), "{nope");
    assertRefused(pb(repo, "artifact", "check", CONFIG_KEY), /cannot be read/);
  });

  test("usage", () => {
    const repo = makeRepo();
    assertRefused(pb(repo, "artifact", "check"), /usage: pb artifact check/, 2);
    assertRefused(pb(repo, "artifact", "check", "../ledger"), /usage: pb artifact check/, 2);
  });
});

// ---------- spend and status ----------

describe("spend", IN_PARALLEL, () => {
  test("finish records agents from recorded returns, and tokens as 0 and unknown", () => {
    const repo = finishableConfig();
    writeReturn(repo, key(CONFIG, "runner"));
    ok(repo, "stage", "finish");

    const ledger = repo.ledger();

    assert.deepEqual(ledger.stages[0].spend, { agents: 2, tokens: 0, tokensKnown: false });
    assert.deepEqual(ledger.spend, { agents: 2, tokens: 0, tokensKnown: false });
    assert.deepEqual(repo.report().spend, { agents: 2, agentsSource: "recorded returns", tokens: 0, tokensKnown: false, tokensUnit: "output tokens" });
  });

  test("a stage's figures add up across its attempts, and the task's across stages", () => {
    const repo = makeRepo({ ledger: { spend: { agents: 5, tokens: 0, tokensKnown: false }, stages: [{ name: CONFIG, status: "failed", attempt: 1, spend: { agents: 3, tokens: 0, tokensKnown: false } }] } });
    writeReturn(repo, CONFIG_KEY);
    writeFileSync(join(repo.dir, "a.txt"), "changed\n");
    ok(repo, "checkpoint", "--step", "config", "--from", CONFIG_KEY);
    ok(repo, "stage", "finish");

    const ledger = repo.ledger();

    assert.equal(ledger.stages.length, 1, "one entry per stage");
    assert.equal(ledger.stages[0].spend.agents, 4);
    assert.equal(ledger.spend.agents, 6);
  });
});

describe("status", IN_PARALLEL, () => {
  test("prints stage and task spend against maxAgents, labelled as output tokens and unknown", () => {
    const repo = finishedConfig();

    const { spend } = ok(repo, "status");

    assert.equal(spend.maxAgents, loadStages(ROOT).maxAgents);
    assert.deepEqual(spend.stage, { name: CONFIG, agents: 1, tokens: 0, tokensKnown: false });
    assert.deepEqual(spend.task, { agents: 1, tokens: 0, tokensKnown: false });
    assert.match(spend.label, /output tokens/);
    assert.match(spend.label, /unknown/);
  });

  test("counts an active stage's returns so far", () => {
    const repo = makeRepo({ ledger: { spend: { agents: 2, tokens: 0, tokensKnown: false } } });
    writeReturn(repo, CONFIG_KEY);

    const { spend } = ok(repo, "status");

    assert.equal(spend.stage.agents, 1);
    assert.equal(spend.task.agents, 3);
  });

  test("a voided return counts once its attempt has been recorded, and not twice", () => {
    const repo = makeRepo();
    writeReturn(repo, CONFIG_KEY);
    ok(repo, "stage", "fail");

    const { spend } = ok(repo, "status");

    assert.equal(spend.stage.agents, 1);
    assert.equal(spend.task.agents, 1);
  });

  test("prints where the run stands", () => {
    const repo = makeRepo();
    ok(repo, "stage", "fail");

    const status = ok(repo, "status");

    assert.deepEqual(status.stage, repo.ledger().stage);
    assert.deepEqual(status.next, { stage: CONFIG, attempt: ATTEMPT + 1 });
    assert.equal(status.stop, null);
    assert.equal(status.needsHuman, null);
  });

  test("the last stage done leaves nothing next", () => {
    const repo = makeRepo({
      stage: { ...activeStage(NET), status: "done" },
      ledger: { stages: [{ name: CONFIG, status: "done", attempt: 1 }, { name: NET, status: "done", attempt: ATTEMPT }] },
    });
    assert.equal(ok(repo, "status").next, null);
  });

  test("takes no argument, and refuses with no run", () => {
    const repo = makeRepo();
    assertRefused(pb(repo, "status", "--all"), /usage: pb status/, 2);
    const empty = makeDir("pb-no-run-");
    git(empty, "init", "-q");
    assertRefused(pb({ dir: empty }, "status"), /no run here/);
  });
});

// ---------- verb classes ----------

describe("verb classes, through the real gate", IN_PARALLEL, () => {
  const PB = `node ${CLI}`;
  const bash = (repo, command, agentType) => decision(hook(GATE, payload(repo, "Bash", { command }, agentType === undefined ? {} : { agent_id: "a1", agent_type: agentType })));

  for (const [args, owner] of [["stage finish", "runner"], [`artifact check ${CONFIG_KEY}`, "runner"], ["stage report", "main"], ["stage fail", "main"], ["status", "main"]]) {
    const others = owner === "runner" ? [undefined, "pairingbuddy:apply-config-change"] : [RUNNER_AGENT, "pairingbuddy:apply-config-change"];
    for (const agentType of others) {
      test(`${args} is denied to ${agentType ?? "the main context"}`, () => {
        const repo = makeRepo();
        assert.equal(bash(repo, `${PB} ${args}`, agentType).kind, "deny");
      });
    }
  }

  test("the runner's exact pb stage finish is auto-allowed", () => {
    assert.equal(bash(makeRepo(), `${PB} stage finish`, RUNNER_AGENT).kind, "allow");
  });

  test("the runner's pb artifact check <key> is auto-allowed", () => {
    assert.equal(bash(makeRepo(), `${PB} artifact check ${CONFIG_KEY}`, RUNNER_AGENT).kind, "allow");
  });

  for (const command of [`${PB} stage finish --stage x`, `${PB} stage finish  `, `${PB} stage finish; ls`, `${PB} artifact check ../ledger`, `${PB} artifact check ${CONFIG_KEY} x`, `${PB} artifact check ${CONFIG_KEY}; ls`]) {
    test(`${command.slice(PB.length)} loses the auto-allow`, () => {
      assert.notEqual(bash(makeRepo(), command, RUNNER_AGENT).kind, "allow");
    });
  }
});
