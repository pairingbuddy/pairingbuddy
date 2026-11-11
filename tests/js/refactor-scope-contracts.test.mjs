import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseLedger } from "./ledger-fixture.mjs";
import { writeLedger } from "../../shared-node/ledger.mjs";
import { askReason, fileHash, gatesFor } from "../../shared-node/gates.mjs";
import { loadStages } from "../../shared-node/stages.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
process.env.CLAUDE_PLUGIN_ROOT = ROOT;
delete process.env.PAIRINGBUDDY_SOLO;
delete process.env.PAIRINGBUDDY_GATE_POLICY;
const { pbCommand } = await import("../../shared-node/verbs.mjs");

// Covers the refactor-scope contracts: the refactoring stage graph, the tests-red allow-list entry, the G:scope gate, and the
// scope-refactoring agent contract. Contract files are read inside the test bodies through readRepoFile.
const readRepoFile = (path) => readFileSync(join(ROOT, path), "utf8");

// Scenario: refactoring-stage-contract (unit tests on contracts/stages.json; see stages-safeguards, stage-graph-safeguards, stage-names)
test("refactoring-graph-has-scope-node", () => {
  // The refactoring graph's only node is code-refactor-scope with gate G:scope, evidence tests:full and artifact:scope-refactoring, and G:scope is a continue-class gate.
  const contract = JSON.parse(readRepoFile("contracts/stages.json"));

  const graph = contract.taskTypes.refactoring;

  assert.ok(graph, "contracts/stages.json has a refactoring task type");
  assert.deepEqual(graph.nodes, [{ name: "code-refactor-scope", gate: "G:scope", evidence: ["tests:full", "artifact:scope-refactoring"] }], "the refactoring graph's only node is code-refactor-scope");
  assert.equal(graph.gates?.["G:scope"]?.class, "continue", "G:scope is a continue-class gate");
});

test("refactoring-not-migrated", () => {
  // refactoring is absent from migratedTypes, so pb run open still refuses it (the existing refusal test must keep passing; this asserts the list).
  const contract = JSON.parse(readRepoFile("contracts/stages.json"));

  assert.ok(Array.isArray(contract.migratedTypes), "contracts/stages.json lists migratedTypes");
  assert.ok(!contract.migratedTypes.includes("refactoring"), "refactoring is not in migratedTypes, so pb run open still refuses it");
});

// Scenario: tests-red-stop-reason (unit tests: plain-names, gate runner allow-list)
test("tests-red-allowed-in-runner-allow-list", async () => {
  // The gate's runner allow-list accepts 'stage stop tests-red' (built from STAGE_STOP_REASONS).
  const { checkCall } = await import("../../shared-node/gate-rules.mjs");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tests-red-allow-list-")));
  mkdirSync(join(root, ".pairingbuddy", "run", "task"), { recursive: true });
  writeLedger(join(root, ".pairingbuddy", "run", "task", "ledger.json"), {
    ...baseLedger(),
    policy: { mode: "", source: "" },
    taskType: "bug_fix",
    stage: { name: "code-scenarios", status: "running", runId: "wf_1", attempt: 1 },
    stages: [{ name: "code-scenarios", status: "running" }],
  });
  const payload = {
    session_id: "s1",
    cwd: root,
    tool_name: "Bash",
    permission_mode: "default",
    agent_id: "a1",
    agent_type: "pairingbuddy:runner",
    tool_input: { command: pbCommand("stage stop tests-red") },
  };

  const decision = checkCall({ runRoots: [root], sessionRoot: null, payload, targets: [], canonicalPath: (path) => path });

  assert.equal(decision, "Runner CLI command, auto-allowed by the Pairing Buddy gate.", "the runner's 'stage stop tests-red' is auto-allowed");
});

// Scenario: g-scope-gate (gate evaluation over a built ledger and report, style of tests/js/gate-eval.test.mjs)
const blockingFinding = { id: "f1", class: "fix", blocking: true, rule: "scope-serves-intent", message: "the scope does not serve the stated intent" };

function gateReasonFor({ taskType = "refactoring", stage = "code-refactor-scope", gate = "G:scope", survivors, reportAttempt = 1, ledgerAttempt = 1 }) {
  const contract = loadStages(ROOT);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "g-scope-")));
  const taskDir = join(root, ".pairingbuddy", "run", "task");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(root, ".pairingbuddy", "test-config.json"), "{}\n");
  writeFileSync(join(taskDir, "report.json"), JSON.stringify({ stage, attempt: reportAttempt, survivors, gaps: [], uncovered: [], unrefuted: [] }));
  const ledger = {
    ...baseLedger(),
    taskType,
    configHash: fileHash(join(root, ".pairingbuddy", "test-config.json")),
    policy: { mode: "auto", source: "constant" },
    stage: { name: stage, status: "done", runId: "wf_1", attempt: ledgerAttempt },
    stages: [{ name: stage, status: "done", attempt: ledgerAttempt }],
  };
  const gateEntry = gatesFor(contract, taskType).find(({ name }) => name === gate);

  return askReason(contract, ledger, gateEntry, root);
}

test("g-scope-asks-on-blocking-survivor", () => {
  // When the stage report has a finding with blocking true, G:scope asks the human with a reason that the scope lens found the scope may not serve the stated intent.
  const reason = gateReasonFor({ survivors: [blockingFinding] });

  assert.equal(reason, "the scope lens found the scope may not serve the stated intent", "G:scope asks because the scope lens found a blocking survivor");
});

test("g-scope-rule-is-g-scope-only", () => {
  // The blocking-survivor ask belongs to G:scope alone: on a bug_fix ledger at code-scenarios the same report leaves G:scenarios passing under auto.
  const reason = gateReasonFor({ taskType: "bug_fix", stage: "code-scenarios", gate: "G:scenarios", survivors: [blockingFinding] });

  assert.equal(reason, null, "the rule is G:scope only: G:scenarios still passes under auto");
});

test("g-scope-passes-when-clean", () => {
  // With no blocking survivor and no ambiguity or uncovered lens, G:scope passes under the auto policy like any continue gate.
  const demoted = { ...blockingFinding, blocking: false };

  const withDemotedSurvivor = gateReasonFor({ survivors: [demoted] });
  const withNoSurvivors = gateReasonFor({ survivors: [] });

  assert.equal(withDemotedSurvivor, null, "a non-blocking survivor leaves G:scope passing under auto");
  assert.equal(withNoSurvivors, null, "no survivors leaves G:scope passing under auto");
});

test("g-scope-ignores-a-voided-report", () => {
  // A report stamped with an attempt the ledger has since overtaken is stale: a blocking survivor in it does not make G:scope ask.
  const reason = gateReasonFor({ survivors: [blockingFinding], reportAttempt: 1, ledgerAttempt: 2 });

  assert.equal(reason, null, "a voided report's blocking survivor is ignored");
});

test("g-scope-passes-a-report-with-no-survivors-list", () => {
  // A report with no survivors key at all leaves G:scope passing under auto, without throwing.
  const reason = gateReasonFor({ survivors: undefined });

  assert.equal(reason, null, "a report with no survivors list leaves G:scope passing");
});

test("g-scope-asks-when-a-survivor-has-no-blocking-flag", () => {
  // Safest default: only a finding explicitly marked non-blocking (blocking: false) lets G:scope pass; a survivor with a rule but no blocking key asks.
  const unflagged = { id: "f2", class: "fix", rule: "scope-serves-intent", message: "the scope does not serve the stated intent" };

  const reason = gateReasonFor({ survivors: [unflagged] });

  assert.equal(reason, "the scope lens found the scope may not serve the stated intent", "a survivor with no blocking flag asks, because only blocking: false lets G:scope pass");
});

// Scenario: scope-refactoring-old-callers (style of tests/js/tdd-agent-contracts.test.mjs)
const AGENT_FIELDS = ["pb_key", "ambiguity", "code_issues", "test_issues"];

// The text of a markdown section: from its heading to the next heading of the same or a higher level.
function sectionOf(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `${heading} is there`);
  const level = heading.indexOf(" ");
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next === -1 ? rest : rest.slice(0, next);
}

// The scope-refactoring entry of agent-config.yaml: from its key to the next two-space-indented key.
function scopeRefactoringConfig() {
  const config = readRepoFile("contracts/agent-config.yaml");
  const start = config.indexOf("\n  scope-refactoring:\n");
  assert.notEqual(start, -1, "scope-refactoring is in agent-config.yaml");
  const rest = config.slice(start + 1);
  const next = rest.search(/\n  [\w-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("one-input-rule-wording-in-scope-refactoring", () => {
  // agents/scope-refactoring.md carries the one input rule wording (paths block: read only named paths plus task, return StructuredOutput, legacy rule kept).
  const input = sectionOf(readRepoFile("agents/scope-refactoring.md"), "## Input");

  assert.match(input, /With a `<paths>` block in the prompt: read only what the paths name/, "Input states the paths-block rule");
  assert.match(input, /`test_config`/, "the Input section names the path test_config");
  assert.match(input, /`human_guidance`/, "the Input section names the path human_guidance");
  assert.match(input, /return your Output as StructuredOutput/, "Input says to return StructuredOutput");
  assert.match(input, /`pb_key`/, "Input names pb_key");
  assert.match(input, /With no `<paths>` block: use the legacy flat files below and write the legacy Output/, "Input keeps the legacy rule");
});

test("paths-block-skips-human-review-and-writes-no-files-in-scope-refactoring", () => {
  // With a paths block the agent skips Step 3, says no human is reachable, and writes no files.
  const text = readRepoFile("agents/scope-refactoring.md");

  assert.match(text, /With a `<paths>` block: skip Step 3/, "Step 3 is skipped with a paths block");
  assert.match(text, /no human is reachable from a stage/i, "the agent says no human is reachable");
  assert.match(sectionOf(text, "### File Creation Restrictions"), /With a `<paths>` block[^\n]*write no files/i, "File Creation Restrictions say a paths block writes no files");
});

test("scope-refactoring-inline-output-json-matches-schema", () => {
  // The paths-block Output JSON lists exactly the fields the result schema requires.
  const schema = JSON.parse(readRepoFile("contracts/schemas/scope-refactoring-result.schema.json"));
  const output = sectionOf(readRepoFile("agents/scope-refactoring.md"), "## Output");
  const pathsJson = /With a `<paths>` block[^\n]*\n\n```json\n([\s\S]*?)\n```/.exec(output)?.[1];

  assert.deepEqual([...schema.required].sort(), [...AGENT_FIELDS].sort(), "the schema requires exactly the four fields");
  assert.ok(pathsJson, "the Output section has a paths-block JSON block");
  assert.deepEqual(Object.keys(JSON.parse(pathsJson)).sort(), [...AGENT_FIELDS].sort(), "the inline Output JSON lists exactly the schema fields");
});

test("scope-refactoring-result-is-return-only-in-agent-config", () => {
  // agent-config.yaml registers the result schema and lists it as a return_only output of scope-refactoring.
  const config = readRepoFile("contracts/agent-config.yaml");

  assert.match(scopeRefactoringConfig(), /schema: scope-refactoring-result\.schema\.json\n\s+return_only: true/, "the contract lists the result schema as a return_only output");
  assert.ok(config.includes("  - scope-refactoring-result.schema.json\n"), "the schema is registered in agent-config.yaml");
});

test("no-paths-block-keeps-flat-files", () => {
  // With no paths block the agent text still reads and writes the legacy flat files .pairingbuddy/code-issues.json and test-issues.json and keeps Human Review.
  const text = readRepoFile("agents/scope-refactoring.md");
  const legacyOutput = sectionOf(text, "## Output").split("With no `<paths>` block:")[1];
  const humanReview = sectionOf(text, "### Step 3: Human Review").replace(/With a `<paths>` block: skip Step 3[^\n]*/, "");

  assert.ok(legacyOutput, "the Output section has a no-paths branch");
  assert.match(legacyOutput, /writes to `\.pairingbuddy\/code-issues\.json`/, "the no-paths Output writes .pairingbuddy/code-issues.json");
  assert.match(legacyOutput, /writes to `\.pairingbuddy\/test-issues\.json`/, "the no-paths Output writes .pairingbuddy/test-issues.json");
  assert.match(humanReview, /using AskUserQuestion/, "the Human Review step still uses AskUserQuestion outside the paths-block skip");
  assert.ok(sectionOf(text, "## Input").includes(".pairingbuddy/task.json"), "the Input section still reads .pairingbuddy/task.json");
});
