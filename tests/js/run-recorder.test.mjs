// The test-only recorder behind T4a's replay rig. It watches a run from outside, so it must never touch one.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { RunRecorder, assertOutsidePlans, spawnEvents, workflowAgents } from "../smoke/run-recorder.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-recorder-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const ledgerText = (seq, name = "code-tdd", status = "active") => JSON.stringify({ seq, stage: { name, status } });

function repoWithLedger(t) {
  const repo = tempDir(t);
  const dir = join(repo, ".pairingbuddy", "run", "task");
  mkdirSync(dir, { recursive: true });
  return { repo, ledger: join(dir, "ledger.json") };
}

const readJsonl = (path) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));

test("each new ledger seq is one snapshot with a time, and a partial write is skipped", async (t) => {
  const { repo, ledger } = repoWithLedger(t);
  const out = join(tempDir(t), "rec");
  const recorder = new RunRecorder(repo, out, { intervalMs: 2 }).start();

  writeFileSync(ledger, ledgerText(1));
  await sleep(30);
  writeFileSync(ledger, ledgerText(1));
  await sleep(30);
  writeFileSync(ledger, "{half");
  await sleep(30);
  writeFileSync(ledger, ledgerText(2, "code-tdd", "done"));
  await sleep(30);
  recorder.stop();

  const snapshots = readJsonl(join(out, "ledger.jsonl"));
  assert.deepEqual(snapshots.map(({ ledger: { seq } }) => seq), [1, 2]);
  assert.ok(snapshots.every(({ t: at }) => Number.isFinite(at) && at >= 0));
  assert.equal(recorder.last.seq, 2, "the last ledger outlives the run");
  assert.deepEqual(recorder.snapshots.map(({ seq }) => seq), [1, 2], "every ledger seen stays at hand for the smoke's checks");
  assert.equal(JSON.parse(readFileSync(ledger, "utf8")).seq, 2, "the ledger is left as it was");
});

test("a ledger that goes away keeps the last one", async (t) => {
  const { repo, ledger } = repoWithLedger(t);
  const recorder = new RunRecorder(repo, join(tempDir(t), "rec"), { intervalMs: 2 }).start();

  writeFileSync(ledger, ledgerText(3));
  await sleep(30);
  rmSync(ledger);
  await sleep(30);
  recorder.stop();

  assert.equal(recorder.last.seq, 3);
});

test("the stream is kept line by line with times, and timing covers each stage", async (t) => {
  const { repo, ledger } = repoWithLedger(t);
  const out = join(tempDir(t), "rec");
  let clock = 0;
  const streamPath = join(out, "raw", "stream.jsonl");
  const recorder = new RunRecorder(repo, out, { intervalMs: 1000, now: () => clock, streamPath }).start();

  clock = 1000;
  recorder.line({ type: "system", subtype: "init" });
  writeFileSync(ledger, ledgerText(1, "code-tdd", "active"));
  recorder.poll();
  clock = 4000;
  writeFileSync(ledger, ledgerText(2, "code-tdd", "done"));
  recorder.poll();
  clock = 5000;
  recorder.stop();

  assert.deepEqual(readJsonl(streamPath), [{ t: 1, event: { type: "system", subtype: "init" } }]);
  assert.equal(existsSync(join(out, "stream.jsonl")), false, "the bulky stream goes where it is told, and the recording stays small");
  assert.deepEqual(JSON.parse(readFileSync(join(out, "timing.json"), "utf8")), { seconds: 5, stageSeconds: { "code-tdd": 3 } });
});

test("spawn events name each Workflow, Agent and Skill call and each workflow agent, in time order", () => {
  const stream = [
    { t: 1, event: { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "Skill", input: { skill: "pairingbuddy:coding" } }, { type: "tool_use", id: "b", name: "Bash", input: { command: "ls" } }] } } },
    { t: 2, event: { type: "assistant", message: { content: [{ type: "tool_use", id: "c", name: "Agent", input: { subagent_type: "pairingbuddy:classify-task" } }] } } },
    { t: 3, event: { type: "assistant", message: { content: [{ type: "tool_use", id: "d", name: "Workflow", input: { name: "pairingbuddy:code-tdd" } }] } } },
    { t: 4, event: { type: "system", subtype: "task_started", task_id: "x", description: "code-tdd/RED/implement-tests/t1/r1", task_type: "local_agent" } },
    { t: 4.5, event: { type: "system", subtype: "task_progress", task_id: "x", description: "Reading a", last_tool_name: "Read" } },
    { t: 5, event: { type: "system", subtype: "task_notification", task_id: "x", status: "completed" } },
    { t: 6, event: { type: "user", message: { content: "plain" } } },
  ];

  assert.deepEqual(spawnEvents(stream), [
    { t: 1, kind: "Skill", name: "pairingbuddy:coding" },
    { t: 2, kind: "Agent", name: "pairingbuddy:classify-task" },
    { t: 3, kind: "Workflow", name: "pairingbuddy:code-tdd" },
    { t: 4, kind: "task_started", name: "code-tdd/RED/implement-tests/t1/r1", id: "x" },
    { t: 4.5, kind: "task_progress", name: "Reading a", id: "x" },
    { t: 5, kind: "task_notification", name: "completed", id: "x" },
  ]);
});

function workflowDir(t) {
  const dir = tempDir(t);
  writeFileSync(join(dir, "agent-a1.meta.json"), JSON.stringify({ agentType: "pairingbuddy:implement-tests", description: "pb1 code-tdd RED implement-tests t1 r1", workflowPhase: "implement-tests" }));
  writeFileSync(join(dir, "agent-a1.jsonl"), ["2026-11-03T01:00:02.000Z", "2026-11-03T01:00:05.500Z"].map((timestamp) => JSON.stringify({ timestamp, type: "user" })).join("\n"));
  writeFileSync(join(dir, "agent-a2.meta.json"), "{broken");
  return dir;
}

test("a workflow's own agents are read from its transcript dir, each with its label and its span", (t) => {
  const dir = workflowDir(t);
  const startedAt = Date.parse("2026-11-03T01:00:00.000Z");

  assert.deepEqual(workflowAgents([dir], startedAt), [
    { t: 2, kind: "workflow_agent", name: "pb1 code-tdd RED implement-tests t1 r1", id: "a1", agentType: "pairingbuddy:implement-tests", phase: "implement-tests", seconds: 3.5 },
  ]);
});

test("stop merges workflow agents into the spawn events, in time order", (t) => {
  const dir = workflowDir(t);
  const { repo } = repoWithLedger(t);
  const out = join(tempDir(t), "rec");
  let clock = Date.parse("2026-11-03T01:00:00.000Z");
  const recorder = new RunRecorder(repo, out, { intervalMs: 1000, now: () => clock }).start();

  clock += 1000;
  recorder.line({ type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "Workflow", input: { name: "w" } }] } });
  clock += 2000;
  recorder.line({ type: "user", message: { content: [{ type: "tool_result", content: `Transcript dir: ${dir}\n` }] } });
  recorder.stop();

  assert.deepEqual(readJsonl(join(out, "spawns.jsonl")).map(({ kind }) => kind), ["Workflow", "workflow_agent"]);
});

test("the spawn events are at hand before stop, for the smoke's checks", (t) => {
  const dir = workflowDir(t);
  const { repo } = repoWithLedger(t);
  let clock = Date.parse("2026-11-03T01:00:00.000Z");
  const recorder = new RunRecorder(repo, join(tempDir(t), "rec"), { intervalMs: 1000, now: () => clock }).start();

  clock += 1000;
  recorder.line({ type: "user", message: { content: [{ type: "tool_result", content: `Transcript dir: ${dir}\n` }] } });

  const spawns = recorder.spawns();
  recorder.stop();

  assert.deepEqual(spawns.map(({ agentType }) => agentType), ["pairingbuddy:implement-tests"]);
});

test("stop writes the spawn events beside the stream", (t) => {
  const { repo } = repoWithLedger(t);
  const out = join(tempDir(t), "rec");
  const recorder = new RunRecorder(repo, out, { intervalMs: 1000 }).start();

  recorder.line({ type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "Workflow", input: { name: "w" } }] } });
  recorder.stop();

  assert.equal(readJsonl(join(out, "spawns.jsonl"))[0].name, "w");
});

const bash = (id, command) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
const result = (id, content, isError = false) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

test("what each pb task end printed is kept with its command, so a leftover count needs no transcript", (t) => {
  const { repo } = repoWithLedger(t);
  const out = join(tempDir(t), "rec");
  let clock = 0;
  const recorder = new RunRecorder(repo, out, { intervalMs: 1000, now: () => clock }).start();

  recorder.line(bash("a", "node /p/cli/pb.mjs status --action"));
  recorder.line(result("a", '{"ok":true}'));
  clock = 2000;
  recorder.line(bash("b", "node /p/cli/pb.mjs task end"));
  clock = 3000;
  recorder.line(result("b", "pb: the tree is dirty, so the task cannot end", true));
  recorder.line(bash("c", "node /p/cli/pb.mjs task end"));
  recorder.line(result("c", [{ type: "text", text: '{"ok":true,"removed":"/r/.pairingbuddy/run/task"}' }]));
  recorder.stop();

  assert.deepEqual(readJsonl(join(out, "task-end.jsonl")), [
    { t: 3, command: "node /p/cli/pb.mjs task end", output: "pb: the tree is dirty, so the task cannot end", isError: true },
    { t: 3, command: "node /p/cli/pb.mjs task end", output: '{"ok":true,"removed":"/r/.pairingbuddy/run/task"}', isError: false },
  ]);
});

for (const [name, invocation] of [
  ["$PB", "node $PB task end"],
  ["$P", "node $P task end"],
  ['"$P"', 'node "$P" task end'],
  ["${PB}", "node ${PB} task end"],
]) {
  test(`a pb task end run through ${name} is kept with its command and output`, (t) => {
    const { repo } = repoWithLedger(t);
    const out = join(tempDir(t), "rec");
    const recorder = new RunRecorder(repo, out, { intervalMs: 1000, now: () => 0 }).start();
    // Mirrors the live run: both variables are set, and the call is followed by 2>&1 and an exit echo. Only the command text is matched.
    const command = `P=/x/cli/pb.mjs; PB=/x/cli/pb.mjs; ${invocation} 2>&1; echo "exit=$?"`;

    recorder.line(bash("a", command));
    recorder.line(result("a", '{"ok":true}\nexit=0'));
    recorder.stop();

    assert.deepEqual(
      readJsonl(join(out, "task-end.jsonl")),
      [{ t: 0, command, output: '{"ok":true}\nexit=0', isError: false }],
      `a pb task end called as "${invocation}" is recognised`,
    );
  });
}

test("a run that never reached pb task end still writes an empty task-end file", (t) => {
  const { repo } = repoWithLedger(t);
  const out = join(tempDir(t), "rec");
  const recorder = new RunRecorder(repo, out, { intervalMs: 1000 }).start();

  recorder.line(bash("a", "echo task ended"));
  recorder.line(result("a", "task ended"));
  recorder.stop();

  assert.equal(readFileSync(join(out, "task-end.jsonl"), "utf8"), "");
});

test("a recording under docs/plans is refused, before anything is written", (t) => {
  const repo = tempDir(t);

  for (const out of [join(ROOT, "docs", "plans"), join(ROOT, "docs", "plans", "rec"), "docs/plans/rec"]) {
    assert.throws(() => assertOutsidePlans(out), /docs\/plans/);
    assert.throws(() => new RunRecorder(repo, out), /docs\/plans/);
  }
  assert.equal(existsSync(join(ROOT, "docs", "plans", "rec")), false);
  assertOutsidePlans(join(ROOT, "tests", "smoke", "recordings", "a"));
});

test("the recorder writes nothing under the repo it watches", async (t) => {
  const { repo, ledger } = repoWithLedger(t);
  writeFileSync(ledger, ledgerText(1));
  const before = readdirSync(join(repo, ".pairingbuddy", "run", "task"));
  const recorder = new RunRecorder(repo, join(tempDir(t), "rec"), { intervalMs: 2 }).start();

  await sleep(20);
  recorder.stop();

  assert.deepEqual(readdirSync(join(repo, ".pairingbuddy", "run", "task")), before);
});

test("the recorder ships only as test tooling: nothing a run loads reaches it", () => {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "cli", "hooks", "shared-node", "workflows", "workflows-src", "skills", "agents", "commands", "contracts", "scripts", ".claude-plugin"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");

  const reaching = files.filter((file) => /run-recorder|tests\/smoke/.test(readFileSync(join(ROOT, file), "utf8")));

  assert.deepEqual(reaching, []);
});
