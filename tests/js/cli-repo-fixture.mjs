// Shared harness for tests that drive the real pb CLI in a temp git repo with a real ledger. Temp dirs are removed when
// the importing test file finishes. HOME and XDG_CONFIG_HOME point at an empty dir, so no user config leaks in.
import "./isolated-tmpdir.mjs";
import { after } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { baseLedger } from "./ledger-fixture.mjs";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const CLI = join(ROOT, "cli", "pb.mjs");
// The attempt every default ledger stage is on; tests build their artifact keys from it.
export const ATTEMPT = 2;
// The one runner in the repo's test-config.json. It has no selector_template, on purpose.
export const RUNNER_WITHOUT_SELECTOR = "fake";
const TEST_CONFIG = JSON.stringify({ source_directory: ".", runners: { [RUNNER_WITHOUT_SELECTOR]: { name: "fake", command: "node fake.mjs", test_directory: "tests", file_pattern: "*.mjs", run_args: [] } }, default_runner: RUNNER_WITHOUT_SELECTOR });
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

const NO_HOME = makeDir("pb-no-home-");

export const env = (extra = {}) => ({ ...process.env, ...ISOLATED_GIT, HOME: NO_HOME, XDG_CONFIG_HOME: NO_HOME, CLAUDE_PLUGIN_ROOT: ROOT, ...extra });

// openTask: false leaves the repo with no task in flight, so `pb run open` starts from a fresh repo.
// remote: true gives the repo a local bare origin with its default branch "main" pushed and refs/remotes/origin/HEAD set;
// configGlobs writes .pairingbuddy/git-config.json with those config_globs; left out, there is no such file.
// .pairingbuddy/ is git-ignored there, so only real changes make the tree dirty. The bare repo's path is returned as remoteDir.
export function makeRepo({ ledger = {}, openTask = true, remote = false, configGlobs } = {}) {
  const dir = makeDir("pb-stop-code-");
  const remoteDir = remote ? makeDir("pb-remote-") : null;
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: env(), stdio: "ignore" });
  git("init", "-q", "-b", remote ? "main" : "feature");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git("add", "a.txt");
  if (remote) {
    writeFileSync(join(dir, ".gitignore"), ".pairingbuddy/\n");
    git("add", ".gitignore");
  }
  git("commit", "-q", "-m", "seed");
  if (remote) {
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remoteDir], { env: env(), stdio: "ignore" });
    git("remote", "add", "origin", remoteDir);
    git("push", "-q", "-u", "origin", "main");
    git("remote", "set-head", "origin", "main");
  }
  const taskDir = join(dir, ".pairingbuddy", "run", "task");
  mkdirSync(join(taskDir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, ".pairingbuddy", "run", ".gitignore"), "*\n");
  writeFileSync(join(dir, ".pairingbuddy", "test-config.json"), TEST_CONFIG);
  if (configGlobs) writeFileSync(join(dir, ".pairingbuddy", "git-config.json"), JSON.stringify({ config_globs: configGlobs }));
  const ledgerPath = join(taskDir, "ledger.json");
  writeLedger(ledgerPath, {
    ...baseLedger(),
    configHash: createHash("sha256").update(TEST_CONFIG).digest("hex"),
    stage: { name: "code-config", status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [],
    ...ledger,
  });
  if (!openTask) rmSync(taskDir, { recursive: true, force: true });
  return { dir, remoteDir, ledger: () => readLedger(ledgerPath) };
}

// Like pb, with extra environment variables (for example PAIRINGBUDDY_GATE_POLICY=auto).
export function pbWithEnv(repo, extraEnv, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: env(extraEnv) });
  return { code: status, stdout, stderr };
}

export const pb = (repo, ...args) => pbWithEnv(repo, {}, ...args);
