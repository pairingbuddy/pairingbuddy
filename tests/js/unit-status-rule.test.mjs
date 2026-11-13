// Pure rule behind pb unit status (shared-node/unit-status.mjs, no I/O). Titles are the test case ids from
// .pairingbuddy/scenarios.json. Each top-level test is one scenario; its subtests are the test cases.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { unitStatus, UnitStatusRefused } from "../../shared-node/unit-status.mjs";

const unit = { branch: "unit/a", base: "main", baseSha: "aaa111" };
const stackedUnit = { ...unit, base: "unit/dep", baseSha: "bbb222", stackedOn: { unit: "Dep", pr: "https://github.com/example/repo/pull/7", branch: "unit/dep" } };
const neverContains = () => false;
const input = (overrides = {}) => ({
  unit,
  remote: "origin",
  baseTip: "aaa111",
  dependencyState: undefined,
  unstackedBase: "main",
  unstackedTip: "aaa111",
  headContains: neverContains,
  ...overrides,
});

const assertRefused = (fn, expectations, message) => {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof UnitStatusRefused, "throws a UnitStatusRefused");
      for (const [pattern, why] of expectations) assert.match(error.message, pattern, why);
      return true;
    },
    message,
  );
};

describe("unit-status-rule", () => {
  test("rule-current-when-base-tip-equals-base-sha", async (t) => {
    await t.test("an unstacked unit whose base tip is still its baseSha is current", () => {
      const result = unitStatus(input());

      assert.equal(result.status, "current", "base tip equals baseSha, nothing to do");
    });

    await t.test("a stacked unit with an OPEN dependency and an unmoved base tip is current", () => {
      const result = unitStatus(input({ unit: stackedUnit, baseTip: "bbb222", dependencyState: "OPEN" }));

      assert.equal(result.status, "current", "dependency still OPEN and base unmoved");
    });
  });

  test("rule-moved-when-base-tip-differs", async (t) => {
    await t.test("an unstacked unit whose base tip moved, not contained in the head, is moved with a rebase recipe", () => {
      const result = unitStatus(input({ baseTip: "ccc333", unstackedTip: "ccc333" }));

      assert.equal(result.status, "moved", "base tip differs from baseSha and the head lacks it");
      assert.equal(result.base, "main", "names the base");
      assert.equal(result.from, "aaa111", "from is the recorded baseSha");
      assert.equal(result.to, "ccc333", "to is the new base tip");
      assert.match(
        result.recipe,
        /^git rebase --onto origin\/main aaa111 unit\/a$/m,
        "recipe carries the rebase line on its own line",
      );
      assert.match(result.recipe, /force push/i, "recipe says the force push is the human's");
      assert.match(result.recipe, /already pushed/i, "recipe scopes that to an already pushed branch");
      assert.match(result.recipe, /pb unit status/, "recipe says to run pb unit status again");
    });
  });

  test("rule-stacked-dependency-merged-moves-onto-unstacked-base", async (t) => {
    await t.test("a stacked unit whose dependency PR is MERGED is moved onto the unstacked base", () => {
      const result = unitStatus(
        input({
          unit: stackedUnit,
          baseTip: "bbb222",
          dependencyState: "MERGED",
          unstackedTip: "ddd444",
        }),
      );

      assert.equal(result.status, "merged", "dependency merged and the head lacks the new tip");
      assert.equal(result.base, "main", "names the unstacked base, not the dependency branch");
      assert.equal(result.from, "bbb222", "from is the recorded baseSha");
      assert.equal(result.to, "ddd444", "to is the unstacked base tip");
      assert.match(
        result.recipe,
        /^git rebase --onto origin\/main bbb222 unit\/a$/m,
        "recipe carries the rebase onto the unstacked base on its own line",
      );
    });
  });

  test("rule-reconciled-when-head-contains-new-tip", async (t) => {
    await t.test("an unstacked unit whose head already contains the new base tip is reconciled", () => {
      const result = unitStatus(
        input({ baseTip: "ccc333", unstackedTip: "ccc333", headContains: (sha) => sha === "ccc333" }),
      );

      assert.deepEqual(
        result,
        { status: "reconciled", base: "main", baseSha: "ccc333", unstack: false },
        "head contains the new tip: reconcile the recorded baseSha without unstacking",
      );
    });
  });

  test("rule-reconciled-with-unstack-after-dependency-merged", async (t) => {
    await t.test("a stacked unit whose dependency PR is MERGED and whose head contains the unstacked tip is reconciled with unstack", () => {
      const result = unitStatus(
        input({
          unit: stackedUnit,
          baseTip: "bbb222",
          dependencyState: "MERGED",
          unstackedTip: "ddd444",
          headContains: (sha) => sha === "ddd444",
        }),
      );

      assert.deepEqual(
        result,
        { status: "reconciled", base: "main", baseSha: "ddd444", unstack: true },
        "head already contains the unstacked tip: reconcile onto the unstacked base and unstack",
      );
    });
  });

  test("rule-refuses-when-dependency-pr-closed", async (t) => {
    await t.test("a stacked unit whose dependency PR is CLOSED refuses, naming the dependency and the unmerged close", () => {
      assertRefused(
        () => unitStatus(input({ unit: stackedUnit, baseTip: "bbb222", dependencyState: "CLOSED" })),
        [
          [/Dep/, "names the dependency unit"],
          [/closed without merging/i, "says its PR was closed without merging"],
          [/so a human decides what happens to this unit/, "ends with the human-decides closing"],
        ],
        "a CLOSED dependency PR is refused",
      );
    });
  });

  test("rule-refuses-on-unknown-dependency-state", async (t) => {
    for (const dependencyState of ["DRAFT", undefined]) {
      await t.test(`a stacked unit whose dependency state is ${String(dependencyState)} refuses, naming the dependency and the unknown state`, () => {
        assertRefused(
          () => unitStatus(input({ unit: stackedUnit, baseTip: "bbb222", dependencyState })),
          [
            [/Dep/, "names the dependency unit"],
            [/unknown/i, "says the dependency state is unknown"],
            [new RegExp(String(dependencyState)), "names the unknown state value"],
          ],
          "an unknown dependency state is refused",
        );
      });
    }
  });

  test("rule-refuses-when-base-gone-and-not-merged", async (t) => {
    await t.test("an unstacked unit whose base branch is gone from the remote refuses, naming the base", () => {
      assertRefused(
        () => unitStatus(input({ baseTip: null })),
        [
          [/main/, "names the base branch"],
          [/gone from the remote/i, "says the base is gone from the remote"],
        ],
        "a missing base on an unstacked unit is refused",
      );
    });

    await t.test("a stacked unit whose dependency is OPEN and whose base branch is gone refuses, naming the base", () => {
      assertRefused(
        () => unitStatus(input({ unit: stackedUnit, baseTip: null, dependencyState: "OPEN" })),
        [
          [/unit\/dep/, "names the base branch"],
          [/gone from the remote/i, "says the base is gone from the remote"],
        ],
        "a missing base under an OPEN dependency is refused",
      );
    });

    await t.test("a stacked unit whose dependency is MERGED and whose base branch is gone is the normal merged case", () => {
      const result = unitStatus(
        input({ unit: stackedUnit, baseTip: null, dependencyState: "MERGED", unstackedTip: "ddd444" }),
      );

      assert.equal(result.status, "merged", "a merged dependency explains the gone base branch");
      assert.equal(result.base, "main", "points at the unstacked base, not the gone dependency branch");
      assert.equal(result.to, "ddd444", "to is the unstacked base tip");
    });
  });
});
