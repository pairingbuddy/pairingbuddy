// Scenario human-adopt: `pb human adopt [--force]` takes over a run owned by another session.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { ATTEMPT, makeRepo, pb } from "./cli-repo-fixture.mjs";
import { INTAKE_DONE, workStages } from "./ledger-fixture.mjs";
import { ATTEMPT_CAP, HUMAN_STOPPED, STAGE_STOP_REASONS } from "../../shared-node/stop-codes.mjs";

// Shared by the adopt tests: exit 0, the adopted JSON, owner cleared, the active stage failed.
function assertAdopted(repo, result, { owner, activeName }) {
  assert.equal(result.code, 0, `exits 0: stdout ${result.stdout}, stderr ${result.stderr}`);
  assert.deepEqual(
    JSON.parse(result.stdout),
    { ok: true, adopted: true, previousOwner: owner, failedStage: { stage: activeName, attempt: ATTEMPT, nextAttempt: ATTEMPT + 1 } },
    "it reports the adoption and the stage it failed",
  );
  const ledger = repo.ledger();
  assert.deepEqual(ledger.owner, { sessionId: null, lastSeen: null }, "the owner is cleared");
  assert.equal(ledger.stage.status, "failed", "the active stage is closed as failed");
  const [entry] = workStages(ledger);
  assert.deepEqual([entry.name, entry.status, entry.attempt], [activeName, "failed", ATTEMPT], "the attempt is recorded as failed, as pb stage fail does");
}

// Shared by the stop tests: adopt kept the stop, and the failed entry records no cleared stop.
function assertStopKept(repo, stop, message) {
  assert.deepEqual(repo.ledger().stop, stop, message);
  const [entry] = workStages(repo.ledger());
  assert.equal("clearedStop" in entry, false, "the failed entry records no cleared stop, since adopt kept it");
}

describe("human-adopt", () => {
  test("adopt-refuses-with-no-open-run", () => {
    const repo = makeRepo({ openTask: false });

    const result = pb(repo, "human", "adopt");

    assert.equal(result.code, 1, `exits 1: stdout ${result.stdout}, stderr ${result.stderr}`);
    assert.match(result.stderr, /no run is open/i, "it says no run is open");
    assert.doesNotMatch(result.stderr, /unexpected failure|unknown|usage:/i, "it is a deliberate refusal, not the catch-all or a usage error");
    assert.equal(existsSync(join(repo.dir, ".pairingbuddy", "run", "task")), false, "it writes no task state");
  });

  test("adopt-with-no-owner-is-an-ok-noop", () => {
    const repo = makeRepo({ ledger: { owner: { sessionId: null, lastSeen: null } } });
    const ledgerPath = join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json");
    const before = readFileSync(ledgerPath);

    const result = pb(repo, "human", "adopt");

    assert.equal(result.code, 0, `exits 0: stdout ${result.stdout}, stderr ${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true, "the call is ok");
    assert.equal(out.adopted, false, "nothing was adopted");
    assert.match(out.message, /no owner/i, "it says the run has no owner");
    assert.ok(readFileSync(ledgerPath).equals(before), "the ledger bytes are unchanged");
  });

  test("adopt-refuses-recent-owner-without-force", () => {
    const lastSeen = new Date(Date.now() - 3 * 60_000).toISOString();
    const repo = makeRepo({ ledger: { owner: { sessionId: "first-session", lastSeen } } });
    const ledgerPath = join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json");
    const before = readFileSync(ledgerPath);

    const result = pb(repo, "human", "adopt");

    assert.equal(result.code, 1, `exits 1: stdout ${result.stdout}, stderr ${result.stderr}`);
    assert.doesNotMatch(result.stderr, /unexpected failure|unknown|usage:|not implemented/i, "it is a deliberate refusal, not the catch-all or a usage error");
    assert.match(result.stderr, /first-session/, "it names the owner session id");
    assert.match(result.stderr, /\b3 minutes ago\b/, "it says how many minutes ago the owner was last seen");
    assert.ok(result.stderr.includes(lastSeen), "it shows the lastSeen time");
    assert.match(result.stderr, /close (that|the|it)\b[^\n]*first|close[^\n]*session[^\n]*first/i, "it says to close that session first");
    assert.match(result.stderr, /human adopt --force/, "it names the same line retyped with --force");
    assert.ok(readFileSync(ledgerPath).equals(before), "the ledger bytes are unchanged");
  });

  test("adopt-stale-owner-clears-owner-and-fails-active-stage", () => {
    const owner = "first-session";
    const lastSeen = new Date(Date.now() - 20 * 60_000).toISOString();
    const repo = makeRepo({ ledger: { owner: { sessionId: owner, lastSeen } } });
    const activeName = repo.ledger().stage.name;

    const result = pb(repo, "human", "adopt");

    assertAdopted(repo, result, { owner, activeName });
  });

  test("adopt-force-takes-a-recently-seen-run", () => {
    const owner = "first-session";
    const lastSeen = new Date(Date.now() - 3 * 60_000).toISOString();
    const repo = makeRepo({ ledger: { owner: { sessionId: owner, lastSeen } } });
    const activeName = repo.ledger().stage.name;

    const result = pb(repo, "human", "adopt", "--force");

    assertAdopted(repo, result, { owner, activeName });
  });

  test("adopt-with-no-active-stage-reports-no-failed-stage", () => {
    const owner = "first-session";
    const lastSeen = new Date(Date.now() - 20 * 60_000).toISOString();
    const stage = { name: "code-config", status: "done", runId: "wf_1", attempt: ATTEMPT, startedAt: null };
    const repo = makeRepo({ ledger: { owner: { sessionId: owner, lastSeen }, stage, stages: [INTAKE_DONE, { name: "code-config", status: "done", attempt: ATTEMPT }] } });
    const before = repo.ledger();

    const result = pb(repo, "human", "adopt");

    assert.equal(result.code, 0, `exits 0: stdout ${result.stdout}, stderr ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, adopted: true, previousOwner: owner, failedStage: null }, "it reports the adoption and no failed stage");
    const ledger = repo.ledger();
    assert.deepEqual(ledger.owner, { sessionId: null, lastSeen: null }, "the owner is cleared");
    assert.deepEqual(ledger.stage, before.stage, "the stage is unchanged");
    assert.deepEqual(ledger.stages, before.stages, "the stages are unchanged");
  });

  test("adopt-keeps-a-stop", () => {
    const owner = "first-session";
    const lastSeen = new Date(Date.now() - 20 * 60_000).toISOString();
    const stop = { code: ATTEMPT_CAP, reason: STAGE_STOP_REASONS[ATTEMPT_CAP], seq: 0 };
    const repo = makeRepo({ ledger: { owner: { sessionId: owner, lastSeen }, stop } });
    const activeName = repo.ledger().stage.name;

    const result = pb(repo, "human", "adopt");

    assertAdopted(repo, result, { owner, activeName });
    assertStopKept(repo, stop, "the run-raised stop is kept, adopt does not clear it");
  });

  test("adopt-keeps-a-human-stop", () => {
    const owner = "first-session";
    const lastSeen = new Date(Date.now() - 20 * 60_000).toISOString();
    const stop = { code: HUMAN_STOPPED, reason: "stopped at the gate", seq: 0 };
    const repo = makeRepo({ ledger: { owner: { sessionId: owner, lastSeen }, stop } });
    const activeName = repo.ledger().stage.name;

    const result = pb(repo, "human", "adopt");

    assertAdopted(repo, result, { owner, activeName });
    assertStopKept(repo, stop, "the human stop is kept, it still needs pb human approve");
  });

  test("adopt-rejects-unknown-arguments", () => {
    const lastSeen = new Date(Date.now() - 20 * 60_000).toISOString();
    const repo = makeRepo({ ledger: { owner: { sessionId: "first-session", lastSeen } } });
    const ledgerPath = join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json");
    const before = readFileSync(ledgerPath);

    const result = pb(repo, "human", "adopt", "--yes");

    assert.equal(result.code, 2, `exits 2 (usage error): stdout ${result.stdout}, stderr ${result.stderr}`);
    assert.ok(readFileSync(ledgerPath).equals(before), "the ledger bytes are unchanged");
  });

  test("adopt-recent-window-is-ten-minutes", () => {
    const ledgerPathOf = (repo) => join(repo.dir, ".pairingbuddy", "run", "task", "ledger.json");
    const ninePointFive = new Date(Date.now() - 9.5 * 60_000).toISOString();
    const nineRepo = makeRepo({ ledger: { owner: { sessionId: "first-session", lastSeen: ninePointFive } } });
    const nineBefore = readFileSync(ledgerPathOf(nineRepo));
    const ninetySeconds = new Date(Date.now() - 90_000).toISOString();
    const oneRepo = makeRepo({ ledger: { owner: { sessionId: "first-session", lastSeen: ninetySeconds } } });
    const oneBefore = readFileSync(ledgerPathOf(oneRepo));

    const nine = pb(nineRepo, "human", "adopt");
    const one = pb(oneRepo, "human", "adopt");

    assert.equal(nine.code, 1, `9.5 minutes exits 1: stdout ${nine.stdout}, stderr ${nine.stderr}`);
    assert.match(nine.stderr, /\b9 minutes ago\b/, "it says 9 minutes ago");
    assert.ok(readFileSync(ledgerPathOf(nineRepo)).equals(nineBefore), "9.5 minutes: the ledger is unchanged");
    assert.equal(one.code, 1, `90 seconds exits 1: stdout ${one.stdout}, stderr ${one.stderr}`);
    assert.match(one.stderr, /\b1 minute ago\b/, "it says 1 minute ago, singular");
    assert.ok(readFileSync(ledgerPathOf(oneRepo)).equals(oneBefore), "90 seconds: the ledger is unchanged");
  });
});
