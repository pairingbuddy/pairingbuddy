// pb checkpoint: what a step may commit and how. The step fixes the type, the artifact supplies only the subject and
// the paths, and git runs with no shell. A model wrote the artifact, so nothing in it is trusted. Node built-ins only.
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, basename, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

import { parseKey } from "./keys.mjs";

const PROTECTED_BRANCHES = ["main", "master"];
const STEPS = {
  config: { type: "chore", role: "apply-config-change" },
  docs: { type: "docs", role: "update-documentation" },
};
const REFUSED_DIRECTORIES = [".pairingbuddy", ".git"];
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

function isKey(text) {
  try {
    parseKey(text);
    return true;
  } catch {
    return false;
  }
}

export const isCheckpointCall = (step, key) => Object.hasOwn(STEPS, step) && isKey(key);

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

const stage = (root, paths) => literalGit(root, "add", "--", ...paths);

// ---------- the key ----------

export function assertCurrentKey(step, key, { stage: { name, status, attempt } }) {
  const { stage: keyStage, role, attempt: keyAttempt } = parseKey(key);
  if (status !== "active") throw new CheckpointRefused(`no stage is active, so ${key} cannot be committed`);
  if (keyStage !== name) throw new CheckpointRefused(`${key} is from stage ${keyStage}, and the active stage is ${name}`);
  if (keyAttempt !== attempt) throw new CheckpointRefused(`${key} is from attempt ${keyAttempt}, and stage ${name} is at attempt ${attempt}`);
  if (role !== STEPS[step].role) throw new CheckpointRefused(`${key} is from role ${role}, and step ${step} takes role ${STEPS[step].role}`);
}

function readArtifact(artifactsDir, key) {
  const path = join(artifactsDir, `${key}.json`);
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CheckpointRefused(`the artifact ${path} cannot be read`);
  }
  if (artifact?.pb_key !== key) throw new CheckpointRefused(`the artifact ${path} has pb_key ${JSON.stringify(artifact?.pb_key)}, not ${key}`);
  if (!Array.isArray(artifact.files_changed)) throw new CheckpointRefused(`the artifact ${path} has no files_changed list`);
  return artifact;
}

// ---------- paths ----------

const isOutside = (path) => path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);

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

function commitMessage(step, subject) {
  if (typeof subject !== "string" || BREAKS_LINE.test(subject)) throw new CheckpointRefused(`commit_subject must be a single line: ${JSON.stringify(subject)}`);
  const bare = subject.trim().replace(TYPE_PREFIX, "").trim();
  if (bare === "") throw new CheckpointRefused(`commit_subject says nothing: ${JSON.stringify(subject)}`);
  return `${STEPS[step].type}: ${bare}`;
}

// ---------- the plan ----------

function assertNothingElseStaged(root, listed) {
  const stray = statusEntries(root).filter(({ index, path }) => index !== " " && index !== "?" && !listed.includes(path)).map(({ path }) => path);
  if (stray.length > 0) throw new CheckpointRefused(`changes outside the list are staged, so the commit would carry them: ${stray.join(", ")}`);
}

// What to commit, or null for no change. Every check that needs no test run is here, so a refusal costs none.
export function planCommit(root, artifactsDir, step, key) {
  const artifact = readArtifact(artifactsDir, key);
  const listed = [...new Set(artifact.files_changed.map((path) => checkedPath(root, path)))];
  if (listed.length === 0) return null;
  const paths = [...new Set(statusEntries(root, listed).map(({ path }) => path))];
  if (paths.length === 0) return null;
  const message = commitMessage(step, artifact.commit_subject);
  assertNothingElseStaged(root, listed);
  return { paths, message };
}

// ---------- the commit ----------

const failureText = ({ stderr, stdout, error }) => (stderr || stdout || error?.message || "").trim().slice(-REASON_CHARS);

const lastLine = (text) => text.trim().split("\n").at(-1);

// LANGUAGE alone, so the words of git's own error stay English and a hook keeps the human's locale.
function tryCommit(root, message) {
  const result = runGit(root, ["commit", "-q", "-m", message], { env: { ...process.env, LANGUAGE: "C" }, timeout: COMMIT_TIMEOUT_MS });
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

export function commitPaths(root, { paths, message }) {
  stage(root, paths);
  const before = dirtyInWorktree(root);
  const first = tryCommit(root, message);
  const hookRetried = first.status !== 0;
  if (hookRetried) {
    stage(root, retryPaths(root, before, first));
    const second = tryCommit(root, message);
    if (second.status !== 0) throw new CheckpointStopped(`the commit failed after one retry: ${failureText(second)}`);
  }
  return { sha: git(root, "rev-parse", "HEAD").trim(), hookRetried };
}
