// Scenario: remap-commits-rule. Pure remapCommits({ recorded, range, merges }) maps each recorded commit to its rebased
// counterpart or throws UnitStatusRefused. No I/O. Titles are the test case ids from .pairingbuddy/scenarios.json.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { remapCommits } from "../../shared-node/rebase-map.mjs";
import { UnitStatusRefused } from "../../shared-node/unit-status.mjs";

describe("remap-commits-rule", () => {
  test("remap-maps-by-patch-id", () => {
    const recorded = [
      { sha: "old1", patchId: "p1" },
      { sha: "old2", patchId: "p2" },
    ];
    const range = [
      { sha: "new1", patchId: "p1" },
      { sha: "new2", patchId: "p2" },
    ];

    const mapping = remapCommits({ recorded, range, merges: [] });

    assert.deepEqual(mapping, { old1: "new1", old2: "new2" }, "each recorded sha maps to the range sha with the same patch-id");
  });

  test("remap-keeps-same-sha", () => {
    const recorded = [
      { sha: "keep1", patchId: "p1" },
      { sha: "keep2", patchId: null },
    ];
    const range = [
      { sha: "keep2", patchId: "changed" },
      { sha: "keep1", patchId: "p9" },
    ];

    const mapping = remapCommits({ recorded, range, merges: [] });

    assert.deepEqual(mapping, { keep1: "keep1", keep2: "keep2" }, "a recorded sha present in the range maps to itself, whatever its patch-id or position");
  });

  test("remap-duplicate-patch-id-uses-first-unused", () => {
    const recorded = [
      { sha: "old1", patchId: "same" },
      { sha: "old2", patchId: "same" },
    ];
    const range = [
      { sha: "new1", patchId: "same" },
      { sha: "new2", patchId: "same" },
    ];

    const mapping = remapCommits({ recorded, range, merges: [] });

    assert.deepEqual(mapping, { old1: "new1", old2: "new2" }, "two recorded commits sharing a patch-id map to two distinct range commits, each used once");
  });

  test("remap-same-sha-wins-over-earlier-patch-id", () => {
    const recorded = [
      { sha: "X", patchId: "p1" },
      { sha: "Y", patchId: "p1" },
    ];
    const range = [
      { sha: "Y", patchId: "p1" },
      { sha: "Z", patchId: "p1" },
    ];

    const mapping = remapCommits({ recorded, range, merges: [] });

    assert.deepEqual(mapping, { X: "Z", Y: "Y" }, "the recorded commit kept at its sha claims that range commit, so an earlier recorded commit sharing its patch-id maps to the other one and no range commit is used twice");
  });

  test("remap-refuses-merge-in-range", () => {
    const recorded = [{ sha: "old1", patchId: "p1" }];
    const range = [{ sha: "new1", patchId: "p1" }];
    const merges = ["mergeSha9"];

    const sut = () => remapCommits({ recorded, range, merges });

    assert.throws(sut, UnitStatusRefused, "a merge in the range refuses with UnitStatusRefused");
    assert.throws(sut, { message: /mergeSha9[\s\S]*rebase instead of merging/i }, "the refusal names the merge sha and tells the human to rebase instead of merging");
  });

  test("remap-refuses-unmatched-recorded", () => {
    const recorded = [
      { sha: "old1", patchId: "p1" },
      { sha: "changedSha7", patchId: "p2" },
    ];
    const range = [{ sha: "new1", patchId: "p1" }];

    const sut = () => remapCommits({ recorded, range, merges: [] });

    assert.throws(sut, UnitStatusRefused, "a recorded commit with no same-sha or same-patch-id range commit refuses with UnitStatusRefused");
    assert.throws(sut, { message: /changedSha7/ }, "the refusal names the recorded commit that no range commit matches");
  });

  test("remap-refuses-unrecorded-range-commit", () => {
    const recorded = [{ sha: "old1", patchId: "p1" }];
    const range = [
      { sha: "new1", patchId: "p1" },
      { sha: "extraSha5", patchId: "p5" },
    ];

    const sut = () => remapCommits({ recorded, range, merges: [] });

    assert.throws(sut, UnitStatusRefused, "a range commit no recorded commit matched refuses with UnitStatusRefused");
    assert.throws(sut, { message: /extraSha5[\s\S]*not in the unit record/i }, "the refusal names the leftover range commit as not in the unit record");
  });

  test("remap-null-patch-id-never-matches", () => {
    const recorded = [{ sha: "nullOld3", patchId: null }];
    const range = [{ sha: "nullNew3", patchId: null }];

    const sut = () => remapCommits({ recorded, range, merges: [] });

    assert.throws(sut, UnitStatusRefused, "a null patch-id never matches another null patch-id, so a different-sha recorded commit refuses with UnitStatusRefused");
    assert.throws(sut, { message: /nullOld3/ }, "the refusal names the recorded commit whose null patch-id could not match");
  });
});
