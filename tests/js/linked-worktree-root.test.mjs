import "./isolated-tmpdir.mjs";
// A linked git worktree kept inside the main checkout (<repo>/worktrees/<name>, the default layout) is a checkout of its
// own: the run state that applies to a call in it is its own .pairingbuddy/, never the main checkout's above it.
// Every test drives the real gate and the real CLI as subprocesses, against a temp repo with a real linked worktree.
import { withIntake } from "./ledger-fixture.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const BOOT = join(ROOT, "hooks", "gate-boot.mjs");
const PAYLOADS = join(ROOT, "tests", "probes", "fixtures", "payloads");
const fixture = (name) => JSON.parse(readFileSync(join(PAYLOADS, name), "utf8"));
const CONFIG_TEXT = '{"runners":{}}\n';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function openRun(dir) {
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), CONFIG_TEXT);
  writeLedger(join(taskDir, "ledger.json"), withIntake({
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "linked",
    plan: { path: "", title: "" }, configHash: createHash("sha256").update(CONFIG_TEXT).digest("hex"),
    policy: { mode: "", source: "" }, stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null }, stages: [],
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
  }));
}

// The main checkout and a linked worktree inside it, at <main>/worktrees/linked on its own branch.
function makeCheckouts() {
  const main = makeDir("linked-main-");
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, ".gitignore"), ".pairingbuddy/\nworktrees/\n");
  git(main, "add", ".gitignore");
  git(main, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
  const linked = join(main, "worktrees", "linked");
  git(main, "worktree", "add", "-q", "-b", "linked-work", linked);
  return { main, linked };
}

let sessions = 0;
const newSession = () => `linked-session-${(sessions += 1)}`;

function runGate(payload) {
  const { PAIRINGBUDDY_GATE_POLICY: _inherited, ...env } = process.env;
  const { status, stdout, stderr } = spawnSync(process.execPath, [BOOT], { cwd: payload.cwd, input: JSON.stringify(payload), env: { ...env, CLAUDE_PLUGIN_ROOT: ROOT }, encoding: "utf8" });
  return { code: status, stdout, stderr };
}

function bash(cwd, session, command) {
  const { agent_id: _id, agent_type: _type, ...base } = fixture("pretooluse-workflow.json");
  return { ...base, session_id: session, cwd, permission_mode: "auto", tool_name: "Bash", tool_input: { command, description: "run it" } };
}

const decisionOf = (result) => (result.stdout === "" ? null : JSON.parse(result.stdout).hookSpecificOutput);

describe("a linked worktree inside the main checkout", () => {
  test("a push in the linked worktree is not gated by the main checkout's run", () => {
    const { main, linked } = makeCheckouts();
    openRun(main);

    const result = runGate(bash(linked, newSession(), "git push -u origin linked-work"));

    assert.equal(result.code, 0, result.stderr);
    assert.equal(decisionOf(result)?.permissionDecision, undefined, `the main checkout's run must not gate the linked worktree: ${result.stdout}`);
  });

  test("a run in the linked worktree gates a push there, and not in the main checkout", () => {
    const { main, linked } = makeCheckouts();
    openRun(linked);

    assert.equal(decisionOf(runGate(bash(linked, newSession(), "git push -u origin linked-work")))?.permissionDecision, "deny");
    assert.equal(decisionOf(runGate(bash(main, newSession(), "git push -u origin main")))?.permissionDecision, undefined);
  });

  test("a session bound to the main checkout's run by an older build is not gated in the linked worktree", () => {
    const { main, linked } = makeCheckouts();
    openRun(main);
    const session = newSession();
    // Older builds walked past the linked worktree's top and bound a session started there to the main checkout's run.
    mkdirSync(join(tmpdir(), "pairingbuddy-sessions"), { recursive: true });
    writeFileSync(join(tmpdir(), "pairingbuddy-sessions", session), main);

    const result = runGate(bash(linked, session, "git push -u origin linked-work"));

    assert.equal(result.code, 0, result.stderr);
    assert.equal(decisionOf(result)?.permissionDecision, undefined, `an older build's binding must not gate the linked worktree: ${result.stdout}`);
  });
});
