import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { StackRefused, dependencyChainOf, stackFor } from "../../shared-node/stack.mjs";

const unit = (name, { pr = null, dependsOn = null } = {}) => ({ unit: name, pr, dependsOn });

// Two-unit fixture: Alpha (with a PR) then Beta depending on it.
const PR_URL = "https://example.test/o/r/pull/1";
const prLine = (state, headRefName = "pb/alpha") => ({ [PR_URL]: { state, headRefName } });
const alphaThenBeta = () => [unit("Alpha", { pr: PR_URL }), unit("Beta", { dependsOn: "Alpha" })];

// Three-unit chain fixture: A -> B -> C; only A's PR state varies, B's PR stays OPEN.
const URL_A = "https://example.test/o/r/pull/3";
const URL_B = "https://example.test/o/r/pull/4";
const chain = () => [
  unit("A", { pr: URL_A }),
  unit("B", { pr: URL_B, dependsOn: "A" }),
  unit("C", { dependsOn: "B" }),
];
const refusedNaming = (unitName) => (error) => error instanceof StackRefused && error.message.includes(unitName);
const prsWithAState = (stateA) => ({
  [URL_A]: { state: stateA, headRefName: "pb/a" },
  [URL_B]: { state: "OPEN", headRefName: "pb/b" },
});

// The pure D18 stacking rule (scenarios.json): no I/O.
describe("stacking-rule", () => {
  test("no-dependency-or-no-pr-line-branches-from-base: no dependency", () => {
    const decision = stackFor({ units: [unit("Alpha")], unit: "Alpha", prs: {}, stackDepth: 2 });

    assert.deepEqual(decision, { base: true }, "no dependsOn branches from the base");
  });

  test("no-dependency-or-no-pr-line-branches-from-base: dependency without a PR line", () => {
    const units = [unit("Alpha"), unit("Beta", { dependsOn: "Alpha" })];

    const decision = stackFor({ units, unit: "Beta", prs: {}, stackDepth: 2 });

    assert.deepEqual(decision, { base: true }, "a dependency without a PR line branches from the base");
  });

  test("merged-dependency-branches-from-base", () => {
    const decision = stackFor({ units: alphaThenBeta(), unit: "Beta", prs: prLine("MERGED"), stackDepth: 3 });

    assert.deepEqual(decision, { base: true }, "a merged dependency branches from the base");
  });

  test("open-dependency-stacks-on-its-head-branch-at-depth-one", () => {
    const decision = stackFor({ units: alphaThenBeta(), unit: "Beta", prs: prLine("OPEN"), stackDepth: 3 });

    assert.deepEqual(
      decision,
      { stackOn: { unit: "Alpha", pr: PR_URL, branch: "pb/alpha", depth: 1 } },
      "an open dependency is stacked on its head branch at depth 1",
    );
  });

  describe("depth-counts-down-the-depends-on-chain-through-open-prs", () => {
    test("both ancestors open: stacks on the nearest dependency at depth 2", () => {
      const decision = stackFor({ units: chain(), unit: "C", prs: prsWithAState("OPEN"), stackDepth: 10 });

      assert.deepEqual(
        decision,
        { stackOn: { unit: "B", pr: URL_B, branch: "pb/b", depth: 2 } },
        "C stacks on B's head branch at 1 + B's own depth",
      );
    });

    test("the chain stops counting at a merged ancestor: depth 1", () => {
      const decision = stackFor({ units: chain(), unit: "C", prs: prsWithAState("MERGED"), stackDepth: 10 });

      assert.deepEqual(
        decision,
        { stackOn: { unit: "B", pr: URL_B, branch: "pb/b", depth: 1 } },
        "a merged A adds nothing to the depth",
      );
    });
  });

  describe("depth-over-cap-stops-with-g-next-unit", () => {
    test("depth 2 with stack_depth 1 stops", () => {
      const decision = stackFor({ units: chain(), unit: "C", prs: prsWithAState("OPEN"), stackDepth: 1 });

      assert.deepEqual(
        decision,
        { stop: { gate: "G:next-unit", reason: "stack-depth", unit: "C", depth: 2, cap: 1 } },
        "a depth over the cap is a G:next-unit stop naming the unit, depth and cap",
      );
    });

    test("depth 2 with stack_depth 2 still stacks", () => {
      const decision = stackFor({ units: chain(), unit: "C", prs: prsWithAState("OPEN"), stackDepth: 2 });

      assert.deepEqual(
        decision,
        { stackOn: { unit: "B", pr: URL_B, branch: "pb/b", depth: 2 } },
        "a depth equal to the cap stacks",
      );
    });
  });

  test("stack-depth-zero-stops-any-open-dependency", () => {
    const decision = stackFor({ units: alphaThenBeta(), unit: "Beta", prs: prLine("OPEN"), stackDepth: 0 });

    assert.deepEqual(
      decision,
      { stop: { gate: "G:next-unit", reason: "stack-depth", unit: "Beta", depth: 1, cap: 0 } },
      "stack_depth 0 turns stacking off: any open dependency stops",
    );
  });

  test("closed-dependency-is-refused-naming-it", () => {
    const attempt = () => stackFor({ units: alphaThenBeta(), unit: "Beta", prs: prLine("CLOSED"), stackDepth: 3 });

    assert.throws(
      attempt,
      refusedNaming("Alpha"),
      "a closed dependency is refused with a StackRefused naming the dependency unit",
    );
  });

  describe("unknown-pr-state-is-refused", () => {
    const cases = [
      { name: "a DRAFT state", prs: prLine("DRAFT") },
      { name: "a PR url missing from prs", prs: {} },
    ];

    for (const { name, prs } of cases) {
      test(name, () => {
        const attempt = () => stackFor({ units: alphaThenBeta(), unit: "Beta", prs, stackDepth: 3 });

        assert.throws(
          attempt,
          refusedNaming("Alpha"),
          "an unknown dependency PR state is refused with a StackRefused naming the dependency unit",
        );
      });
    }
  });
});

// A four-unit chain D -> C -> B -> A with every PR OPEN: asking for D stacks at depth 3.
describe("depth-three-chain", () => {
  const urls = { A: "https://example.test/o/r/pull/10", B: "https://example.test/o/r/pull/11", C: "https://example.test/o/r/pull/12" };
  const units = () => [
    unit("A", { pr: urls.A }),
    unit("B", { pr: urls.B, dependsOn: "A" }),
    unit("C", { pr: urls.C, dependsOn: "B" }),
    unit("D", { dependsOn: "C" }),
  ];
  const prs = Object.fromEntries(Object.entries(urls).map(([name, url]) => [url, { state: "OPEN", headRefName: `pb/${name.toLowerCase()}` }]));

  test("stack_depth 2 stops at depth 3", () => {
    const decision = stackFor({ units: units(), unit: "D", prs, stackDepth: 2 });

    assert.deepEqual(
      decision,
      { stop: { gate: "G:next-unit", reason: "stack-depth", unit: "D", depth: 3, cap: 2 } },
      "three open ancestors make depth 3, past a cap of 2",
    );
  });

  test("stack_depth 3 stacks on C at depth 3", () => {
    const decision = stackFor({ units: units(), unit: "D", prs, stackDepth: 3 });

    assert.deepEqual(
      decision,
      { stackOn: { unit: "C", pr: urls.C, branch: "pb/c", depth: 3 } },
      "a depth equal to the cap stacks on the nearest dependency",
    );
  });
});

describe("dependency-chain-of", () => {
  test("returns the dependencies nearest first", () => {
    const units = chain();

    const found = dependencyChainOf(units, "C");

    assert.deepEqual(found.map((dependency) => dependency.unit), ["B", "A"], "B comes before A");
    assert.equal(found[0], units[1], "the entries are the plan's own units");
  });

  test("is empty for a unit with no dependency", () => {
    assert.deepEqual(dependencyChainOf(chain(), "A"), [], "A depends on nothing");
  });
});
