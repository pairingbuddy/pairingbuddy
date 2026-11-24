// Nothing ran while nothing wrote the ledger for a long time (a night, a closed session), so that gap is no working time:
// the next write records it as an idle wait, which SPENT and the report leave out (T4d run: SPENT read 22:52:56 for a code
// run whose stops overnight and between sessions were never stamped).
import "./isolated-tmpdir.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLedger, updateLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { waitedSeconds } from "../../shared-node/glance.mjs";
import { baseLedger } from "./ledger-fixture.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-idle-waits-")));
after(() => rmSync(dir, { recursive: true, force: true }));

let count = 0;
// A ledger last written `minutesAgo` minutes ago.
function ledgerWritten(minutesAgo) {
  count += 1;
  const path = join(dir, `ledger-${count}.json`);
  writeLedger(path, baseLedger());
  const then = new Date(Date.now() - minutesAgo * 60_000);
  utimesSync(path, then, then);
  return { path, then };
}

describe("a long gap between ledger writes is an idle wait", () => {
  test("a write two hours after the last one records the gap from that write to this one", () => {
    const { path, then } = ledgerWritten(120);

    const before = Date.now();
    updateLedger(path, (ledger) => ({ ...ledger, task: "moved on" }));

    const waits = readLedger(path).idleWaits;
    assert.equal(waits.length, 1);
    assert.ok(Math.abs(Date.parse(waits[0].askedAt) - then.getTime()) < 1_000, "from the last write");
    assert.ok(Date.parse(waits[0].answeredAt) >= before - 1_000, "to this write");
  });

  test("a write within the hour records no gap: a long step is working time", () => {
    const { path } = ledgerWritten(50);

    updateLedger(path, (ledger) => ({ ...ledger, task: "moved on" }));

    assert.equal(readLedger(path).idleWaits, undefined);
  });
});

describe("waitedSeconds leaves the idle gaps out", () => {
  test("an idle gap is waited, and a stop it overlaps counts once", () => {
    const ledger = {
      ...baseLedger(),
      idleWaits: [{ askedAt: "2026-11-22T23:04:00.000Z", answeredAt: "2026-11-23T10:14:00.000Z" }],
      stopWaits: [{ askedAt: "2026-11-23T10:00:00.000Z", answeredAt: "2026-11-23T10:20:00.000Z" }],
    };

    assert.equal(waitedSeconds(ledger, Date.parse("2026-11-23T12:00:00.000Z")), (11 * 60 + 16) * 60);
  });
});
