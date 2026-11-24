import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOLO_SCRIPT = join(REPO_ROOT, "scripts", "solo-buddy.sh");

function notImplemented(name) {
  assert.fail(`not implemented: ${name}`);
}

function writeExecutable(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

// Runs solo-buddy.sh on a feature branch with a fake claude that records
// the environment it was started with. Returns what claude saw.
function runSoloOnFeatureBranch() {
  const dir = mkdtempSync(join(tmpdir(), "solo-new-"));
  try {
    const binDir = join(dir, "bin");
    const repoDir = join(dir, "repo");
    const envFile = join(dir, "claude-env.txt");
    const planFile = join(dir, "plan.md");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
    const argsFile = join(dir, "claude-args.txt");
    writeExecutable(
      join(binDir, "claude"),
      `#!/usr/bin/env bash\nenv > "${envFile}"\nprintf '%s\\n' "$@" > "${argsFile}"\nexit 0\n`,
    );
    writeExecutable(join(binDir, "gh"), "#!/usr/bin/env bash\nexit 0\n");
    writeFileSync(planFile, "# Plan\n");
    const init = spawnSync("git", ["init", "-b", "feature/solo-test"], { cwd: repoDir, encoding: "utf8" });
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
    // Only what the script needs: nothing from the host's solo flags or API keys leaks in.
    const env = {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
    };
    const result = spawnSync(SOLO_SCRIPT, [planFile], { cwd: repoDir, env, encoding: "utf8" });
    const claudeEnv = readFileSync(envFile, "utf8");
    const claudeArgs = readFileSync(argsFile, "utf8");
    return { result, claudeEnv, claudeArgs, planFile };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("exports-gate-policy-auto", () => {
  const { result, claudeEnv } = runSoloOnFeatureBranch();

  assert.equal(result.status, 0, `solo-buddy.sh should run on a feature branch: ${result.stderr}`);
  assert.match(
    claudeEnv,
    /^PAIRINGBUDDY_GATE_POLICY=auto$/m,
    "claude must start with PAIRINGBUDDY_GATE_POLICY=auto in its environment",
  );
});

test("gate-policy-set-before-claude-starts", () => {
  const lines = readFileSync(SOLO_SCRIPT, "utf8").split("\n");
  const exportLine = lines.findIndex((line) => /^\s*export\s+PAIRINGBUDDY_GATE_POLICY=auto\s*$/.test(line));
  const claudeLine = lines.findIndex((line) => /^\s*claude\s+"\$\{CLAUDE_ARGS\[@\]\}"/.test(line));

  assert.notEqual(exportLine, -1, "solo-buddy.sh must export PAIRINGBUDDY_GATE_POLICY=auto");
  assert.notEqual(claudeLine, -1, "solo-buddy.sh must invoke claude with CLAUDE_ARGS");
  assert.ok(
    exportLine < claudeLine,
    `the policy export (line ${exportLine + 1}) must come before the claude invocation (line ${claudeLine + 1})`,
  );
});

test("still-exports-solo-flag", () => {
  const { result, claudeEnv } = runSoloOnFeatureBranch();

  assert.equal(result.status, 0, `solo-buddy.sh should run on a feature branch: ${result.stderr}`);
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
  const { result, claudeArgs, planFile } = runSoloOnFeatureBranch();

  assert.equal(result.status, 0, `solo-buddy.sh should run on a feature branch: ${result.stderr}`);
  assert.match(claudeArgs, /\/pairingbuddy:code/, "the prompt passed to claude must name /pairingbuddy:code");
  assert.ok(
    claudeArgs.includes(planFile),
    `the prompt passed to claude must name the plan file ${planFile}, got: ${claudeArgs}`,
  );
});

test("skill-solo-uses-new-plan-loop", () => {
  notImplemented("skill-solo-uses-new-plan-loop");
});

test("agents-do-not-read-policy-env", () => {
  notImplemented("agents-do-not-read-policy-env");
});

test("refuses-main", () => {
  notImplemented("refuses-main");
});

test("refuses-master", () => {
  notImplemented("refuses-master");
});

test("skill-solo-stops-on-human-task", () => {
  notImplemented("skill-solo-stops-on-human-task");
});

test("skill-solo-human-stop-message", () => {
  notImplemented("skill-solo-human-stop-message");
});

test("skill-solo-human-stop-not-auto-yes", () => {
  notImplemented("skill-solo-human-stop-not-auto-yes");
});
