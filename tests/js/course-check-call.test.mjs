// Scenario: course-check-call. courseCheck(config) makes one checker call per fix group and returns the verdict or null.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runScript } from "./harness.mjs";
import { buildKey, fixAttemptRound } from "../../shared-node/keys.mjs";
import { buildLabel } from "../../shared-node/labels.mjs";

// The wrapper stage goes through the real bundler, in a temp root that only links shared-node and the shared sources.
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const WRAPPER_STAGE = [
  "export const meta = { name: 'course-check-wrapper', description: 'test wrapper' };",
  "// pb-inline-module shared-node/keys.mjs",
  "// pb-inline-module shared-node/labels.mjs",
  "",
  "return await courseCheck(args);",
  "",
].join("\n");
let root;
let wrapperPath;
before(() => {
  root = mkdtempSync(join(tmpdir(), "pb-course-check-"));
  mkdirSync(join(root, "workflows-src", "stages"), { recursive: true });
  symlinkSync(join(REPO, "shared-node"), join(root, "shared-node"));
  symlinkSync(join(REPO, "workflows-src", "shared"), join(root, "workflows-src", "shared"));
  symlinkSync(join(REPO, "contracts"), join(root, "contracts"));
  writeFileSync(join(root, "workflows-src", "stages", "course-check-wrapper.mjs"), WRAPPER_STAGE);
  execFileSync(process.execPath, [join(REPO, "scripts", "build-workflows.mjs"), "--root", root, "--src", join(root, "workflows-src"), "--out", join(root, "out")]);
  wrapperPath = join(root, "out", "course-check-wrapper.js");
});
after(() => rmSync(root, { recursive: true, force: true }));

const SCHEMA = JSON.parse(readFileSync(join(REPO, "contracts", "schemas", "course-verdict.schema.json"), "utf8"));
const DIFF = "diff --git a/a.mjs b/a.mjs\n+const zebra = 8812;";
const FINDINGS = [{ id: "code-1", rule: "no-magic-numbers", claim: "8812 is a magic number", where: "a.mjs:1" }];
const baseConfig = {
  stage: "code-safety-net",
  attempt: 1,
  fixAttempt: 1,
  rollbacks: 0,
  group: { id: "g1", findings: FINDINGS },
  diff: DIFF,
  schema: SCHEMA,
};
const runCourseCheck = (config, agent) => runScript(wrapperPath, { args: config, agent });
const keyOf = (config) => buildKey({ stage: config.stage, role: "course-checker", item: config.group.id, round: fixAttemptRound(config.fixAttempt), attempt: config.attempt });
const labelOf = (config) => buildLabel({ stage: config.stage, phase: null, role: "course-checker", item: config.group.id, round: fixAttemptRound(config.fixAttempt) });

const betterVerdictFor = (config) => ({ pb_key: keyOf(config), finding_id: "code-1", verdict: "better", mistake: "none", what_went_wrong: "" });

test("one-sonnet-call-with-pinned-key-label-and-data", async () => {
  const key = keyOf(baseConfig);
  const verdict = betterVerdictFor(baseConfig);

  const { calls, result } = await runCourseCheck(baseConfig, async () => verdict);

  assert.equal(calls.length, 1, "exactly one agent call");
  const { prompt, opts } = calls[0];
  assert.equal(opts.agentType, "pairingbuddy:course-checker", "the call goes to the course checker");
  assert.equal(opts.model, "sonnet", "the call uses sonnet");
  assert.equal(opts.label, labelOf(baseConfig), "the label names stage, role, group and round");
  assert.deepEqual(opts.schema.properties.pb_key.enum, [key], "the key is pinned in the schema");
  assert.ok(prompt.includes(key), "the prompt carries the key");
  const section = (tag) => JSON.parse(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(prompt)?.[1] ?? "null");
  assert.deepEqual(section("findings"), FINDINGS, "the <findings> section holds the group's findings");
  assert.equal(section("diff"), DIFF, "the <diff> section holds the diff as JSON");
  assert.deepEqual(result, verdict, "the result is the agent's verdict");
});

const modelFor = async (overrides) => {
  const config = { ...baseConfig, ...overrides };
  const { calls } = await runCourseCheck(config, async () => betterVerdictFor(config));
  assert.equal(calls.length, 1, "exactly one agent call");
  return calls[0].opts.model;
};

test("opus-after-first-rollback", async () => {
  assert.equal(await modelFor({ rollbacks: 0 }), "sonnet", "no rollbacks stays on sonnet");
  assert.equal(await modelFor({ rollbacks: 1 }), "opus", "one rollback escalates to opus");
  assert.equal(await modelFor({ rollbacks: 2 }), "opus", "two rollbacks stay on opus");
});

test("opus-on-plan-stage", async () => {
  assert.equal(await modelFor({ stage: "plan-requirements" }), "opus", "plan-requirements uses opus with no rollbacks");
  assert.equal(await modelFor({ stage: "plan-architecture" }), "opus", "plan-architecture uses opus with no rollbacks");
  assert.equal(await modelFor({ stage: "plan-tracers" }), "opus", "plan-tracers uses opus with no rollbacks");
  assert.equal(await modelFor({ stage: "plan-sequence" }), "opus", "plan-sequence uses opus with no rollbacks");
  assert.equal(await modelFor({ stage: "replan" }), "sonnet", "replan is not a plan stage");
  assert.equal(await modelFor({ stage: "code-plan" }), "sonnet", "code-plan is not a plan stage");
});

const groupOfTwo = {
  id: "g1",
  findings: [
    { id: "code-1", rule: "no-magic-numbers", claim: "8812 is a magic number", where: "a.mjs:1" },
    { id: "code-2", rule: "no-dead-code", claim: "zebra is unused", where: "a.mjs:2" },
  ],
};
const wrongDirectionFor = (config, findingId) => ({
  pb_key: keyOf(config),
  finding_id: findingId,
  verdict: "wrong-direction",
  mistake: "wrong-direction",
  what_went_wrong: "the fix moved away from the finding",
});

test("verdict-finding-outside-group-gives-null", async () => {
  const idNotInGroup = "tests-1";
  const config = { ...baseConfig, group: groupOfTwo };

  const { calls, result } = await runCourseCheck(config, async () => wrongDirectionFor(config, idNotInGroup));

  assert.equal(calls.length, 1, "exactly one agent call");
  assert.equal(result, null, "a verdict naming a finding outside the group gives null");
});

test("verdict-naming-a-later-group-finding-is-kept", async () => {
  const config = { ...baseConfig, group: groupOfTwo };
  const verdict = wrongDirectionFor(config, "code-2");

  const { result } = await runCourseCheck(config, async () => verdict);

  assert.deepEqual(result, verdict, "a wrong-direction verdict naming the group's second finding is returned as is");
});

test("null-checker-return-gives-null", async () => {
  // The workflow runtime returns null for a failed agent call.
  const { calls, result } = await runCourseCheck(baseConfig, async () => null);

  assert.equal(calls.length, 1, "exactly one agent call");
  assert.equal(result, null, "a checker call that returns nothing gives null");
});

test("dropped-verdict-is-logged", async () => {
  const config = { ...baseConfig, group: groupOfTwo };
  const outsideGroup = wrongDirectionFor(config, "tests-1");
  const accepted = wrongDirectionFor(config, "code-2");
  const mentionsGroup = (logs) => logs.filter((entry) => String(entry).includes("g1"));

  const nullRun = await runCourseCheck(config, async () => null);
  const outsideRun = await runCourseCheck(config, async () => outsideGroup);
  const acceptedRun = await runCourseCheck(config, async () => accepted);

  assert.equal(mentionsGroup(nullRun.logs).length, 1, "a null checker return logs one entry naming the group");
  assert.equal(mentionsGroup(outsideRun.logs).length, 1, "a verdict outside the group logs one entry naming the group");
  assert.equal(mentionsGroup(acceptedRun.logs).length, 0, "an accepted verdict logs nothing about the group");
});
