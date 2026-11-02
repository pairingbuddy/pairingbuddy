import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger } from "../../shared-node/ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CONFIG = `${JSON.stringify({ runners: { node: { command: "node --version", test_directory: ".", run_args: [] } }, default_runner: "node" })}\n`;
const OLD_PATH_TYPES = ["new_feature", "bug_fix", "refactoring", "spike"];

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

const AGENT_CALL = { subagent_type: "pairingbuddy:apply-config-change", prompt: "Set x" };

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
  test(`${type} has no stage graph, so no run opens and the gate stays out of the old path`, (t) => {
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

test("the migrated-types list is exactly the types with a stage graph", () => {
  const listed = JSON.parse(/^MIGRATED_TYPES = (\[.*\])$/m.exec(pseudocode())[1]);
  const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));

  assert.deepEqual(listed, ["config_change"]);
  assert.deepEqual(listed.sort(), Object.keys(contract.taskTypes).sort());
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
