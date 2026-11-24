// Safeguards for shared-node/glance.mjs: a try past the limit, a current test outside the list, tokens that are not
// known, a gate with no plain name, and the last-resort cut of a standing needs-you segment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitBand, gateLine, glance } from "../../shared-node/glance.mjs";

const redSpawn = (item) => ({ kind: "workflow_agent", name: `pb1 code-tdd RED implement-tests ${item} r1` });
const tries = (count, item = "t1") => Array.from({ length: count }, () => redSpawn(item));
const nowOf = (spawns) => glance({ ledger: {}, spawns, tests: ["t1"] }).rows.now;

// Past the limit (the human let the step go on) a try is only counted: no "of 3", and no word that it is the last.
for (const count of [4, 11]) {
  test(`try-${count}-past-the-limit-reads-try-${count}`, () => {
    assert.match(nowOf(tries(count)), new RegExp(` · try ${count}$`));
  });
}

test("current-test-outside-a-complete-list-leaves-what-is-left-unknown", () => {
  const { rows, band } = glance({ ledger: {}, spawns: tries(1, "t9"), tests: ["t1", "t2"], testsComplete: true });

  assert.equal(rows.left, "unknown");
  assert.equal(band.find(({ id }) => id === "left"), undefined, "the band leaves out a left segment with no value");
});

test("tokens-not-known-read-tokens-unknown", () => {
  const { rows } = glance({ ledger: { spend: { tokens: 0 } }, spawns: [], ranFor: 5 });

  assert.equal(rows.spent, "0 agents · 0:05 · tokens unknown");
});

test("tokens-known-read-their-count", () => {
  const { rows } = glance({ ledger: { spend: { tokens: 120, tokensKnown: true } }, spawns: [], ranFor: 5 });

  assert.equal(rows.spent, "0 agents · 0:05 · 120 output tokens");
});

test("for-the-pane-unknown-tokens-and-plan-share-are-left-out-of-spent", () => {
  const { rows } = glance({ ledger: { spend: { tokens: 0 } }, spawns: [], ranFor: 5, leaveOutUnknown: true });

  assert.equal(rows.spent, "0 agents · 0:05");
});

// Scenario S6 unit B, frames 07 and 08: one attempt's tokens were unknown (the killed session's), the rest were counted, and
// SPENT dropped them all. The pane shows the counted ones as a floor.
test("for-the-pane-tokens-known-only-in-part-read-as-at-least-their-count", () => {
  const { rows } = glance({ ledger: { spend: { tokens: 50205, tokensKnown: false } }, spawns: [], ranFor: 5, leaveOutUnknown: true });

  assert.equal(rows.spent, "0 agents · 0:05 · at least 50205 output tokens");
});

test("the-band-has-no-looping-segment-even-on-a-retry", () => {
  for (const spawns of [[], tries(2), tries(3)]) {
    const { band } = glance({ ledger: {}, spawns, tests: ["t1"] });

    assert.equal(band.find(({ id }) => id === "looping"), undefined, `${spawns.length} tries`);
    assert.ok(band.every(({ text }) => !text.includes("looping")), `${spawns.length} tries: no band text speaks of looping`);
  }
});

test("gate-with-no-plain-name-reads-as-its-id", () => {
  assert.equal(gateLine("G:not-a-gate"), "G:not-a-gate");
});

test("standing-needs-you-is-cut-to-the-ellipsis-at-one-column", () => {
  const segments = [{ id: "where", text: "abc" }, { id: "needsYou", text: "needs you: something long", standing: true }];

  assert.deepEqual(fitBand(segments, 1).map(({ text }) => text), ["…"]);
});

test("standing-needs-you-is-cut-after-shortening-so-what-fits-is-kept", () => {
  const band = [{ id: "where", text: "abc" }, { id: "needsYou", text: "needs you: something long", standing: true }];

  const fitted = fitBand(band, 19);

  assert.deepEqual(fitted.map(({ text }) => text), ["you: something long"]);
});

test("a-review-round-agent-is-no-step-on-a-test", () => {
  const ledger = { stage: { name: "code-safety-net", status: "active" } };
  const review = [
    { kind: "workflow_agent", name: "pb1 code-safety-net - refuter code-1 r1" },
    { kind: "workflow_agent", name: "pb1 code-safety-net - course-checker g3 r5" },
  ];

  const now = glance({ ledger, spawns: review, tests: ["t1"] }).rows.now;

  assert.equal(now, "safety-net review", "a refuter's finding or a fix group is not a test, so NOW names the stage");
});

test("spent-time-counts-from-the-unit-start-when-one-is-given", () => {
  const unitStart = "2026-11-14T10:00:00.000Z";
  const ledger = { stage: { name: "pr-draft", status: "active", startedAt: "2026-11-14T10:03:00.000Z" }, stages: [] };
  const now = Date.parse("2026-11-14T10:03:35.000Z");

  const unit = glance({ ledger, spawns: [], now, since: unitStart, leaveOutUnknown: true });
  const run = glance({ ledger, spawns: [], now, leaveOutUnknown: true });

  assert.equal(unit.rows.spent, "0 agents · 3:35", "the publish run's time keeps counting from the unit's start");
  assert.equal(unit.band.find(({ id }) => id === "spent").text, "3:35 · 0 agents", "the band's time does too");
  assert.equal(run.rows.spent, "0 agents · 0:35", "with no unit start the run's own start stands");
});

test("now-and-the-band-follow-the-active-stage-never-the-last-test", () => {
  const ledger = { stage: { name: "code-safety-net", status: "active" } };
  const spawns = [
    { kind: "workflow_agent", name: "pb1 code-tdd REFACTOR refactor-tests order-total r1" },
    { kind: "workflow_agent", name: "pb1 code-safety-net - lens code r1" },
  ];

  const { rows, band } = glance({ ledger, spawns, tests: ["order-total"], testsComplete: true });

  assert.equal(rows.now, "safety-net review", "a test step of an earlier stage is not the current step");
  assert.equal(band.find(({ id }) => id === "where").text, "safety-net review", "the band names the active stage, not the last test's phase");
});

// Time a question waited on the human is no working time: SPENT leaves out each answered wait and the one still open.
test("spent-time-leaves-out-the-time-questions-waited-on-the-human", () => {
  const at = (clock) => `2026-11-16T${clock}.000Z`;
  const ledger = {
    stage: { name: "pr-draft", status: "done", startedAt: at("10:00:00") },
    stages: [{ name: "pr-draft", status: "done", startedAt: at("10:00:00") }],
    gates: { "G:publish": { source: "human", answer: "approve", askedAt: at("10:05:00"), answeredAt: at("14:05:00") } },
    needsHuman: null,
  };
  const now = Date.parse(at("14:10:00"));
  const shown = glance({ ledger, spawns: [], now, leaveOutUnknown: true });

  assert.equal(shown.rows.spent, "0 agents · 10:00", "four hours of waiting are left out of 4:10:00");
  assert.equal(shown.band.find(({ id }) => id === "spent").text, "10:00 · 0 agents", "the band's time too");

  const waiting = { ...ledger, gates: {}, needsHuman: { gate: "G:publish", reason: "r", seq: 1, askedAt: at("10:05:00") } };
  assert.equal(glance({ ledger: waiting, spawns: [], now, leaveOutUnknown: true }).rows.spent, "0 agents · 5:00", "a question still open waits to now");
});
