// A stopped run does no work: the time from a stop to the write that lifts it is waiting, like a question's, and SPENT, the
// TESTS step age and the report leave it out for good, not only while the stop stands (T4d run: SPENT read 14:22:03 after a
// night-long stop, for about four hours of work).
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLedger, updateLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { pausedAtOf, waitedSeconds } from "../../shared-node/glance.mjs";
import { buildLabel } from "../../shared-node/labels.mjs";
import { stepAge } from "../../shared-node/now-building.mjs";
import { baseLedger } from "./ledger-fixture.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-stop-waits-")));
after(() => rmSync(dir, { recursive: true, force: true }));

let count = 0;
function ledgerAt(over = {}) {
  count += 1;
  const path = join(dir, `ledger-${count}.json`);
  writeLedger(path, { ...baseLedger(), ...over });
  return path;
}

const STOP = { reason: "a step failed", seq: 1, code: "step-failed" };
const at = (iso) => Date.parse(iso);

describe("a stop is a wait", () => {
  test("the write that sets a stop opens a stop wait, and the write that lifts it closes it", () => {
    const path = ledgerAt();

    updateLedger(path, (ledger) => ({ ...ledger, stop: STOP }));
    const open = readLedger(path).stopWaits;
    updateLedger(path, (ledger) => ({ ...ledger, stop: null }));
    const closed = readLedger(path).stopWaits;

    assert.equal(open.length, 1);
    assert.equal(typeof open[0].askedAt, "string");
    assert.equal(open[0].answeredAt, undefined, "open while the stop stands");
    assert.equal(closed.length, 1);
    assert.ok(Date.parse(closed[0].answeredAt) >= Date.parse(closed[0].askedAt), "closed when it was lifted");
  });

  test("a write that keeps the stop leaves its wait open", () => {
    const path = ledgerAt();
    updateLedger(path, (ledger) => ({ ...ledger, stop: STOP }));

    updateLedger(path, (ledger) => ({ ...ledger, task: "renamed" }));

    assert.equal(readLedger(path).stopWaits.length, 1);
    assert.equal(readLedger(path).stopWaits[0].answeredAt, undefined);
  });
});

describe("waitedSeconds leaves the stops out", () => {
  test("a lifted stop's time is waited, after it is lifted too", () => {
    const ledger = { ...baseLedger(), stopWaits: [{ askedAt: "2026-11-23T00:22:00.000Z", answeredAt: "2026-11-23T10:00:00.000Z" }] };

    assert.equal(waitedSeconds(ledger, at("2026-11-23T12:00:00.000Z")), (9 * 60 + 38) * 60);
  });

  test("a stop still standing is waited up to now", () => {
    const ledger = { ...baseLedger(), stop: STOP, stopWaits: [{ askedAt: "2026-11-23T00:00:00.000Z" }] };

    assert.equal(waitedSeconds(ledger, at("2026-11-23T00:10:00.000Z")), 600);
  });

  test("a question asked while the run is stopped is not counted twice", () => {
    const ledger = { ...baseLedger(), stopWaits: [{ askedAt: "2026-11-23T00:00:00.000Z", answeredAt: "2026-11-23T01:00:00.000Z" }], gateWaits: [{ gate: "G:x", askedAt: "2026-11-23T00:30:00.000Z", answeredAt: "2026-11-23T01:00:00.000Z" }] };

    assert.equal(waitedSeconds(ledger, at("2026-11-23T02:00:00.000Z")), 3600);
  });
});

describe("the paused clock and the step age", () => {
  test("a stopped run's clock stops where its stop began", () => {
    const ledger = { ...baseLedger(), stop: STOP, stopWaits: [{ askedAt: "2026-11-23T00:22:00.000Z" }] };

    assert.equal(pausedAtOf(ledger), at("2026-11-23T00:22:00.000Z"));
  });

  test("the step age leaves out a stop that came and went since the step began", () => {
    const label = buildLabel({ stage: "code-tdd", phase: "REFACTOR", role: "refactor-code", item: "t9", round: 1 });
    const spawns = [{ kind: "workflow_agent", name: label, startedAt: "2026-11-23T00:00:00.000Z" }];
    const ledger = { ...baseLedger(), stopWaits: [{ askedAt: "2026-11-23T00:10:00.000Z", answeredAt: "2026-11-23T10:00:00.000Z" }] };

    assert.equal(stepAge({ spawns, now: at("2026-11-23T10:05:00.000Z"), ledger }), "15:00");
  });
});
