// A test-config.json the human changed mid-stage is a wait on the human, not a failing step: the CLI ends the stage's
// attempt at once and records the wait, and pb human accept lets the next attempt start. Every test drives the real CLI
// as a subprocess, in a temp git repo with a real ledger.
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { recordedAnswer, runTap } from "./tap-fixture.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const STAGE = "code-tdd";
const ATTEMPT = 2;
const CONFIG_GATE = "config-changed";

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const RUNNER = { command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [], selector_template: ["{test_file}", "--name={test_function}"] };
const CONFIG = `${JSON.stringify({ source_directory: ".", runners: { fake: RUNNER }, default_runner: "fake" })}\n`;
// The stages and gates before code-tdd, done, so its next attempt is the run's next action.
const DONE_BEFORE = ["intake", "code-scenarios"].map((name) => ({ name, status: "done", attempt: 1 }));
const APPROVED = { "G:type": { source: "human-cli", answer: "approve" }, "G:scenarios": { source: "human-cli", answer: "approve" } };
const EDITED = CONFIG.replace("fake.mjs", "fake2.mjs");

function makeRepo({ stage = { name: STAGE, status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null } } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-config-wait-")));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  const configPath = join(dir, ".pairingbuddy", "test-config.json");
  writeFileSync(configPath, CONFIG);
  writeFileSync(join(dir, "fake.mjs"), "");
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "new_feature",
    owner: { sessionId: null, lastSeen: null }, task: "a task", plan: { path: "", title: "" },
    configHash: createHash("sha256").update(CONFIG).digest("hex"), policy: { mode: "", source: "" },
    stage, stages: DONE_BEFORE, gates: APPROVED, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
  });
  return { dir, ledger: () => readLedger(ledgerPath), edit: (text = EDITED) => writeFileSync(configPath, text) };
}

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000 });
  return { code: status, stdout, stderr };
}

describe("a changed test-config mid-stage waits on the human", () => {
  test("the refusal says the run stopped for the human, so a stage script halts at once", () => {
    const repo = makeRepo();
    repo.edit();

    const result = pb(repo, "test", "--full");

    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /^pb: the run stopped/, "the stage scripts halt on this first word, with no retry");
    assert.match(result.stderr, /human accept/, "the refusal names what the human types");
    assert.doesNotMatch(result.stderr, /unexpected failure/);
  });

  test("the ledger records the wait, ends the attempt and raises no stop", () => {
    const repo = makeRepo();
    repo.edit();

    pb(repo, "test", "--full");

    const ledger = repo.ledger();
    assert.equal(ledger.stop, null, "a changed config is no stop");
    assert.equal(ledger.needsHuman?.gate, CONFIG_GATE);
    assert.equal(typeof ledger.needsHuman.askedAt, "string", "the wait has a start, so it counts as waited");
    assert.match(ledger.needsHuman.fix, /human accept/, "the views show the fix line");
    assert.equal(ledger.stage.status, "failed", "the attempt ended, so the next one starts without pb stage fail");
  });

  test("pb human accept answers the wait, and the next attempt is the next action", () => {
    const repo = makeRepo();
    repo.edit();
    pb(repo, "test", "--full");

    const accepted = pb(repo, "human", "accept");

    assert.equal(accepted.code, 0, accepted.stderr);
    assert.equal(repo.ledger().needsHuman, null, "the wait is answered");
    const { next, action } = JSON.parse(pb(repo, "status", "--action").stdout);
    assert.deepEqual(next, { stage: STAGE, attempt: ATTEMPT + 1 }, "the stage starts again at its next attempt");
    assert.match(action, new RegExp(`^Start the workflow pairingbuddy:${STAGE}`), action);
  });

  test("the wait holds a question for the human, with Accept and Stop", () => {
    const repo = makeRepo();
    repo.edit();
    pb(repo, "test", "--full");

    const { question } = repo.ledger().needsHuman;

    assert.ok(question.header.length <= 12, question.header);
    assert.match(question.question, /test-config\.json/, "it names the file to check");
    assert.deepEqual(question.options.map(({ label }) => label), ["Accept", "Stop"]);
    assert.equal(question.multiSelect, false);
  });

  test("while the run waits, the next action asks that exact question, with the ! line only as the fallback", () => {
    const repo = makeRepo();
    repo.edit();
    pb(repo, "test", "--full");

    const { action } = JSON.parse(pb(repo, "status", "--action").stdout);

    assert.ok(action.includes(`AskUserQuestion, passing exactly this question: ${JSON.stringify({ questions: [repo.ledger().needsHuman.question] })}`), action);
    assert.match(action, /If you asked and it still waits[\s\S]*human accept/, action);
    assert.doesNotMatch(action, /approve/, action);
  });

  test("a file put back as it was is accepted too, and the wait ends", () => {
    const repo = makeRepo();
    repo.edit();
    pb(repo, "test", "--full");
    repo.edit(CONFIG);

    const accepted = pb(repo, "human", "accept");

    assert.equal(accepted.code, 0, accepted.stderr);
    assert.equal(repo.ledger().needsHuman, null);
    assert.equal(repo.ledger().gateWaits?.[0]?.gate, CONFIG_GATE, "the wait's time stays waiting");
  });

  test("gate eval names the accept line as the human's command", () => {
    const repo = makeRepo();
    repo.edit();
    pb(repo, "test", "--full");

    const { humanCommand } = JSON.parse(pb(repo, "gate", "eval").stdout);

    assert.match(humanCommand, /human accept$/, humanCommand);
  });

  test("the human's Accept, recorded by the tap, pins the file and ends the wait", () => {
    const repo = makeRepo();
    repo.edit();
    pb(repo, "test", "--full");

    runTap(repo, recordedAnswer(repo, repo.ledger().needsHuman.question, "Accept"));

    const ledger = repo.ledger();
    assert.equal(ledger.needsHuman, null, "the wait is answered");
    assert.equal(ledger.configHash, createHash("sha256").update(EDITED).digest("hex"), "the new file is pinned");
    assert.equal(ledger.configAcceptances?.length, 1, "the acceptance is recorded");
    assert.equal(ledger.gateWaits?.[0]?.gate, CONFIG_GATE, "the wait's time stays waiting");
    assert.equal(JSON.parse(pb(repo, "status", "--action").stdout).next?.stage, STAGE, "the stage starts again");
  });

  test("the human's Stop, recorded by the tap, stops the run as theirs", () => {
    const repo = makeRepo();
    repo.edit();
    pb(repo, "test", "--full");

    runTap(repo, recordedAnswer(repo, repo.ledger().needsHuman.question, "Stop"));

    const ledger = repo.ledger();
    assert.equal(ledger.needsHuman, null);
    assert.equal(ledger.stop?.code, "human-stopped");
  });

  test("an answer to another question is not recorded", () => {
    const repo = makeRepo();
    repo.edit();
    pb(repo, "test", "--full");
    const asked = repo.ledger().needsHuman.question;

    runTap(repo, recordedAnswer(repo, { ...asked, question: `${asked.question} Really?` }, "Accept"));

    assert.equal(repo.ledger().needsHuman?.gate, CONFIG_GATE, "the wait stands");
  });
});
