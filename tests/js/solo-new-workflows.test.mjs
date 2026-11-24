import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  const binDir = join(dir, "bin");
  const repoDir = join(dir, "repo");
  const envFile = join(dir, "claude-env.txt");
  const planFile = join(dir, "plan.md");
  spawnSync("mkdir", ["-p", binDir, repoDir]);
  writeExecutable(join(binDir, "claude"), `#!/usr/bin/env bash\nenv > "${envFile}"\nexit 0\n`);
  writeExecutable(join(binDir, "gh"), "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(planFile, "# Plan\n");
  spawnSync("git", ["init", "-b", "feature/solo-test"], { cwd: repoDir });
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };
  delete env.PAIRINGBUDDY_GATE_POLICY;
  const result = spawnSync(SOLO_SCRIPT, [planFile], { cwd: repoDir, env, encoding: "utf8" });
  let claudeEnv = "";
  try {
    claudeEnv = readFileSync(envFile, "utf8");
  } catch {
    claudeEnv = "";
  }
  return { result, claudeEnv };
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
  notImplemented("gate-policy-set-before-claude-starts");
});

test("still-exports-solo-flag", () => {
  notImplemented("still-exports-solo-flag");
});

test("prompt-invokes-code-on-plan", () => {
  notImplemented("prompt-invokes-code-on-plan");
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
