// Shared harness for tests that drive the real pb CLI in a temp git repo with a real ledger. Temp dirs are removed when
// the importing test file finishes. HOME and XDG_CONFIG_HOME point at an empty dir, so no user config leaks in.
import "./isolated-tmpdir.mjs";
import { after } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { lensRow, writeCleanLensReturn } from "./lens-return-fixture.mjs";
import { baseLedger, withIntake } from "./ledger-fixture.mjs";

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
  // The run is past intake: a done intake first in its stages and G:type passed, whatever stages and gates the test names.
  writeLedger(ledgerPath, withIntake({
    ...baseLedger(),
    configHash: createHash("sha256").update(TEST_CONFIG).digest("hex"),
    stage: { name: "code-config", status: "active", runId: "wf_1", attempt: ATTEMPT, startedAt: null },
    stages: [],
    ...ledger,
  }));
  if (!openTask) rmSync(taskDir, { recursive: true, force: true });
  return { dir, remoteDir, ledger: () => readLedger(ledgerPath) };
}

// Like pb, with extra environment variables (for example PAIRINGBUDDY_GATE_POLICY=auto).
export function pbWithEnv(repo, extraEnv, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30_000, env: env(extraEnv) });
  return { code: status, stdout, stderr };
}

export const pb = (repo, ...args) => pbWithEnv(repo, {}, ...args);

// Writes content to docs/plan.md in the repo, creating docs/ when needed.
export function writePlan(repo, content) {
  mkdirSync(join(repo.dir, "docs"), { recursive: true });
  writeFileSync(join(repo.dir, "docs", "plan.md"), content);
}

// Records a clean lens return for every lens of the stage's row for the task type, at the stage's current attempt, so a
// stage whose lenses are not under test reaches an auto-pass gate rather than reporting its lenses uncovered.
export function recordCleanLensReturns(repo, stage, taskType, attempt) {
  for (const { name } of lensRow(stage, taskType).lenses) writeCleanLensReturn(join(repo.taskDir, "artifacts"), stage, name, attempt);
}

// Pushes a new commit to main on the bare remote from a throwaway second clone, as someone else moving origin/main, and
// returns the new tip. The clone is removed afterwards.
export function pushFromSecondClone(repo, file) {
  const clone = realpathSync(mkdtempSync(join(tmpdir(), "pb-clone-")));
  try {
    const cloneGit = (...args) => execFileSync("git", args, { cwd: clone, env: env(), encoding: "utf8" }).trim();
    execFileSync("git", ["clone", "-q", repo.remoteDir, clone], { env: env(), stdio: "ignore" });
    cloneGit("config", "user.name", "Other");
    cloneGit("config", "user.email", "other@example.com");
    writeFileSync(join(clone, file), `${file}\n`);
    cloneGit("add", file);
    cloneGit("commit", "-q", "-m", `add ${file}`);
    cloneGit("push", "-q", "origin", "main");
    return cloneGit("rev-parse", "HEAD");
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

// A unit open on a repo with a bare origin, with two commits on its branch (the first adds fake.mjs, the test-config runner,
// so the tree stays clean), unit.json recording them and two tasks (headSha: the old baseSha, then the second commit) whose
// full suite passed at the old HEAD, then origin/main moved and the branch rebased onto it with `git rebase --onto`, as the
// human would (reconcile: "merge" merges origin/main into the branch instead). secondFileContent is the content of the second
// commit's file. suiteExitCode is the exit code of fake.mjs, so the full suite at the new HEAD passes (0) or fails.
// Returns the repo, the unit.json path, the unit as written before the rebase (unitBefore) and the old and new shas.
// `pb unit status` has not run yet.
export function rebasedUnitRepo({ suiteExitCode = 0, reconcile = "rebase", secondFileContent = "b\n" } = {}) {
  const repo = makeRepo({ openTask: false, remote: true });
  const git = (...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), encoding: "utf8" }).trim();
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "x");
  if (opened.code !== 0) throw new Error(`unit open failed: ${opened.stderr}${opened.stdout}`);
  const unitFile = join(repo.dir, ".pairingbuddy", "run", "unit.json");
  const unit = JSON.parse(readFileSync(unitFile, "utf8"));
  const oldBase = unit.baseSha;
  const commit = (file, content) => {
    writeFileSync(join(repo.dir, file), content);
    git("add", file);
    git("commit", "-q", "-m", `add ${file}`);
    return git("rev-parse", "HEAD");
  };
  const oldFirst = commit("fake.mjs", `process.exit(${suiteExitCode});\n`);
  const oldSecond = commit("b.txt", secondFileContent);
  const suite = { passed: true, head: oldSecond };
  const task = (title, headSha) => ({ title, stages: [], gateSources: {}, lenses: {}, headSha, reportSummary: null, blocking: [], attempts: {}, lessons: [], spend: null, fullSuite: suite });
  const tasks = [task("first", oldBase), task("second", oldSecond)];
  const unitBefore = { ...unit, tasks, commits: [oldFirst, oldSecond] };
  writeFileSync(unitFile, `${JSON.stringify(unitBefore, null, 2)}\n`);
  const newMain = pushFromSecondClone(repo, "other.txt");
  git("fetch", "-q", "origin");
  if (reconcile === "merge") git("merge", "--no-ff", "-q", "-m", "merge origin/main", "origin/main");
  else git("rebase", "--onto", "origin/main", oldBase, unit.branch);
  return { repo, unitFile, unitBefore, branch: unit.branch, oldBase, oldFirst, oldSecond, newMain, newFirst: git("rev-parse", "HEAD~1"), newSecond: git("rev-parse", "HEAD") };
}
