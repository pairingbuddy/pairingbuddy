// Safeguards for shared-node/glance.mjs: ordinal suffixes past "rd", a current test outside the list, tokens that are not
// known, a gate with no plain name, and the last-resort cut of a standing needs-you segment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitBand, gateLine, glance } from "../../shared-node/glance.mjs";

const redSpawn = (item) => ({ kind: "workflow_agent", name: `pb1 code-tdd RED implement-tests ${item} r1` });
const tries = (count, item = "t1") => Array.from({ length: count }, () => redSpawn(item));
const nowOf = (spawns) => glance({ ledger: {}, spawns, tests: ["t1"] }).rows.now;

for (const [count, word] of [[4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [23, "23rd"]]) {
  test(`try-${count}-reads-${word}`, () => {
    assert.match(nowOf(tries(count)), new RegExp(`, ${word} try$`));
  });
}

test("current-test-outside-a-complete-list-leaves-what-is-left-unknown", () => {
  const { rows, band } = glance({ ledger: {}, spawns: tries(1, "t9"), tests: ["t1", "t2"], testsComplete: true });

  assert.equal(rows.left, "unknown");
  assert.equal(band.find(({ id }) => id === "left").text, "left: unknown");
});

test("tokens-not-known-read-tokens-unknown", () => {
  const { rows } = glance({ ledger: { spend: { tokens: 0 } }, spawns: [], ranFor: 5 });

  assert.equal(rows.spent, "0 agents · 0:05 · tokens unknown · % of plan unknown");
});

test("tokens-known-read-their-count", () => {
  const { rows } = glance({ ledger: { spend: { tokens: 120, tokensKnown: true } }, spawns: [], ranFor: 5 });

  assert.equal(rows.spent, "0 agents · 0:05 · 120 output tokens · % of plan unknown");
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
