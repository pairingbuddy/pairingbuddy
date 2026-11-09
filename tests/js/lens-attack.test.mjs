// Scenarios: lens-spawn, lens-merge, lens-uncovered, lens-result-shape. lensAttack with recording stand-in agents.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runScript } from "./harness.mjs";

// Real workflows are built by scripts/build-workflows.mjs, so the wrapper stage goes through that bundler (same preamble, same inlined modules). The temp root only links shared-node and the real shared sources, so nothing in the repo is written.
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const WRAPPER_STAGE = [
  "export const meta = { name: 'lens-wrapper', description: 'test wrapper' };",
  "// pb-inline-module shared-node/keys.mjs",
  "// pb-inline-module shared-node/labels.mjs",
  "// pb-inline-module shared-node/lens-merge.mjs",
  "// pb-inline-module shared-node/shell-word.mjs",
  "",
  "return await lensAttack(args);",
  "",
].join("\n");
let root;
let wrapperPath;
before(() => {
  root = mkdtempSync(join(tmpdir(), "pb-lens-"));
  mkdirSync(join(root, "workflows-src", "stages"), { recursive: true });
  symlinkSync(join(REPO, "shared-node"), join(root, "shared-node"));
  symlinkSync(join(REPO, "workflows-src", "shared"), join(root, "workflows-src", "shared"));
  writeFileSync(join(root, "workflows-src", "stages", "lens-wrapper.mjs"), WRAPPER_STAGE);
  execFileSync(process.execPath, [join(REPO, "scripts", "build-workflows.mjs"), "--root", root, "--src", join(root, "workflows-src"), "--out", join(root, "out")]);
  wrapperPath = join(root, "out", "lens-wrapper.js");
});
after(() => rmSync(root, { recursive: true, force: true }));

const configWith = (lenses) => ({ stage: "scenarios", subject: "task", attempt: 1, lenses });
const TWO_LENSES = configWith([{ name: "necessity", model: "sonnet" }, { name: "patterns", model: "opus" }]);
const ONE_LENS = configWith([{ name: "necessity", model: "sonnet" }]);
const lensReturn = (findings) => ({ pb_key: "k", ambiguity: null, findings });
const runLensAttack = (config, agent) => runScript(wrapperPath, { args: config, agent });

// lens-spawn
test("With two lenses naming sonnet and opus, the recorded agent() calls pass opts.model sonnet and opus respectively", async () => {
  const config = TWO_LENSES;

  const { calls } = await runLensAttack(config, async () => ({ findings: [] }));

  assert.deepEqual(calls.map(({ opts }) => opts.model), ["sonnet", "opus"]);
});

test("Every lens call has agentType pairingbuddy:lens (the harness rejects it otherwise) and a label built from the stage, role lens and the lens name", async () => {
  const config = TWO_LENSES;

  const { calls } = await runLensAttack(config, async () => ({ findings: [] }));

  assert.deepEqual(calls.map(({ opts }) => opts.agentType), ["pairingbuddy:lens", "pairingbuddy:lens"]);
  assert.deepEqual(calls.map(({ opts }) => opts.label), ["pb1 scenarios - lens necessity r1", "pb1 scenarios - lens patterns r1"]);
});

test("Each lens call's prompt carries its lens name and the serialized subject it must review", async () => {
  const config = { ...TWO_LENSES, subject: { title: "zebra-crossing-subject-7431", items: ["alpha-item"] } };

  const { calls } = await runLensAttack(config, async () => ({ findings: [] }));

  const names = ["necessity", "patterns"];
  calls.forEach(({ prompt }, i) => {
    assert.ok(prompt.includes(`<lens>`) && prompt.includes(names[i]), `prompt ${i} names lens ${names[i]}`);
    assert.ok(prompt.includes("<subject>") && prompt.includes(JSON.stringify(config.subject)), `prompt ${i} carries the serialized subject`);
  });
});

// lens-merge
test("Same lens returns, with the lenses completing in opposite orders, give a deep-equal result", async () => {
  const config = TWO_LENSES;
  const findingsByModel = {
    sonnet: [{ rule: "R1", severity: "high", claim: "claim one", where: "a.mjs:1" }],
    opus: [{ rule: "R2", severity: "low", claim: "claim two", where: "b.mjs:2" }],
  };
  // Each agent waits on a deferred promise, released in the order the test names, so the completion order is exact.
  const runCompletingIn = async (order) => {
    const gates = {};
    const waiting = { sonnet: new Promise((resolve) => { gates.sonnet = resolve; }), opus: new Promise((resolve) => { gates.opus = resolve; }) };
    const respond = async (_prompt, opts) => {
      await waiting[opts.model];
      return lensReturn(findingsByModel[opts.model]);
    };
    const running = runLensAttack(config, respond);
    for (const model of order) {
      gates[model]();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return running;
  };

  const firstLensFirst = await runCompletingIn(["sonnet", "opus"]);
  const secondLensFirst = await runCompletingIn(["opus", "sonnet"]);

  assert.deepEqual(firstLensFirst.result, secondLensFirst.result);
});

test("Survivors list lens 1 findings in their returned order, then lens 2 findings", async () => {
  const config = TWO_LENSES;
  const findingsByModel = {
    sonnet: [
      { rule: "R1", severity: "high", claim: "claim one", where: "a.mjs:1" },
      { rule: "R2", severity: "low", claim: "claim two", where: "a.mjs:2" },
    ],
    opus: [
      { rule: "R3", severity: "high", claim: "claim three", where: "b.mjs:3" },
      { rule: "R4", severity: "low", claim: "claim four", where: "b.mjs:4" },
    ],
  };
  const comparable = ({ rule, claim, where, severity }) => ({ rule, claim, where, severity });

  const { result } = await runLensAttack(config, async (_prompt, opts) => (lensReturn(findingsByModel[opts.model])));

  assert.deepEqual(result.survivors.map(comparable), [...findingsByModel.sonnet, ...findingsByModel.opus]);
});

test("Each finding gets an id from its lens name and its position, ignoring any id the model supplied; the same input yields the same ids", async () => {
  // Id format chosen here: `<lensName>-<n>`, n counting from 1 within each lens.
  const config = TWO_LENSES;
  const findingsByModel = {
    sonnet: [
      { id: "model-made-up", rule: "R1", severity: "high", claim: "claim one", where: "a.mjs:1" },
      { rule: "R2", severity: "low", claim: "claim two", where: "a.mjs:2" },
    ],
    opus: [{ rule: "R3", severity: "high", claim: "claim three", where: "b.mjs:3" }],
  };
  const respond = async (_prompt, opts) => (lensReturn(findingsByModel[opts.model]));

  const first = await runLensAttack(config, respond);
  const second = await runLensAttack(config, respond);

  assert.deepEqual(first.result.survivors.map(({ id }) => id), ["necessity-1", "necessity-2", "patterns-1"]);
  assert.deepEqual(second.result.survivors.map(({ id }) => id), first.result.survivors.map(({ id }) => id));
});

test("A finding whose rule is empty or whitespace is kept but marked non-blocking (demoted, severity not high), while a finding with a rule stays blocking", async () => {
  const config = ONE_LENS;
  const findings = [
    { rule: "", severity: "high", claim: "empty rule", where: "a.mjs:1" },
    { rule: "   ", severity: "high", claim: "blank rule", where: "a.mjs:2" },
    { rule: "R1", severity: "high", claim: "ruled", where: "a.mjs:3" },
  ];
  const respond = async () => (lensReturn(findings));

  const { result } = await runLensAttack(config, respond);

  const [empty, blank, ruled] = result.survivors;
  assert.equal(result.survivors.length, 3, "all findings are kept");
  assert.equal(empty.blocking, false, "empty rule is non-blocking");
  assert.equal(blank.blocking, false, "whitespace rule is non-blocking");
  assert.notEqual(empty.severity, "high", "demoted empty-rule severity");
  assert.notEqual(blank.severity, "high", "demoted whitespace-rule severity");
  assert.equal(ruled.blocking, true, "a finding with a rule stays blocking");
});

// lens-uncovered
test("One of two lenses returns null: its name is in uncovered and the other lens's findings are still in survivors", async () => {
  const config = TWO_LENSES;
  const patternsFindings = [{ rule: "R2", severity: "low", claim: "claim two", where: "b.mjs:2" }];
  const respond = async (_prompt, opts) => (opts.model === "sonnet" ? null : lensReturn(patternsFindings));

  const { result } = await runLensAttack(config, respond);

  assert.deepEqual(result.uncovered, ["necessity"], "the null lens is uncovered");
  assert.deepEqual(result.survivors.map(({ rule, claim, where }) => ({ rule, claim, where })), [{ rule: "R2", claim: "claim two", where: "b.mjs:2" }], "the other lens's findings survive");
});

test("When every lens returns, uncovered is []", async () => {
  const config = TWO_LENSES;
  const respond = async () => (lensReturn([]));

  const { result } = await runLensAttack(config, respond);

  assert.deepEqual(result.uncovered, [], "no lens is uncovered when every lens returns");
});

// lens-result-shape
test("agentsUsed equals the number of agent() calls spawned, including a lens that returned null", async () => {
  const config = TWO_LENSES;
  const respond = async (_prompt, opts) => (opts.model === "sonnet" ? null : lensReturn([]));

  const { calls, result } = await runLensAttack(config, respond);

  assert.equal(calls.length, 2, "both lenses were spawned");
  assert.equal(result.agentsUsed, calls.length, "agentsUsed matches the recorded agent() calls, null lens included");
});

test("The result carries every return field, with neutral values for the ones later tasks fill", async () => {
  // D8 names a single return shape, so consumers (gates, report) read one shape and later tasks fill values without changing it.
  const config = TWO_LENSES;
  const respond = async () => (lensReturn([]));

  const { result } = await runLensAttack(config, respond);

  assert.deepEqual(Object.keys(result).sort(), ["agentsUsed", "attempts", "lessons", "refuted", "stopReason", "survivors", "uncovered", "unrefuted"], "the result carries exactly the D8 return fields");
  assert.deepEqual(result.refuted, [], "refuted is neutral");
  assert.deepEqual(result.unrefuted, [], "unrefuted is neutral");
  assert.equal(result.attempts, 0, "attempts is neutral");
  assert.deepEqual(result.lessons, [], "lessons is neutral");
  assert.equal(result.stopReason, null, "stopReason is neutral");
});
