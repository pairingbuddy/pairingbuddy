// What a hook can learn about a repo without calling git: HEAD, the default branch and the protected list, read as plain
// files. Node built-ins only.
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// The same two names gitconf.mjs defaults to, which this file cannot import without pulling in child_process.
const DEFAULT_PROTECTED = ["main", "master"];

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// The repo at or above start: its top and its git directory, which a linked worktree's `.git` file points to.
// gitDir is null when that file cannot be read.
export function findRepo(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    const dot = join(dir, ".git");
    const stat = statSync(dot, { throwIfNoEntry: false });
    if (stat?.isDirectory()) return { top: dir, gitDir: dot };
    if (stat?.isFile()) {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dot) ?? "");
      return { top: dir, gitDir: pointer === null ? null : resolve(dir, pointer[1]) };
    }
    if (dir === dirname(dir)) return null;
  }
}

// Shared refs live in the common directory of a linked worktree.
export function commonDirectory(gitDir) {
  const pointer = readText(join(gitDir, "commondir"));
  return pointer === null ? gitDir : resolve(gitDir, pointer.trim());
}

// The repo's config text, from the common directory a linked worktree shares.
const configText = (gitDir) => readText(join(commonDirectory(gitDir), "config")) ?? "";

// False for a repo whose refs are not plain files (reftable), or whose git dir cannot be read: HEAD and refs/remotes then say
// nothing, so a caller must treat every target as unknown.
export function refsAreFiles(gitDir) {
  if (gitDir === null) return false;
  const storage = /^\s*refstorage\s*=\s*(\S+)/im.exec(configText(gitDir));
  return storage === null || storage[1].toLowerCase() === "files";
}

// The branch HEAD names, or null for a detached HEAD, an unreadable one, or the `.invalid` placeholder reftable writes there.
export function currentBranch(gitDir) {
  if (gitDir === null || !refsAreFiles(gitDir)) return null;
  const head = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readText(join(gitDir, "HEAD")) ?? "");
  return head === null || head[1] === ".invalid" ? null : head[1];
}

// True when the repo's own config decides where a bare push goes: any remote.<name>.push, or a push.default other than
// simple and current. A bare push then cannot be read from HEAD.
export function configuresPushTarget(gitDir) {
  if (gitDir === null) return false;
  let section = "";
  for (const line of configText(gitDir).split("\n")) {
    const header = /^\s*\[\s*([^\s\]"]+)(?:\s+"[^"]*")?\s*\]\s*(.*)$/.exec(line);
    const entry = header === null ? line : header[2];
    if (header !== null) section = header[1].toLowerCase();
    const setting = /^\s*([A-Za-z][\w-]*)\s*=\s*(.*?)\s*$/.exec(entry);
    if (setting === null) continue;
    const key = setting[1].toLowerCase();
    if (section === "remote" && key === "push") return true;
    if (section === "push" && key === "default" && !["simple", "current"].includes(setting[2].toLowerCase())) return true;
  }
  return false;
}

function configuredBranches(root) {
  try {
    const config = JSON.parse(readText(join(root, ".pairingbuddy", "git-config.json")) ?? "null");
    const list = config?.protected_branches;
    const remote = typeof config?.remote === "string" ? config.remote : "origin";
    return { list: Array.isArray(list) && list.every((name) => typeof name === "string") ? list : DEFAULT_PROTECTED, remote };
  } catch {
    return { list: DEFAULT_PROTECTED, remote: "origin" };
  }
}

// The configured protected branches (the defaults without a usable config) and the remote's default branch, from
// refs/remotes/<remote>/HEAD. A linked worktree with no config of its own reads the main worktree's.
export function protectedBranches(repo) {
  const common = repo.gitDir === null ? null : commonDirectory(repo.gitDir);
  const main = common !== null && basename(common) === ".git" ? dirname(common) : repo.top;
  const { list, remote } = configuredBranches(readText(join(repo.top, ".pairingbuddy", "git-config.json")) === null ? main : repo.top);
  const trunk = common === null ? null : /^ref:\s*refs\/remotes\/[^/]+\/(.+?)\s*$/m.exec(readText(join(common, "refs", "remotes", remote, "HEAD")) ?? "");
  return trunk === null ? list : [...list, trunk[1]];
}
