// Scenario: light-review-call. The lightReview workflow function makes one Sonnet lens call and settles the result.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runScript } from "./harness.mjs";

// The wrapper stage goes through the real bundler, in a temp root that only links shared-node and the shared sources.
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const WRAPPER_STAGE = [
  "export const meta = { name: 'light-review-wrapper', description: 'test wrapper' };",
  "// pb-inline-module shared-node/keys.mjs",
  "// pb-inline-module shared-node/labels.mjs",
  "// pb-inline-module shared-node/lens-merge.mjs",
  "// pb-inline-module shared-node/shell-word.mjs",
  "// pb-inline-module shared-node/glob-match.mjs",
  "// pb-inline-module shared-node/light-review.mjs",
  "",
  "return await lightReview(args);",
  "",
].join("\n");
let root;
let wrapperPath;
before(() => {
  root = mkdtempSync(join(tmpdir(), "pb-light-review-"));
  mkdirSync(join(root, "workflows-src", "stages"), { recursive: true });
  symlinkSync(join(REPO, "shared-node"), join(root, "shared-node"));
  symlinkSync(join(REPO, "workflows-src", "shared"), join(root, "workflows-src", "shared"));
  writeFileSync(join(root, "workflows-src", "stages", "light-review-wrapper.mjs"), WRAPPER_STAGE);
  execFileSync(process.execPath, [join(REPO, "scripts", "build-workflows.mjs"), "--root", root, "--src", join(root, "workflows-src"), "--out", join(root, "out")]);
  wrapperPath = join(root, "out", "light-review-wrapper.js");
});
after(() => rmSync(root, { recursive: true, force: true }));

const LIGHT_REVIEW = JSON.parse(readFileSync(join(REPO, "contracts", "lenses.json"), "utf8")).lightReview;
const TEST_CONFIG = { runners: { node: { test_directory: "tests/js", file_pattern: "*.test.mjs" } } };
const SUBJECT = "zebra-crossing-subject-7431";
const lightConfig = {
  stage: "tdd",
  attempt: 1,
  item: "t3",
  changed: ["shared-node/a.mjs"],
  testConfig: TEST_CONFIG,
  lightReview: LIGHT_REVIEW,
  subject: SUBJECT,
  corpus: ["docs/a.md"],
};
const runLightReview = (config, agent) => runScript(wrapperPath, { args: config, agent });
const emptyReturn = { pb_key: "k", ambiguity: null, focus_changes: [], findings: [] };
const finding = (focus) => ({ focus, rule: "some-rule", severity: "medium", kind: "fix-here", claim: `claim for ${focus}`, where: "shared-node/a.mjs:1" });

test("exactly-one-lens-sonnet-call-with-prompt", async () => {
  const { calls } = await runLightReview(lightConfig, async () => emptyReturn);

  assert.equal(calls.length, 1, "exactly one agent call");
  const { prompt, opts } = calls[0];
  assert.equal(opts.agentType, "pairingbuddy:lens", "the call goes to the lens agent");
  assert.equal(opts.model, "sonnet", "the call uses sonnet");
  const section = (tag) => JSON.parse(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(prompt)?.[1] ?? "null");
  const codeSmell = LIGHT_REVIEW.catalog.find(({ name }) => name === "code-smell");
  assert.deepEqual(section("focuses"), [codeSmell], "the <focuses> section holds exactly the code-smell catalog entry");
  assert.deepEqual(section("catalog"), LIGHT_REVIEW.catalog, "the <catalog> section holds the full catalog");
  assert.ok(prompt.includes(JSON.stringify(SUBJECT)), "the prompt carries the serialized subject");
});
test("findings-outside-settled-focus-dropped", async () => {
  const agentReturn = {
    pb_key: "k",
    ambiguity: null,
    focus_changes: [
      { focus: "design-fit", change: "add", reason: "new module" },
      { focus: "test-level", change: "add", reason: "" },
    ],
    findings: [finding("code-smell"), finding("design-fit"), finding("test-level")],
  };

  const { result } = await runLightReview(lightConfig, async () => agentReturn);

  assert.deepEqual(result.focuses, ["code-smell", "design-fit"], "the reasoned add settles into the focuses");
  assert.deepEqual(result.survivors.map(({ claim }) => claim), ["claim for code-smell", "claim for design-fit"], "only findings in settled focuses survive");
  assert.ok(result.survivors.every(({ id }) => /^light-review-\d+$/.test(id)), "each survivor has a light-review id");
  assert.deepEqual(result.rejected.map(({ focus, change }) => ({ focus, change })), [{ focus: "test-level", change: "add" }], "the reasonless add is rejected");
});
test("zero-rule-focuses-no-call-no-findings", async () => {
  const { calls, result } = await runLightReview({ ...lightConfig, changed: [] }, async () => emptyReturn);

  assert.equal(calls.length, 0, "no agent call is made");
  assert.deepEqual(result.focuses, [], "there are no focuses");
  assert.deepEqual(result.survivors, [], "there are no findings");
  assert.deepEqual(result.uncovered, [], "nothing was owed a review");
  assert.equal(result.agentsUsed, 0, "no agents were used");
});
test("reviewer-drops-all-focuses-no-findings", async () => {
  const agentReturn = {
    pb_key: "k",
    ambiguity: null,
    focus_changes: [{ focus: "code-smell", change: "drop", reason: "only comments changed" }],
    findings: [finding("code-smell")],
  };

  const { calls, result } = await runLightReview(lightConfig, async () => agentReturn);

  assert.deepEqual(result.focuses, [], "the reasoned drop empties the focuses");
  assert.deepEqual(result.survivors, [], "no finding survives without a settled focus");
  assert.deepEqual(result.uncovered, [], "nothing is uncovered");
  assert.equal(calls.length, 1, "exactly one agent call");
});
test("failed-reviewer-goes-to-uncovered", async () => {
  const { result } = await runLightReview(lightConfig, async () => null);

  assert.deepEqual(result.uncovered, ["light-review"], "the failed reviewer is reported uncovered");
  assert.deepEqual(result.survivors, [], "a failed reviewer yields no findings");
  assert.deepEqual(result.focuses, ["code-smell"], "nothing was settled away, so the rule focuses stay");
  assert.equal(result.agentsUsed, 1, "the one agent call is counted");
});
