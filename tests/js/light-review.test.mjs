// Scenario: light-review-rule and settle-focuses. ruleFocuses picks up to two focuses deterministically; settleFocuses applies reviewer changes only when valid.
// Scenario: light-review-schema-and-safeguard. The identify agents remain registered after the light review lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { ruleFocuses, settleFocuses } from "../../shared-node/light-review.mjs";
import { matchesGlob } from "../../shared-node/glob-match.mjs";

const TEST_CONFIG = {
  runners: {
    node: { test_directory: "tests/js", file_pattern: "*.test.mjs" },
    pytest: { test_directory: "tests", file_pattern: "test_*.py" },
  },
};
const LIGHT_REVIEW = {
  model: "sonnet",
  maxFocuses: 2,
  rule: { test: "test-quality", production: "code-smell" },
  catalog: [
    { name: "code-smell", brief: "smells" },
    { name: "naming-and-domain", brief: "names" },
    { name: "duplication-against-corpus", brief: "duplicates" },
    { name: "test-quality", brief: "test smells" },
    { name: "test-level", brief: "level" },
    { name: "design-fit", brief: "fit" },
  ],
};

const namesOf = (rejected) => rejected.map(({ focus, change }) => ({ focus, change }));

// light-review-rule
test("production-file-selects-code-smell", () => {
  const changed = ["shared-node/light-review.mjs"];

  const focuses = ruleFocuses(changed, TEST_CONFIG, LIGHT_REVIEW, matchesGlob);

  assert.deepEqual(focuses, ["code-smell"], "a production-only change selects the code-smell focus");
});
test("test-file-selects-test-quality", () => {
  const changed = ["tests/js/light-review.test.mjs"];

  const focuses = ruleFocuses(changed, TEST_CONFIG, LIGHT_REVIEW, matchesGlob);

  assert.deepEqual(focuses, ["test-quality"], "a file under a runner test_directory matching its file_pattern selects the test-quality focus");
});
test("both-kinds-give-both-in-catalog-order", () => {
  const changed = ["tests/js/light-review.test.mjs", "shared-node/light-review.mjs"];

  const focuses = ruleFocuses(changed, TEST_CONFIG, LIGHT_REVIEW, matchesGlob);

  assert.deepEqual(focuses, ["code-smell", "test-quality"], "both kinds give both focuses in catalog order, even when the test file comes first");
});
test("same-files-any-order-same-focus", () => {
  const forward = ["shared-node/light-review.mjs", "tests/js/light-review.test.mjs", "tests/js/light-review.test.mjs"];
  const reversed = [...forward].reverse();
  const shuffled = ["tests/js/light-review.test.mjs", "shared-node/light-review.mjs", "tests/js/light-review.test.mjs"];

  const fromForward = ruleFocuses(forward, TEST_CONFIG, LIGHT_REVIEW, matchesGlob);
  const fromReversed = ruleFocuses(reversed, TEST_CONFIG, LIGHT_REVIEW, matchesGlob);
  const fromShuffled = ruleFocuses(shuffled, TEST_CONFIG, LIGHT_REVIEW, matchesGlob);

  assert.deepEqual(fromReversed, fromForward, "reversing the order, with duplicates, gives the same focuses");
  assert.deepEqual(fromShuffled, fromForward, "a different order and duplicate mix gives the same focuses");
});
test("no-changed-files-zero-focuses", () => {
  const focuses = ruleFocuses([], TEST_CONFIG, LIGHT_REVIEW, matchesGlob);

  assert.deepEqual(focuses, [], "no changed files select no focuses");
});

// settle-focuses
test("change-with-reason-applies", () => {
  const rule = ["code-smell"];
  const changes = [
    { focus: "code-smell", change: "drop", reason: "only renames" },
    { focus: "naming-and-domain", change: "add", reason: "new domain terms" },
  ];

  const settled = settleFocuses(rule, changes, LIGHT_REVIEW);

  assert.deepEqual(settled.focuses, ["naming-and-domain"], "a drop and an add, each with a reason, replace the rule focus");
  assert.deepEqual(settled.rejected, [], "no change is rejected when each carries a reason and stays in the catalog");
});
test("blank-reason-rejected-rule-focus-stands", () => {
  const rule = ["code-smell"];
  const emptyReason = { focus: "code-smell", change: "drop", reason: "" };
  const blankReason = { focus: "code-smell", change: "drop", reason: "   " };

  const settledEmpty = settleFocuses(rule, [emptyReason], LIGHT_REVIEW);
  const settledBlank = settleFocuses(rule, [blankReason], LIGHT_REVIEW);

  assert.deepEqual(settledEmpty.focuses, ["code-smell"], "a drop with an empty reason leaves the rule focus standing");
  assert.deepEqual(namesOf(settledEmpty.rejected), [{ focus: "code-smell", change: "drop" }], "only the empty-reason drop is rejected, naming its focus and change");
  assert.match(settledEmpty.rejected[0].why, /reason/, "the rejection says the reason is missing");
  assert.deepEqual(settledBlank.focuses, ["code-smell"], "a drop with a whitespace-only reason leaves the rule focus standing");
  assert.deepEqual(namesOf(settledBlank.rejected), [{ focus: "code-smell", change: "drop" }], "only the whitespace-only drop is rejected, naming its focus and change");
  assert.match(settledBlank.rejected[0].why, /reason/, "the rejection says the reason is missing");
});
test("focus-outside-catalog-rejected", () => {
  const rule = ["code-smell"];
  const outsideCatalog = { focus: "security", change: "add", reason: "touches auth" };

  const settled = settleFocuses(rule, [outsideCatalog], LIGHT_REVIEW);

  assert.deepEqual(settled.focuses, ["code-smell"], "a focus outside the catalog is not added");
  assert.deepEqual(namesOf(settled.rejected), [{ focus: "security", change: "add" }], "only the outside-catalog add is rejected, naming its focus and change");
  assert.match(settled.rejected[0].why, /catalog/, "the rejection says the focus is not in the catalog");
});
test("third-focus-rejected", () => {
  const rule = ["code-smell", "test-quality"];
  const thirdAdd = { focus: "design-fit", change: "add", reason: "new module boundary" };
  const dropTestQuality = { focus: "test-quality", change: "drop", reason: "no test changes of substance" };

  const overLimit = settleFocuses(rule, [thirdAdd], LIGHT_REVIEW);
  const dropFreesRoom = settleFocuses(rule, [thirdAdd, dropTestQuality], LIGHT_REVIEW);

  assert.deepEqual(overLimit.focuses, ["code-smell", "test-quality"], "an add past the two-focus limit leaves the rule focuses standing");
  assert.deepEqual(namesOf(overLimit.rejected), [{ focus: "design-fit", change: "add" }], "only the third-focus add is rejected, naming its focus and change");
  assert.match(overLimit.rejected[0].why, /third|more than|at most/, "the rejection says the limit of two focuses was exceeded");
  assert.deepEqual(dropFreesRoom.focuses, ["code-smell", "design-fit"], "a valid drop listed after the add still frees room, because drops apply before adds");
  assert.deepEqual(dropFreesRoom.rejected, [], "nothing is rejected when the drop makes room for the add");
});

// light-review-schema-and-safeguard (safeguard, runs last)
test("identify-agents-remain-registered", () => {
  const root = new URL("../../", import.meta.url);
  const read = (rel) => readFileSync(new URL(rel, root), "utf8");
  const agentConfig = read("contracts/agent-config.yaml");
  const pluginAgents = JSON.parse(read(".claude-plugin/plugin.json")).agents;

  for (const name of ["identify-test-issues", "identify-code-issues"]) {
    assert.match(agentConfig, new RegExp(`^  ${name}:$`, "m"), `agent-config.yaml keeps a top-level entry for ${name}`);
    assert.ok(pluginAgents.includes(`./agents/${name}.md`), `plugin.json still lists ./agents/${name}.md`);
    assert.ok(existsSync(new URL(`agents/${name}.md`, root)), `agents/${name}.md still exists`);
  }
});
