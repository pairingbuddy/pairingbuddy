// The D17 guard through the real hook process (hooks/gate-boot.mjs). The table rows that only vary the command text are in
// d17-rules.test.mjs; this file has what needs the process: finding the run (subdirectory, session binding, cd / -C /
// --git-dir / GIT_DIR / HOME targets), reading the branch from files with git off PATH, broken plugin copies, platform drift,
// the permission mode, Write and Edit into .git, and one smoke row per command family.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { writeLedger } from "../../shared-node/ledger.mjs";
import { sessionsDirectory } from "../../shared-node/run-root.mjs";
import { env as gitEnv } from "./cli-repo-fixture.mjs";
import { FALLBACKS, FAMILIES, expandRows, runsInUnitLayer } from "./d17-cases.mjs";
import { fakeRepo, scratchDir } from "./d17-repos.mjs";
import { scenarios } from "./d17-table.mjs";
import { ROOT, fixture, runGate } from "./gate-harness.mjs";
import { baseLedger } from "./ledger-fixture.mjs";

const IN_PARALLEL = { concurrency: 8 };

// ---------- the world a call runs in ----------

const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: gitEnv(), stdio: "ignore" });
const ledgerPath = (dir) => join(dir, ".pairingbuddy", "run", "task", "ledger.json");
const unitPath = (dir) => join(dir, ".pairingbuddy", "run", "unit.json");

// A run is run/task/ledger.json; a unit is run/unit.json, with a ledger beside it unless `ledger` says otherwise. No run state is no run/ directory.
function addRunState(dir, runState, ledger) {
  if (runState === "none") return;
  mkdirSync(join(dir, ".pairingbuddy", "run", "task"), { recursive: true });
  if (runState === "unit") writeFileSync(unitPath(dir), JSON.stringify({ unit: null, plan: null, tracer: null, branch: "feature/x", base: "main", baseSha: "a".repeat(40), configHash: "a".repeat(64), gitConfigHash: "a".repeat(64), tasks: [], commits: [] }));
  if (ledger === "ok") writeLedger(ledgerPath(dir), baseLedger());
}

// A copy of the plugin's hook with one defect: only gate-boot.mjs and gate.mjs (every shared module missing), or the whole
// shared-node with a gate-rules.mjs that does not parse.
function pluginCopy({ brokenRules }) {
  const plugin = scratchDir("d17-plugin-");
  mkdirSync(join(plugin, "hooks"));
  for (const file of ["gate-boot.mjs", "gate.mjs"]) cpSync(join(ROOT, "hooks", file), join(plugin, "hooks", file));
  if (brokenRules) {
    cpSync(join(ROOT, "shared-node"), join(plugin, "shared-node"), { recursive: true });
    writeFileSync(join(plugin, "shared-node", "gate-rules.mjs"), "export const checkCall = ;\n");
  }
  return join(plugin, "hooks", "gate-boot.mjs");
}
const MISSING_MODULES = pluginCopy({ brokenRules: false });
const BROKEN_RULES = pluginCopy({ brokenRules: true });

// What a call is made of. `dir` is the repo with the run state; setups change it, or say where the call stands and what the process sees.
let sessions = 0;
function newCall({ runState, context, ledger = "ok" }) {
  const dir = fakeRepo();
  addRunState(dir, runState, ledger);
  return { runState, context, dir, cwd: dir, sessionId: `d17-session-${++sessions}`, agentType: "pairingbuddy:implement-code", payload: {}, gate: undefined, path: undefined, env: {} };
}

const elsewhere = (call) => {
  call.cwd = scratchDir("d17-elsewhere-");
};
const head = (dir, text) => writeFileSync(join(dir, ".git", "HEAD"), `${text}\n`);
const withoutGit = (call) => {
  call.path = scratchDir("d17-nopath-");
};

// HEAD on main inside a linked worktree: its .git is a file with "gitdir:", not a directory. Made with git, once per call.
function linkedWorktreeOnMain(call) {
  const base = scratchDir("d17-base-");
  git(base, "init", "-q", "-b", "other");
  git(base, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "seed");
  call.cwd = join(scratchDir("d17-wt-"), "wt");
  git(base, "worktree", "add", "-q", "-b", "main", call.cwd);
}

// Each setup named in the table changes the call in the one way its name says.
const SETUPS = {
  "the runner agent (pairingbuddy:runner) runs it directly; it must commit through pb checkpoint": (call) => {
    call.agentType = "pairingbuddy:runner";
  },
  "no ledger.json (publish-only unit)": () => {},
  "permission_mode auto": (call) => {
    call.payload.permission_mode = "auto";
  },
  "permission_mode bypassPermissions": (call) => {
    call.payload.permission_mode = "bypassPermissions";
  },
  "HEAD on main, read from .git/HEAD with git off PATH": (call) => {
    head(call.dir, "ref: refs/heads/main");
    withoutGit(call);
  },
  "detached HEAD; target unknown, fail closed": (call) => head(call.dir, "a".repeat(40)),
  "linked worktree (.git is a file with gitdir:), HEAD on main": linkedWorktreeOnMain,
  "release listed in .pairingbuddy/git-config.json protected_branches": (call) => {
    mkdirSync(join(call.dir, ".pairingbuddy"), { recursive: true });
    writeFileSync(join(call.dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ protected_branches: ["main", "master", "release"] }));
  },
  // Git is off PATH, so only reading refs/remotes/origin/HEAD as a file can make trunk protected.
  "trunk is the default branch from refs/remotes/origin/HEAD, read from files without calling git": (call) => {
    mkdirSync(join(call.dir, ".git", "refs", "remotes", "origin"), { recursive: true });
    writeFileSync(join(call.dir, ".git", "refs", "remotes", "origin", "HEAD"), "ref: refs/remotes/origin/trunk\n");
    withoutGit(call);
  },
  "gate modules missing (only gate-boot.mjs and gate.mjs copied); raw text, mirrors the unit-open fail-closed fallback": (call) => {
    call.gate = MISSING_MODULES;
  },
  "gate modules missing (only gate-boot.mjs and gate.mjs copied)": (call) => {
    call.gate = MISSING_MODULES;
  },
  "gate modules missing; the main context with no run needs none of them": (call) => {
    call.gate = MISSING_MODULES;
  },
  "gate modules missing; cwd outside any run, session unbound": (call) => {
    call.gate = MISSING_MODULES;
    elsewhere(call);
  },
  "payload has agent_type but no agent_id; treated as subagent (choice)": (call) => {
    call.dropAgentId = true;
  },
  "empty .pairingbuddy/run/ directory is not run state": (call) => mkdirSync(join(call.dir, ".pairingbuddy", "run"), { recursive: true }),
  "empty .pairingbuddy/run/": (call) => mkdirSync(join(call.dir, ".pairingbuddy", "run"), { recursive: true }),
  "cwd in a subdirectory of a repo with a run": (call) => {
    call.cwd = join(call.dir, "sub");
  },
  // The session was bound to the run repo by an earlier call; this one stands in another repo that has no run.
  "cwd in another repo with no run; session bound to a run": (call) => {
    call.cwd = fakeRepo();
    mkdirSync(sessionsDirectory(), { recursive: true });
    writeFileSync(join(sessionsDirectory(), call.sessionId), call.dir);
  },
  "cwd outside any run, session unbound; -C target is the run root (choice)": elsewhere,
  "cwd outside any run, session unbound; cd target is the run root (choice)": elsewhere,
  "cwd outside any run, session unbound; -C target has no run": elsewhere,
  "cwd outside any run, session unbound; --git-dir / --work-tree / GIT_DIR target is the run root": elsewhere,
  "cwd outside any run, session unbound; HOME is the run root": (call) => {
    elsewhere(call);
    call.env.HOME = call.dir;
  },
  "unit.json present with no ledger.json": () => {},
  "corrupt ledger.json; Bash rules run before the ledger is read": (call) => writeFileSync(ledgerPath(call.dir), "{not json"),
  "payload with only agent_id, or only agent_type: platform drift (existing assertNoDrift)": () => {},
  "payload with both agent_id and agent_type (control for platform drift)": () => {},
  "gate-rules.mjs import fails (existing fail-closed gate error)": (call) => {
    call.gate = BROKEN_RULES;
  },
  // Files only: the hook never calls git, so a config with refStorage and the placeholder HEAD is what it would read.
  "reftable repo (extensions.refStorage = reftable, HEAD reads refs/heads/.invalid)": (call) => {
    writeFileSync(join(call.dir, ".git", "config"), "[extensions]\n\trefStorage = reftable\n");
    head(call.dir, "ref: refs/heads/.invalid");
  },
};

// Setups that decide the ledger themselves; every other unit row runs with a ledger and without one.
const LEDGER_SETUPS = {
  "no ledger.json (publish-only unit)": "none",
  "unit.json present with no ledger.json": "none",
  "corrupt ledger.json; Bash rules run before the ledger is read": "ok",
};
// A drift row is two calls: the payload keeps only agent_id, or only agent_type.
const DRIFT_SETUP = "payload with only agent_id, or only agent_type: platform drift (existing assertNoDrift)";
const DRIFT_VARIANTS = [{ label: "only agent_id", drop: "agent_type" }, { label: "only agent_type", drop: "agent_id" }];

// ---------- one hook call ----------

function expandPlaceholders(command, call) {
  let text = command.replaceAll("<plugin>", ROOT).replaceAll("/abs/run-repo", call.dir);
  if (text.includes("/abs/plain-repo")) text = text.replaceAll("/abs/plain-repo", fakeRepo());
  return text;
}

function payloadFor(call, command) {
  const payload = { ...fixture("pretooluse-workflow-agent-bash.json"), cwd: call.cwd, session_id: call.sessionId, tool_name: "Bash", tool_input: { command: expandPlaceholders(command, call) } };
  if (call.context === "main") {
    delete payload.agent_id;
    delete payload.agent_type;
    payload.permission_mode = "default";
  } else {
    payload.agent_id = "agent-d17";
    payload.agent_type = call.agentType;
  }
  if (call.dropAgentId) delete payload.agent_id;
  if (call.drop) delete payload[call.drop];
  return { ...payload, ...call.payload };
}

const callHook = (call, command) => runGate(payloadFor(call, command), { processCwd: call.cwd, gate: call.gate, path: call.path, env: call.env });

// The hook must run to completion: exit 0, nothing on stderr, and stdout either empty or one JSON decision.
function verdictOf({ code, stdout, stderr }) {
  assert.equal(code, 0, `the hook must exit 0; stderr: ${stderr}`);
  assert.equal(stderr, "", "the hook must not write to stderr");
  if (stdout === "") return { decision: "none", reason: "" };
  const { hookSpecificOutput } = JSON.parse(stdout);
  assert.equal(hookSpecificOutput.hookEventName, "PreToolUse");
  return { decision: hookSpecificOutput.permissionDecision, reason: hookSpecificOutput.permissionDecisionReason ?? "" };
}

function assertAllowed(result, label) {
  const { decision, reason } = verdictOf(result);
  assert.ok(decision === "none" || decision === "allow", `${label} should be allowed, but the hook gave ${decision}: ${reason}`);
}

function assertDenied(result, reasons, label) {
  const { decision, reason } = verdictOf(result);
  assert.equal(decision, "deny", `${label} should be denied, but the hook gave ${decision}`);
  for (const pattern of reasons) assert.match(reason, pattern, `${label}: the deny came from another rule`);
  return reason;
}

// ---------- the table rows that need the process ----------

const variantsOf = (setup, cell) => {
  if (setup === DRIFT_SETUP) return DRIFT_VARIANTS;
  if (cell.runState === "unit" && !(setup in LEDGER_SETUPS)) return [{ label: "with a ledger", ledger: "ok" }, { label: "without a ledger", ledger: "none" }];
  return [{ label: "", ledger: LEDGER_SETUPS[setup] ?? "ok" }];
};

// Allowed with a plugin copy that has no modules: the same copy must still deny what a subagent may never do, or the allow could be a hook that silently did nothing.
const CONTROL = { command: "git push origin main", context: "subagent" };

describe("D17 table rows that need the hook process", IN_PARALLEL, () => {
  for (const { name, row, cell, command, reasons } of expandRows(scenarios, (row) => !runsInUnitLayer(row))) {
    const setup = SETUPS[row.setup];
    assert.ok(row.setup === undefined || setup, `no fixture for setup "${row.setup}"`);
    for (const variant of variantsOf(row.setup, cell)) {
      test(variant.label === "" ? name : `${name} (${variant.label})`, async () => {
        const call = newCall({ ...cell, ledger: variant.ledger });
        setup?.(call);
        if (variant.drop) call.drop = variant.drop;

        const result = await callHook(call, command);

        if (row.expect === "deny") {
          const reason = assertDenied(result, reasons, name);
          if (row.forbid) assert.doesNotMatch(reason, row.forbid);
          return;
        }
        assertAllowed(result, name);
        if (call.gate === MISSING_MODULES) {
          const control = { ...call, context: CONTROL.context };
          assertDenied(await callHook(control, CONTROL.command), [FALLBACKS["no-run-gate-error"]], `${name}: control through the same copy`);
        }
      });
    }
  }
});

// ---------- one smoke row per command family ----------

// Defaults only: a repo on feature/x, the run state and the caller as given.
const SMOKE = [
  { rule: "commit", command: "git commit -m x", runState: "run", context: "subagent" },
  { rule: "bypass", command: "git commit --no-verify -m x", runState: "run", context: "main" },
  { rule: "push", command: "git push origin feature/x", runState: "unit", context: "main" },
  { rule: "protected-push", command: "git push origin main", runState: "none", context: "subagent" },
  { rule: "pr-write", command: "gh pr create --fill", runState: "run", context: "main" },
  { rule: "pr-merge", command: "gh pr merge 3", runState: "none", context: "subagent" },
  { rule: "revert", command: "git reset --hard", runState: "run", context: "main" },
  { rule: "unreadable", command: "git $VERB origin", runState: "run", context: "main" },
  { rule: "branch", command: "git checkout -b y", runState: "unit", context: "main" },
  { rule: "allowlist", command: "git add .", runState: "run", context: "subagent" },
];
const SMOKE_ALLOWS = [
  { command: "git commit -m x", runState: "run", context: "main" },
  { command: "git status", runState: "run", context: "subagent" },
  { command: "git push origin feature/x", runState: "none", context: "subagent" },
  { command: "git push origin main", runState: "none", context: "main" },
];

describe("one hook call per D17 rule family", IN_PARALLEL, () => {
  for (const { rule, command, runState, context } of SMOKE) {
    test(`${rule} denies ${command} [${runState}/${context}]`, async () => {
      const call = newCall({ runState, context });

      assertDenied(await callHook(call, command), [FAMILIES[rule]], command);
    });
  }
  for (const { command, runState, context } of SMOKE_ALLOWS) {
    test(`${command} is allowed [${runState}/${context}]`, async () => {
      const call = newCall({ runState, context });

      assertAllowed(await callHook(call, command), command);
    });
  }
});

// ---------- Write and Edit into a git directory ----------

// HEAD, refs, config and hooks decide what a push or a branch switch does, so the Write tools may not touch them while run
// state exists. A file that merely starts with .git (.gitignore) is no git directory.
describe("Write and Edit into a git directory while run state exists", IN_PARALLEL, () => {
  const writeCall = (cwd, tool, file) => {
    const payload = { ...fixture("pretooluse-workflow-agent-bash.json"), cwd, session_id: `d17-write-${++sessions}`, tool_name: tool };
    delete payload.agent_id;
    delete payload.agent_type;
    payload.permission_mode = "default";
    payload.tool_input = tool === "Edit" ? { file_path: file, old_string: "a", new_string: "b" } : { file_path: file, content: "x" };
    return payload;
  };
  const verdict = async (cwd, tool, file) => verdictOf(await runGate(writeCall(cwd, tool, file), { processCwd: cwd }));

  for (const runState of ["run", "unit"]) {
    for (const tool of ["Write", "Edit"]) {
      for (const file of [".git/HEAD", ".git/config", ".git/hooks/pre-push", ".git/refs/heads/x"]) {
        test(`${tool} ${file} is denied with ${runState} state`, async () => {
          const call = newCall({ runState, context: "main" });

          const { decision, reason } = await verdict(call.dir, tool, join(call.dir, file));

          assert.equal(decision, "deny");
          assert.match(reason, /\.git|git directory/i, "the deny names the git directory");
        });
      }
    }
    test(`Write .gitignore is not denied with ${runState} state`, async () => {
      const call = newCall({ runState, context: "main" });

      const { decision } = await verdict(call.dir, "Write", join(call.dir, ".gitignore"));

      assert.notEqual(decision, "deny");
    });
  }

  test("Write .git/config is not denied with no run state", async () => {
    const call = newCall({ runState: "none", context: "main" });

    const { decision } = await verdict(call.dir, "Write", join(call.dir, ".git", "config"));

    assert.notEqual(decision, "deny");
  });

  test("in a linked worktree, the worktree's own git directory and the common one are both denied", async () => {
    const base = scratchDir("d17-base-");
    git(base, "init", "-q", "-b", "main");
    git(base, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "seed");
    const wt = join(scratchDir("d17-wt-"), "wt");
    git(base, "worktree", "add", "-q", "-b", "other", wt);
    mkdirSync(join(wt, ".pairingbuddy", "run", "task"), { recursive: true });
    writeLedger(join(wt, ".pairingbuddy", "run", "task", "ledger.json"), baseLedger());

    for (const file of [join(base, ".git", "worktrees", "wt", "HEAD"), join(base, ".git", "config"), join(wt, ".git")]) {
      assert.equal((await verdict(wt, "Write", file)).decision, "deny", file);
    }
  });
});
