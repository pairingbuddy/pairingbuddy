// The repo boundary: a session pb works in stays in its home repo. A push to another repo's URL, a gh call that writes to
// another repo, and any write or git change inside another repo's checkout are the human's alone. Hooks never call git, so
// every fact here comes from plain files. Node built-ins only.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { callRepo, ghParts, gitVerb, readsOnly, recognizes } from "./d17.mjs";
import { commonDirectory, configValue, currentBranch, findRepo, remoteUrl } from "./git-files.mjs";
import { redacted, scanText } from "./leak-scan.mjs";
import { toolCalls } from "./shell-calls.mjs";

// host/owner/name in lower case, from any URL form git and gh take, or a bare owner/name (GitHub's). null for a local path.
export function repoSlug(url) {
  const text = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(text);
  const full = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(text);
  const bare = /^([\w-][\w.-]*\/[\w.-]+)$/.exec(text);
  const [host, path] = scp !== null ? [scp[1], scp[2]] : full !== null ? [full[1], full[2]] : bare !== null ? ["github.com", bare[1]] : [null, null];
  return host === null ? null : `${host}/${path}`.toLowerCase();
}

// A repo's identity: its slug, or the absolute path of a local one.
// A bare owner/name is gh's form only: to git it is a path.
const isNetworkUrl = (url) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^file:/i.test(url)) || /^[\w.-]+@[\w.-]+:/.test(url);
export const identityOf = (url, baseDir) => (isNetworkUrl(url) ? repoSlug(url) : resolve(baseDir, url.replace(/^file:\/\//i, "")));

export const HOME_REPO_FILE = "home-repo.json";

function recordedSlug(root) {
  try {
    const { slug } = JSON.parse(readFileSync(join(root, ".pairingbuddy", "run", HOME_REPO_FILE), "utf8"));
    return typeof slug === "string" && slug !== "" ? slug : null;
  } catch {
    return null;
  }
}

// The run's home repo: the slug pb unit open recorded (origin can be changed after it), else origin's (a local origin's
// absolute path); and the git common
// directory every linked worktree of it shares. slug is null when neither names a repo.
export function homeRepoOf(root) {
  const repo = findRepo(root);
  const gitDir = repo?.gitDir ?? null;
  const origin = remoteUrl(gitDir, "origin");
  return { slug: recordedSlug(root) ?? (origin === null ? null : identityOf(origin, repo.top)), common: gitDir === null ? null : commonDirectory(gitDir) };
}

export const crossRepo = (what, target, home) =>
  `${what} reaches ${target}, which is not this run's home repo ${home.slug ?? "(unknown)"}. A Pairing Buddy session never writes to, pushes to or files anything in another repo, so the call is denied: only the human can do a cross-repo action, by running it themselves.`;

// Options of git push that take the next word.
const PUSH_VALUE = new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"]);

// The remote word a push names: --repo, else its first operand, else the one git picks for the branch (pushRemote,
// remote.pushDefault, the branch's remote), else origin.
function pushRemote(tail, gitDir) {
  const operands = [];
  for (let i = 0; i < tail.length; i += 1) {
    const word = tail[i];
    if (word.startsWith("--repo=")) return word.slice("--repo=".length);
    if (word === "--repo") return tail[i + 1];
    if (PUSH_VALUE.has(word)) i += 1;
    else if (!word.startsWith("-")) operands.push(word);
  }
  if (operands.length > 0) return operands[0];
  const branch = currentBranch(gitDir);
  const byBranch = (key) => (branch === null ? null : configValue(gitDir, "branch", branch, key));
  return byBranch("pushremote") ?? configValue(gitDir, "remote", null, "pushdefault") ?? byBranch("remote") ?? "origin";
}

// Where a push goes, as an identity, or null when it cannot be read.
function pushTarget(call, cwd) {
  const found = callRepo(call, cwd);
  if (found === null || found.repo === null) return null;
  const { tail } = gitVerb(call.rest, call.before);
  const remote = pushRemote(tail, found.repo.gitDir);
  if (remote === undefined || /[$`{]/.test(remote)) return null;
  const url = /[:/]/.test(remote) ? remote : remoteUrl(found.repo.gitDir, remote);
  return url === null ? null : identityOf(url, found.dir);
}

// gh calls that make a repo or a gist, which belong to no run.
const GH_NEW_PLACES = { gist: ["create", "new", "edit", "delete", "rename", "clone"], repo: ["create", "new", "fork", "delete", "rename", "archive", "unarchive"] };

const GITHUB_URL = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)/i;
const API_PATH = /^\/?repos\/([\w.-]+\/[\w.-]+)/;

// Every repo a gh call names: -R/--repo, a github.com URL, an api path under repos/.
function ghNamedRepos(rest) {
  const named = [];
  rest.forEach((word, i) => {
    if (word === "-R" || word === "--repo") named.push(rest[i + 1]);
    else if (word.startsWith("--repo=")) named.push(word.slice("--repo=".length));
    else if (word.startsWith("-R") && word.length > 2) named.push(word.slice(2));
    else if (GITHUB_URL.test(word)) named.push(GITHUB_URL.exec(word)[1]);
    else if (API_PATH.test(word)) named.push(API_PATH.exec(word)[1]);
  });
  return named.filter((word) => word !== undefined).map((word) => repoSlug(word) ?? word);
}

// The repo a gh call with none named acts on: the one its directory is in.
function ghImplicitRepo(call, cwd) {
  const found = callRepo(call, cwd);
  const origin = found?.repo?.gitDir == null ? null : remoteUrl(found.repo.gitDir, "origin");
  return origin === null ? null : identityOf(origin, found.repo.top);
}

function ghDenial(call, cwd, home) {
  const { group, sub } = ghParts(call.rest);
  if (GH_NEW_PLACES[group]?.includes(sub)) return crossRepo(`gh ${group} ${sub}`, `a new ${group}`, home);
  if (readsOnly(call)) return null;
  const named = ghNamedRepos(call.rest);
  const targets = named.length > 0 ? named : [ghImplicitRepo(call, cwd)].filter((target) => target !== null);
  const foreign = targets.find((target) => target !== home.slug);
  return foreign === undefined ? null : crossRepo(`gh ${[group, sub].filter(Boolean).join(" ")}`, foreign, home);
}

// The identity of the repo a found repo is, when it is not the home repo, else null. A linked worktree of the home repo
// shares its common directory, and another clone of it has the same origin: neither is foreign.
function foreignIdentity(repo, home) {
  if (repo === null || repo.gitDir === null) return null;
  if (home.common !== null && commonDirectory(repo.gitDir) === home.common) return null;
  const origin = remoteUrl(repo.gitDir, "origin");
  const identity = origin === null ? repo.top : identityOf(origin, repo.top);
  return identity === home.slug ? null : identity;
}

// The reason to deny a write to these paths, or null: none may land in another repo's checkout.
export function writeBoundaryDenial(targets, home) {
  for (const target of targets) {
    const foreign = foreignIdentity(findRepo(dirname(target)), home);
    if (foreign !== null) return crossRepo(`Writing ${target}`, foreign, home);
  }
  return null;
}

// git remote add|set-url with a URL of another repo: a later push to that remote would leave the home repo.
function remoteChangeDenial(call, cwd, home) {
  const { verb, tail } = gitVerb(call.rest, call.before);
  const words = tail.filter((word) => !word.startsWith("-"));
  if (verb !== "remote" || !["add", "set-url"].includes(words[0])) return null;
  const url = words.at(-1);
  if (url === undefined || words.length < 3) return null;
  const found = callRepo(call, cwd);
  const target = identityOf(url, found?.dir ?? cwd);
  return target === home.slug ? null : crossRepo(`git remote ${words[0]}`, target, home);
}

// A git call that changes anything, run in another repo's checkout. A fetch sends nothing out and touches no file there.
function gitElsewhereDenial(call, cwd, home) {
  if (readsOnly(call) || gitVerb(call.rest, call.before).verb === "fetch") return null;
  const found = callRepo(call, cwd);
  const foreign = found === null ? null : foreignIdentity(found.repo, home);
  return foreign === null ? null : crossRepo(`git ${gitVerb(call.rest, call.before).verb ?? ""}`.trim(), foreign, home);
}

// The reason to deny this Bash command, or null. home is homeRepoOf the run's root.
export function bashBoundaryDenial({ command, cwd, home }) {
  for (const call of toolCalls(command, ["git", "gh"], recognizes)) {
    if (call.name === "git" && gitVerb(call.rest, call.before).verb === "push") {
      const target = pushTarget(call, cwd);
      if (target !== home.slug) return crossRepo("git push", target ?? "a remote that cannot be read", home);
    } else if (call.name === "git") {
      const reason = remoteChangeDenial(call, cwd, home) ?? gitElsewhereDenial(call, cwd, home);
      if (reason !== null) return reason;
    }
    if (call.name === "gh") {
      const reason = ghDenial(call, cwd, home);
      if (reason !== null) return reason;
    }
  }
  return null;
}

// ---------- text a gh call sends out ----------

// gh verbs whose words are posted: a title, a body, a comment, release notes.
const GH_POSTS = { pr: ["create", "edit", "comment", "review"], issue: ["create", "edit", "comment"], release: ["create", "edit"] };
const TEXT_FLAGS = new Set(["-t", "--title", "-b", "--body", "-n", "--notes"]);
const FILE_FLAGS = new Set(["-F", "--body-file", "--notes-file"]);

function flagValues(rest, flags) {
  const values = [];
  rest.forEach((word, i) => {
    const [name, glued] = word.startsWith("--") && word.includes("=") ? [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)] : [word, undefined];
    if (flags.has(name)) values.push(glued ?? rest[i + 1]);
  });
  return values.filter((value) => value !== undefined);
}

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// The leak findings in what one gh call posts, its body files' contents included.
function postedFindings(call, cwd, options) {
  const { group, sub } = ghParts(call.rest);
  if (!GH_POSTS[group]?.includes(sub)) return [];
  const dir = call.cd === undefined ? cwd : resolve(cwd, call.cd);
  const files = flagValues(call.rest, FILE_FLAGS).filter((path) => path !== "-").map((path) => readOrEmpty(resolve(dir, path)));
  return scanText([...flagValues(call.rest, TEXT_FLAGS), ...files].join("\n"), options);
}

// The author's own addresses: user.email in the repo's config and in the global git config files.
export function authorEmails(root) {
  const gitDir = findRepo(root)?.gitDir ?? null;
  const global = [join(homedir(), ".gitconfig"), join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "git", "config")];
  const fromFiles = global.map((path) => /^\s*email\s*=\s*(\S+)\s*$/im.exec(readOrEmpty(path))?.[1]);
  return [configValue(gitDir, "user", null, "email"), ...fromFiles].filter((address) => typeof address === "string" && address !== "");
}

export const leakList = (findings) => findings.map((finding) => `${finding.kind} ${redacted(finding)}`).join("; ");

// The reason to deny a gh call whose posted text holds a secret or personal data, or null. Only the human can send it.
export function outgoingTextDenial({ command, cwd, allowedEmails = [] }) {
  for (const call of toolCalls(command, ["gh"], recognizes)) {
    const findings = postedFindings(call, cwd, { allowedEmails });
    if (findings.length > 0) {
      return `This gh call would post what looks like a secret or personal data: ${leakList(findings)}. Nothing that leaves the machine may carry one, so the call is denied. Take it out and try again; if it is a false alarm, only the human can send it, by running it themselves.`;
    }
  }
  return null;
}
