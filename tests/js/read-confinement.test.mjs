// Scenarios: lens-read-confinement, confined-agent-roster, confinement-denial-quality.
// Placeholders: each test fails until the confinement rule is implemented. Skips are not allowed.
import "./isolated-tmpdir.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { writeLedger } from "../../shared-node/ledger.mjs";
import { sessionsDirectory } from "../../shared-node/run-root.mjs";
import { fakeRepo, scratchDir } from "./d17-repos.mjs";
import { ROOT, assertAllowed, fixture, runGate } from "./gate-harness.mjs";
import { baseLedger } from "./ledger-fixture.mjs";

// A fake repo with a run ledger, and a subagent payload (agent_id and agent_type) standing in it.
let sessions = 0;
function repoWithRun() {
  const dir = fakeRepo();
  mkdirSync(join(dir, ".pairingbuddy", "run", "task"), { recursive: true });
  writeLedger(join(dir, ".pairingbuddy", "run", "task", "ledger.json"), baseLedger());
  writeFileSync(join(dir, "inside.txt"), "x");
  return dir;
}
const subagentCall = (dir, agentType, toolName, toolInput) => ({
  ...fixture("pretooluse-workflow-agent-bash.json"),
  cwd: dir,
  session_id: `read-confinement-${++sessions}`,
  agent_type: agentType,
  tool_name: toolName,
  tool_input: toolInput,
});

const placeholder = () => assert.fail("placeholder: not implemented");

// lens-read-confinement
test("lens_read_inside_repo_allowed", async () => {
  const dir = repoWithRun();
  const payload = subagentCall(dir, "pairingbuddy:lens", "Read", { file_path: join(dir, "inside.txt") });

  const result = await runGate(payload);

  assertAllowed(result);
});
test("lens_read_outside_repo_denied", async () => {
  const dir = repoWithRun();
  const outside = repoWithRun();
  const payload = subagentCall(dir, "pairingbuddy:lens", "Read", { file_path: join(outside, "inside.txt") });

  const result = await runGate(payload);

  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const decision = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
  assert.equal(decision, "deny", "a lens Read outside the repo toplevel must be denied");
});
test("lens_read_session_transcript_denied", async () => {
  const dir = repoWithRun();
  const transcript = join(process.env.HOME || "/home/user", ".claude", "projects", "-some-project", "session-abc.jsonl");
  const payload = subagentCall(dir, "pairingbuddy:lens", "Read", { file_path: transcript });

  const result = await runGate(payload);

  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const decision = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
  assert.equal(decision, "deny", "a lens Read of a session transcript must be denied");
});
test("lens_read_symlink_escape_denied", async () => {
  const dir = repoWithRun();
  const outside = repoWithRun();
  symlinkSync(join(outside, "inside.txt"), join(dir, "escape.txt"));
  const payload = subagentCall(dir, "pairingbuddy:lens", "Read", { file_path: join(dir, "escape.txt") });

  const result = await runGate(payload);

  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const decision = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
  assert.equal(decision, "deny", "a lens Read of a symlink pointing outside the repo must be denied");
});
test("lens_read_dotdot_traversal_denied", async () => {
  const dir = repoWithRun();
  const outside = repoWithRun();
  const climbing = relative(dir, join(outside, "inside.txt"));
  const payload = subagentCall(dir, "pairingbuddy:lens", "Read", { file_path: climbing });

  const result = await runGate(payload);

  assert.ok(climbing.startsWith(".."), `the path must climb out of the toplevel: ${climbing}`);
  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const decision = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
  assert.equal(decision, "deny", "a lens Read whose '..' segments climb out of the toplevel must be denied");
});
test("lens_grep_outside_path_denied", async () => {
  const dir = repoWithRun();
  const outside = repoWithRun();
  const payload = subagentCall(dir, "pairingbuddy:lens", "Grep", { pattern: "x", path: outside });

  const result = await runGate(payload);

  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const decision = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
  assert.equal(decision, "deny", "a lens Grep whose path is outside the repo toplevel must be denied");
});
test("lens_grep_no_path_uses_cwd", async () => {
  const dir = repoWithRun();
  const outside = scratchDir("read-confinement-outside-");
  const call = subagentCall(dir, "pairingbuddy:lens", "Grep", { pattern: "x" });
  mkdirSync(sessionsDirectory(), { recursive: true });
  writeFileSync(join(sessionsDirectory(), call.session_id), dir);
  const inRepo = await runGate(call);
  const outOfRepo = await runGate({ ...call, cwd: outside });

  assertAllowed(inRepo);
  assert.equal(outOfRepo.code, 0, `the JSON deny form needs exit 0; stderr: ${outOfRepo.stderr}`);
  const decision = outOfRepo.stdout ? JSON.parse(outOfRepo.stdout).hookSpecificOutput.permissionDecision : "allow";
  assert.equal(decision, "deny", "a lens Grep with no path must be denied when the payload cwd is outside the repo toplevel");
});
test("lens_glob_outside_path_or_pattern_denied", async () => {
  const dir = repoWithRun();
  const outside = repoWithRun();
  const denied = async (toolInput, why) => {
    const call = subagentCall(dir, "pairingbuddy:lens", "Glob", toolInput);
    mkdirSync(sessionsDirectory(), { recursive: true });
    writeFileSync(join(sessionsDirectory(), call.session_id), dir);
    const result = await runGate(call);
    assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
    const decision = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
    assert.equal(decision, "deny", why);
  };

  await denied({ pattern: "*.txt", path: outside }, "a lens Glob whose path is outside the repo toplevel must be denied");
  await denied({ pattern: join(outside, "*.txt") }, "a lens Glob with an absolute pattern outside the repo toplevel must be denied");
  await denied({ pattern: "../**/*.txt" }, "a lens Glob whose pattern starts with ../ must be denied");
});

// confined-agent-roster
test("refuter_and_synthesizer_confined_like_lens", async () => {
  const dir = repoWithRun();
  const outside = repoWithRun();
  const decisionOf = (result) => {
    assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
    return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
  };

  for (const agentType of ["pairingbuddy:refuter", "pairingbuddy:synthesizer"]) {
    const inside = subagentCall(dir, agentType, "Read", { file_path: join(dir, "inside.txt") });
    const outsideCall = subagentCall(dir, agentType, "Read", { file_path: join(outside, "inside.txt") });
    for (const call of [inside, outsideCall]) {
      mkdirSync(sessionsDirectory(), { recursive: true });
      writeFileSync(join(sessionsDirectory(), call.session_id), dir);
    }

    const allowed = await runGate(inside);
    const denied = await runGate(outsideCall);

    assertAllowed(allowed);
    assert.equal(decisionOf(denied), "deny", `a ${agentType} Read outside the repo toplevel must be denied`);
  }
});
test("other_agents_and_main_unaffected", async () => {
  const dir = repoWithRun();
  const outside = repoWithRun();
  const implementer = subagentCall(dir, "pairingbuddy:implement-code", "Read", { file_path: join(outside, "inside.txt") });
  const main = subagentCall(dir, undefined, "Read", { file_path: join(outside, "inside.txt") });
  delete main.agent_type;
  delete main.agent_id;
  for (const call of [implementer, main]) {
    mkdirSync(sessionsDirectory(), { recursive: true });
    writeFileSync(join(sessionsDirectory(), call.session_id), dir);
  }

  const implementerResult = await runGate(implementer);
  const mainResult = await runGate(main);

  assertAllowed(implementerResult);
  assertAllowed(mainResult);
});
test("linked_worktree_toplevel_is_the_boundary", async () => {
  const main = scratchDir("read-confinement-main-");
  const git = (cwd, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" });
  git(main, "init", "-q");
  writeFileSync(join(main, "main-only.txt"), "x");
  git(main, "-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
  git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  const dir = join(scratchDir("read-confinement-wt-"), "linked");
  git(main, "worktree", "add", "-q", "-b", "linked-x", dir);
  mkdirSync(join(dir, ".pairingbuddy", "run", "task"), { recursive: true });
  writeLedger(join(dir, ".pairingbuddy", "run", "task", "ledger.json"), baseLedger());
  const inside = subagentCall(dir, "pairingbuddy:lens", "Read", { file_path: join(dir, "main-only.txt") });
  const outside = subagentCall(dir, "pairingbuddy:lens", "Read", { file_path: join(main, "main-only.txt") });
  for (const call of [inside, outside]) {
    mkdirSync(sessionsDirectory(), { recursive: true });
    writeFileSync(join(sessionsDirectory(), call.session_id), dir);
  }

  const allowed = await runGate(inside);
  const denied = await runGate(outside);

  assertAllowed(allowed);
  assert.equal(denied.code, 0, `the JSON deny form needs exit 0; stderr: ${denied.stderr}`);
  const decision = denied.stdout ? JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision : "allow";
  assert.equal(decision, "deny", "a lens Read in the main checkout must be denied from a linked worktree");
});
test("confined_agent_with_no_run_state_still_confined", async () => {
  const dir = fakeRepo();
  const outside = fakeRepo();
  writeFileSync(join(outside, "inside.txt"), "x");
  const payload = subagentCall(dir, "pairingbuddy:lens", "Read", { file_path: join(outside, "inside.txt") });

  const result = await runGate(payload);

  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const decision = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
  assert.equal(decision, "deny", "a lens Read outside the repo toplevel must be denied even with no run state");
});

// confinement-denial-quality
test("deny_message_names_the_rule", async () => {
  const dir = repoWithRun();
  const outside = repoWithRun();
  const outsidePath = join(outside, "inside.txt");
  const payload = subagentCall(dir, "pairingbuddy:lens", "Read", { file_path: outsidePath });

  const result = await runGate(payload);

  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.permissionDecision, "deny", "a lens Read outside the repo toplevel must be denied");
  assert.ok(output.permissionDecisionReason.includes("pairingbuddy:lens"), `the reason must name the agent type: ${output.permissionDecisionReason}`);
  assert.ok(output.permissionDecisionReason.includes(outsidePath), `the reason must name the denied path: ${output.permissionDecisionReason}`);
  assert.ok(output.permissionDecisionReason.includes(realpathSync(dir)), `the reason must name the repo toplevel: ${output.permissionDecisionReason}`);
});
test("unknown_toplevel_fails_closed", async () => {
  const plain = scratchDir("read-confinement-plain-");
  writeFileSync(join(plain, "inside.txt"), "x");
  const payload = subagentCall(plain, "pairingbuddy:lens", "Read", { file_path: join(plain, "inside.txt") });

  const result = await runGate(payload);

  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const output = JSON.parse(result.stdout || "{}").hookSpecificOutput;
  assert.equal(output?.permissionDecision, "deny", "a lens Read must be denied when the repo toplevel cannot be determined");
  assert.match(output.permissionDecisionReason, /toplevel.*unknown|unknown.*toplevel/i, `the reason must say the toplevel is unknown: ${output.permissionDecisionReason}`);
});
test("session_bound_to_run_a_cannot_read_repo_b_from_cwd_in_b", async () => {
  const repoA = repoWithRun();
  const repoB = fakeRepo();
  writeFileSync(join(repoB, "inside.txt"), "x");
  const call = subagentCall(repoB, "pairingbuddy:lens", "Read", { file_path: join(repoB, "inside.txt") });
  mkdirSync(sessionsDirectory(), { recursive: true });
  writeFileSync(join(sessionsDirectory(), call.session_id), repoA);

  const result = await runGate(call);

  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  const decision = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
  assert.equal(decision, "deny", "a lens Read in repo B must be denied when the session's run is in repo A");
});

// hardening
const denyDecision = (result) => {
  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
};
test("lens_glob_brace_tilde_and_inner_dotdot_patterns_denied", async () => {
  const dir = repoWithRun();
  const outside = repoWithRun();
  for (const pattern of [`{${outside},nothing}/*.txt`, "~/*", "*/../../*.txt", "**/../../*.txt"]) {
    const call = subagentCall(dir, "pairingbuddy:lens", "Glob", { pattern });
    mkdirSync(sessionsDirectory(), { recursive: true });
    writeFileSync(join(sessionsDirectory(), call.session_id), dir);
    assert.equal(denyDecision(await runGate(call)), "deny", `a lens Glob pattern ${pattern} must be denied`);
  }
});
test("lens_glob_inside_pattern_allowed", async () => {
  const dir = repoWithRun();
  const call = subagentCall(dir, "pairingbuddy:lens", "Glob", { pattern: "{inside,other}.txt" });
  mkdirSync(sessionsDirectory(), { recursive: true });
  writeFileSync(join(sessionsDirectory(), call.session_id), dir);

  assertAllowed(await runGate(call));
});
test("confined_agent_other_tools_denied_with_and_without_run", async () => {
  const withRun = repoWithRun();
  const noRun = fakeRepo();
  for (const dir of [withRun, noRun]) {
    for (const [tool, input] of [["NotebookRead", { notebook_path: join(dir, "x.ipynb") }], ["Bash", { command: "cat /etc/hosts" }]]) {
      const call = subagentCall(dir, "pairingbuddy:lens", tool, input);
      mkdirSync(sessionsDirectory(), { recursive: true });
      writeFileSync(join(sessionsDirectory(), call.session_id), dir);
      assert.equal(denyDecision(await runGate(call)), "deny", `a lens ${tool} must be denied`);
    }
  }
});
test("confined_agent_structured_output_allowed_with_and_without_run", async () => {
  for (const dir of [repoWithRun(), fakeRepo()]) {
    for (const agent of ["pairingbuddy:lens", "pairingbuddy:refuter", "pairingbuddy:synthesizer"]) {
      const call = subagentCall(dir, agent, "StructuredOutput", { findings: [] });
      assert.notEqual(denyDecision(await runGate(call)), "deny", `${agent} must be able to return StructuredOutput`);
    }
  }
});
// The registered matcher must reach the read tools, or the rule above never runs in a real session.
test("gate_matcher_covers_the_read_tools", () => {
  const { hooks } = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
  const [entry] = hooks.PreToolUse.filter((e) => e.hooks.some((h) => h.command.includes("hooks/gate-boot.mjs")));
  const matches = (tool) => new RegExp(`^(?:${entry.matcher || ".*"})$`).test(tool);
  for (const tool of ["Read", "Grep", "Glob"]) assert.ok(matches(tool), `the gate's matcher must cover ${tool}`);
});
test("main_read_with_a_broken_ledger_allowed", async () => {
  const dir = repoWithRun();
  writeFileSync(join(dir, ".pairingbuddy", "run", "task", "ledger.json"), "{ not json");
  const main = subagentCall(dir, undefined, "Read", { file_path: join(dir, "inside.txt") });
  delete main.agent_type;
  delete main.agent_id;

  assertAllowed(await runGate(main));
});
