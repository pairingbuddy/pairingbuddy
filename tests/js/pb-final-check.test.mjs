// pb final-check <id> --pass|--fail --note '<what happened>': the session records the result of a final check it ran itself
// (a live, paid or manual run no test covers). A failed one keeps G:task-end from passing by itself, under auto too.
// Every test drives the real CLI in a temp git repo with a real ledger.
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

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
const IN_PARALLEL = { concurrency: 8 };
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

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
const gitEnv = () => ({ ...process.env, ...ISOLATED_GIT, HOME: NO_HOME, XDG_CONFIG_HOME: NO_HOME });

const CONFIG_TEXT = '{"runners":{}}\n';

function makeRepo({ withRun = true } = {}) {
  const dir = makeDir("pb-final-check-");
  execFileSync("git", ["init", "-q"], { cwd: dir, env: gitEnv() });
  mkdirSync(join(dir, ".pairingbuddy"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), CONFIG_TEXT);
  const ledgerPath = join(dir, ".pairingbuddy", "run", "task", "ledger.json");
  if (withRun) {
    mkdirSync(join(dir, ".pairingbuddy", "run", "task", "artifacts"), { recursive: true });
    writeLedger(ledgerPath, {
      v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "new_feature",
      owner: { sessionId: null, lastSeen: null }, task: "Task 9", plan: { path: "", title: "" },
      configHash: createHash("sha256").update(CONFIG_TEXT).digest("hex"), policy: { mode: "", source: "" },
      stage: { name: "code-safety-net", status: "done", runId: "wf_1", attempt: 1, startedAt: null },
      stages: [], gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 }, stop: null, needsHuman: null,
    });
  }
  return { dir, ledger: () => readLedger(ledgerPath) };
}

function pb(repo, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: gitEnv() });
  return { code: status, stdout, stderr };
}

describe("pb final-check", IN_PARALLEL, () => {
  test("records each result in the ledger, newest last, with its note", () => {
    const repo = makeRepo();

    const failed = pb(repo, "final-check", "smokes", "--fail", "--note", "S4 and S5 failed live");
    const passed = pb(repo, "final-check", "deploy", "--pass", "--note", "staging is up");

    assert.equal(failed.code, 0, failed.stderr);
    assert.equal(passed.code, 0, passed.stderr);
    assert.deepEqual(repo.ledger().finalChecks.map(({ id, result, note }) => ({ id, result, note })), [
      { id: "smokes", result: "fail", note: "S4 and S5 failed live" },
      { id: "deploy", result: "pass", note: "staging is up" },
    ]);
  });
});

test("skill-coding-records-final-checks: the coding skill tells the session to record each final check it runs, and that a failed one is no question for the inbox", async () => {
  const { readFileSync } = await import("node:fs");
  const skill = readFileSync(join(ROOT, "skills", "coding", "SKILL.md"), "utf8");

  assert.match(skill, /pb final-check <id> --pass\|--fail --note/, "names the verb");
  assert.match(skill, /failed final check[^.\n]*(never|not)[^.\n]*pb question add/i, "a failed check is not set aside as a question");
});
