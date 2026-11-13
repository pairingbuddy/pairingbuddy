// pb rollback: the git side of undoing a rejected fix group. The rejected work is kept reachable under a numbered ref
// before the tree goes back, and git runs with no shell. The caller passes the ref prefix in, so nothing here reads
// the current branch. Node built-ins only.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A git failure the caller reports as an expected refusal, not a crash.
export class RollbackRefused extends Error {}

const GIT_BUFFER_BYTES = 64 * 1024 * 1024;

function git(root, args, env = {}) {
  const result = spawnSync("git", args, { cwd: root, shell: false, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_BUFFER_BYTES, env: { ...process.env, ...env } });
  if (result.error || result.status !== 0) {
    const why = String(result.stderr ?? "").trim() || result.error?.message || `exit ${result.status}`;
    throw new RollbackRefused(`git ${args.join(" ")} failed: ${why}`);
  }
  return result.stdout.trim();
}

// Commits the listed paths, as they are on disk now, as a commit on top of HEAD without touching the real index or HEAD:
// a throwaway index is filled from HEAD, the paths are added to it, and the tree it holds is committed. Returns the new
// commit's sha, or null when none of the paths is dirty (the caller then has nothing extra to keep).
function commitDirtyPaths(root, paths, message) {
  if (git(root, ["--literal-pathspecs", "status", "--porcelain", "--", ...paths]) === "") return null;
  const dir = mkdtempSync(join(tmpdir(), "pb-save-"));
  try {
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    git(root, ["read-tree", "HEAD"], env);
    git(root, ["--literal-pathspecs", "add", "-A", "--", ...paths], env);
    const tree = git(root, ["write-tree"], env);
    return git(root, ["commit-tree", tree, "-p", "HEAD", "-m", message]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The paths a commit touched, repo-relative.
export function pathsOfCommit(root, sha) {
  return git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha]).split("\n").filter(Boolean);
}

// The next free rollback ref under the prefix. The number is one past the highest already taken, so a second rollback of
// the same stage never overwrites the first. Only plain counters (1, 2, ...) count; anything else under the prefix is ignored.
function nextRollbackRef(root, prefix) {
  const taken = git(root, ["for-each-ref", "--format=%(refname)", prefix]).split("\n").filter(Boolean)
    .map((ref) => ref.slice(prefix.length)).filter((n) => /^[1-9]\d*$/.test(n)).map(Number);
  return `${prefix}${Math.max(0, ...taken) + 1}`;
}

// The steps both rollback paths share: keep the group's dirty paths (or the fallback sha when nothing is dirty) reachable
// under the next rollback ref, then put the paths back to HEAD. prefix is the stage's ref prefix, ending in a slash.
function saveAndRestore(root, key, prefix, paths, fallbackSha) {
  const saved = commitDirtyPaths(root, paths, `pairingbuddy rollback ${key}`) ?? fallbackSha;
  // Create-only (empty old value), so a second rollback of the same stage never overwrites the first.
  const ref = nextRollbackRef(root, prefix);
  git(root, ["update-ref", ref, saved, ""]);
  // Put the group's paths back to HEAD so a later --keep has nothing of ours to refuse over. One call tells which paths
  // HEAD has; a path it does not have is a new file the fix created.
  const inHead = new Set(git(root, ["--literal-pathspecs", "ls-tree", "-r", "-z", "--name-only", "HEAD", "--", ...paths]).split("\0").filter(Boolean));
  const present = paths.filter((p) => inHead.has(p));
  const absent = paths.filter((p) => !inHead.has(p));
  if (present.length) git(root, ["--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--", ...present]);
  // Unstage and delete exactly the new files, never a broad clean.
  if (absent.length) git(root, ["--literal-pathspecs", "rm", "--cached", "-q", "--ignore-unmatch", "--", ...absent]);
  for (const p of absent) rmSync(join(root, p), { force: true });
  return { ref, sha: saved };
}

// Adds the commit HEAD is on once the tree has been put back, so the ledger can say what the group was undone to.
const withBase = (root, saved) => ({ ...saved, base: git(root, ["rev-parse", "HEAD"]) });

// Uncommitted fix (red tests): the paths are saved on top of HEAD under the next rollback ref and then put back to HEAD.
// HEAD itself does not move.
export function rollbackUncommitted(root, { key, prefix, paths }) {
  const saved = saveAndRestore(root, key, prefix, paths, null);
  return withBase(root, saved);
}

// Committed fix: the tree goes back to the fix commit's parent. The rejected commit stays reachable under the rollback
// ref. --keep makes git refuse rather than overwrite work it would lose.
export function rollbackCommitted(root, { key, prefix, sha }) {
  const saved = saveAndRestore(root, key, prefix, pathsOfCommit(root, sha), sha);
  git(root, ["reset", "--keep", `${sha}^`]);
  return withBase(root, saved);
}
