import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger } from "../../shared-node/ledger.mjs";
import { planLoopSection, pseudocode, routerSection, sentencesOf, sentencesSaying, skill } from "./skill-router.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CONFIG = `${JSON.stringify({ runners: { node: { command: "node --version", test_directory: ".", run_args: [] } }, default_runner: "node" })}\n`;

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
  assert.match(decision.permissionDecisionReason, /Start the workflow pairingbuddy:intake instead/);
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
  assert.match(r.stderr, /intake is not finished/);
});

// ---------- the skill's router ----------


test("the contract's migrated types each have a stage graph, and the skill keeps no list of its own", () => {
  const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));

  assert.deepEqual(contract.migratedTypes, ["config_change", "bug_fix", "new_feature", "refactoring", "spike"]);
  assert.ok(contract.migratedTypes.every((type) => Object.hasOwn(contract.taskTypes, type)));
  assert.doesNotMatch(pseudocode(), /MIGRATED_TYPES/, "intake decides the type, so the skill has no list of types");
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

test("the router runs after the plan loop has left and before any classification and the old branches", () => {
  const code = pseudocode();
  const planEnd = code.indexOf('_stop("Plan execution paused/complete.")');
  const classified = code.lastIndexOf("task_classification = classify_task(task)");
  const router = code.indexOf("if not _is_solo():\n    _run_new_path(task)");
  const oldBranches = code.indexOf('if task_type == "new_feature":');

  assert.ok(planEnd !== -1 && planEnd < router, "plan tasks never reach the router");
  assert.ok(router < classified, "outside Solo the run classifies, so the router comes first");
  assert.ok(classified < oldBranches, "Solo classifies before the old branches");
});

// Live S2 runs classified new_feature and then followed the old new_feature branch, the first one past the router, with
// no run opened. Each migrated type's old branch says, as its first line, that only plan tasks and Solo reach it.
test("the old branch of every migrated type says only plan tasks and Solo reach it", () => {
  const code = pseudocode();
  const contract = JSON.parse(readFileSync(join(ROOT, "contracts", "stages.json"), "utf8"));

  for (const type of contract.migratedTypes) {
    const branch = new RegExp(`^(?:el)?if task_type == "${type}":\\n(.*)$`, "m").exec(code);
    assert.ok(branch, `${type} has an old branch`);
    assert.match(branch[1], new RegExp(`^ {4}# Plan tasks and Solo only$`), type);
  }
});

test("the router stops the task, so a non-Solo task never falls into the old branches", () => {
  const router = /^if not _is_solo\(\):\n([\s\S]*?)\n\n/m.exec(pseudocode())[1];

  assert.match(router, /_run_new_path\(task\)\n\s+_stop\("Task complete\."\)/);
});

// The just-completed task is in task.json until cleanup, and classification applies all of human-guidance.json.
const CURATE = "human_guidance = curate_guidance(human_guidance, task)";
const SKILL_CURATE = "_curating_guidance(task)";
// The first curation call in a code slice: the agent call or the skill call
const curateAt = (part) => [part.indexOf(CURATE), part.indexOf(SKILL_CURATE)].filter((i) => i !== -1).sort((a, b) => a - b)[0] ?? -1;
const CLEANUP = "_cleanup_state_files()";
const CLASSIFY = "task_classification = classify_task(task)";

test("guidance curation comes before cleanup and classification, in the plan loop and outside it", () => {
  const code = pseudocode();
  const planEnd = code.indexOf('_stop("Plan execution paused/complete.")');

  for (const [name, from, to] of [["plan loop", 0, planEnd], ["non-plan path", planEnd, code.length]]) {
    const part = code.slice(from, to);
    const order = [curateAt(part), part.indexOf(CLEANUP), part.indexOf(CLASSIFY)];
    assert.ok(!order.includes(-1), `${name} has all three steps`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${name}: curate, cleanup, classify`);
  }
});

test("curation runs once on the non-plan path, ahead of the router", () => {
  const code = pseudocode();
  const nonPlan = code.slice(code.indexOf('_stop("Plan execution paused/complete.")'));

  assert.equal(nonPlan.split(CURATE).length, 2);
  assert.equal(nonPlan.split(SKILL_CURATE).length, 2);
  assert.ok(curateAt(nonPlan) < nonPlan.indexOf("_run_new_path(task)"));
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
  assert.ok(nonPlan.indexOf("_run_new_path(task)") < guard, "after the router");
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

test("outside Solo an open run is continued through pb status --action, as the Plan Loop and the Stop hook do", () => {
  const text = skill();
  const check = text.indexOf("## An Open Run Comes First");
  const section = text.slice(check, text.indexOf("## State File Mappings"));
  const printed = section.split("\n").find((line) => line.includes("If it prints a status"));
  assert.ok(printed, "has a bullet for a printed status");
  assert.doesNotMatch(printed, /then stop/i, "an open run is not a reason to stop outside Solo");
  assert.match(printed, /follow `pb status --action`/i);
  assert.match(printed, /Plan Loop step 1/);
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

  for (const branchType of ["feat", "fix", "refactor", "chore", "spike"]) {
    test(`unit-type-guess: ${branchType} is a branch type the main session may guess`, () => {
      const section = routerSection();

      sentencesSaying(`${branchType} is a guessed branch type`, section, /branch type you guess from the task/, new RegExp(`\`${branchType}\``));
    });
  }

  test("the guessed type only names the branch, and intake decides the run's type", () => {
    sentencesSaying("that the type only names the branch", routerSection(), /only names the branch/, /intake decides the run's type/);
  });

  test("unit-slug-is-kebab-case-and-the-cli-validates", () => {
    const section = routerSection();

    sentencesSaying("a short kebab-case slug from the task", section, /--slug <slug>/, /kebab-case slug/);
    sentencesSaying("that the CLI validates the type and the slug", section, /^The CLI validates both/);
  });
});

describe("skill-opens-publish-run-after-task-end", () => {
  test("publish-open-after-task-end", () => {
    const section = routerSection();

    sentencesSaying("to run pb task end when every stage and gate is done", section, /When it says every stage and gate is done, run `pb task end`/);
    sentencesSaying("to open the publish run otherwise", section, /Otherwise run `pb run open --kind publish`/);
  });

  test("task-end-and-publish-open-refusals-stop-the-run", () => {
    const section = routerSection();

    sentencesSaying("that a refusal of either command stops and is reported", section, /If either refuses, stop and report the refusal/, /do not open the publish run by other means/);
  });

  test("a-closed-task-end-reports-its-reason-and-opens-no-publish-run", () => {
    const section = routerSection();

    sentencesSaying("that a closed pb task end result is reported with its reason and stops", section, /If its output has `closed`/, /report its `reason` and stop/);
    sentencesSaying("that a closed result does not open the publish run", section, /If its output has `closed`/, /do not run `pb run open --kind publish`/);
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

  test("auto-pass-at-publish-runs-pb-publish", () => {
    const section = routerSection();

    sentencesSaying("that an auto-pass at G:publish is the approval, so run pb publish without holding it back, as the PR opens as a draft", section, /auto-pass.*G:publish/, /run `pb publish`/, /draft/);
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

test("run open ignores the task classification file: taskType stays null and intake comes first", (t) => {
  const root = makeRepo(t);
  classifyAs(root, "new_feature");

  const r = pb(root, OPEN);

  assert.equal(r.status, 0, r.stderr);
  assert.equal(ledgerOf(root).taskType, null);
  assert.deepEqual(JSON.parse(pb(root, ["status"]).stdout).next, { stage: "intake", attempt: 1 });
});
test("router-no-classify-task-outside-plan-and-solo", () => {
  const code = pseudocode();
  const nonPlan = code.slice(code.indexOf('_stop("Plan execution paused/complete.")'));
  const run = nonPlan.indexOf("_run_new_path(task)");
  const classify = nonPlan.indexOf("classify_task(task)");
  const guard = nonPlan.slice(0, run).split("\n").reverse().find((line) => /^if .*:$/.test(line));
  const open = sentencesSaying("what pb run open does", routerSection(), /pb run open --kind code/);
  const first = sentencesSaying("intake and G:type come first", routerSection(), /intake/, /G:type/);

  assert.ok(run !== -1, "the non-plan path calls _run_new_path");
  assert.ok(classify === -1 || run < classify, "the new path is called before any classify_task call");
  assert.match(guard, /not _is_solo\(\)/, "the new path is guarded by not _is_solo()");
  assert.doesNotMatch(guard, /task_type/, "the guard has no task_type condition");
  assert.ok(open.every((sentence) => !/task-classification/.test(sentence)), "pb run open does not read task-classification.json");
  assert.ok(first.length > 0);
});
function curatingGuidanceRow() {
  const rows = skill().split("\n").filter((line) => /^\|\s*`_curating_guidance\(task\)`/.test(line));

  assert.equal(rows.length, 1, "the Orchestrator Functions table has a _curating_guidance(task) row");
  return rows[0];
}

test("router-keeps-classify-task-for-plan-and-solo", () => {
  const code = pseudocode();
  const planStart = code.indexOf("for plan_task in plan_tasks:");
  const planEnd = code.indexOf('_stop("Plan execution paused/complete.")');
  const planLoop = code.slice(planStart, planEnd);
  const solo = code.slice(planEnd);
  const soloClassify = solo.indexOf("task_classification = classify_task(task)");
  const soloBranch = solo.indexOf('if task_type == "new_feature":');

  assert.ok(planStart !== -1 && planEnd > planStart, "the plan loop is in the pseudocode");
  assert.match(planLoop, /classify_task\(task\)/, "the plan loop still calls classify_task(task)");
  assert.ok(soloClassify !== -1 && soloBranch !== -1, "Solo's old path classifies and branches");
  assert.ok(soloClassify < soloBranch, "Solo calls classify_task(task) before the old branches");
});

test("router-uses-skill-in-main-context: outside Solo, guidance is curated by the curating-guidance skill before cleanup", () => {
  const code = pseudocode();
  const nonPlan = code.slice(code.indexOf('_stop("Plan execution paused/complete.")'));
  const row = curatingGuidanceRow();

  assert.ok(nonPlan.includes("_curating_guidance(task)"), "the non-plan path calls _curating_guidance(task)");
  assert.ok(nonPlan.indexOf("_curating_guidance(task)") < nonPlan.indexOf(CLEANUP), "curation comes before cleanup");
  const elseBranch = nonPlan.slice(nonPlan.indexOf("else:", nonPlan.indexOf("if _is_solo():")), nonPlan.indexOf(CLEANUP));
  assert.ok(!elseBranch.includes("curate_guidance("), "the non-Solo branch does not call the curate_guidance agent");
  assert.match(row, /curating-guidance/, "the row names the curating-guidance skill");
});
test("router-keeps-agent-for-plan-and-solo: the plan loop and the Solo branch still call the curate_guidance agent, which stays registered", () => {
  const code = pseudocode();
  const planEnd = code.indexOf('_stop("Plan execution paused/complete.")');
  const nonPlan = code.slice(planEnd);
  const soloBranch = nonPlan.slice(nonPlan.indexOf("if _is_solo():"), nonPlan.indexOf("else:", nonPlan.indexOf("if _is_solo():")));
  const config = readFileSync(join(ROOT, "contracts", "agent-config.yaml"), "utf8");

  assert.ok(code.slice(0, planEnd).includes(CURATE), "the plan loop calls curate_guidance(human_guidance, task)");
  assert.ok(soloBranch.includes(CURATE), "the Solo branch calls curate_guidance(human_guidance, task)");
  assert.ok(existsSync(join(ROOT, "agents", "curate-guidance.md")), "agents/curate-guidance.md still exists");
  assert.match(config, /^  curate-guidance:/m, "agent-config.yaml still lists curate-guidance");
});

test("outside-solo-plan-loop-uses-pb-plan-next-and-run-open-plan: the plan loop is driven by pb plan next and pb run open --plan, stops at any refusal it cannot act on, and the pseudocode calls it outside Solo", () => {
  const section = planLoopSection();

  sentencesSaying("the loop runs pb plan next <plan> first", section, /first/, /`pb plan next <plan>`/);
  sentencesSaying("with no unit open it runs pb unit open", section, /no unit is open/, /`pb unit open`/);
  sentencesSaying("it runs pb run open --kind code --plan <plan>, which takes the next task itself and does not write task.json", section, /`pb run open --kind code --plan <plan>`/, /takes the next task/, /not write `?task\.json`?/);
  sentencesSaying("it follows pb status --action and pb gate eval through the stages and G:task-end", section, /`pb status --action`/, /`pb gate eval`/, /G:task-end/);
  sentencesSaying("then pb task end, then pb plan next again", section, /`pb task end`/, /`pb plan next`/, /again/);
  sentencesSaying("a unit done but not published opens the publish run and publishes as the router does", section, /done but not published/, /`pb run open --kind publish`/, /router/);
  sentencesSaying("any other refusal is shown to the human and the loop stops", section, /human task/, /hand-ticked/, /legacy unit/, /stop/);
  sentencesSaying("the model never ticks a box or types a pb human command", section, /never/, /tick/, /`pb human`/);

  const code = pseudocode();
  const call = code.indexOf("_run_plan_loop(plan_path)");
  const guard = code.indexOf("if not _is_solo():", code.indexOf("if _detect_plan_file(task):"));
  const loop = code.indexOf("for plan_task in plan_tasks:");

  assert.ok(call !== -1, "the pseudocode calls _run_plan_loop(plan_path)");
  assert.ok(guard !== -1 && guard < call, "the call sits after an `if not _is_solo():` in the plan branch");
  assert.ok(call < loop, "the call comes before `for plan_task in plan_tasks:`");
  assert.match(code.slice(guard, loop), /_run_plan_loop\(plan_path\)\n\s+_stop\(/, "the plan loop is stopped right after the call");
});

test("solo-keeps-old-plan-loop-and-plan-tasks-curate-with-skill", () => {
  const section = planLoopSection();
  const sentences = sentencesOf(section);
  const curate = sentences.findIndex((sentence) => /before each task/.test(sentence) && /curating-guidance/.test(sentence));
  const clean = sentences.findIndex((sentence) => /clean/.test(sentence) && /state files/.test(sentence));
  const open = sentences.findIndex((sentence) => /`pb run open --kind code --plan <plan>`/.test(sentence));
  const row = curatingGuidanceRow();

  assert.ok(curate !== -1, `no sentence in the Plan Loop says that before each task the loop runs the curating-guidance skill. Sentences:\n${sentences.join("\n")}`);
  assert.ok(clean !== -1, "no sentence in the Plan Loop says the loop cleans the state files");
  assert.ok(open !== -1, "the Plan Loop runs pb run open --kind code --plan <plan>");
  assert.ok(curate <= clean && clean < open, "the Plan Loop curates guidance, then cleans the state files, before pb run open --kind code --plan");
  assert.doesNotMatch(section, /curate_guidance/, "the Plan Loop does not call the curate_guidance agent");
  assert.match(row, /plan tasks included/, "the _curating_guidance row says it runs outside Solo, plan tasks included");

  const code = pseudocode();
  const soloPlanLoop = code.slice(code.indexOf("for plan_task in plan_tasks:"), code.indexOf('_stop("Plan execution paused/complete.")'));

  assert.ok(soloPlanLoop.includes(CURATE), "the Solo plan loop still calls curate_guidance(human_guidance, task)");
  assert.match(soloPlanLoop, /classify_task\(task\)/, "the Solo plan loop still calls classify_task(task)");
  assert.doesNotMatch(soloPlanLoop, /pb run open/, "the Solo plan loop does not call pb run open");
});

describe("router-asks-gates-with-the-question-box", () => {
  test("needs-human-asks-with-askuserquestion-unchanged", () => {
    const section = routerSection();

    sentencesSaying("that a needs-human gate is asked with AskUserQuestion, the question passed unchanged", section, /On `needs-human`/, /AskUserQuestion/, /exactly as `pb gate eval` gave it/);
    sentencesSaying("that pb status --action is run after the question", section, /^Then run `pb status --action`/);
  });

  test("the-bang-command-is-only-the-fallback", () => {
    const section = routerSection();

    sentencesSaying("that the ! command is shown only when the gate still waits after the question", section, /Only if the gate still waits/, /`humanCommand`/, /stop/);
  });

  test("publish-gate-is-asked-as-in-step-4", () => {
    const section = routerSection();

    sentencesSaying("that a needs-human G:publish is asked as in step 4", section, /On `needs-human`, ask the human as in step 4/);
  });

  test("the-human-hears-plain-names", () => {
    const section = routerSection();

    sentencesSaying("that the human hears the plain gate and stage names, not ids or pb commands", section, /When you talk to the human/, /plain names/, /"your OK on the task type"/, /not `G:type`/, /`pb status --action`/, /`code-safety-net`/);
  });

  test("the-whole-narration-is-plain", () => {
    const section = routerSection();

    sentencesSaying("that plain names hold all through the run, not only at a stop", section, /When you talk to the human/, /all through the run, not only at a stop/);
    sentencesSaying("that the narration names no stage, auto-pass or workflow id", section, /stage like `code-scenarios`/, /"auto-passed"/, /workflow id like `wf_54e3ede7`/);
    sentencesSaying("an example of plain narration", section, /"The task type is settled; writing scenarios now\."/);
  });
});
