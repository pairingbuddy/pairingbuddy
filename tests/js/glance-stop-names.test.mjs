// Scenario: glance-names-stop. The band says why the run stopped, in plain words (shared-node/glance.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";

import { glance } from "../../shared-node/glance.mjs";
import { plainName } from "../../shared-node/plain-names.mjs";
import { ledgerAtSeq, SOME_TIME, TDD_ACTIVE_SEQ } from "./glance-fixture.mjs";

function needsYouText(result) {
  const segment = result.band.find((segment) => segment.id === "needsYou");
  assert.ok(segment, "the band has a needsYou segment");
  return segment.text;
}

async function stoppedLedger(extra = {}) {
  const snapshot = await ledgerAtSeq("probe-2", TDD_ACTIVE_SEQ);
  return { ...snapshot, stop: { reason: "implement-code failed 3 times", seq: TDD_ACTIVE_SEQ, ...extra } };
}

test("band-names-stop-by-plain-name", async () => {
  const code = "step-failed";
  const ledger = await stoppedLedger({ code });

  const result = glance({ ledger, spawns: [], now: SOME_TIME });

  const plain = plainName(code);
  assert.ok(plain, "precondition: the code has a plain name");
  const text = needsYouText(result);
  assert.ok(text.includes(plain), `needs-you text reads the plain name '${plain}'`);
  assert.ok(!text.includes(code), "needs-you text shows no stop code");
  assert.ok(!text.includes(ledger.stop.reason), "needs-you text does not show the stop reason");
});

test("stop-without-code-falls-back", async () => {
  const ledger = await stoppedLedger();

  const result = glance({ ledger, spawns: [], now: SOME_TIME });

  assert.equal(needsYouText(result), "needs you: stopped");
});

test("unknown-code-falls-back", async () => {
  const code = "no-such-stop-code";
  assert.equal(plainName(code), undefined, "precondition: the code has no plain name");
  const ledger = await stoppedLedger({ code });

  const result = glance({ ledger, spawns: [], now: SOME_TIME });

  assert.equal(
    needsYouText(result),
    "needs you: stopped",
    "an unknown code falls back to the generic stop text, never the raw code",
  );
});

test("needs-human-still-names-gate", async () => {
  const stopped = await stoppedLedger({ code: "step-failed" });
  const ledger = { ...stopped, needsHuman: { gate: "G:task-end", reason: "the work is done and waits for sign-off", seq: TDD_ACTIVE_SEQ } };

  const result = glance({ ledger, spawns: [], now: SOME_TIME });

  assert.equal(needsYouText(result), "needs you: your sign-off at the end");
});
