import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeLedger } from "../../shared-node/ledger.mjs";
import { ROOT, assertAllowed, fixture, runGate } from "./gate-harness.mjs";

async function withRepo(fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unit-open-gate-")));
  try {
    await fn({ dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PB = join(ROOT, "cli", "pb.mjs");

const bash = (repo, command, permission_mode) => ({
  ...fixture("pretooluse-workflow.json"),
  cwd: repo.dir,
  tool_name: "Bash",
  tool_input: { command },
  permission_mode,
});

// Returns the hook output so callers can check the reason.
const assertDenied = (result, label) => {
  assert.notEqual(result.stdout, "", `${label}: the hook denies`);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(result.code, 0, `${label}: the JSON deny form needs exit 0`);
  assert.equal(output.permissionDecision, "deny", `${label}: denied`);
  return output;
};

const assertNotDenied = (result, label) =>
  assert.notEqual(JSON.parse(result.stdout || "{}").hookSpecificOutput?.permissionDecision, "deny", `${label}: not denied`);

const openRun = (repo) => {
  const ledgerDir = join(repo.dir, ".pairingbuddy", "run", "task");
  mkdirSync(ledgerDir, { recursive: true });
  writeLedger(join(ledgerDir, "ledger.json"), {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "Task 23",
    plan: { path: "", title: "" }, configHash: "a".repeat(64),
    policy: { mode: "", source: "" },
    stage: { name: "", status: "", runId: null, attempt: 0, startedAt: null }, stages: [],
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
  });
};

// Placeholders created from .pairingbuddy/scenarios.json. Each one fails
// until its implementation exists. Never use { skip } here: the JS suite
// treats skipped tests as failures.

// Scenario: unit-open-gate-hook

test("gate-allows-model-unit-open-confirm-only-in-auto", () =>
  withRepo(async (repo) => {
    const withYes = `node ${PB} unit open --type feat --slug x --yes`;
    const withBranch = `node ${PB} unit open --type feat --slug x --branch my/x`;
    const humanCommand = (reason, cwd, command) => {
      const typed = command === withBranch ? `unit open --type feat --slug x --branch my/x` : `unit open --type feat --slug x`;
      return reason.includes(`!cd ${cwd} && node ${PB} ${typed}`);
    };

    assertAllowed(await runGate(bash(repo, withYes, "auto")));
    assertAllowed(await runGate(bash(repo, withBranch, "auto")));

    for (const command of [withYes, withBranch]) {
      for (const mode of ["default", "acceptEdits"]) {
        const result = await runGate(bash(repo, command, mode));
        const output = assertDenied(result, `${mode} ${command}`);
        assert.ok(humanCommand(output.permissionDecisionReason, repo.dir, command), `${mode}: the reason names the ! command: ${output.permissionDecisionReason}`);
      }
    }

    const auto = { env: { PAIRINGBUDDY_GATE_POLICY: "auto" } };
    assertAllowed(await runGate(bash(repo, withYes, "default"), auto));
    assertAllowed(await runGate(bash(repo, withBranch, "acceptEdits"), auto));
  }));

test("gate-allows-bare-unit-open-and-denies-env-prefixed", () =>
  withRepo(async (repo) => {
    const open = `node ${PB} unit open --type feat --slug x`;
    const bare = open;
    const pbWithEnvironment = `PAIRINGBUDDY_GATE_POLICY=auto ${open} --yes`;
    const disguisesPb = {
      "a variable holding the flag": `Y=--yes; ${open} $Y`,
      "a command substitution producing the flag": `${open} $(echo --yes)`,
      "a shell function forwarding its arguments": `f(){ node ${PB} "$@"; }; f unit open --type feat --slug x --yes`,
    };

    for (const mode of ["default", "acceptEdits", "auto"]) {
      assertAllowed(await runGate(bash(repo, bare, mode)));
    }

    const denied = { "an environment-prefixed call": pbWithEnvironment, ...disguisesPb };
    for (const [label, command] of Object.entries(denied)) {
      assertDenied(await runGate(bash(repo, command, "default")), `${label}: ${command}`);
    }
  }));

test("gate-unit-open-confirm-rule-holds-with-run-state", () =>
  withRepo(async (repo) => {
    openRun(repo);
    const withYes = `node ${PB} unit open --type feat --slug x --yes`;

    for (const mode of ["default", "acceptEdits"]) {
      assertDenied(await runGate(bash(repo, withYes, mode)), `${mode}: ${withYes} with a run open`);
    }

    assertNotDenied(await runGate(bash(repo, withYes, "auto")), "auto: with a run open");
  }));

test("gate-denies-built-unit-open-words-outside-auto", () =>
  withRepo(async (repo) => {
    const tail = "open --type a --slug b --yes";
    const built = {
      "a command substitution building 'unit'": `node ${PB} $(printf un)it ${tail}`,
      "a command substitution inside the word": `node ${PB} u$(printf n)it ${tail}`,
      "IFS standing in for the space": `node ${PB} unit\${IFS}${tail}`,
      "a brace expansion with an empty alternative": `node ${PB} {unit,} ${tail}`,
      "a glob standing in for a letter": `node ${PB} uni? ${tail}`,
    };

    for (const [state, prepare] of [["no run state", () => {}], ["run state", () => openRun(repo)]]) {
      prepare();
      for (const [label, command] of Object.entries(built)) {
        for (const mode of ["default", "acceptEdits"]) {
          assertDenied(await runGate(bash(repo, command, mode)), `${state}, ${mode}, ${label}: ${command}`);
        }
        const inAuto = await runGate(bash(repo, command, "auto"));
        const autoMessage = `${state}, auto, ${label}: ${command}`;
        if (state === "run state") assertDenied(inAuto, autoMessage);
        else assertNotDenied(inAuto, autoMessage);
      }
    }
  }));
