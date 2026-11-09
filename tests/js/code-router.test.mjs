import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CONFIG = `${JSON.stringify({ runners: { node: { command: "node --version", test_directory: ".", run_args: [] } }, default_runner: "node" })}\n`;
const OLD_PATH_TYPES = ["refactoring", "spike"];

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
}

function tempDir(t, prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeRepo(t) {
  const dir = tempDir(t, "pb-router-");
  git(dir, "init", "-q", "-b", "feature/x");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  mkdirSync(join(dir, ".pairingbuddy"));
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), CONFIG);
  return dir;
}

const classify = (root, text) => writeFileSync(join(root, ".pairingbuddy", "task-classification.json"), text);
const classifyAs = (root, type) => classify(root, JSON.stringify({ task_type: type, rationale: "test" }));

const withoutSolo = () => {
  const { PAIRINGBUDDY_SOLO: _, ...env } = process.env;
  return env;
};

function pb(cwd, args, { env = withoutSolo(), plugin = ROOT } = {}) {
  return spawnSync("node", [join(plugin, "cli", "pb.mjs"), ...args], { cwd, env, encoding: "utf8" });
}

const OPEN = ["run", "open", "--kind", "code"];
const runDir = (root) => join(root, ".pairingbuddy", "run");
const ledgerOf = (root) => readLedger(join(runDir(root), "task", "ledger.json"));

function assertRefusedWithNoRunState(root, r, pattern) {
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, pattern);
  assert.doesNotMatch(r.stderr, /unexpected failure/, "a deliberate refusal");
  assert.equal(existsSync(runDir(root)), false, "a refused open leaves no run state at all");
}

function gate(root, tool, toolInput) {
  const payload = { session_id: "router", cwd: root, tool_name: tool, permission_mode: "auto", tool_input: toolInput };
  const r = spawnSync("node", [join(ROOT, "hooks", "gate-boot.mjs")], { input: JSON.stringify(payload), cwd: root, env: { ...withoutSolo(), CLAUDE_PLUGIN_ROOT: ROOT }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === "" ? null : JSON.parse(r.stdout).hookSpecificOutput;
}

const AGENT_CALL = { subagent_type: "pairingbuddy:classify-task", prompt: "Set x" };
const NEW_PATH_AGENT_CALL = { subagent_type: "pairingbuddy:apply-config-change", prompt: "Set x" };

// ---------- pb run open ----------

test("config_change: the run records the type and the status names its first stage", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "config_change");

  const r = pb(root, OPEN);

  assert.equal(r.status, 0, r.stderr);
  assert.equal(ledgerOf(root).taskType, "config_change");
  assert.deepEqual(JSON.parse(pb(root, ["status"]).stdout).next, { stage: "code-config", attempt: 1 });
});

test("no classification file: the taskType stays null, for a run opened before classification", (t) => {
  const root = makeRepo(t);

  assert.equal(pb(root, OPEN).status, 0);

  assert.equal(ledgerOf(root).taskType, null);
});

for (const type of [...OLD_PATH_TYPES, "constructor"]) {
  test(`${type} is not migrated, so no run opens and the gate stays out of the old path`, (t) => {
    const root = makeRepo(t);
    classifyAs(root, type);

    assertRefusedWithNoRunState(root, pb(root, OPEN), new RegExp(`${type}.*old path`));

    assert.equal(gate(root, "Agent", { subagent_type: "pairingbuddy:implement-code", prompt: "go" }), null, "old-path agents still spawn");
  });
}

for (const [name, text, pattern] of [
  ["unparseable", "{not json", /task-classification\.json.*not valid JSON/],
  ["without a task_type", "{}", /task-classification\.json.*task_type/],
  ["with a task_type that is no string", '{"task_type": 3}', /task-classification\.json.*task_type/],
  ["that is not an object", "null", /task-classification\.json.*task_type/],
]) {
  test(`a classification file ${name} refuses instead of taking the default graph`, (t) => {
    const root = makeRepo(t);
    classify(root, text);

    assertRefusedWithNoRunState(root, pb(root, OPEN), pattern);
  });
}

test("a stage graph is chosen from the classification, not from a fixed type", (t) => {
  const plugin = join(tempDir(t, "pb-router-plugin-"), "plugin");
  for (const dir of ["cli", "shared-node", "contracts"]) cpSync(join(ROOT, dir), join(plugin, dir), { recursive: true });
  const stagesPath = join(plugin, "contracts", "stages.json");
  const contract = JSON.parse(readFileSync(stagesPath, "utf8"));
  contract.taskTypes.bug_fix = { nodes: [{ name: "code-bug", gate: null, evidence: [] }], gates: {} };
  contract.migratedTypes.push("bug_fix");
  writeFileSync(stagesPath, JSON.stringify(contract));
  const root = makeRepo(t);
  classifyAs(root, "bug_fix");

  assert.equal(pb(root, OPEN, { plugin }).status, 0);

  assert.equal(ledgerOf(root).taskType, "bug_fix");
  assert.deepEqual(JSON.parse(pb(root, ["status"], { plugin }).stdout).next, { stage: "code-bug", attempt: 1 });
});

test("a plan run does not read the coding classification", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "bug_fix");

  const r = pb(root, ["run", "open", "--kind", "plan"]);

  assert.equal(r.status, 0, r.stderr);
  assert.equal(ledgerOf(root).taskType, null);
});

test("Solo stays on the old path: no run opens under it, even for a config change", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "config_change");

  const r = pb(root, OPEN, { env: { ...process.env, PAIRINGBUDDY_SOLO: "true" } });

  assertRefusedWithNoRunState(root, r, /Solo.*old path/);
});

test("PAIRINGBUDDY_SOLO=false is not Solo", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "config_change");

  assert.equal(pb(root, OPEN, { env: { ...process.env, PAIRINGBUDDY_SOLO: "false" } }).status, 0);
});

// ---------- a model that skips the workflow ----------

test("before a run a direct agent call passes, and once the run exists the gate denies it", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "config_change");
  assert.equal(gate(root, "Agent", AGENT_CALL), null);

  assert.equal(pb(root, OPEN).status, 0);

  const decision = gate(root, "Agent", AGENT_CALL);
  assert.equal(decision.permissionDecision, "deny");
  assert.match(decision.permissionDecisionReason, /Start the workflow pairingbuddy:code-config instead/);
});

test("an agent only a stage spawns is denied before a run as well", (t) => {
  const root = makeRepo(t);

  assert.equal(gate(root, "Agent", NEW_PATH_AGENT_CALL).permissionDecision, "deny");
});

test("a run with no finished stage cannot end, whatever the model reports", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "config_change");
  assert.equal(pb(root, OPEN).status, 0);

  const r = pb(root, ["task", "end"]);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /code-config is not finished/);
});

// ---------- the skill's router ----------

const skill = () => readFileSync(join(ROOT, "skills", "coding", "SKILL.md"), "utf8");
const pseudocode = () => /## Workflow[\s\S]*?```python\n([\s\S]*?)```/.exec(skill())[1];

test("the skill's migrated types are the contract's, and each has a stage graph", () => {
  const listed = JSON.parse(/^MIGRATED_TYPES = (\[.*\])$/m.exec(pseudocode())[1]);
  const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));

  assert.deepEqual(listed, ["config_change", "bug_fix", "new_feature"]);
  assert.deepEqual(listed, contract.migratedTypes);
  assert.ok(listed.every((type) => Object.hasOwn(contract.taskTypes, type)));
});

const runner = (over = {}) => ({ command: "node --version", test_directory: ".", run_args: [], ...over });
const SELECTABLE = { selector_template: ["{test_file}::{test_function}"] };

function configure(root, runners) {
  writeFileSync(join(root, ".pairingbuddy", "test-config.json"), JSON.stringify({ runners, default_runner: Object.keys(runners)[0] }));
}

for (const type of ["bug_fix", "new_feature"]) {
  test(`${type} opens a run on its own graph once its runner can select one test`, (t) => {
    const root = makeRepo(t);
    configure(root, { node: runner(SELECTABLE) });
    classifyAs(root, type);

    assert.equal(pb(root, OPEN).status, 0);

    assert.equal(ledgerOf(root).taskType, type);
    assert.deepEqual(JSON.parse(pb(root, ["status"]).stdout).next, { stage: "code-scenarios", attempt: 1 });
  });
}

test("new_feature with a runner that has no selector_template is refused at open, as bug_fix is", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "new_feature");

  assertRefusedWithNoRunState(root, pb(root, OPEN), /runner node has no selector_template/);
});

test("bug_fix with a runner that has no selector_template is refused at open, and the refusal names the fix", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "bug_fix");

  const r = pb(root, OPEN);

  assertRefusedWithNoRunState(root, r, /runner node has no selector_template/);
  assert.match(r.stderr, /\.pairingbuddy\/test-config\.json/, "it names the file");
  assert.match(r.stderr, /\{test_file\}::\{test_function\}/, "it shows what to add");
  assert.match(r.stderr, /human/, "the human owns that file");
});

test("every runner is held to it, since the placeholders may pick any of them", (t) => {
  const root = makeRepo(t);
  configure(root, { node: runner(SELECTABLE), e2e: runner(), api: runner() });
  classifyAs(root, "bug_fix");

  assertRefusedWithNoRunState(root, pb(root, OPEN), /runners e2e, api have no selector_template/);
});

test("a type with no RED or GREEN needs no selector_template", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "config_change");

  assert.equal(pb(root, OPEN).status, 0);
});

test("a run opened before classification needs no selector_template", (t) => {
  const root = makeRepo(t);

  assert.equal(pb(root, OPEN).status, 0);
});

test("the bootstrap of test-config has the skill ask for a selector_template", () => {
  const bootstrap = /### Bootstrap test-config\.json\n([\s\S]*?)\n### /.exec(skill())[1];

  assert.match(bootstrap, /selector_template/);
});

test("a config that exists is used with no question, so no run ends waiting at the bootstrap", () => {
  const bootstrap = /### Bootstrap test-config\.json\n([\s\S]*?)\n### /.exec(skill())[1];

  assert.match(bootstrap, /If it exists, use it and ask nothing/);
  assert.doesNotMatch(bootstrap, /Use existing test config\?/);
});

test("the agents a graph uses but the old path still calls stay callable with no run", (t) => {
  const root = makeRepo(t);

  assert.equal(gate(root, "Agent", { subagent_type: "pairingbuddy:enumerate-scenarios-and-test-cases", prompt: "go" }), null);
});

test("the router runs after the plan loop has left, after classification, and before the old branches", () => {
  const code = pseudocode();
  const planEnd = code.indexOf('_stop("Plan execution paused/complete.")');
  const classified = code.lastIndexOf("task_classification = classify_task(task)");
  const router = code.indexOf("if task_type in MIGRATED_TYPES and not _is_solo():");
  const oldBranches = code.indexOf('if task_type == "new_feature":');

  assert.ok(planEnd !== -1 && planEnd < classified, "plan tasks never reach the router");
  assert.ok(classified < router, "the router reads the classification");
  assert.ok(router < oldBranches, "a migrated type never falls into the old branches");
});

// Live S2 runs classified new_feature and then followed the old new_feature branch, the first one past the router, with
// no run opened. Each migrated type's old branch says, as its first line, that only plan tasks and Solo reach it.
test("the old branch of every migrated type says only plan tasks and Solo reach it", () => {
  const code = pseudocode();
  const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));

  for (const type of contract.migratedTypes) {
    const branch = new RegExp(`^(?:el)?if task_type == "${type}":\\n(.*)$`, "m").exec(code);
    assert.ok(branch, `${type} has an old branch`);
    assert.match(branch[1], new RegExp(`^ {4}# Plan tasks and Solo only: the router takes every other ${type}$`), type);
  }
});

test("the router names the migrated types it takes away from the old branches", () => {
  const router = /if task_type in MIGRATED_TYPES and not _is_solo\(\):\n([\s\S]*?)\n\n/.exec(pseudocode())[1];

  assert.match(router, /never the old branches below/);
});

// The just-completed task is in task.json until cleanup, and classification applies all of human-guidance.json.
const CURATE = "human_guidance = curate_guidance(human_guidance, task)";
const CLEANUP = "_cleanup_state_files()";
const CLASSIFY = "task_classification = classify_task(task)";

test("guidance curation comes before cleanup and classification, in the plan loop and outside it", () => {
  const code = pseudocode();
  const planEnd = code.indexOf('_stop("Plan execution paused/complete.")');

  for (const [name, from, to] of [["plan loop", 0, planEnd], ["non-plan path", planEnd, code.length]]) {
    const order = [CURATE, CLEANUP, CLASSIFY].map((step) => code.slice(from, to).indexOf(step));
    assert.ok(!order.includes(-1), `${name} has all three steps`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${name}: curate, cleanup, classify`);
  }
});

test("curation runs once on the non-plan path, ahead of the router", () => {
  const code = pseudocode();
  const nonPlan = code.slice(code.indexOf('_stop("Plan execution paused/complete.")'));

  assert.equal(nonPlan.split(CURATE).length, 2);
  assert.ok(nonPlan.indexOf(CURATE) < nonPlan.indexOf("if task_type in MIGRATED_TYPES and not _is_solo():"));
});

test("the new task reaches task.json only after cleanup, in both orders", () => {
  const code = pseudocode();
  const planEnd = code.indexOf('_stop("Plan execution paused/complete.")');

  for (const [name, part] of [["plan loop", code.slice(0, planEnd)], ["non-plan path", code.slice(planEnd)]]) {
    const written = part.indexOf("_write_task(task)");
    assert.ok(part.indexOf(CLEANUP) < written && written < part.indexOf(CLASSIFY), `${name}: cleanup, write, classify`);
  }
});

test("State File Management tells the same order", () => {
  const steps = /### State File Management\n([\s\S]*?)\n### /.exec(skill())[1];

  assert.ok(steps.indexOf("curate_guidance") < steps.indexOf("Delete all"));
  assert.doesNotMatch(steps, /after classification/);
});

test("curate-guidance asks nothing with no human, and takes the check before any of its steps", () => {
  const agent = readFileSync(join(ROOT, "agents", "curate-guidance.md"), "utf8");
  const check = agent.indexOf("### When No Human Is Here");

  assert.ok(check !== -1 && check < agent.indexOf("### Step 1: Read Inputs"));
  const section = agent.slice(check, agent.indexOf("### Step 1: Read Inputs"));
  for (const word of ["PAIRINGBUDDY_GATE_POLICY", "CLAUDE_CODE_ENTRYPOINT", "sdk-cli", "PAIRINGBUDDY_SOLO", '{"guidance": []}']) assert.ok(section.includes(word), `names ${word}`);
  assert.match(section, /ask nothing/i);
  assert.match(section, /offer nothing/i);
});

// ---------- the old path inside an open unit ----------

test("old-path-stops-on-open-unit: the old path is guarded after the router and in the plan loop", () => {
  const code = pseudocode();
  const planEnd = code.indexOf('_stop("Plan execution paused/complete.")');
  const planPart = code.slice(0, planEnd);
  const nonPlan = code.slice(planEnd);

  const guard = nonPlan.indexOf("_stop_if_unit_open()");
  assert.ok(guard !== -1, "the non-plan path calls it");
  assert.ok(nonPlan.indexOf("if task_type in MIGRATED_TYPES and not _is_solo():") < guard, "after the router");
  assert.ok(guard < nonPlan.indexOf("# Old path"), "before the old path");
  const planGuard = planPart.indexOf("_stop_if_unit_open()");
  assert.ok(planGuard !== -1, "the plan loop calls it");
  assert.ok(planGuard < planPart.indexOf("same old-path branches"), "before each plan task's old-path work");
});

test("stop-rule-names-unit-file-and-abandon: the functions table row says what it checks and how to leave", () => {
  const row = /^\| `_stop_if_unit_open\(\)` \|.*$/m.exec(skill());

  assert.ok(row, "the functions table has a row for it");
  assert.ok(row[0].includes(".pairingbuddy/run/unit.json"), "names the unit file");
  assert.ok(row[0].includes("`pb human abandon`"), "names the way out");
});

// ---------- entry with a run already open ----------

test("the skill checks for an open run ahead of everything that touches state", () => {
  const text = skill();
  const check = text.indexOf("## An Open Run Comes First");
  const code = pseudocode();

  assert.ok(check !== -1 && check < text.indexOf("## State File Mappings"), "it sits at the top of the skill");
  assert.ok(code.indexOf("_stop_if_run_open()") !== -1);
  assert.ok(code.indexOf("_stop_if_run_open()") < code.indexOf("_detect_plan_file(task)"), "it comes first in the workflow");
  const section = text.slice(check, text.indexOf("## State File Mappings"));
  for (const word of ["pb status", "no run here", "`action`"]) assert.ok(section.includes(word), `names ${word}`);
  assert.match(section, /do not clean state or classify/i);
});

test("Solo: a stage cannot start on a leftover run, and the Stop hook does not drive one", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "config_change");
  assert.equal(pb(root, OPEN).status, 0);
  const env = { ...withoutSolo(), CLAUDE_PLUGIN_ROOT: ROOT, PAIRINGBUDDY_SOLO: "true" };
  const payload = { session_id: "solo", cwd: root, tool_name: "Workflow", permission_mode: "bypassPermissions", tool_input: { name: "pairingbuddy:code-config", args: { attempt: 1, pluginRoot: ROOT, task: { description: "x" } } } };

  const started = spawnSync("node", [join(ROOT, "hooks", "gate-boot.mjs")], { input: JSON.stringify(payload), cwd: root, env, encoding: "utf8" });
  const stopped = spawnSync("node", [join(ROOT, "hooks", "stop.mjs")], { input: JSON.stringify({ session_id: "solo", cwd: root }), cwd: root, env, encoding: "utf8" });

  assert.equal(JSON.parse(started.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(ledgerOf(root).stage.status, "");
  assert.equal(stopped.stdout, "");
});

test("a run opens only inside the router, and the plan loop says it stays old", () => {
  const code = pseudocode();

  assert.equal(code.match(/_run_new_path\(/g).length, 1, "one call site");
  assert.match(code.slice(0, code.indexOf('_stop("Plan execution paused/complete.")')), /never the migrated-types router/);
  assert.match(code, /elif task_type == "config_change":/, "the old branch stays for plan tasks and Solo");
});

test("the new path takes stage results from pb, never from the workflow's status", () => {
  const section = /### Migrated-Types Router\n([\s\S]*?)\n## /.exec(skill())[1];

  for (const step of ["run open --kind code", "pb status", "pb gate eval", "pb task end", "pb stage finish"]) assert.ok(section.includes(step), `names ${step}`);
  assert.match(section, /never .*workflow's .*status/i);
  assert.doesNotMatch(section, /^.*\bpb human\b.*(run|type) it yourself/im);
});

test("the router follows the action, because a gate can fall between two stages", () => {
  const section = /### Migrated-Types Router\n([\s\S]*?)\n## /.exec(skill())[1];

  assert.match(section, /`pb status --action`/);
  assert.match(section, /A gate can fall between two stages/);
  assert.doesNotMatch(section, /While `next` is not null/, "next names a stage even while a gate stands before it");
});

// ---------- the thin command ----------

const command = () => readFileSync(join(ROOT, "commands", "code.md"), "utf8");

test("the command passes the plugin root and the human's text, and allows no tools", () => {
  const text = command();

  assert.ok(text.includes("${CLAUDE_PLUGIN_ROOT}"), "P11");
  assert.ok(text.includes("$ARGUMENTS"), "the human's text");
  assert.doesNotMatch(text, /allowed-tools/, "P18B");
  assert.match(text, /coding skill/);
});

test("the human's text arrives as data, and the command does not name the Workflow tool", () => {
  const text = command();

  assert.match(text, /<task>\n\$ARGUMENTS\n<\/task>/);
  assert.doesNotMatch(text, /Workflow/, "this text reaches workflow agents, and a prompt naming the tool did no work (P13A)");
});

// ---------- a session's cwd is never inside its own --plugin-dir ----------

const isWithin = (path, dir) => path === dir || path.startsWith(`${dir}${sep}`);

test("the drill starts its session outside the plugin it loads, and the run state sits in the cwd", (t) => {
  const temp = tempDir(t, "pb-router-drill-");
  const r = spawnSync("node", [join(ROOT, "tests", "drills", "force_wedge.mjs"), "--stranded-stage"], { cwd: temp, env: { ...withoutSolo(), TMPDIR: temp }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  const [, cwd, plugin] = /^cd (\S+) && claude --plugin-dir (\S+)$/m.exec(r.stdout);
  const [, root, exported] = /^export ROOT=(\S+) PLUGIN=(\S+)$/m.exec(r.stdout);

  assert.ok(!isWithin(cwd, plugin) && !isWithin(plugin, cwd), `${cwd} and ${plugin} overlap`);
  assert.deepEqual([root, exported], [cwd, plugin], "the recipe's variables match the start line");
  assert.ok(existsSync(join(plugin, "hooks", "gate.mjs")));
  assert.equal(readLedger(join(cwd, ".pairingbuddy", "run", "task", "ledger.json")).stage.status, "active");
  assert.equal(existsSync(join(plugin, ".pairingbuddy", "run")), false, "the plugin holds no run state");
});

test("smoke refuses a repo inside the plugin it loads, before any claude starts", (t) => {
  const bin = tempDir(t, "pb-router-bin-");
  const marker = join(bin, "claude-ran");
  writeFileSync(join(bin, "claude"), `#!/bin/sh\ntouch ${marker}\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const script = `
from pathlib import Path
from tests.smoke.runner import REPO_ROOT, Budget, SmokeError, run_claude
try:
    run_claude(REPO_ROOT / "tests", "/x", Budget(), Path(${JSON.stringify(join(bin, "stream"))}))
except SmokeError as e:
    print(e)
`;

  const r = spawnSync("uv", ["run", "--extra", "dev", "python", "-c", script], { cwd: ROOT, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--plugin-dir/);
  assert.equal(existsSync(marker), false, "no claude ran");
});

// ---------- the router around a unit and its publish run ----------

const routerSection = () => /### Migrated-Types Router\n([\s\S]*?)\n## /.exec(skill())[1];

// The router's steps are numbered list items, each a run of sentences. A sentence ends at . ! or ? followed by a space
// and a capital letter or a backtick, so "step 2 and do not run `pb unit open` again." stays whole, and the list markers
// are not sentences of their own.
const listMarker = /^\s*(\d+\.|-)\s+/;
const sentencesOf = (text) => text.split("\n").map((line) => line.replace(listMarker, "")).flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z`])/)).filter((sentence) => sentence.trim() !== "");

// Every sentence of the text matching all of the patterns (regular expressions only, so each needle is visibly a pattern).
const sentencesMatching = (text, ...patterns) => sentencesOf(text).filter((sentence) => patterns.every((pattern) => pattern.test(sentence)));

// The sentences that say it, at least one: a claim nobody makes fails here, with what the router does say.
function sentencesSaying(claim, text, ...patterns) {
  const found = sentencesMatching(text, ...patterns);
  assert.ok(found.length > 0, `no sentence says ${claim} (${patterns.join(" and ")}). The router's sentences:\n${sentencesOf(text).join("\n")}`);
  return found;
}

describe("skill-opens-unit-before-code-run", () => {
  test("unit-open-precedes-run-open", () => {
    const section = routerSection();

    const [unitFirst] = sentencesSaying("a non-plan task is a unit of one task, opened first", section, /unit of one task/, /unit opens first/);
    const [unitOpen] = sentencesSaying("to run pb unit open with a type and a slug", section, /^Otherwise run `pb unit open --type <type> --slug <slug>`/);
    const [codeOpen] = sentencesSaying("to run pb run open --kind code", section, /^Run `pb run open --kind code`/);
    assert.ok(section.indexOf(unitFirst) < section.indexOf(codeOpen), "the unit step comes before the code run step");
    assert.ok(section.indexOf(unitOpen) < section.indexOf(codeOpen), "pb unit open comes before pb run open --kind code");
  });

  test("router-does-not-say-the-human-confirmed-the-branch", () => {
    const section = routerSection();

    assert.doesNotMatch(section, /the human confirmed its branch/, "the router no longer says the human confirmed the just-opened unit's branch");
    assert.doesNotMatch(section, /\b(?:run|pass|add|use|append|with)\b[^.\n]*--yes/i, "the router never tells the model to pass --yes");
    sentencesSaying("that pb unit open opens the template branch with no confirmation", section, /There is no confirmation/, /a plain call opens the template branch/);
    sentencesSaying("that only the human types a command for the human", section, /^Only the human types it\.?$/);
  });

  test("unit-open-refusal-for-the-human-is-shown-and-stops", () => {
    const section = routerSection();

    sentencesSaying("that a command for the human is shown and the run stops", section, /refuses with a command for the human to type/, /stop and show the human that command/);
  });

  test("resume-uses-just-opened-unit", () => {
    const section = routerSection();

    const resume = sentencesSaying("an open unit with no task records and its branch checked out is the one just opened", section, /If an open unit has no task records/, /its branch is checked out/, /it is the one just opened/);

    assert.match(resume[0], /go on to step 2 and do not run `pb unit open` again/);
  });

  const typeMapping = { new_feature: "feat", bug_fix: "fix", refactoring: "refactor", config_change: "chore" };
  for (const [type, abbreviation] of Object.entries(typeMapping)) {
    test(`unit-type-mapping: ${type} is ${abbreviation}`, () => {
      const section = routerSection();

      sentencesSaying(`${type} maps to ${abbreviation}`, section, /mapped from `task_type`/, new RegExp(`\`${type}\` to \`${abbreviation}\``));
    });
  }

  test("unit-slug-is-kebab-case-and-the-cli-validates", () => {
    const section = routerSection();

    sentencesSaying("a short kebab-case slug from the task", section, /--slug <slug>/, /kebab-case slug/);
    sentencesSaying("that the CLI validates the type and the slug", section, /^The CLI validates both/);
  });
});

describe("skill-opens-publish-run-after-task-end", () => {
  test("publish-open-after-task-end", () => {
    const section = routerSection();

    sentencesSaying("to run pb task end and then open the publish run", section, /When it says every stage and gate is done, run `pb task end`, then `pb run open --kind publish`/);
  });

  test("task-end-and-publish-open-refusals-stop-the-run", () => {
    const section = routerSection();

    sentencesSaying("that a refusal of either command stops and is reported", section, /If either refuses, stop and report the refusal/, /do not open the publish run by other means/);
  });

  test("publish-run-follows-action", () => {
    const section = routerSection();

    const [follow] = sentencesSaying("to follow the action through pr-draft and G:publish as for the code stages", section, /^Follow `pb status --action` through pr-draft and `G:publish` as for the code stages/);

    assert.match(follow, /run `pb gate eval` when it says a gate is due/);
  });
});

describe("skill-runs-pb-publish-after-approval", () => {
  test("pb-publish-after-approval", () => {
    const section = routerSection();

    sentencesSaying("that an approved G:publish makes the action name pb publish", section, /^When G:publish is approved, `pb status --action` names `pb publish`/);
  });

  test("gate-eval-skip-runs-pb-publish", () => {
    const section = routerSection();

    sentencesSaying("that a gate eval skip runs pb publish", section, /^When `pb gate eval` returns `skip`/, /run `pb publish` too/);
  });

  test("reports-url-warnings-pending-comment", () => {
    const section = routerSection();

    sentencesSaying("to report url, warnings and pendingComment from pb publish", section, /report `url`, `warnings` and `pendingComment` from its output/);
  });

  test("no-direct-push", () => {
    const section = routerSection();

    sentencesSaying("that pb publish is the only route to a push or a PR, and a push is never run by hand", section, /`pb publish` is the only route to a push or a PR/, /never run `git push` or `gh pr create` yourself/);
  });

  test("only-the-human-runs-pb-human", () => {
    const section = routerSection();

    sentencesSaying("that only the human runs a pb human command", section, /only the human runs a `pb human` command/);
  });
});

describe("skill-keep-local-skip-local-stop", () => {
  test("keep-local-reports-and-stops", () => {
    const section = routerSection();

    const rule = sentencesSaying("to report and stop on keep local", section, /If the human answers keep local/, /report that and stop/);

    for (const sentence of rule) assert.doesNotMatch(sentence, /pb publish/, "no pb publish follows it");
  });

  test("skip-and-local-report-reason", () => {
    const section = routerSection();

    sentencesSaying("to report the reason and stop when pb publish returns skip, local or kept-local", section, /If `pb publish` returns `skip`, `local` or `kept-local`/, /report the `reason` and stop/);
  });

  test("gate-eval-skip-means-nothing-to-publish", () => {
    const section = routerSection();

    const gateSkip = sentencesSaying("what a gate eval skip means", section, /`pb gate eval` returns `skip`/);
    for (const sentence of gateSkip) assert.match(sentence, /nothing to publish/, "the gate eval skip is named by what it means");
    sentencesSaying("what a pb publish skip means", section, /`pb publish` returns `skip`/, /nothing was pushed/);
  });

  test("a left-behind kept-local unit is finished by pb publish", () => {
    const section = routerSection();

    sentencesSaying("that a left-behind kept-local unit is finished by pb publish", section, /kept-local unit is left behind/, /`pb publish`/, /report its `reason`/);
  });

  // A deliberate regression guard: these rules were in the router before the unit and publish run were added.
  test("regression-guard-existing-router-rules-kept", () => {
    const section = routerSection();

    sentencesSaying("that pb stage finish is the only proof", section, /`pb stage finish`[^.]*is the only proof/);
    sentencesSaying("never to read a workflow's reported status as a result", section, /^Never read a workflow's reported status as a result/);
    sentencesSaying("never to do a stage's work", section, /^Never do a stage's work yourself/);
  });
});
