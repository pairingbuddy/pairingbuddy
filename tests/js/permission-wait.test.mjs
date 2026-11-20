// Scenario permission-prompt-needs-you: Claude Code's own permission prompt is the human being needed. Its Notification
// hook (notification_type permission_prompt, six seconds after the prompt shows) opens a permission wait in the ledger; the
// next tool call, the turn's end or the human's next prompt closes it. While it is open the run needs the human, and the
// time counts as waiting, as a gate question's does.
import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { gateLine, glance, waitedSeconds } from "../../shared-node/glance.mjs";
import { withPermissionAsk } from "../../shared-node/permission-wait.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const HOOK = join(ROOT, "hooks", "permission.mjs");

function makeLedger() {
  return {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "publish", taskType: "publish",
    owner: { sessionId: null, lastSeen: null }, task: "Add order_total",
    plan: { path: "", title: "" }, configHash: "a".repeat(64),
    policy: { mode: "default", source: "constant" }, stage: { name: "pr-draft", status: "active", runId: null, attempt: 1 }, stages: [],
    gates: {}, tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop: null, needsHuman: null,
  };
}

function makeRun(ledger = makeLedger()) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "permission-")));
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(taskDir, { recursive: true });
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, ledger);
  return { dir, ledgerPath, ledger: () => readLedger(ledgerPath), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const runHook = (payload) => spawnSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });

const prompt = (cwd, tool = "Workflow") => ({ hook_event_name: "Notification", session_id: "s1", cwd, notification_type: "permission_prompt", message: `Claude needs your permission to use ${tool}`, title: "Claude Code" });

describe("permission-prompt-needs-you", () => {
  test("a permission prompt during a run opens a permission wait naming the tool, and prints nothing", () => {
    const run = makeRun();
    try {
      const result = runHook(prompt(run.dir));

      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      const [wait] = run.ledger().permissionWaits;
      assert.equal(wait.tool, "Workflow");
      assert.ok(Math.abs(Date.parse(wait.askedAt) - Date.now()) < 60_000, `askedAt is now, got ${wait.askedAt}`);
      assert.equal(wait.answeredAt, undefined, "still open");
    } finally {
      run.cleanup();
    }
  });

  // Each sign the prompt was answered: a tool call starts or ends (the stage's own agents included), the turn ends, or the human types.
  for (const event of ["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit"]) {
    test(`${event} after the prompt closes the open wait`, () => {
      const run = makeRun();
      try {
        runHook(prompt(run.dir));

        const result = runHook({ hook_event_name: event, session_id: "s1", cwd: run.dir, tool_name: "Bash", agent_id: "a1" });

        assert.equal(result.stdout, "");
        const [wait] = run.ledger().permissionWaits;
        assert.ok(Date.parse(wait.answeredAt) >= Date.parse(wait.askedAt), `answered after it was asked, got ${JSON.stringify(wait)}`);
      } finally {
        run.cleanup();
      }
    });
  }

  test("a tool call with no wait open leaves the ledger as it was", () => {
    const run = makeRun();
    try {
      const before = run.ledger();

      runHook({ hook_event_name: "PostToolUse", session_id: "s1", cwd: run.dir, tool_name: "Bash" });

      assert.equal(run.ledger().seq, before.seq, "nothing was written");
    } finally {
      run.cleanup();
    }
  });

  test("a second prompt while one is open keeps the first wait; one after it was answered opens another", () => {
    const run = makeRun();
    try {
      runHook(prompt(run.dir));
      runHook(prompt(run.dir, "Bash"));
      assert.equal(run.ledger().permissionWaits.length, 1);

      runHook({ hook_event_name: "PostToolUse", session_id: "s1", cwd: run.dir, tool_name: "Workflow" });
      runHook(prompt(run.dir, "Bash"));

      assert.deepEqual(run.ledger().permissionWaits.map((wait) => wait.tool), ["Workflow", "Bash"]);
    } finally {
      run.cleanup();
    }
  });

  test("a prompt with no run, or another notification, writes nothing", () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "no-run-")));
    const run = makeRun();
    try {
      assert.equal(runHook(prompt(outside)).status, 0);
      runHook({ ...prompt(run.dir), notification_type: "idle_prompt" });

      assert.equal(run.ledger().permissionWaits, undefined);
    } finally {
      run.cleanup();
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("permission-wait-reads-as-needs-you", () => {
  const open = (tool) => ({ ...makeLedger(), seq: 5, permissionWaits: [{ askedAt: "2026-11-20T14:43:25.000Z", seq: 5, ...(tool ? { tool } : {}) }] });

  test("an open wait reads as the question waiting on the human, in plain words that name what the tool is for", () => {
    const asked = withPermissionAsk(open("Workflow"));

    assert.equal(asked.needsHuman.seq, 5, "the wait's own seq, so the alert fires once for it");
    assert.equal(gateLine(asked.needsHuman.gate), "Claude Code is asking your permission to start the next step");
    assert.equal(gateLine(withPermissionAsk(open("Bash")).needsHuman.gate), "Claude Code is asking your permission to use Bash");
    assert.equal(gateLine(withPermissionAsk(open()).needsHuman.gate), "Claude Code is asking your permission");
  });

  test("the band leads with it, standing, as with any question", () => {
    const { band } = glance({ ledger: withPermissionAsk(open("Workflow")), now: Date.now() });

    assert.deepEqual(band.find((segment) => segment.id === "needsYou"), { id: "needsYou", text: "needs you: Claude Code is asking your permission to start the next step", standing: true });
  });

  test("an answered wait, a stop or a gate question already asking leaves the ledger as it is", () => {
    const answered = { ...open("Workflow"), permissionWaits: [{ ...open("Workflow").permissionWaits[0], answeredAt: "2026-11-20T21:15:00.000Z" }] };
    const stopped = { ...open("Workflow"), stop: { reason: "x", seq: 4, code: "human-stopped" } };
    const asking = { ...open("Workflow"), needsHuman: { gate: "G:publish", reason: "x", seq: 4 } };

    for (const ledger of [answered, stopped, asking]) assert.deepEqual(withPermissionAsk(ledger), ledger);
  });
});

describe("permission-wait-is-no-working-time", () => {
  const at = (clock) => `2026-11-20T${clock}.000Z`;
  const ledger = (permissionWaits) => ({ ...makeLedger(), permissionWaits });

  test("an answered wait counts from askedAt to answeredAt, an open one to now", () => {
    const waits = [{ askedAt: at("14:43:25"), seq: 4, tool: "Workflow", answeredAt: at("21:15:25") }, { askedAt: at("21:30:00"), seq: 9 }];

    assert.equal(waitedSeconds(ledger(waits), Date.parse(at("21:31:00"))), 6 * 3600 + 32 * 60 + 60);
  });

  test("the time spent leaves the wait out", () => {
    const waits = [{ askedAt: at("10:01:00"), seq: 4, answeredAt: at("10:31:00") }];
    const running = { ...ledger(waits), stage: { name: "pr-draft", status: "active", runId: null, attempt: 1, startedAt: at("10:00:00") } };

    assert.match(glance({ ledger: running, now: Date.parse(at("10:40:00")) }).rows.spent, / · 10:00 · /);
  });
});
