// Scenarios: lens-spawn, lens-merge, lens-uncovered, lens-result-shape. lensAttack with recording stand-in agents.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runScript } from "./harness.mjs";
import { buildLabel } from "../../shared-node/labels.mjs";
import { wiredLensConfig } from "../../shared-node/lens-merge.mjs";
import { buildKey, lensSlug } from "../../shared-node/keys.mjs";
import { buildReport } from "../../shared-node/stage-run.mjs";

// Real workflows are built by scripts/build-workflows.mjs, so the wrapper stage goes through that bundler (same preamble, same inlined modules). The temp root only links shared-node and the real shared sources, so nothing in the repo is written.
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const WRAPPER_STAGE = [
  "export const meta = { name: 'lens-wrapper', description: 'test wrapper' };",
  "// pb-inline-module shared-node/keys.mjs",
  "// pb-inline-module shared-node/labels.mjs",
  "// pb-inline-module shared-node/lens-merge.mjs",
  "// pb-inline-module shared-node/shell-word.mjs",
  "// pb-inline-module shared-node/spent-line.mjs",
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

const configWith = (lenses) => ({ stage: "scenarios", subject: "task", attempt: 1, task: "some-task", lenses });
const TWO_LENSES = configWith([{ name: "necessity", model: "sonnet" }, { name: "patterns", model: "opus" }]);
const ONE_LENS = configWith([{ name: "necessity", model: "sonnet" }]);
const lensReturn = (findings) => ({ pb_key: "k", ambiguity: null, findings });
const runLensAttack = (config, agent) => runScript(wrapperPath, { args: config, agent });

const REFUTER = "pairingbuddy:refuter";
const isRefuter = ({ agentType }) => agentType === REFUTER;
const refuterCallsOf = (calls) => calls.filter(({ opts }) => isRefuter(opts));
// One necessity lens, refuting its top maxRefuters findings.
const refutingConfig = (maxRefuters, extra = {}) => ({ ...ONE_LENS, refute: "one", maxRefuters, ...extra });
const sentIdOf = (prompt) => /^Finding id: (.+)$/m.exec(prompt)[1];
// The lens call answers lensFindings (a list, or a function of the call's opts); each refuter answers about the finding it was sent, echoing its id.
const refuterStandIn = (lensFindings, verdict = "survives") => async (prompt, opts) => {
  if (!isRefuter(opts)) return lensReturn(typeof lensFindings === "function" ? lensFindings(opts) : lensFindings);
  const finding_id = sentIdOf(prompt);
  return { pb_key: "k", finding_id, verdict: typeof verdict === "function" ? verdict(finding_id) : verdict, ambiguity: null };
};
const ranked = (n) => ({ rule: `R${n}`, severity: "medium", kind: "risk", claim: `claim ${n}`, where: `a.mjs:${n}` });
// Two lenses, a finding each, so a refuter is needed for each: the budget tests cut that short.
const BUDGET_FINDINGS = {
  sonnet: [{ rule: "R1", severity: "high", kind: "fix-here", claim: "claim one", where: "a.mjs:1" }],
  opus: [{ rule: "R2", severity: "medium", kind: "risk", claim: "claim two", where: "b.mjs:2" }],
};
const budgetStandIn = refuterStandIn(({ model }) => BUDGET_FINDINGS[model]);

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

test("Each lens prompt carries the run's task in a <task> block", async () => {
  const config = { ...TWO_LENSES, task: "zebra-task-5521" };

  const { calls } = await runLensAttack(config, async () => ({ findings: [] }));

  assert.equal(calls.length, 2, "both lenses were called");
  calls.forEach(({ prompt }, i) => {
    const block = /<task>\n([\s\S]*?)\n<\/task>/.exec(prompt)?.[1];
    assert.equal(block, JSON.stringify(config.task), `prompt ${i} carries the serialized task in a <task> block`);
  });
});

// lens-merge
test("Each lens prompt has a <corpus> section listing the corpus paths, and says none when the corpus is empty", async () => {
  const withCorpus = { ...ONE_LENS, corpus: ["src/a.mjs", "docs/b.md"] };
  const emptyCorpus = { ...ONE_LENS, corpus: [] };

  const listed = await runLensAttack(withCorpus, async () => ({ findings: [] }));
  const empty = await runLensAttack(emptyCorpus, async () => ({ findings: [] }));

  const section = (prompt) => /<corpus>\n([\s\S]*?)\n<\/corpus>/.exec(prompt)?.[1];
  assert.ok(section(listed.calls[0].prompt).includes("src/a.mjs") && section(listed.calls[0].prompt).includes("docs/b.md"));
  assert.match(section(empty.calls[0].prompt), /none/i);
});

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
      { rule: "R2", severity: "high", claim: "claim two", where: "a.mjs:2" },
    ],
    opus: [
      { rule: "R3", severity: "high", claim: "claim three", where: "b.mjs:3" },
      { rule: "R4", severity: "high", claim: "claim four", where: "b.mjs:4" },
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
      { rule: "R2", severity: "high", claim: "claim two", where: "a.mjs:2" },
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

  const byClaim = (claim) => result.survivors.find((finding) => finding.claim === claim);
  const [empty, blank, ruled] = ["empty rule", "blank rule", "ruled"].map(byClaim);
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

test("merge-keeps-kind-on-survivor", async () => {
  const config = ONE_LENS;
  const findings = [{ rule: "R1", severity: "high", kind: "risk", claim: "a risk", where: "a.mjs:1" }];

  const { result } = await runLensAttack(config, async () => (lensReturn(findings)));

  assert.equal(result.survivors.length, 1, "the finding survives");
  assert.equal(result.survivors[0].kind, "risk", "the survivor still carries kind risk");
});

test("rank-orders-by-kind", async () => {
  const config = ONE_LENS;
  const findings = [
    { rule: "R1", severity: "medium", kind: "drift", claim: "a drift", where: "a.mjs:1" },
    { rule: "R2", severity: "medium", kind: "risk", claim: "a risk", where: "a.mjs:2" },
    { rule: "R3", severity: "medium", kind: "fix-here", claim: "a fix", where: "a.mjs:3" },
  ];

  const { result } = await runLensAttack(config, async () => (lensReturn(findings)));

  assert.deepEqual(result.survivors.map(({ kind }) => kind), ["fix-here", "risk", "drift"], "survivors are ordered fix-here, risk, drift");
});

test("rank-orders-by-severity-within-kind", async () => {
  const config = ONE_LENS;
  const findings = [
    { rule: "R1", severity: "high", kind: "drift", claim: "a high drift", where: "a.mjs:1" },
    { rule: "R2", severity: "low", kind: "risk", claim: "a low risk", where: "a.mjs:2" },
    { rule: "R3", severity: "high", kind: "risk", claim: "a high risk", where: "a.mjs:3" },
    { rule: "R4", severity: "low", kind: "fix-here", claim: "a low fix", where: "a.mjs:4" },
    { rule: "R5", severity: "medium", kind: "risk", claim: "a medium risk", where: "a.mjs:5" },
  ];

  const { result } = await runLensAttack(config, async () => (lensReturn(findings)));

  assert.deepEqual(result.survivors.map(({ kind, severity }) => `${kind}:${severity}`), ["fix-here:low", "risk:high", "risk:medium", "risk:low", "drift:high"], "kind outranks severity, and within a kind high precedes medium precedes low");
});

test("rank-is-stable-for-ties", async () => {
  const config = TWO_LENSES;
  const tied = (rule, claim) => ({ rule, severity: "medium", kind: "risk", claim, where: "a.mjs:1" });
  const returns = {
    necessity: lensReturn([tied("R1", "necessity first"), tied("R2", "necessity second")]),
    patterns: lensReturn([tied("R3", "patterns first"), tied("R4", "patterns second")]),
  };

  const { result } = await runLensAttack(config, async (prompt, opts) => returns[opts.label.includes("patterns") ? "patterns" : "necessity"]);

  assert.deepEqual(result.survivors.map(({ id, claim }) => `${id}:${claim}`), ["necessity-1:necessity first", "necessity-2:necessity second", "patterns-1:patterns first", "patterns-2:patterns second"], "tied findings keep lens order then returned order, with ids assigned before ranking");
});

test("findings-at-cap-all-kept", async () => {
  const config = { ...ONE_LENS, maxFindingsPerLens: 3 };
  const findings = [1, 2, 3].map(ranked);

  const { result, logs } = await runLensAttack(config, async () => (lensReturn(findings)));

  assert.equal(result.survivors.length, 3, "a lens returning exactly the cap keeps all its findings");
  assert.deepEqual(logs, [], "no trim is logged at the cap");
});

test("findings-past-cap-trimmed-and-logged", async () => {
  const config = { ...ONE_LENS, maxFindingsPerLens: 3 };
  const findings = [
    { rule: "R1", severity: "low", kind: "risk", claim: "the lowest ranked", where: "a.mjs:1" },
    { rule: "R2", severity: "high", kind: "risk", claim: "high one", where: "a.mjs:2" },
    { rule: "R3", severity: "medium", kind: "risk", claim: "medium one", where: "a.mjs:3" },
    { rule: "R4", severity: "high", kind: "risk", claim: "high two", where: "a.mjs:4" },
  ];

  const { result, logs } = await runLensAttack(config, async () => (lensReturn(findings)));

  assert.deepEqual(result.survivors.map(({ claim }) => claim), ["high one", "high two", "medium one"], "the cap keeps N findings and drops the lowest-ranked one");
  assert.equal(logs.length, 1, "one trim is logged");
  assert.match(logs[0], /necessity/, "the log names the lens");
  assert.match(logs[0], /\b1\b/, "the log records the dropped count");
});

test("cap-applies-per-lens-not-total", async () => {
  const config = { ...configWith([{ name: "necessity", model: "sonnet" }, { name: "patterns", model: "sonnet" }]), maxFindingsPerLens: 2 };
  const found = (prefix) => [1, 2].map((n) => ({ ...ranked(n), claim: `${prefix} ${n}` }));
  const returns = { necessity: lensReturn(found("necessity")), patterns: lensReturn(found("patterns")) };

  const { result, logs } = await runLensAttack(config, async (prompt, opts) => returns[opts.label.includes("patterns") ? "patterns" : "necessity"]);

  assert.equal(result.survivors.length, 4, "each lens at its cap keeps all its findings, so the merged total exceeds the cap");
  assert.deepEqual(logs, [], "no trim is logged when every lens is at its cap");
});

test("refuters-spawn-for-top-n-only", async () => {
  const config = refutingConfig(2);
  const findings = [
    { rule: "R1", severity: "low", kind: "risk", claim: "rank four", where: "a.mjs:1" },
    { rule: "R2", severity: "high", kind: "fix-here", claim: "rank one", where: "a.mjs:2" },
    { rule: "R3", severity: "medium", kind: "risk", claim: "rank three", where: "a.mjs:3" },
    { rule: "R4", severity: "high", kind: "risk", claim: "rank two", where: "a.mjs:4" },
  ];
  const standIn = refuterStandIn(findings, "survives");

  const { calls } = await runLensAttack(config, standIn);

  const refuterCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:refuter");
  assert.equal(refuterCalls.length, 2, "exactly maxRefuters refuter calls are made");
  assert.ok(refuterCalls[0].prompt.includes("rank one") && refuterCalls[1].prompt.includes("rank two"), "the refuters go to the two top-ranked findings");
});

test("findings-at-refuter-cap-all-refuted-attempted", async () => {
  const config = refutingConfig(2);
  const findings = [
    { rule: "R1", severity: "high", kind: "fix-here", claim: "claim one", where: "a.mjs:1" },
    { rule: "R2", severity: "medium", kind: "risk", claim: "claim two", where: "a.mjs:2" },
  ];
  const standIn = refuterStandIn(findings, "survives");

  const { calls, result } = await runLensAttack(config, standIn);

  const refuterCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:refuter");
  assert.equal(refuterCalls.length, 2, "every finding gets a refuter when findings equal maxRefuters");
  assert.deepEqual(result.unrefuted, [], "nothing is left unrefuted at the cap");
});

test("findings-past-cap-returned-unrefuted-and-logged", async () => {
  const config = refutingConfig(2);
  const findings = [
    { rule: "R1", severity: "low", kind: "risk", claim: "rank four", where: "a.mjs:1" },
    { rule: "R2", severity: "high", kind: "fix-here", claim: "rank one", where: "a.mjs:2" },
    { rule: "R3", severity: "medium", kind: "risk", claim: "rank three", where: "a.mjs:3" },
    { rule: "R4", severity: "high", kind: "risk", claim: "rank two", where: "a.mjs:4" },
  ];
  const standIn = refuterStandIn(findings, "survives");

  const { result, logs } = await runLensAttack(config, standIn);

  assert.deepEqual(result.unrefuted.map(({ claim }) => claim), ["rank three", "rank four"], "the findings below the cut are returned in unrefuted");
  assert.ok(result.unrefuted.every(({ id }) => !result.survivors.some((survivor) => survivor.id === id)), "unrefuted findings are not survivors");
  assert.ok(result.unrefuted.every(({ id }) => logs.some((message) => message.includes(id))), "log() records each unrefuted id");
});

test("unrefuted-findings-are-non-blocking", async () => {
  const config = refutingConfig(1);
  const findings = [
    { rule: "R1", severity: "high", kind: "fix-here", claim: "rank one", where: "a.mjs:1" },
    { rule: "R2", severity: "low", kind: "risk", claim: "rank two", where: "a.mjs:2" },
  ];
  const standIn = refuterStandIn(findings, "survives");

  const { result } = await runLensAttack(config, standIn);

  assert.equal(result.unrefuted.length, 1, "one finding is left unrefuted");
  assert.ok(result.unrefuted[0].rule, "the unrefuted finding carries a rule");
  assert.equal(result.unrefuted[0].blocking, false, "an unrefuted finding is non-blocking even with a rule");
});

test("refute-none-spawns-no-refuter", async () => {
  const config = refutingConfig(2, { refute: "none" });
  const findings = [
    { rule: "R1", severity: "high", kind: "fix-here", claim: "claim one", where: "a.mjs:1" },
    { rule: "R2", severity: "low", kind: "risk", claim: "claim two", where: "a.mjs:2" },
  ];
  const standIn = refuterStandIn(findings, "refuted");

  const { calls, result } = await runLensAttack(config, standIn);

  assert.equal(calls.filter(({ opts }) => opts.agentType === "pairingbuddy:refuter").length, 0, "no refuter call is made with refute none");
  assert.deepEqual(result.survivors.map(({ claim }) => claim).sort(), ["claim one", "claim two"], "all findings stay survivors");
});

test("high-severity-refuter-uses-opus", async () => {
  const config = refutingConfig(2);
  const findings = [
    { rule: "R1", severity: "high", kind: "fix-here", claim: "the high claim", where: "a.mjs:1" },
    { rule: "R2", severity: "medium", kind: "risk", claim: "the medium claim", where: "a.mjs:2" },
  ];
  const standIn = refuterStandIn(findings, "survives");

  const { calls } = await runLensAttack(config, standIn);

  const refuterCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:refuter");
  const highCall = refuterCalls.find(({ prompt }) => prompt.includes("the high claim"));
  assert.equal(highCall.opts.model, "opus", "the refuter for a high-severity finding is called with model opus");
});

test("non-high-refuter-uses-sonnet", async () => {
  const config = refutingConfig(2);
  const findings = [
    { rule: "R1", severity: "medium", kind: "risk", claim: "the medium claim", where: "a.mjs:1" },
    { rule: "R2", severity: "low", kind: "risk", claim: "the low claim", where: "a.mjs:2" },
  ];
  const standIn = refuterStandIn(findings, "survives");

  const { calls } = await runLensAttack(config, standIn);

  const refuterCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:refuter");
  const mediumCall = refuterCalls.find(({ prompt }) => prompt.includes("the medium claim"));
  const lowCall = refuterCalls.find(({ prompt }) => prompt.includes("the low claim"));
  assert.equal(mediumCall.opts.model, "sonnet", "the refuter for a medium-severity finding is called with model sonnet");
  assert.equal(lowCall.opts.model, "sonnet", "the refuter for a low-severity finding is called with model sonnet");
});

test("refuter-call-has-agent-type-and-finding-id", async () => {
  const config = refutingConfig(2);
  const findings = [{ rule: "R1", severity: "high", kind: "fix-here", claim: "the unique-claim-5521", where: "a.mjs:1" }];
  const standIn = refuterStandIn(findings, "survives");

  const { calls } = await runLensAttack(config, standIn);

  const refuterCalls = calls.filter(({ opts }) => opts.agentType === "pairingbuddy:refuter");
  assert.equal(refuterCalls.length, 1, "one refuter call is made for the one finding");
  const [{ prompt, opts }] = refuterCalls;
  assert.equal(opts.label, buildLabel({ stage: "scenarios", phase: null, role: "refuter", item: "necessity-1", round: 1 }), "the label has role refuter and the finding id as item");
  assert.ok(prompt.includes("necessity-1"), "the prompt carries the finding id");
  assert.ok(prompt.includes("the unique-claim-5521"), "the prompt carries the finding claim");
});

test("refuted-verdict-moves-finding-to-refuted", async () => {
  const config = refutingConfig(2);
  const findings = [{ rule: "R1", severity: "high", kind: "fix-here", claim: "the doomed claim", where: "a.mjs:1" }];
  const standIn = refuterStandIn(findings, "refuted");

  const { result } = await runLensAttack(config, standIn);

  assert.deepEqual(result.survivors.map(({ id }) => id), [], "the refuted finding leaves survivors");
  assert.deepEqual(result.refuted.map(({ id }) => id), ["necessity-1"], "the refuted finding appears in refuted");
});

test("survives-verdict-keeps-finding-survivor", async () => {
  const config = refutingConfig(2);
  const findings = [{ rule: "R1", severity: "high", kind: "fix-here", claim: "the sturdy claim", where: "a.mjs:1" }];
  const standIn = refuterStandIn(findings, "survives");

  const { result } = await runLensAttack(config, standIn);

  assert.deepEqual(result.survivors.map(({ id }) => id), ["necessity-1"], "the finding whose refuter returned survives stays a survivor");
  assert.deepEqual(result.refuted.map(({ id }) => id), [], "the surviving finding is not in refuted");
});

test("null-refuter-return-leaves-finding-unrefuted", async () => {
  const config = refutingConfig(2);
  const findings = [{ rule: "R1", severity: "high", kind: "fix-here", claim: "the unanswered claim", where: "a.mjs:1" }];
  const standIn = async (prompt, opts) => (isRefuter(opts) ? null : lensReturn(findings));

  const { result } = await runLensAttack(config, standIn);

  assert.deepEqual(result.unrefuted.map(({ id }) => id), ["necessity-1"], "the finding whose refuter returned null is in unrefuted");
  assert.deepEqual(result.refuted.map(({ id }) => id), [], "no verdict was filed, so the finding is not in refuted");
});

test("spawns-up-to-agent-budget-allowed", async () => {
  const config = { ...TWO_LENSES, refute: "one", maxRefuters: 2, agentBudget: 4 };

  const { calls, result } = await runLensAttack(config, budgetStandIn);

  assert.equal(calls.length, 4, "two lens calls and two refuter calls are all made");
  assert.equal(result.agentsUsed, 4, "agentsUsed equals the budget");
  assert.equal(result.stopReason, null, "no stop when the budget is exactly enough");
});

test("spawn-past-agent-budget-not-made", async () => {
  const config = { ...TWO_LENSES, refute: "one", maxRefuters: 2, agentBudget: 3 };

  const { calls, result, logs } = await runLensAttack(config, budgetStandIn);

  assert.equal(calls.length, 3, "only the budget's calls are recorded, one below the four needed");
  assert.equal(result.agentsUsed, calls.length, "agentsUsed equals the number of calls made");
  assert.ok(result.unrefuted.every(({ id }) => logs.some((message) => message.includes(id))), "the budget-skipped finding is logged");
});

test("budget-stop-records-stop-reason", async () => {
  const config = { ...TWO_LENSES, refute: "one", maxRefuters: 2, agentBudget: 3 };

  const { result, logs } = await runLensAttack(config, budgetStandIn);

  assert.equal(result.stopReason, "agent-budget", "the budget prevented a refuter spawn");
  assert.deepEqual(result.unrefuted.map(({ id }) => id), ["patterns-1"], "the finding whose refuter was not spawned is unrefuted");
  assert.match(logs.join("\n"), /patterns-1.*agent budget/, "the log names the budget as the reason");
});

// trust: a verdict counts only for the finding its refuter was sent
test("verdict-for-another-finding-is-ignored", async () => {
  const config = refutingConfig(2);
  const findings = [ranked(1), ranked(2)];
  const lyingStandIn = async (prompt, opts) => (isRefuter(opts)
    ? { pb_key: "k", finding_id: "necessity-2", verdict: "refuted", ambiguity: null }
    : lensReturn(findings));

  const { result } = await runLensAttack(config, lyingStandIn);

  assert.deepEqual(result.refuted.map(({ id }) => id), ["necessity-2"], "only the refuter sent necessity-2 may refute it");
  assert.deepEqual(result.unrefuted.map(({ id }) => id), ["necessity-1"], "necessity-1's refuter named another finding, so it is unrefuted");
  assert.deepEqual(result.survivors.map(({ id }) => id), [], "nothing else survives");
});

test("verdict-for-a-finding-never-sent-is-ignored", async () => {
  const config = refutingConfig(1);
  const stray = async (prompt, opts) => (isRefuter(opts)
    ? { pb_key: "k", finding_id: "necessity-9", verdict: "refuted", ambiguity: null }
    : lensReturn([ranked(1)]));

  const { result } = await runLensAttack(config, stray);

  assert.deepEqual(result.unrefuted.map(({ id }) => id), ["necessity-1"]);
  assert.deepEqual(result.refuted, []);
});

// parity: the stage report reads the same returns and verdicts the workflow produced. The config is the real scenarios row's.
const REAL_LENS_MAP = JSON.parse(readFileSync(join(REPO, "contracts", "lenses.json"), "utf8"));
async function workflowAndReport(lensFor, refuterFor, agentBudget) {
  const wired = wiredLensConfig(REAL_LENS_MAP, "code-scenarios");
  const config = { stage: "code-scenarios", subject: "task", attempt: 1, task: "some-task", ...wired, agentBudget };
  const filed = [];
  const agent = async (prompt, opts) => {
    const returned = isRefuter(opts) ? refuterFor(sentIdOf(prompt)) : lensFor();
    filed.push({ key: /Return pb_key exactly as: (\S+)/.exec(prompt)[1], returned });
    return returned;
  };
  const { result } = await runLensAttack(config, agent);
  const artifactsDir = mkdtempSync(join(tmpdir(), "pb-parity-"));
  try {
    for (const { key, returned } of filed) if (returned !== null) writeFileSync(join(artifactsDir, `${key}.json`), JSON.stringify({ ...returned, pb_key: key }));
    const stage = { name: "code-scenarios", status: "active", runId: "wf_1", attempt: 1, startedAt: null };
    return { result, report: buildReport({ stage, tests: {}, checkpoints: [] }, artifactsDir) };
  } finally {
    rmSync(artifactsDir, { recursive: true, force: true });
  }
}
const idsOf = (list) => list.map(({ id }) => id);

test("report-and-workflow-agree-on-survivors-refuted-unrefuted-and-uncovered", async () => {
  const verdictFor = { "necessity-1": "refuted", "necessity-2": "survives", "necessity-3": null };
  const refuterFor = (id) => (id === "necessity-4" ? { pb_key: "k", finding_id: "necessity-5", verdict: "refuted", ambiguity: null }
    : verdictFor[id] === null ? null : { pb_key: "k", finding_id: id, verdict: verdictFor[id] ?? "survives", ambiguity: null });
  const eight = lensReturn([1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ ...ranked(n), severity: n <= 4 ? "high" : "low" })));

  // maxRefuters is 6 and one lens call counts against the budget of 4, so three findings are sent and the rest are not.
  const { result, report } = await workflowAndReport(() => eight, refuterFor, 4);

  assert.equal(result.stopReason, "agent-budget", "the budget cut a refuter");
  assert.ok(result.refuted.length > 0 && result.unrefuted.length > 0 && result.survivors.length > 0, "the case covers refuted, unrefuted and surviving findings");
  assert.deepEqual(idsOf(report.survivors), idsOf(result.survivors), "survivors match");
  assert.deepEqual(idsOf(report.refuted), idsOf(result.refuted), "refuted match");
  assert.deepEqual(idsOf(report.unrefuted), idsOf(result.unrefuted), "unrefuted match");
  assert.deepEqual(report.uncovered, result.uncovered, "uncovered match");
});

test("report-and-workflow-agree-when-the-lens-returned-nothing", async () => {
  const { result, report } = await workflowAndReport(() => null, () => null, 10);

  assert.deepEqual(result.uncovered, ["necessity"]);
  assert.deepEqual(report.uncovered, result.uncovered, "uncovered match");
  assert.deepEqual(idsOf(report.survivors), idsOf(result.survivors), "survivors match");
});

// Scenario: misalignment-empty-corpus. Merge marks needsCorpus lenses uncovered when config.corpus is [], never by lens name.
test("misalignment_lens_uncovered_when_corpus_empty", async () => {
  const config = { ...configWith([{ name: "corpus-misalignment", model: "sonnet", needsCorpus: true }]), corpus: [] };

  const { result } = await runLensAttack(config, async () => lensReturn([]));

  assert.deepEqual(result.uncovered, ["corpus-misalignment"], "a needsCorpus lens with an empty corpus is uncovered even though it returned no findings");
});

test("misalignment_lens_clean_when_corpus_nonempty", async () => {
  const lenses = [{ name: "corpus-misalignment", model: "sonnet", needsCorpus: true }, { name: "necessity", model: "sonnet" }];
  const nonEmpty = { ...configWith(lenses), corpus: ["docs/a.md"] };
  const empty = { ...configWith(lenses), corpus: [] };

  const { result: withCorpus } = await runLensAttack(nonEmpty, async () => lensReturn([]));
  const { result: withoutCorpus } = await runLensAttack(empty, async () => lensReturn([]));

  assert.deepEqual(withCorpus.uncovered, [], "a needsCorpus lens returning no findings is covered when the corpus is non-empty");
  assert.deepEqual(withoutCorpus.uncovered, ["corpus-misalignment"], "only the needsCorpus lens is uncovered when the corpus is empty");
});

test("misalignment_report_agrees_with_workflow", async () => {
  const lens = { name: "corpus-misalignment", model: "sonnet", needsCorpus: true };
  const lensMap = { rows: [{ stage: "scenarios", lenses: [lens], refute: "none" }] };
  const config = { ...wiredLensConfig(lensMap, "code-scenarios"), stage: "code-scenarios", subject: "task", attempt: 1, task: "some-task", corpus: [] };
  const key = buildKey({ stage: "code-scenarios", role: "lens", item: lensSlug(lens.name), round: 1, attempt: 1 });
  const root = mkdtempSync(join(tmpdir(), "pb-corpus-"));
  const artifactsDir = join(root, "run", "task", "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  // the corpus the stage used, as pb snapshot writes it: run/corpus.json, an empty manifest
  writeFileSync(join(root, "run", "corpus.json"), JSON.stringify({ paths: [] }));
  try {
    const { result } = await runLensAttack(config, async () => lensReturn([]));
    writeFileSync(join(artifactsDir, `${key}.json`), JSON.stringify({ ...lensReturn([]), pb_key: key }));
    const stage = { name: "code-scenarios", status: "active", runId: "wf_1", attempt: 1, startedAt: null };

    const report = buildReport({ stage, tests: {}, checkpoints: [] }, artifactsDir, lensMap);

    assert.deepEqual(result.uncovered, [lens.name], "the workflow marks the needsCorpus lens uncovered");
    assert.deepEqual(report.uncovered, result.uncovered, "the report, reading run/corpus.json, lists the same uncovered lens");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// buildReport reads the corpus pb snapshot wrote, and a file it cannot trust is a refusal, never an empty corpus.
test("report_refuses_a_corpus_manifest_that_is_not_a_list_of_paths", () => {
  const stage = { name: "code-scenarios", status: "active", runId: "wf_1", attempt: 1, startedAt: null };
  for (const text of ["{not json", JSON.stringify({ paths: "docs/a.md" }), JSON.stringify({ paths: [1] }), JSON.stringify(null)]) {
    const root = mkdtempSync(join(tmpdir(), "pb-corpus-bad-"));
    const artifactsDir = join(root, "run", "task", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(join(root, "run", "corpus.json"), text);
    try {
      assert.throws(() => buildReport({ stage, tests: {}, checkpoints: [] }, artifactsDir), /corpus\.json/, `a manifest of ${text} is refused, naming the file`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// Scenario: lens-map-wires-pr-draft
test("A lens with a brief gets a <brief> block after its </lens> line holding the brief as one escaped JSON line, and a lens without one gets no <brief> tag", async () => {
  const brief = "Check <b>claims</b> against the diff.";
  const config = configWith([{ name: "claims", model: "sonnet", brief }, { name: "patterns", model: "opus" }]);

  const { calls } = await runLensAttack(config, async () => lensReturn([]));

  const escapedBrief = JSON.stringify(brief).replace(/</g, "\\u003c");
  const [briefed, plain] = calls.map(({ prompt }) => prompt);
  assert.ok(briefed.includes(`<brief>\n${escapedBrief}\n</brief>`), "the briefed lens's prompt holds the escaped brief in a <brief> block");
  assert.ok(briefed.indexOf("<brief>") > briefed.indexOf("</lens>"), "the <brief> block comes after the </lens> line");
  assert.ok(!plain.includes("<brief"), "the lens without a brief has no <brief> tag");
});
