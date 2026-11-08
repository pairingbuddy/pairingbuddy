// Task 68a: pb pr lint, driven through the CLI. The draft is the PR body the tap wrote to run/pr-body.md and the title
// in the pr-draft artifact the tap filed under run/task/artifacts (the tap writes no separate title file).
import "./isolated-tmpdir.mjs";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeLedger } from "../../shared-node/ledger.mjs";
import { classOf, matchVerb } from "../../shared-node/verbs.mjs";
import { baseLedger } from "./ledger-fixture.mjs";
import { env, makeRepo, pb } from "./cli-repo-fixture.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const GATE = join(ROOT, "hooks", "gate-boot.mjs");
const CLEAN_TITLE = "feat: add export button";
const CLEAN_BODY = "## Summary\n\nAdds an export button to the report page so a reader can download the table as CSV.\n\n## Impact\n\nReaders get a new button; nothing else changes.\n";
const draftKey = (attempt) => `pr-draft.draft-pull-request.-.r1.a${attempt}`;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// A repo with a unit open, one commit on the unit branch, a ledger on the pr-draft stage at ledgerAttempt, and the draft
// artifacts the tap would have filed (one per attempt in titles, keyed by attempt number).
function repoWithDrafts({ titles, body, ledgerAttempt = 1 }) {
  const repo = makeRepo({ openTask: false, remote: true });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "export", "--yes");
  assert.equal(opened.code, 0, `unit open: ${opened.stderr}`);
  writeFileSync(join(repo.dir, "export.txt"), "export\n");
  execFileSync("git", ["add", "export.txt"], { cwd: repo.dir, env: env() });
  execFileSync("git", ["commit", "-q", "-m", "feat: add export"], { cwd: repo.dir, env: env() });
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  mkdirSync(join(runDir, "task", "artifacts"), { recursive: true });
  writeFileSync(join(runDir, "pr-body.md"), body);
  for (const [attempt, title] of Object.entries(titles)) {
    writeFileSync(join(runDir, "task", "artifacts", `${draftKey(attempt)}.json`), JSON.stringify({ pb_key: draftKey(attempt), title, body, labels: [], base: "main", coordination: null }));
  }
  writeLedger(join(runDir, "task", "ledger.json"), {
    ...baseLedger(),
    stage: { name: "pr-draft", status: "active", runId: "r1", attempt: ledgerAttempt },
    stages: [],
  });
  return { repo, runDir };
}

const repoWithDraft = ({ title, body }) => repoWithDrafts({ titles: { 1: title }, body });

test("cli-lints-pr-body-and-title-and-prints-result", () => {
  const bad = repoWithDraft({ title: "Added the export button", body: `${CLEAN_BODY}\nThis is a seamless upgrade.\n` });
  const clean = repoWithDraft({ title: CLEAN_TITLE, body: CLEAN_BODY });

  const dirty = pb(bad.repo, "pr", "lint");
  const ok = pb(clean.repo, "pr", "lint");

  assert.equal(dirty.code, 0, `a failed lint is a result, not a gate: ${dirty.stderr}`);
  const printed = JSON.parse(dirty.stdout);
  assert.equal(printed.ok, false);
  assert.ok(printed.failures.some(({ rule, text }) => rule === "title-form" && text === "Added the export button"), "names the title-form rule and the title");
  assert.ok(printed.failures.some(({ rule, text }) => rule === "hype" && text === "seamless"), "names the hype rule and the word");
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  assert.deepEqual(JSON.parse(ok.stdout).failures ?? [], []);
  const recorded = JSON.parse(readFileSync(join(bad.runDir, "pr-lint.json"), "utf8"));
  assert.equal(recorded.bodyHash, sha256(`${CLEAN_BODY}\nThis is a seamless upgrade.\n`), "the result is recorded with the body hash");
  assert.equal(recorded.ok, false);
});

test("lint-reads-current-attempt-draft", () => {
  const { repo } = repoWithDrafts({ titles: { 1: "Added the first draft", 2: CLEAN_TITLE }, body: CLEAN_BODY, ledgerAttempt: 1 });

  const result = pb(repo, "pr", "lint");

  assert.equal(result.code, 0, result.stderr);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.ok, false, "attempt 1's title is linted, not attempt 2's");
  assert.ok(printed.failures.some(({ rule, text }) => rule === "title-form" && text === "Added the first draft"), "names attempt 1's title");
});

// The gate sees a Bash call from the runner agent. A verb the table leaves out is denied; a runner verb is allowed.
function gateDecision(command) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pr-lint-gate-")));
  after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, ".pairingbuddy", "run", "task"), { recursive: true });
  writeLedger(join(dir, ".pairingbuddy", "run", "task", "ledger.json"), baseLedger());
  const payload = {
    session_id: "s1", cwd: dir, permission_mode: "default", hook_event_name: "PreToolUse", agent_type: "pairingbuddy:runner",
    agent_id: "a1", tool_name: "Bash", tool_input: { command, description: "run it" },
  };
  const { stdout } = spawnSync(process.execPath, [GATE], { cwd: dir, input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT } });
  return stdout === "" ? "none" : JSON.parse(stdout).hookSpecificOutput.permissionDecision;
}

test("pr-lint-verb-is-classified-for-the-runner", () => {
  const verb = matchVerb(["pr", "lint"]);

  assert.equal(verb, "pr lint");
  assert.equal(classOf(verb), "runner");
  assert.equal(gateDecision(`node ${join(ROOT, "cli", "pb.mjs")} pr lint`), "allow", "the gate allows the runner's pr lint");
});
