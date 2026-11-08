import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class GitConfigRefused extends Error {}

export const DEFAULTS = {
  remote: "origin",
  protected_branches: ["main", "master"],
  branch_template: "{type}/{slug}",
  config_globs: [],
  commit: {
    red_commits: true,
    subject_template: "{type}: {subject}",
    key_pattern: null,
    require_signature: false,
    conventions: [],
  },
  pr: {
    title_template: "{type}: {summary}",
    base_branch: null,
    publish: "pr",
    stack_depth: 3,
    lint: {},
    conventions: [],
  },
};

export const gitConfigPath = (root) => join(root, ".pairingbuddy", "git-config.json");

export function loadGitConfig(root) {
  const file = gitConfigPath(root);
  const config = structuredClone(DEFAULTS);
  if (existsSync(file)) {
    const parsed = parseConfigFile(file);
    validateTypes(parsed, DEFAULTS);
    return mergeOverDefaults(config, parsed);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  return config;
}

function parseConfigFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new GitConfigRefused(`git-config.json is not valid JSON: ${err.message}`);
  }
  if (!isPlainObject(parsed)) throw new GitConfigRefused("git-config.json must contain a JSON object");
  return parsed;
}

function kindOf(v) {
  return Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
}

// Null defaults accept null or a string; integer defaults require an integer; other known fields must match the default's kind.
function validateTypes(over, defaults, path = "") {
  for (const [key, value] of Object.entries(over)) {
    if (!Object.hasOwn(defaults, key)) continue;
    const want = defaults[key];
    const name = path + key;
    if (isPlainObject(want)) {
      if (!isPlainObject(value)) throw new GitConfigRefused(`git-config.json: field "${name}" must be an object`);
      if (Object.keys(want).length) validateTypes(value, want, name + ".");
      continue;
    }
    const got = kindOf(value);
    const wantsInteger = Number.isInteger(want);
    const ok = want === null ? got === "null" || got === "string" : got === kindOf(want) && (!wantsInteger || Number.isInteger(value));
    if (!ok) throw new GitConfigRefused(`git-config.json: field "${name}" must be ${want === null ? "a string or null" : wantsInteger ? "an integer" : "of type " + kindOf(want)}, got ${got}`);
  }
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function mergeOverDefaults(base, over) {
  for (const [key, value] of Object.entries(over)) {
    if (UNSAFE_KEYS.has(key)) continue;
    base[key] =
      isPlainObject(value) && isPlainObject(base[key]) ? mergeOverDefaults(base[key], value) : value;
  }
  return base;
}

// Pure rule: the configured protected branches plus the repo default branch known at run time.
export function protectedBranches(config, defaultBranch) {
  return new Set([...config.protected_branches, defaultBranch].filter(Boolean));
}

// Pure rule: case-insensitive membership of a branch in the protected set.
export function isBranchProtected(set, branch) {
  const wanted = branch.toLowerCase();
  return [...set].some((name) => name.toLowerCase() === wanted);
}

// The remote's HEAD as git knows it; null when unavailable (never guessed).
export function defaultBranchOf(root, remote) {
  try {
    const ref = execFileSync("git", ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return ref.slice(`refs/remotes/${remote}/`.length) || null;
  } catch {
    return null;
  }
}

// Pure rule: the configured PR base branch, else the repo default branch, else unknown (null).
export function baseBranch(config, defaultBranch) {
  return config.pr.base_branch || defaultBranch || null;
}
