// pb checkpoint: what a step may commit and how. The step fixes the type, the artifact supplies only the subject and
// the paths, and git runs with no shell. A model wrote the artifact, so nothing in it is trusted. Node built-ins only.
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, basename, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

import { parseKey } from "./keys.mjs";

const PROTECTED_BRANCHES = ["main", "master"];
// A config step exists to change something, so its return must account for any change that is not there. tests says
// what must run before the commit: the whole suite, the one test the key names, or nothing, since a placeholder proves
// nothing. A step that runs one test takes a key that names it, and every other step's key names none.
const STEPS = {
  config: { type: "chore", role: "apply-config-change", provesChange: true, tests: "full" },
  docs: { type: "docs", role: "update-documentation", provesChange: false, tests: "full" },
  placeholders: { type: "test", role: "create-test-placeholders", provesChange: false, tests: "none" },
  red: { type: "test", role: "implement-tests", provesChange: false, tests: "selected" },
  green: { types: { bug_fix: "fix", new_feature: "feat" }, role: "implement-code", provesChange: false, tests: "selected" },
};
const STATE_DIRECTORY = ".pairingbuddy";
const REFUSED_DIRECTORIES = [STATE_DIRECTORY, ".git"];
const TYPE_PREFIX = /^(?:feat|fix|docs|chore|test|refactor|style|perf|ci|build|revert)(?:\([^)]*\))?!?:\s*/i;
const BREAKS_LINE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
// Git writes the commit only after every hook has passed, so this line can only mean signing or the object store.
const WRITE_FAILED = "fatal: failed to write commit object";
const COMMIT_TIMEOUT_MS = 300_000;
const REASON_CHARS = 500;
const GIT_BUFFER_BYTES = 64 * 1024 * 1024;

export class CheckpointRefused extends Error {}
// A failure that needs a human: the verb records it as the run's stop.
export class CheckpointStopped extends Error {}

export const isProtectedBranch = (branch) => PROTECTED_BRANCHES.includes(branch.toLowerCase());

export const checkpointSteps = () => Object.keys(STEPS);

export function isKey(text) {
  try {
    parseKey(text);
    return true;
  } catch {
    return false;
  }
}

export const isCheckpointCall = (step, key) => Object.hasOwn(STEPS, step) && isKey(key);

export const testsOfStep = (step) => STEPS[step].tests;

const namesTest = (step) => testsOfStep(step) === "selected";

// The one key this step can use: its own role, with a test exactly when the step takes one. The gate allows no other.
export function keyFitsStep(step, key) {
  const { role, item } = parseKey(key);
  return role === STEPS[step].role && (item !== null) === namesTest(step);
}

// ---------- git ----------

const runGit = (root, args, options = {}) => spawnSync("git", args, { cwd: root, shell: false, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_BUFFER_BYTES, ...options });

function git(root, ...args) {
  const { status, stdout, stderr, error } = runGit(root, args);
  if (status !== 0) throw new CheckpointRefused(`git ${args.join(" ")} failed: ${(stderr || error?.message || "").trim()}`);
  return stdout;
}

// --literal-pathspecs: a listed path is a file name, so `*` or `:/` in one cannot widen what is staged.
const literalGit = (root, command, ...args) => git(root, "--literal-pathspecs", command, ...args);

function statusEntries(root, paths = []) {
  const output = literalGit(root, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", ...paths);
  return output.split("\0").filter(Boolean).map((entry) => ({ index: entry[0], worktree: entry[1], path: entry.slice(3) }));
}

const dirtyInWorktree = (root) => statusEntries(root).filter(({ worktree }) => worktree !== " ").map(({ path }) => path);

// Every path a commit has not taken, staged, changed, deleted or new. Ignored files are no one's leftovers, and the
// state directory is pb's own: a repo need not ignore it, and no checkpoint may stage it.
export const remainingFiles = (root) => statusEntries(root).map(({ path }) => path).filter((path) => !path.startsWith(`${STATE_DIRECTORY}/`));

const stagedPaths = (root) => statusEntries(root).filter(({ index }) => index !== " " && index !== "?").map(({ path }) => path);

const stage = (root, paths) => literalGit(root, "add", "--", ...paths);

// The branch checked out at the run root, or null for a detached HEAD.
export function branchOf(root) {
  const { status, stdout } = runGit(root, ["symbolic-ref", "-q", "HEAD"]);
  return status === 0 ? stdout.trim().replace(/^refs\/heads\//, "") : null;
}

// The commit at the run root, or null in a repo with none yet.
export function headOf(root) {
  const { status, stdout } = runGit(root, ["rev-parse", "-q", "--verify", "HEAD"]);
  return status === 0 ? stdout.trim() : null;
}

export const isOnHead = (root, sha) => runGit(root, ["merge-base", "--is-ancestor", sha, "HEAD"]).status === 0;

// ---------- the key ----------

export function assertCurrentKey(step, key, { stage: { name, status, attempt } }) {
  const { stage: keyStage, role, attempt: keyAttempt } = parseKey(key);
  if (status !== "active") throw new CheckpointRefused(`no stage is active, so ${key} cannot be committed`);
  if (keyStage !== name) throw new CheckpointRefused(`${key} is from stage ${keyStage}, and the active stage is ${name}`);
  if (keyAttempt !== attempt) throw new CheckpointRefused(`${key} is from attempt ${keyAttempt}, and stage ${name} is at attempt ${attempt}`);
  if (role !== STEPS[step].role) throw new CheckpointRefused(`${key} is from role ${role}, and step ${step} takes role ${STEPS[step].role}`);
  if (namesTest(step) && parseKey(key).item === null) throw new CheckpointRefused(`${key} names no test, and step ${step} takes one`);
}

function parsedOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readArtifact(artifactsDir, step, key) {
  const path = join(artifactsDir, `${key}.json`);
  const artifact = parsedOrNull(path);
  if (artifact === null) {
    if (STEPS[step].provesChange) throw new CheckpointStopped(`step ${step} has no usable return in the artifact ${path}, so nothing shows what it did. pb stage fail clears this`);
    throw new CheckpointRefused(`the artifact ${path} cannot be read`);
  }
  if (artifact.pb_key !== key) throw new CheckpointRefused(`the artifact ${path} has pb_key ${JSON.stringify(artifact?.pb_key)}, not ${key}`);
  if (!Array.isArray(artifact.files_changed)) throw new CheckpointRefused(`the artifact ${path} has no files_changed list`);
  return artifact;
}

// ---------- paths ----------

export const isOutside = (path) => path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);

function assertNotRefusedDirectory(path, listed) {
  const segments = path.split(sep).map((segment) => segment.toLowerCase());
  const directory = REFUSED_DIRECTORIES.find((name) => segments.includes(name));
  if (directory !== undefined) throw new CheckpointRefused(`${listed} is inside ${directory}/, which a checkpoint never stages`);
}

function linkTargetOrNull(path) {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

// Where a path lands once every link is followed, for a path or a link target that does not exist yet too.
function landingPath(path) {
  try {
    return realpathSync(path);
  } catch (e) {
    if (e.code !== "ENOENT") throw new CheckpointRefused(`${path} cannot be resolved: ${e.code}`);
  }
  const link = linkTargetOrNull(path);
  return link === null ? join(landingPath(dirname(path)), basename(path)) : landingPath(resolve(dirname(path), link));
}

function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function checkedPath(root, listed) {
  if (typeof listed !== "string" || listed === "") throw new CheckpointRefused(`a listed path must be a non-empty string: ${JSON.stringify(listed)}`);
  if (isAbsolute(listed)) throw new CheckpointRefused(`${listed} is an absolute path`);
  const path = normalize(listed);
  if (isOutside(path)) throw new CheckpointRefused(`${listed} is outside the repo`);
  assertNotRefusedDirectory(path, listed);
  const realRoot = realpathSync(root);
  const landing = relative(realRoot, landingPath(join(realRoot, path)));
  if (isOutside(landing)) throw new CheckpointRefused(`${listed} is a symlink that lands outside the repo`);
  assertNotRefusedDirectory(landing, listed);
  if (isDirectory(join(realRoot, path))) throw new CheckpointRefused(`${listed} is a directory, so it could sweep up what it holds. List its files.`);
  return path;
}

// ---------- the message ----------

function commitType(step, taskType) {
  const { type, types } = STEPS[step];
  if (type !== undefined) return type;
  if (types !== undefined && Object.hasOwn(types, taskType ?? "")) return types[taskType];
  throw new CheckpointRefused(`step ${step} has no commit type for task type ${taskType}`);
}

function commitMessage(step, subject, taskType) {
  if (typeof subject !== "string" || BREAKS_LINE.test(subject)) throw new CheckpointRefused(`commit_subject must be a single line: ${JSON.stringify(subject)}`);
  const bare = subject.trim().replace(TYPE_PREFIX, "").trim();
  if (bare === "") throw new CheckpointRefused(`commit_subject says nothing: ${JSON.stringify(subject)}`);
  return `${commitType(step, taskType)}: ${bare}`;
}

// ---------- the plan ----------

function assertNothingElseStaged(root, listed) {
  const stray = stagedPaths(root).filter((path) => !listed.includes(path));
  if (stray.length > 0) throw new CheckpointRefused(`changes outside the list are staged, so the commit would carry them: ${stray.join(", ")}`);
}

// A refused edit leaves the tree as it was and the agent's return may not say so. Only an empty list with an ambiguity
// is a no-change anyone can trust, and pb gate eval asks a human about that ambiguity.
function assertChangeProven(step, { ambiguity }, listed, paths) {
  const unchanged = listed.filter((path) => !paths.includes(path));
  if (unchanged.length > 0) throw new CheckpointStopped(`step ${step} lists files that did not change: ${unchanged.join(", ")}. pb stage fail clears this`);
  if (listed.length > 0 || (typeof ambiguity === "string" && ambiguity.trim() !== "")) return;
  throw new CheckpointStopped(`step ${step} changed nothing and its return gives no ambiguity to say why. pb stage fail clears this`);
}

const isInside = (path, directory) => !isOutside(relative(directory, path));

function assertInTestDirectory(listed, directories) {
  const stray = listed.find((path) => !directories.some((directory) => isInside(path, directory)));
  if (stray !== undefined) throw new CheckpointRefused(`${stray} is outside the test_directory ${directories.join(", ")}, and this step changes tests alone`);
}

// What each step may touch, so a test cannot be written by the step that makes it pass, or left out of the commit
// that says it failed. scope is null for a step with no test, and holds the row's file for a step with one.
const SCOPE_CHECKS = {
  placeholders: (_root, listed, { testDirectories }) => assertInTestDirectory(listed, testDirectories),
  red(root, listed, { testDirectories, testFile }) {
    assertInTestDirectory(listed, testDirectories);
    if (!listed.includes(normalize(testFile)) && statusEntries(root, [testFile]).length > 0) throw new CheckpointRefused(`${testFile} changed and is not listed, so the commit would miss the test`);
  },
  green(root, listed, { testFile }) {
    if (listed.includes(normalize(testFile)) || statusEntries(root, [testFile]).length > 0) throw new CheckpointRefused(`${testFile} changed: GREEN changes the code and leaves the test as RED committed it`);
  },
};

// What to commit, or null for no change. Every check that needs no test run is here, so a refusal costs none.
// alreadyCommitted: this key has a commit, so a repeat of the step has nothing left to change.
export function planCommit(root, artifactsDir, step, key, { alreadyCommitted = false, taskType = null, scope = null } = {}) {
  const artifact = readArtifact(artifactsDir, step, key);
  const listed = [...new Set(artifact.files_changed.map((path) => checkedPath(root, path)))];
  const paths = listed.length === 0 ? [] : [...new Set(statusEntries(root, listed).map(({ path }) => path))];
  const swept = paths.find((path) => !listed.includes(path));
  if (swept !== undefined) throw new CheckpointRefused(`${swept} is not listed: a listed path matched it, so that path is a directory that is gone. List its files.`);
  SCOPE_CHECKS[step]?.(root, paths, scope);
  if (STEPS[step].provesChange && !alreadyCommitted) assertChangeProven(step, artifact, listed, paths);
  if (paths.length === 0) return null;
  const message = commitMessage(step, artifact.commit_subject, taskType);
  assertNothingElseStaged(root, listed);
  return { paths, message };
}

// ---------- the commit ----------

const failureText = ({ stderr, stdout, error }) => (stderr || stdout || error?.message || "").trim().slice(-REASON_CHARS);

const lastLine = (text) => text.trim().split("\n").at(-1);

// Test code ran in the repo after the plan was made, and `git commit` takes the whole index, so this looks again.
function assertNotMoved(root, { branch, head }) {
  const branchNow = branchOf(root);
  if (branchNow !== branch) throw new CheckpointStopped(`the branch moved from ${branch} to ${branchNow ?? "a detached HEAD"} while the tests ran, so nothing was committed`);
  const headNow = headOf(root);
  if (headNow !== head) throw new CheckpointStopped(`HEAD moved from ${head} to ${headNow} while the tests ran, so nothing was committed`);
}

function stageExactly(root, paths) {
  try {
    stage(root, paths);
  } catch (e) {
    if (e instanceof CheckpointRefused) throw new CheckpointStopped(`the listed paths changed while the tests ran, so nothing was committed: ${e.message}`);
    throw e;
  }
  const staged = stagedPaths(root);
  const differ = [...staged.filter((path) => !paths.includes(path)), ...paths.filter((path) => !staged.includes(path))];
  if (differ.length > 0) throw new CheckpointStopped(`the staged paths are not the listed ones, so nothing was committed: ${differ.join(", ")}`);
}

// LANGUAGE alone, so the words of git's own error stay English and a hook keeps the human's locale.
function tryCommit(root, message, timeout) {
  const result = runGit(root, ["commit", "-q", "-m", message], { env: { ...process.env, LANGUAGE: "C" }, timeout });
  if (result.status !== 0 && lastLine(result.stderr ?? "") === WRITE_FAILED) throw new CheckpointStopped(`the commit could not be signed: ${failureText(result)}`);
  return result;
}

function checkedHookChanges(root, changed) {
  try {
    return changed.map((path) => checkedPath(root, path));
  } catch (e) {
    if (e instanceof CheckpointRefused) throw new CheckpointStopped(`the commit failed, and a hook changed a file no checkpoint may stage: ${e.message}`);
    throw e;
  }
}

// What the first try left in the worktree that was not there before it, which only a hook can have done. A file
// already dirty is someone's work in progress, so it stays out of the retry. A hook that changed nothing would fail alike.
function retryPaths(root, before, failed) {
  const changed = dirtyInWorktree(root).filter((path) => !before.includes(path));
  if (changed.length === 0) throw new CheckpointStopped(`the commit failed: ${failureText(failed)}`);
  return checkedHookChanges(root, changed);
}

export function commitPaths(root, plan, timeout = COMMIT_TIMEOUT_MS) {
  const { paths, message } = plan;
  assertNotMoved(root, plan);
  stageExactly(root, paths);
  const before = dirtyInWorktree(root);
  const first = tryCommit(root, message, timeout);
  const hookRetried = first.status !== 0;
  if (hookRetried) {
    stage(root, retryPaths(root, before, first));
    const second = tryCommit(root, message, timeout);
    if (second.status !== 0) throw new CheckpointStopped(`the commit failed after one retry: ${failureText(second)}`);
  }
  return { sha: git(root, "rev-parse", "HEAD").trim(), hookRetried };
}
