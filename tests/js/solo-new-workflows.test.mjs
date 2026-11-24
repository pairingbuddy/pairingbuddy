import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOLO_SCRIPT = join(REPO_ROOT, "scripts", "solo-buddy.sh");

const SKILL_PATH = join(REPO_ROOT, "skills", "coding", "SKILL.md");

function readSkill() {
  return readFileSync(SKILL_PATH, "utf8");
}

// The "### Solo Mode" section of the coding skill, up to the next heading.
function soloModeSection() {
  const skill = readSkill();
  const start = skill.indexOf("### Solo Mode");
  assert.notEqual(start, -1, "skills/coding/SKILL.md must have a '### Solo Mode' section");
  const rest = skill.slice(start);
  const next = rest.search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, next);
}

function filesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

function writeExecutable(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

// Runs solo-buddy.sh on a feature branch with a fake claude that records
// the environment it was started with. Returns what claude saw.
function runSoloOnFeatureBranch(branch = "feature/solo-test") {
  const dir = mkdtempSync(join(tmpdir(), "solo-new-"));
  try {
    const binDir = join(dir, "bin");
    const repoDir = join(dir, "repo");
    const envFile = join(dir, "claude-env.txt");
    const argsFile = join(dir, "claude-args.txt");
    const planFile = join(dir, "plan.md");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
    writeExecutable(
      join(binDir, "claude"),
      `#!/usr/bin/env bash\nenv > "${envFile}"\nprintf '%s\\n' "$@" > "${argsFile}"\nexit 0\n`,
    );
    writeExecutable(join(binDir, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    writeFileSync(planFile, "# Plan\n");
    const init = spawnSync("git", ["init", "-b", branch], { cwd: repoDir, encoding: "utf8" });
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
    // Only what the script needs: nothing from the host's solo flags or API keys leaks in.
    const env = {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
    };
    const result = spawnSync(SOLO_SCRIPT, [planFile], { cwd: repoDir, env, encoding: "utf8" });
    const claudeStarted = existsSync(envFile);
    const readIfStarted = (file) => (claudeStarted ? readFileSync(file, "utf8") : "");
    const claudeEnv = readIfStarted(envFile);
    const claudeArgs = readIfStarted(argsFile);
    return { result, claudeEnv, claudeArgs, planFile, claudeStarted };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Runs solo-buddy.sh on a feature branch and asserts it succeeded.
function runSoloSucceeding() {
  const run = runSoloOnFeatureBranch();
  assert.equal(run.result.status, 0, `solo-buddy.sh should run on a feature branch: ${run.result.stderr}`);
  return run;
}

// Runs solo-buddy.sh on a protected branch and asserts it refused before claude started.
function runSoloRefusing(branch) {
  const run = runSoloOnFeatureBranch(branch);
  assert.notEqual(run.result.status, 0, `solo-buddy.sh must exit non-zero on ${branch}`);
  assert.equal(run.claudeStarted, false, `claude must never start on ${branch}`);
  return run.result;
}

test("exports-gate-policy-auto", () => {
  const { claudeEnv } = runSoloSucceeding();

  assert.match(
    claudeEnv,
    /^PAIRINGBUDDY_GATE_POLICY=auto$/m,
    "claude must start with PAIRINGBUDDY_GATE_POLICY=auto in its environment",
  );
});

test("gate-policy-set-before-claude-starts", () => {
  assert.fail("not implemented: the PAIRINGBUDDY_GATE_POLICY export must appear in scripts/solo-buddy.sh before the claude invocation");
});

test("still-exports-solo-flag", () => {
  const { claudeEnv } = runSoloSucceeding();

  assert.match(claudeEnv, /^PAIRINGBUDDY_SOLO=true$/m, "claude must still see PAIRINGBUDDY_SOLO=true");
  assert.match(
    claudeEnv,
    /^PAIRINGBUDDY_SOLO_MAX_RETRIES=5$/m,
    "claude must still see PAIRINGBUDDY_SOLO_MAX_RETRIES with the default of 5",
  );
  assert.match(
    claudeEnv,
    /^PAIRINGBUDDY_PLAN_PATH=.*plan\.md$/m,
    "claude must still see PAIRINGBUDDY_PLAN_PATH naming the plan file",
  );
});

test("prompt-invokes-code-on-plan", () => {
  const { claudeArgs, planFile } = runSoloSucceeding();

  assert.match(claudeArgs, /\/pairingbuddy:code/, "the prompt passed to claude must name /pairingbuddy:code");
  assert.ok(
    claudeArgs.includes(planFile),
    `the prompt passed to claude must name the plan file ${planFile}, got: ${claudeArgs}`,
  );
});

test("skill-solo-uses-new-plan-loop", () => {
  const skill = readSkill();

  assert.doesNotMatch(
    skill,
    /Solo plan tasks stay on the old path/,
    "the skill must no longer keep Solo plan tasks on the old path",
  );
  assert.doesNotMatch(
    skill,
    /never the migrated-types router/,
    "the skill must no longer bar Solo from the migrated-types router (T7b check lifted)",
  );
  assert.doesNotMatch(skill, /old plan loop stays until T10/, "the skill must drop the old Solo plan loop");
  assert.match(
    soloModeSection(),
    /Solo follows the Plan Loop/,
    "the Solo Mode section must say Solo follows the Plan Loop",
  );

  const start = skill.indexOf("if _detect_plan_file(task):");
  const end = skill.indexOf("# Normal (non-plan) execution", start);
  assert.notEqual(start, -1, "the skill must have a plan branch '_detect_plan_file(task)'");
  assert.notEqual(end, -1, "the plan branch must end at the non-plan execution marker");
  const planBranch = skill.slice(start, end);

  assert.match(planBranch, /_run_plan_loop\(plan_path\)/, "the plan branch must run the plan loop");
  assert.doesNotMatch(planBranch, /_is_solo\(\)/, "the plan branch must not treat Solo differently from other runs");
  assert.doesNotMatch(planBranch, /\bfor plan_task in\b/, "the plan branch must not keep its own old Solo task loop");
});

test("agents-do-not-read-policy-env", () => {
  const files = [...filesUnder(join(REPO_ROOT, "agents")), ...filesUnder(join(REPO_ROOT, "skills"))];
  const readers = files.filter((file) => readFileSync(file, "utf8").includes("PAIRINGBUDDY_GATE_POLICY"));

  assert.ok(files.length > 0, "agents/ and skills/ must contain files to check");
  assert.deepEqual(readers, [], "only hooks may read PAIRINGBUDDY_GATE_POLICY, not agents or skills");
});

test("refuses-main", () => {
  const result = runSoloRefusing("main");

  assert.match(result.stdout + result.stderr, /main/, "the error must name the branch main");
});

test("refuses-master", () => {
  runSoloRefusing("master");
});

test("skill-solo-stops-on-human-task", () => {
  const section = soloModeSection();

  assert.match(section, /\[HUMAN\]/, "the Solo Mode section must name [HUMAN] tasks");
  assert.match(section, /\[HUMAN\][^\n]*\bstops?\b/i, "Solo must stop on a [HUMAN] task");
  assert.match(section, /Solo does not skip it to reach the next task/, "Solo must not skip a [HUMAN] task to the next one");
});

test("skill-solo-human-stop-message", () => {
  const section = soloModeSection();

  assert.match(section, /pb plan next/, "the stop is driven by the pb plan next refusal");
  assert.match(section, /message/i, "Solo must report a message when it stops on a [HUMAN] task");
  assert.match(
    section,
    /person must do and tick|human must do and tick|a person (does|must do) .*tick/i,
    "the message must say a person must do the task and tick it",
  );
});

test("skill-solo-human-stop-not-auto-yes", () => {
  const section = soloModeSection();

  assert.match(
    section,
    /auto-yes[^\n]*\[HUMAN\]|\[HUMAN\][^\n]*auto-yes/i,
    "the Solo Mode section must say how auto-yes relates to a [HUMAN] task",
  );
  assert.match(
    section,
    /Solo never does it and never ticks its box/,
    "Solo must never do a [HUMAN] task or tick its box",
  );
});
