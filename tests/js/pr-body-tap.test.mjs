import "./isolated-tmpdir.mjs";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeLedger } from "../../shared-node/ledger.mjs";

// The tap writes run/pr-body.md from the draft-pull-request return, guarded like the artifact filing.
const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const STAGE = "pr-draft";
const AGENT = "draft-pull-request";
const KEY = `${STAGE}.${AGENT}.-.r1.a1`;
const BODY = "## Summary\n\nExport lands as one button.\n\n## Impact\n\nNone for existing users.\n";
const CONFIG_TEXT = '{"runners":{}}\n';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeRepo({ stageName = STAGE, attempt = 1 } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pr-body-tap-")));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeLedger(join(taskDir, "ledger.json"), {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "Task 68",
    plan: { path: "", title: "" }, configHash: createHash("sha256").update(CONFIG_TEXT).digest("hex"),
    policy: { mode: "", source: "" },
    stage: { name: stageName, status: "running", runId: "wf_1", attempt, startedAt: null },
    stages: [{ name: stageName, status: "running" }],
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
  });
  return { dir, taskDir, body: join(dir, ".pairingbuddy", "run", "pr-body.md") };
}

function tap(repo, { agent = `pairingbuddy:${AGENT}`, key = KEY, fields = {} } = {}) {
  const toolInput = { pb_key: key, title: "Add export", body: BODY, labels: [], base: "main", coordination: null, ...fields };
  const payload = { session_id: "pr-body-session", cwd: repo.dir, hook_event_name: "PostToolUse", tool_name: "StructuredOutput", agent_type: agent, tool_input: toolInput, tool_response: "ok" };
  const { status } = spawnSync(process.execPath, [join(ROOT, "hooks", "tap.mjs")], { cwd: repo.dir, input: JSON.stringify(payload), env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT }, encoding: "utf8" });
  assert.equal(status, 0, "the tap exits 0");
}

test("tap-writes-pr-body-md-from-the-return-body-and-still-files-the-artifact", () => {
  const repo = makeRepo();

  tap(repo);

  assert.equal(readFileSync(repo.body, "utf8"), BODY);
  assert.equal(JSON.parse(readFileSync(join(repo.taskDir, "artifacts", `${KEY}.json`), "utf8")).title, "Add export");
});

for (const [name, repoOver, tapOver, key] of [
  ["another-agent", {}, { agent: "pairingbuddy:commit-changes" }, KEY],
  ["a-different-stage", { stageName: "code-tdd" }, {}, KEY],
  ["a-different-attempt", { attempt: 2 }, {}, KEY],
]) {
  test(`tap-writes-no-pr-body-md-for-${name}`, () => {
    const repo = makeRepo(repoOver);

    tap(repo, { ...tapOver, key });

    assert.equal(existsSync(repo.body), false);
  });
}

// Scenario: pr-draft-cli-and-tap
test("tap-writes-pr-body-for-pr-draft-fix-return", () => {
  const redraft = "## Summary\n\nExport lands as one button, redrafted.\n";
  const fixKey = `${STAGE}.fix.g1.r2.a1`;
  const repo = makeRepo();
  tap(repo);

  tap(repo, { key: fixKey, fields: { body: redraft } });

  assert.equal(readFileSync(repo.body, "utf8"), redraft, "the redraft replaces the first draft's body");
});

test("tap-writes-no-pr-body-for-another-stage-fix-return", () => {
  const other = makeRepo({ stageName: "code-scenarios" });

  tap(other, { agent: "pairingbuddy:enumerate-scenarios-and-test-cases", key: "code-scenarios.fix.g1.r2.a1", fields: { body: "## Summary\n\nRedrafted.\n" } });

  assert.equal(existsSync(other.body), false, "a fix return from another stage writes no pr-body.md");
});
