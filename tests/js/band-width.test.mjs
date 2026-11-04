import { test } from "node:test";
import assert from "node:assert/strict";

import { fitBand } from "../../shared-node/glance.mjs";

// Band design: docs/design/progress-mod/round-4/R4-1-band-tdd-calm.png (139 columns) and round-4/README.md (narrowing order).
// Segment contract under test: { id, text }, in the order where, spent, left, looping, offTrack, needsYou.
// fitBand(segments, columns) returns the segments that fit. A band's width is its texts joined with SEPARATOR.
const SEPARATOR = " │ ";
const FULL_WIDTH_COLUMNS = 139;

// Typed from R4-1 (test 3 of 4, calm run); needsYou carries a reason so that it can be shortened and truncated.
const R4_1_BAND = [
  { id: "where", text: "RED · test 3 of 4" },
  { id: "spent", text: "1:55 · 12 agents · ≈0.4%" },
  { id: "left", text: "left: 1 test + review" },
  { id: "looping", text: "looping: no" },
  { id: "offTrack", text: "off track: no" },
  { id: "needsYou", text: "needs you: your sign-off at the end", standing: true },
];

const widthOf = (segments) => segments.map((segment) => segment.text).join(SEPARATOR).length;
const idsOf = (segments) => segments.map((segment) => segment.id);
const textOf = (segments, id) => segments.find((segment) => segment.id === id).text;
const withoutLeft = (segments) => segments.filter((segment) => segment.id !== "left");
const withoutPercent = (segments) => segments.map((segment) => (segment.id === "spent" ? { ...segment, text: segment.text.replace(/ · ≈.*$/, "") } : segment));
const withShortNeedsYou = (segments) => segments.map((segment) => (segment.id === "needsYou" ? { ...segment, text: segment.text.replace("needs you:", "you:") } : segment));

test("at 139 columns every segment is kept, spent with its ≈ %", () => {
  const kept = fitBand(R4_1_BAND, FULL_WIDTH_COLUMNS);

  assert.deepEqual(kept, R4_1_BAND, "every segment is kept, unchanged");
  assert.ok(widthOf(kept) <= FULL_WIDTH_COLUMNS, "the band is no wider than 139 columns");
});

test("narrowing the width drops 'left:' first, keeping the band within the width", () => {
  const columns = widthOf(R4_1_BAND) - 1;

  const kept = fitBand(R4_1_BAND, columns);

  assert.deepEqual(idsOf(kept), ["where", "spent", "looping", "offTrack", "needsYou"], "only left has gone");
  assert.equal(textOf(kept, "spent"), "1:55 · 12 agents · ≈0.4%", "≈ % is still there when only left has gone");
  assert.ok(widthOf(kept) <= columns, `nothing is wider than ${columns} columns`);
});

test("narrowing the width further drops '≈ %' second, keeping the band within the width", () => {
  const columns = widthOf(withoutLeft(R4_1_BAND)) - 1;

  const kept = fitBand(R4_1_BAND, columns);

  assert.deepEqual(idsOf(kept), ["where", "spent", "looping", "offTrack", "needsYou"], "left stays gone");
  assert.equal(textOf(kept, "spent"), "1:55 · 12 agents", "≈ % goes second");
  assert.ok(widthOf(kept) <= columns, `nothing is wider than ${columns} columns`);
});

test("after dropping 'left:' and '≈ %', the next step shortens 'needs you:' to 'you:'", () => {
  const minimum = withoutPercent(withoutLeft(R4_1_BAND));
  const columns = widthOf(minimum) - 1;

  const kept = fitBand(R4_1_BAND, columns);

  assert.equal(textOf(kept, "needsYou"), "you: your sign-off at the end");
  assert.deepEqual(kept, withShortNeedsYou(minimum), "nothing else changes in that step");
  assert.ok(widthOf(kept) <= columns, `nothing is wider than ${columns} columns`);
});

test("below that, a standing needs-you is kept whole, never wider than the columns, 'where' untouched", () => {
  const shortened = withShortNeedsYou(withoutPercent(withoutLeft(R4_1_BAND)));
  const columns = widthOf(shortened) - 1;

  const kept = fitBand(R4_1_BAND, columns);

  assert.ok(widthOf(kept) <= columns, `no wider than ${columns} columns`);
  assert.equal(textOf(kept, "needsYou"), "needs you: your sign-off at the end", "a standing needs-you is kept whole while it fits");
  assert.equal(textOf(kept, "where"), "RED · test 3 of 4", "'where' is untouched");
});

test("below that, with nothing standing, the band is truncated in Task 57's order: needs-you is cut first, with an ellipsis", () => {
  const calm = R4_1_BAND.map((segment) => (segment.id === "needsYou" ? { id: segment.id, text: "needs you: no" } : segment));
  const shortened = withShortNeedsYou(withoutPercent(withoutLeft(calm)));
  const columns = widthOf(shortened) - 1;

  const kept = fitBand(calm, columns);

  assert.ok(widthOf(kept) <= columns, `no wider than ${columns} columns`);
  assert.match(textOf(kept, "needsYou"), /…$/, "the cut text ends in an ellipsis");
  assert.equal(textOf(kept, "where"), "RED · test 3 of 4", "a higher-priority segment is untouched while a lower one can still give");
});

test("at a very small width the band is still no wider than the columns", () => {
  const columns = 12;

  const kept = fitBand(R4_1_BAND, columns);

  assert.ok(widthOf(kept) <= columns, `no wider than ${columns} columns`);
});

test("with separators and the gap counted fitBand still returns segments whose joined width plus the details button fits the columns, at 167 and a narrow width", () => {
  const DETAILS_BUTTON = " ▸ details".length; // the space before the button plus its label
  const drawnWidth = (segments) => widthOf(segments) + DETAILS_BUTTON;

  for (const columns of [167, 60, 40]) {
    const kept = fitBand(R4_1_BAND, columns - DETAILS_BUTTON);

    assert.ok(drawnWidth(kept) <= columns, `the band plus the button is no wider than ${columns} columns, got ${drawnWidth(kept)}`);
  }
});
