// Task 101: same-session resume of a Workflow stage, enforced by the gate.
// A Workflow call carrying resumeFromRunId takes a resume path that never resets the stage. It is
// allowed only while the named stage is the active one, with the recorded runId, the recorded
// attempt and plugin root, a bundle that still hashes to ledger.stage.scriptHash, and no stop.
// Placeholders: each test is a node:test case that fails until its behaviour is built.
import "./isolated-tmpdir.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readLedger, validateLedger } from "../../shared-node/ledger.mjs";
import { assertAllowed, runGate } from "./gate-harness.mjs";
import { baseLedger } from "./ledger-fixture.mjs";
import { sha256 } from "./tap-fixture.mjs";
import { CONFIG, SAFETY_NET, SAFETY_NET_BUNDLE, activeStage, makeLedger, stageCall, withPlugin, withRepo } from "./workflow-fixture.mjs";

const ledgerWithStage = (fields) => {
  const ledger = baseLedger();
  return { ...ledger, stage: { ...ledger.stage, ...fields } };
};

// A resume call: the stage's Workflow call plus resumeFromRunId. Later denial tests override single fields.
const resumeCall = (cwd, pluginRoot, { stage = CONFIG, runId, attempt = 1 } = {}) =>
  stageCall(cwd, stage, { pluginRoot, attempt, task: { description: "set x" } }, { resumeFromRunId: runId });

// A denied resume: exit 0 with the JSON deny form, a reason matching the pattern, and the ledger stage untouched.
const assertDeniedResume = (result, repo, before, reason, why, { remedy, notRemedy } = {}) => {
  assert.equal(result.code, 0, `the JSON deny form needs exit 0; stderr: ${result.stderr}`);
  assert.notEqual(result.stdout, "", `${why}: the gate allowed it`);
  const decision = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny", why);
  assert.match(decision.permissionDecisionReason, reason, "the reason names the failed precondition");
  if (remedy) assert.match(decision.permissionDecisionReason, remedy, "the reason gives the step that works");
  if (notRemedy) assert.doesNotMatch(decision.permissionDecisionReason, notRemedy, "the reason does not offer a step that is refused");
  assert.deepEqual(readLedger(repo.ledgerPath).stage, before, "a denied resume leaves the ledger stage unchanged");
};

describe("stage start records the script hash", () => {
  test("ledger-validator-accepts-script-hash", () => {
    const hash = "b".repeat(64);

    const withHash = validateLedger(ledgerWithStage({ scriptHash: hash }));
    const withNull = validateLedger(ledgerWithStage({ scriptHash: null }));
    const withNone = validateLedger(ledgerWithStage({}));
    const withNumber = validateLedger(ledgerWithStage({ scriptHash: 7 }));

    assert.equal(withHash.valid, true, `a string scriptHash is valid: ${JSON.stringify(withHash.errors)}`);
    assert.equal(withNull.valid, true, `a null scriptHash is valid: ${JSON.stringify(withNull.errors)}`);
    assert.equal(withNone.valid, true, `an older ledger with no scriptHash is valid: ${JSON.stringify(withNone.errors)}`);
    assert.equal(withNumber.valid, false, "a non-string scriptHash is invalid");
    assert.ok(withNumber.errors.some((e) => e.path === "stage.scriptHash" && /string or null/.test(e.message)), `the error names stage.scriptHash: ${JSON.stringify(withNumber.errors)}`);
  });

  test("stage-start-records-script-hash", async () => {
    const bundle = "export const meta = { name: 'code-config' };\n// a bundle of its own\n";
    await withPlugin({ bundles: { [CONFIG]: bundle } }, (pluginRoot) => withRepo({}, async (repo) => {
      const args = { pluginRoot, attempt: 1, task: { description: "set x" } };

      const result = await runGate(stageCall(repo.dir, CONFIG, args), { pluginRoot });

      assertAllowed(result);
      const { stage } = readLedger(repo.ledgerPath);
      assert.equal(stage.scriptHash, sha256(bundle), "scriptHash is the sha256 of the plugin's bundle");
      assert.deepEqual({ name: stage.name, status: stage.status, runId: stage.runId, attempt: stage.attempt }, { name: CONFIG, status: "active", runId: null, attempt: 1 });
      assert.ok(Number.isFinite(Date.parse(stage.startedAt)), `startedAt is recorded: ${stage.startedAt}`);
    }));
  });
});

// The recorded run every resume test starts from: an active stage on run wf_1, attempt 1, whose scriptHash is
// the hash of the plugin's CONFIG bundle. Each test passes only the stage fields, stop or extra bundles it changes.
const RECORDED_BUNDLE = "export const meta = { name: 'code-config' };\n// the bundle that started the run\n";
// A bundles entry of null leaves that stage's bundle file out of the plugin; a stage override of undefined leaves that field out of the ledger.
const withoutValue = (object, dropped) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== dropped));
const pluginBundle = (pluginRoot) => join(pluginRoot, "workflows", `${CONFIG}.js`);
const REDO_REMEDY = /pb stage fail[\s\S]*next attempt|next attempt[\s\S]*pb stage fail/;

const withRecordedRun = ({ stage: overrides = {}, stop = null, bundles: extra = {} } = {}, fn) => {
  const bundles = withoutValue({ [CONFIG]: RECORDED_BUNDLE, ...extra }, null);
  return withPlugin({ bundles }, (pluginRoot) => {
    const stage = withoutValue({ ...activeStage(CONFIG, 1), scriptHash: sha256(RECORDED_BUNDLE), ...overrides }, undefined);
    return withRepo({ ledger: makeLedger({ stage, stop }) }, (repo) => fn({ repo, pluginRoot, stage, before: readLedger(repo.ledgerPath).stage }));
  });
};

describe("a matching resume is allowed", () => {
  test("matching-resume-allowed-and-stage-unchanged", () =>
    withRecordedRun({}, async ({ repo, pluginRoot, stage, before }) => {
      const result = await runGate(resumeCall(repo.dir, pluginRoot, { runId: stage.runId }), { pluginRoot });

      assertAllowed(result);
      assert.deepEqual(readLedger(repo.ledgerPath).stage, before, "resume leaves runId, attempt, startedAt and scriptHash as recorded");
    }));
});

describe("each failed precondition of resume is denied", () => {
  test("resume-after-finished-stage-denied", () =>
    withRecordedRun({ stage: { status: "done" } }, async ({ repo, pluginRoot, stage, before }) => {
      const result = await runGate(resumeCall(repo.dir, pluginRoot, { runId: stage.runId }), { pluginRoot });

      assertDeniedResume(result, repo, before, /not active|finished/, "resuming a finished stage is denied", { remedy: /pb status/, notRemedy: /stage fail/ });
    }));

  test("resume-naming-another-stage-denied", () =>
    withRecordedRun({ bundles: { [SAFETY_NET]: SAFETY_NET_BUNDLE } }, async ({ repo, pluginRoot, stage, before }) => {
      const result = await runGate(resumeCall(repo.dir, pluginRoot, { stage: SAFETY_NET, runId: stage.runId }), { pluginRoot });

      assertDeniedResume(result, repo, before, /not the active stage/, "resuming a stage other than the active one is denied", { remedy: new RegExp(`pairingbuddy:${CONFIG}[\\s\\S]*pb status|pb status[\\s\\S]*pairingbuddy:${CONFIG}`) });
    }));

  test("resume-with-stop-denied", () => {
    const stop = { reason: "step-failed: a step failed past its retries", seq: 0, code: "step-failed" };
    return withRecordedRun({ stop }, async ({ repo, pluginRoot, stage, before }) => {
      const matching = await runGate(resumeCall(repo.dir, pluginRoot, { runId: stage.runId }), { pluginRoot });
      assertDeniedResume(matching, repo, before, /stop/, "resuming past a recorded stop is denied", { remedy: /pb status/ });

      const wrongRun = await runGate(resumeCall(repo.dir, pluginRoot, { runId: "wf_2" }), { pluginRoot });
      assertDeniedResume(wrongRun, repo, before, /stop/, "a stop wins over the runId checks", { remedy: /pb status/, notRemedy: /stage fail/ });
    });
  });

  test("resume-wrong-run-id-denied", () =>
    withRecordedRun({}, async ({ repo, pluginRoot, before }) => {
      assert.equal(before.runId, "wf_1", "setup: the ledger records run wf_1");

      const result = await runGate(resumeCall(repo.dir, pluginRoot, { runId: "wf_2" }), { pluginRoot });

      assertDeniedResume(result, repo, before, /does not match the recorded run/, "resuming a run other than the recorded one is denied", { remedy: /pb stage fail/ });
    }));

  test("resume-with-no-recorded-run-denied", () =>
    withRecordedRun({ stage: { runId: null } }, async ({ repo, pluginRoot, before }) => {
      assert.equal(before.status, "active", "setup: the ledger records an active stage");
      assert.equal(before.runId, null, "setup: the ledger records no run for it");

      const named = await runGate(resumeCall(repo.dir, pluginRoot, { runId: "wf_1" }), { pluginRoot });
      assertDeniedResume(named, repo, before, /no recorded run/, "resuming a run the stage never recorded is denied");

      const absent = await runGate(resumeCall(repo.dir, pluginRoot, { runId: null }), { pluginRoot });
      assertDeniedResume(absent, repo, before, /no recorded run/, "a null resumeFromRunId must not match a null recorded runId");
    }));

  test("resume-wrong-attempt-denied", () =>
    withRecordedRun({}, async ({ repo, pluginRoot, stage, before }) => {
      assert.equal(before.attempt, 1, "setup: the ledger records attempt 1");
      const call = resumeCall(repo.dir, pluginRoot, { runId: stage.runId, attempt: before.attempt + 1 });
      assert.equal(call.tool_input.resumeFromRunId, stage.runId, "setup: the call names the recorded run");

      const result = await runGate(call, { pluginRoot });

      assertDeniedResume(result, repo, before, /Wrong attempt|got 2/, "resuming with an attempt other than the recorded one is denied", { remedy: /Resume at attempt 1\b/ });
    }));

  test("resume-wrong-plugin-root-denied", () =>
    withRecordedRun({}, async ({ repo, pluginRoot, stage, before }) => {
      const otherRoot = `${pluginRoot}-elsewhere`;
      const call = resumeCall(repo.dir, otherRoot, { runId: stage.runId });
      assert.equal(call.tool_input.resumeFromRunId, stage.runId, "setup: the call names the recorded run");
      assert.equal(call.tool_input.args.attempt, before.attempt, "setup: the call carries the recorded attempt");

      const result = await runGate(call, { pluginRoot });

      assertDeniedResume(result, repo, before, /pluginRoot/, "resuming with a pluginRoot that is not the plugin root is denied", { remedy: new RegExp(`Use pluginRoot ${pluginRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
    }));

  test("resume-with-mismatched-script-denied", () =>
    withRecordedRun({}, async ({ repo, pluginRoot, stage, before }) => {
      const call = resumeCall(repo.dir, pluginRoot, { runId: stage.runId });
      call.tool_input.script = "export const meta = { name: 'code-config' };\n// a script that is not the built bundle\n";
      assert.equal(call.tool_input.resumeFromRunId, stage.runId, "setup: the call names the recorded run");

      const result = await runGate(call, { pluginRoot });

      assertDeniedResume(result, repo, before, /does not match the built bundle/, "resuming with a script that is not the built bundle is denied", { remedy: /by name with no script/ });
    }));

  test("resume-with-changed-bundle-denied", () =>
    withRecordedRun({}, async ({ repo, pluginRoot, stage, before }) => {
      const bundlePath = pluginBundle(pluginRoot);
      writeFileSync(bundlePath, `${RECORDED_BUNDLE}// rewritten after the stage started\n`);
      const call = resumeCall(repo.dir, pluginRoot, { runId: stage.runId });
      assert.equal(before.scriptHash, sha256(RECORDED_BUNDLE), "setup: the ledger records the hash of the bundle at start");
      assert.notEqual(sha256(readFileSync(bundlePath, "utf8")), before.scriptHash, "setup: the bundle on disk no longer hashes to the recorded scriptHash");
      assert.equal(call.tool_input.resumeFromRunId, stage.runId, "setup: the call names the recorded run");
      assert.equal(call.tool_input.script, undefined, "setup: the call names the workflow only, with no script");

      const result = await runGate(call, { pluginRoot });

      assertDeniedResume(result, repo, before, /bundle changed since the stage started/, "resuming after the bundle changed is denied", { remedy: REDO_REMEDY });
    }));

  describe("resume-with-no-recorded-script-hash-denied", () => {
    test("a ledger from before the hash was recorded", () =>
      withRecordedRun({ stage: { scriptHash: undefined } }, async ({ repo, pluginRoot, stage, before }) => {
        const call = resumeCall(repo.dir, pluginRoot, { runId: stage.runId });
        assert.equal("scriptHash" in before, false, "setup: the recorded stage has no scriptHash field at all");
        assert.equal(call.tool_input.resumeFromRunId, stage.runId, "setup: the call names the recorded run");

        const result = await runGate(call, { pluginRoot });

        assertDeniedResume(result, repo, before, /no script hash|bundle changed since the stage started/, "resuming a stage that recorded no script hash is denied", { remedy: REDO_REMEDY });
      }));

    test("the start could not read the bundle and it is still missing", () =>
      withRecordedRun({ stage: { scriptHash: null }, bundles: { [CONFIG]: null } }, async ({ repo, pluginRoot, stage, before }) => {
        const call = resumeCall(repo.dir, pluginRoot, { runId: stage.runId });
        assert.equal(before.scriptHash, null, "setup: the stage recorded scriptHash null");
        assert.equal(existsSync(pluginBundle(pluginRoot)), false, "setup: the plugin has no bundle file for the stage");
        assert.equal(call.tool_input.script, undefined, "setup: the call names the workflow only, with no script");

        const result = await runGate(call, { pluginRoot });

        assertDeniedResume(result, repo, before, /no script hash|bundle changed since the stage started/, "a null recorded hash must not match a bundle that is still unreadable", { remedy: REDO_REMEDY });
      }));
  });

  test("resume-with-missing-bundle-never-matches", () =>
    withRecordedRun({ stage: { scriptHash: sha256("") }, bundles: { [CONFIG]: null } }, async ({ repo, pluginRoot, stage, before }) => {
      const call = resumeCall(repo.dir, pluginRoot, { runId: stage.runId });
      assert.equal(before.scriptHash, sha256(""), "setup: the recorded hash is the hash of empty text");
      assert.equal(existsSync(pluginBundle(pluginRoot)), false, "setup: the plugin has no bundle file for the stage");

      const result = await runGate(call, { pluginRoot });

      assertDeniedResume(result, repo, before, /no script hash|bundle changed since the stage started/, "a missing bundle must not hash to the empty text's hash", { remedy: REDO_REMEDY });
    }));
});
