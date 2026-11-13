import "./isolated-tmpdir.mjs";
// Scenario owner-last-seen-refresh. Drives the real gate hook as a subprocess against a temp git repo.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { assertAllowed, fixture, runGate } from "./gate-harness.mjs";
import { baseLedger, withIntake } from "./ledger-fixture.mjs";

const CONFIG_TEXT = '{"runners":{}}\n';
const OWNER = "owner-last-seen-session";
// The recorded policy matches the payload's permission_mode, so the gate has no policy to write.
const MODE = "default";

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function ownedRepo(lastSeen) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "last-seen-")));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), CONFIG_TEXT);
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, withIntake({
    ...baseLedger(),
    plan: { path: "", title: "" },
    configHash: createHash("sha256").update(CONFIG_TEXT).digest("hex"),
    policy: { mode: MODE, source: "permission_mode" },
    owner: { sessionId: OWNER, lastSeen },
  }));
  return { dir, read: () => readLedger(ledgerPath), bytes: () => readFileSync(ledgerPath) };
}

function mainBashCall(cwd, session) {
  const { agent_id: _id, agent_type: _type, ...base } = fixture("pretooluse-workflow.json");
  return { ...base, session_id: session, cwd, permission_mode: MODE, tool_name: "Bash", tool_input: { command: "ls", description: "run it" } };
}

async function assertRefreshed(label, lastSeen) {
  const repo = ownedRepo(lastSeen);

  assertAllowed(await runGate(mainBashCall(repo.dir, OWNER)));

  const { owner } = repo.read();
  const seenAt = Date.parse(owner.lastSeen);
  assert.equal(owner.sessionId, OWNER, `${label}: the owner stays the same session`);
  assert.ok(Number.isFinite(seenAt), `${label}: lastSeen must be a parseable time: ${owner.lastSeen}`);
  assert.ok(Math.abs(Date.now() - seenAt) < 10_000, `${label}: lastSeen must be within the last few seconds: ${owner.lastSeen}`);
}

describe("owner-last-seen-refresh", () => {
  test("owner-call-with-stale-last-seen-refreshes-it", async () => {
    await assertRefreshed("lastSeen 120s old", new Date(Date.now() - 120_000).toISOString());
    await assertRefreshed("lastSeen null", null);
  });

  test("owner-call-with-fresh-last-seen-writes-nothing", async () => {
    const repo = ownedRepo(new Date(Date.now() - 10_000).toISOString());
    const before = repo.bytes();

    assertAllowed(await runGate(mainBashCall(repo.dir, OWNER)));

    assert.ok(repo.bytes().equals(before), "a fresh lastSeen must leave the ledger file byte-for-byte unchanged");
  });

  test("subagent-and-other-session-calls-never-touch-last-seen", async () => {
    const staleSeen = new Date(Date.now() - 120_000).toISOString();
    const subagentRepo = ownedRepo(staleSeen);
    const otherRepo = ownedRepo(staleSeen);

    assertAllowed(await runGate({ ...mainBashCall(subagentRepo.dir, OWNER), agent_id: "sub-1", agent_type: "general-purpose" }));
    assertAllowed(await runGate(mainBashCall(otherRepo.dir, "some-other-session")));

    assert.deepEqual(subagentRepo.read().owner, { sessionId: OWNER, lastSeen: staleSeen }, "a subagent call must not refresh lastSeen");
    assert.deepEqual(otherRepo.read().owner, { sessionId: OWNER, lastSeen: staleSeen }, "another session's call must not change the owner or lastSeen");
  });
});
