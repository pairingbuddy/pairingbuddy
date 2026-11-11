// D17: which git and gh calls are denied, by run state and caller. The table is data, classify reads one parsed call into
// the kinds the table has rows for, and decide looks the cell up. d17Denial reads a Bash command and the repo's plain
// files to run all three. Hooks never call git, and neither does this. Node built-ins only.
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

import { configuresPushTarget, currentBranch, findRepo, protectedBranches, refsAreFiles } from "./git-files.mjs";
import { toolCalls } from "./shell-calls.mjs";

// ---------- the table ----------

const A = "allow";
const D = "deny";
const cell = (main, subagent) => ({ main, subagent });
// The same in a run and with a unit open.
const inRun = (outcome) => ({ run: outcome, unit: outcome });

// Rows are the kinds classify gives; columns are the run state (none, a run, a unit) and who calls.
export const D17_TABLE = {
  commit: { none: cell(A, A), ...inRun(cell(A, D)) },
  "commit-bypass": { none: cell(A, A), ...inRun(cell(D, D)) },
  push: { none: cell(A, A), ...inRun(cell(D, D)) },
  "push-protected": { none: cell(A, D), ...inRun(cell(D, D)) },
  "pr-write": { none: cell(A, A), ...inRun(cell(D, D)) },
  "pr-merge": { none: cell(A, D), ...inRun(cell(D, D)) },
  revert: { none: cell(A, D), ...inRun(cell(D, D)) },
  unreadable: { none: cell(A, D), ...inRun(cell(D, D)) },
  "branch-change": { none: cell(A, A), run: cell(A, A), unit: cell(D, D) },
  // A subagent during a run or unit: a git or gh call that is neither read-only nor a working-tree form the table allows.
  "outside-allowlist": { none: cell(A, A), ...inRun(cell(A, D)) },
};

const ROUTE = "Publishing goes through pb publish, which the main context runs.";

const REASONS = {
  commit: () => "Subagents do not commit during a run: the runner commits through pb checkpoint.",
  "commit-bypass": () => "A commit that skips hooks or signing (--no-verify, -n, --no-gpg-sign, or a -c setting that does) is denied during a run. The runner commits through pb checkpoint.",
  push: () => `git push is denied during a run. ${ROUTE}`,
  "push-protected": (runState) =>
    runState === "none"
      ? `A subagent never pushes to a protected branch, and never force-pushes, deletes, mirrors or pushes all refs, or pushes a target it cannot read. ${ROUTE}`
      : `git push is denied during a run. ${ROUTE}`,
  "pr-write": () => `gh pr create, edit, ready, revert and update-branch are denied during a run. ${ROUTE} An open pull request's title and body are refreshed with pb pr refresh.`,
  "pr-merge": (runState) => (runState === "none" ? `A subagent never merges a pull request. ${ROUTE}` : `gh pr merge is denied during a run. ${ROUTE}`),
  revert: (runState) =>
    runState === "none"
      ? "A subagent reverts nothing: reset --hard, clean, checkout ., restore . and branch -D are denied."
      : "Nothing reverts during a run: reset --hard, clean, checkout ., restore . and branch -D are denied.",
  unreadable: (runState) =>
    `A git or gh call whose words a shell builds ($, a backtick, a brace) cannot be checked, so it is denied ${runState === "none" ? "for a subagent" : "during a run"}.`,
  "branch-change": () =>
    "While a unit is open the branch stays where it is: creating, switching, renaming or checking out a branch is denied. Publish the unit's work with pb publish.",
  "outside-allowlist": () =>
    `A subagent during a run only reads: status, log, diff, show, listing forms of branch, tag, remote, stash and worktree, and read-only gh calls are allowed. Every other git or gh call is denied. ${ROUTE}`,
};

// ---------- reading words ----------

const CURRENT = Symbol("the current branch");
const UNREADABLE = Symbol("a target that cannot be read");

// A word the shell builds is empty here (a substitution) or holds $, a backtick or a brace.
const isBuilt = (word) => word === undefined || word === "" || /[$`{]/.test(word);
const isLongOption = (word, full, shortest) => word.length >= shortest && full.startsWith(word.split("=")[0]);
const hasShortOption = (tail, letters) => tail.some((word) => /^-[^-]/.test(word) && [...word.slice(1)].some((letter) => letters.includes(letter)));
const hasLongOption = (tail, ...names) => tail.some((word) => names.includes(word.split("=")[0]));

// Every pathspec that names the whole tree: `.`, `/`-rooted `:/`, `*`, a `:(top)` or `:/` magic over those, and `..` steps.
const WHOLE_TREE = new Set([".", "./", ":/", "*", "**"]);
function isWholeTree(word) {
  if (WHOLE_TREE.has(word) || /^(?:\.\.\/?)+$/.test(word)) return true;
  const afterMagic = word.startsWith(":(") ? word.slice(word.indexOf(")") + 1) : word.startsWith(":/") ? word.slice(2) : null;
  return afterMagic !== null && ["", "*", "**", ".", "./"].includes(afterMagic);
}

// git's options before the verb. -C and -c (and the long ones that take a word) take the next word unless it is glued on.
const GIT_GLOBAL_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);

// The variables a command sets in its own words (`V=x git ...`, `env V=x git ...`), as a Map.
function assignments(before) {
  const env = new Map();
  for (const word of before) {
    const match = /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(word);
    if (match !== null) env.set(match[1], match[2]);
  }
  return env;
}

// The config git reads from its environment: GIT_CONFIG_COUNT with KEY_n/VALUE_n pairs, and GIT_CONFIG_PARAMETERS. A key or
// value the command text does not give is built ("$"), and a key that is built makes the whole config unreadable.
function environmentConfigs(env) {
  const configs = [];
  let unreadable = false;
  const add = (key, value) => {
    if (key === undefined || isBuilt(key)) unreadable = true;
    configs.push(`${key === undefined || isBuilt(key) ? "$" : key}=${value === undefined ? "$" : value}`);
  };
  if (env.has("GIT_CONFIG_COUNT")) {
    const count = /^\d+$/.test(env.get("GIT_CONFIG_COUNT")) ? Number(env.get("GIT_CONFIG_COUNT")) : null;
    if (count === null) unreadable = true;
    for (let n = 0; n < (count ?? 0); n += 1) add(env.get(`GIT_CONFIG_KEY_${n}`), env.get(`GIT_CONFIG_VALUE_${n}`));
  }
  if (env.has("GIT_CONFIG_PARAMETERS")) {
    for (const [, key, value] of env.get("GIT_CONFIG_PARAMETERS").matchAll(/'([^']*)'(?:='([^']*)')?/g)) {
      if (value === undefined) configs.push(key);
      else add(key, value);
    }
  }
  return { configs, unreadable };
}

function gitGlobals(words, before = []) {
  const env = assignments(before);
  const fromEnvironment = environmentConfigs(env);
  const globals = { dirs: [], configs: [...fromEnvironment.configs], gitDir: env.get("GIT_DIR"), workTree: env.get("GIT_WORK_TREE"), unreadableConfig: fromEnvironment.unreadable };
  let i = 0;
  while (i < words.length && words[i].startsWith("-") && words[i] !== "-") {
    const word = words[i];
    const name = word.startsWith("--") ? word.split("=")[0] : word;
    if (!GIT_GLOBAL_VALUE.has(name)) {
      i += 1;
      continue;
    }
    const glued = word.startsWith("--") && word.includes("=");
    const value = glued ? word.slice(name.length + 1) : (words[i + 1] ?? "");
    i += glued ? 1 : 2;
    if (name === "-C") globals.dirs.push(value);
    if (name === "-c") globals.configs.push(value);
    if (name === "--git-dir") globals.gitDir = value;
    if (name === "--work-tree") globals.workTree = value;
    if (name === "--config-env") {
      const split = value.indexOf("=");
      const variable = split === -1 ? undefined : value.slice(split + 1);
      globals.configs.push(`${split === -1 ? value : value.slice(0, split)}=${env.get(variable) ?? "$"}`);
    }
  }
  return { globals, args: words.slice(i) };
}

// gh's words split into the group and subcommand (past any flags, -R/--repo and --hostname taking a word, wherever they
// stand before the subcommand) and the words after the subcommand. For `api` the subcommand slot holds the endpoint, so
// `after` is read from the group on.
function ghParts(words) {
  const positional = [];
  let i = 0;
  for (; i < words.length && positional.length < 2; i += 1) {
    const word = words[i];
    if (word.startsWith("-") && word !== "-") {
      if (["-R", "--repo", "--hostname"].includes(word)) i += 1;
    } else {
      positional.push(word);
    }
    if (positional[0] === "api") return { group: "api", sub: undefined, after: words.slice(i + 1) };
  }
  return { group: positional[0], sub: positional[1], after: words.slice(i) };
}

function aliasOf({ configs }, verb) {
  const config = configs.find((entry) => entry.toLowerCase().startsWith(`alias.${verb.toLowerCase()}=`));
  return config === undefined ? undefined : config.slice(config.indexOf("=") + 1);
}

// ---------- classifying a call ----------

function bypassesCommit(tail, { configs, unreadableConfig }) {
  const configured = unreadableConfig || configs.some((entry) => {
    const [key, ...value] = entry.split("=");
    if (key.toLowerCase() === "core.hookspath") return true;
    return key.toLowerCase() === "commit.gpgsign" && (isBuilt(value.join("=")) || /^(false|0|no|off)$/i.test(value.join("=")));
  });
  if (configured) return true;
  const valueLong = new Set(["--message", "--file", "--reuse-message", "--reedit-message", "--fixup", "--squash", "--author", "--date", "--template", "--cleanup", "--trailer", "--pathspec-from-file"]);
  for (let i = 0; i < tail.length; i += 1) {
    const word = tail[i];
    if (word === "--") return false;
    if (word.startsWith("--")) {
      if (isLongOption(word, "--no-verify", 6) || isLongOption(word, "--no-gpg-sign", 6)) return true;
      if (valueLong.has(word)) i += 1;
    } else if (word.startsWith("-") && word.length > 1) {
      for (let j = 1; j < word.length; j += 1) {
        const letter = word[j];
        if (letter === "n") return true;
        if ("mFCct".includes(letter)) {
          if (j === word.length - 1) i += 1;
          break;
        }
        if (letter === "S" || letter === "u") break;
      }
    }
  }
  return false;
}

// What a refspec writes to. git DWIMs a short destination, so `heads/main` and `refs/heads/main` both name main. A
// destination that is a pattern, or built, cannot be resolved and reads as unreadable.
function refspecTarget(refspec) {
  if (isBuilt(refspec)) return { target: UNREADABLE, broad: false };
  const forced = refspec.startsWith("+");
  const spec = forced ? refspec.slice(1) : refspec;
  const deletes = spec.startsWith(":");
  const destination = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
  if (destination === "" || /[*?[\\]/.test(destination)) return { target: UNREADABLE, broad: forced || deletes };
  const name = destination.replace(/^refs\/heads\//, "").replace(/^heads\//, "");
  return { target: name === "HEAD" || name === "@" ? CURRENT : name, broad: forced || deletes };
}

// True when a -c, --config-env or GIT_CONFIG setting chooses where a push goes, so the refspec list does not say.
function configuresPushTargetInline({ configs, unreadableConfig }) {
  return (
    unreadableConfig ||
    configs.some((entry) => {
      const key = entry.split("=")[0].toLowerCase();
      const value = entry.slice(entry.indexOf("=") + 1).toLowerCase();
      return /^remote\..*\.push$/.test(key) || (key === "push.default" && !["simple", "current"].includes(value));
    })
  );
}

function classifyPush(tail, { viaXargs, globals }) {
  let broad = false;
  let tags = false;
  let repoGiven = false;
  const positional = [];
  for (let i = 0; i < tail.length; i += 1) {
    const word = tail[i];
    if (word === "--") {
      positional.push(...tail.slice(i + 1));
      break;
    }
    if (word.startsWith("--")) {
      const name = word.split("=")[0];
      if (isLongOption(word, "--force", 6) || isLongOption(word, "--force-with-lease", 6) || isLongOption(word, "--force-if-includes", 6)) broad = true;
      else if (isLongOption(word, "--delete", 5) || isLongOption(word, "--mirror", 5) || isLongOption(word, "--prune", 5)) broad = true;
      else if (isLongOption(word, "--all", 5) || name === "--branches") broad = true;
      else if (isLongOption(word, "--tags", 5)) tags = true;
      else if (name === "--repo") repoGiven = true;
      if (!word.includes("=") && ["--repo", "--push-option", "--receive-pack", "--exec"].includes(name)) i += 1;
    } else if (word.startsWith("-") && word.length > 1) {
      for (let j = 1; j < word.length; j += 1) {
        if (word[j] === "f" || word[j] === "d") broad = true;
        if (word[j] === "o") {
          if (j === word.length - 1) i += 1;
          break;
        }
      }
    } else {
      positional.push(word);
    }
  }
  const refspecs = repoGiven ? positional : positional.slice(1);
  const parsed = refspecs.map(refspecTarget);
  const targets = parsed.map(({ target }) => target);
  if (parsed.some((entry) => entry.broad)) broad = true;
  if (positional.some(isBuilt) || viaXargs || configuresPushTargetInline(globals)) targets.push(UNREADABLE);
  if (refspecs.length === 0 && !tags && !broad) targets.push(CURRENT);
  return [{ kind: "push", broad, targets }];
}

const UNREADABLE_PUSH = [{ kind: "push", broad: false, targets: [UNREADABLE] }];

// Options of branch that take a value; the shapes classifyBranch and the read-only check both need.
function branchOptions(tail) {
  const short = new Set();
  const long = new Set();
  const positional = [];
  const valueLong = new Set(["--set-upstream-to", "--sort", "--format"]);
  const optionalValueLong = new Set(["--contains", "--no-contains", "--merged", "--no-merged", "--points-at"]);
  for (let i = 0; i < tail.length; i += 1) {
    const word = tail[i];
    if (word === "--") {
      positional.push(...tail.slice(i + 1));
      break;
    }
    if (word.startsWith("--")) {
      const name = word.split("=")[0];
      long.add(name);
      const next = tail[i + 1];
      if (!word.includes("=") && (valueLong.has(name) || (optionalValueLong.has(name) && next !== undefined && !next.startsWith("-")))) i += 1;
    } else if (word.startsWith("-") && word.length > 1) {
      for (let j = 1; j < word.length; j += 1) {
        short.add(word[j]);
        if (word[j] === "u") {
          if (j === word.length - 1) i += 1;
          break;
        }
      }
    } else {
      positional.push(word);
    }
  }
  return { short, long, positional };
}

function classifyBranch(tail) {
  const { short, long, positional } = branchOptions(tail);
  const deletes = short.has("d") || short.has("D") || long.has("--delete");
  if (deletes) return short.has("D") || short.has("f") || long.has("--force") ? [{ kind: "revert" }] : [];
  if (["m", "M", "c", "C"].some((letter) => short.has(letter)) || long.has("--move") || long.has("--copy")) return [{ kind: "branch-change" }];
  const listing = ["l", "a", "r", "v", "u", "i"].some((letter) => short.has(letter));
  const listLong = ["--list", "--show-current", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--set-upstream-to", "--unset-upstream", "--edit-description", "--sort", "--format"];
  if (listing || listLong.some((name) => long.has(name))) return [];
  return positional.length > 0 ? [{ kind: "branch-change" }] : [];
}

// True for the forms of branch that only list.
function branchLists(tail) {
  const { short, long, positional } = branchOptions(tail);
  const changes = ["d", "D", "m", "M", "c", "C", "u", "f", "t"].some((letter) => short.has(letter)) || ["--delete", "--move", "--copy", "--set-upstream-to", "--unset-upstream", "--edit-description", "--force", "--track", "--no-track", "--create-reflog"].some((name) => long.has(name));
  return !changes && (positional.length === 0 || short.has("l") || long.has("--list"));
}

function classifyCheckout(tail) {
  const kinds = [];
  const separator = tail.indexOf("--");
  const options = separator === -1 ? tail : tail.slice(0, separator);
  let forces = false;
  let creates = false;
  const positional = [];
  for (let i = 0; i < options.length; i += 1) {
    const word = options[i];
    if (word.startsWith("--") && word.length > 2) {
      if (word === "--force") forces = true;
      if (word === "--detach" || word === "--orphan") creates = true;
      if (word === "--orphan") i += 1;
    } else if (word.startsWith("-") && word.length > 1) {
      for (let j = 1; j < word.length; j += 1) {
        if (word[j] === "f") forces = true;
        if (word[j] === "d") creates = true;
        if (word[j] === "b" || word[j] === "B") {
          creates = true;
          if (j === word.length - 1) i += 1;
          break;
        }
      }
    } else {
      positional.push(word);
    }
  }
  if (forces || tail.some(isWholeTree)) kinds.push({ kind: "revert" });
  if (creates || (separator === -1 && positional.length > 0)) kinds.push({ kind: "branch-change" });
  return kinds;
}

function classifySwitch(tail) {
  const forces = tail.some((word) => word === "--force" || word === "--discard-changes" || (/^-[a-zA-Z]+$/.test(word) && /^-[^cC]*f/.test(word)));
  return [...(forces ? [{ kind: "revert" }] : []), { kind: "branch-change" }];
}

const operands = (tail, valueOptions = []) => {
  const found = [];
  for (let i = 0; i < tail.length; i += 1) {
    if (tail[i].startsWith("-") && tail[i] !== "-") i += valueOptions.includes(tail[i]) ? 1 : 0;
    else found.push(tail[i]);
  }
  return found;
};

// `symbolic-ref HEAD <ref>` moves HEAD to another branch.
function classifySymbolicRef(tail) {
  const [first, second] = operands(tail, ["-m"]);
  return first === "HEAD" && (second !== undefined || hasShortOption(tail, "d")) ? [{ kind: "branch-change" }] : [];
}

// `rebase <upstream> <branch>` checks <branch> out first; --root does the same with one operand.
function classifyRebase(tail) {
  const given = operands(tail, ["--onto", "-x", "--exec", "-s", "--strategy", "-X", "--strategy-option", "-C"]);
  return given.length >= 2 || (given.length >= 1 && hasLongOption(tail, "--root")) ? [{ kind: "branch-change" }] : [];
}

// `stash branch` creates and switches to a branch; `stash drop` and `stash clear` lose work the other worktrees share.
function classifyStash(tail) {
  const [sub] = operands(tail);
  if (sub === "branch") return [{ kind: "branch-change" }];
  return sub === "drop" || sub === "clear" ? [{ kind: "revert" }] : [];
}

// bisect checks commits out, so every step but the read-only ones moves HEAD.
function classifyBisect(tail) {
  const [sub] = operands(tail);
  return sub === undefined || ["log", "visualize", "view", "terms", "help"].includes(sub) ? [] : [{ kind: "branch-change" }];
}

const classifyCheckoutIndex = (tail) => (hasShortOption(tail, "fa") || hasLongOption(tail, "--force", "--all") ? [{ kind: "revert" }] : []);
const classifyReadTree = (tail) => (hasShortOption(tail, "u") || hasLongOption(tail, "--reset") ? [{ kind: "revert" }] : []);

// update-ref deletes a ref (a branch delete) or moves one (reset --hard, branch -f); --stdin hides which.
function classifyUpdateRef(tail) {
  const [ref] = operands(tail, ["-m"]);
  const moves = ref !== undefined && (isBuilt(ref) || ref === "HEAD" || ref.startsWith("refs/heads/"));
  return hasShortOption(tail, "d") || hasLongOption(tail, "--delete", "--stdin") || moves ? [{ kind: "revert" }] : [];
}

function classifyWorktree(tail) {
  if (tail[0] === "add") return [{ kind: "branch-change" }];
  return tail[0] === "remove" && (hasShortOption(tail, "f") || hasLongOption(tail, "--force")) ? [{ kind: "revert" }] : [];
}

const GIT_VERBS = {
  push: (tail, context) => classifyPush(tail, context),
  "send-pack": () => UNREADABLE_PUSH,
  "http-push": () => UNREADABLE_PUSH,
  subtree: (tail) => (tail[0] === "push" ? UNREADABLE_PUSH : []),
  commit: (tail, { globals }) => [...(bypassesCommit(tail, globals) ? [{ kind: "commit-bypass" }] : []), { kind: "commit" }],
  reset: (tail) => (tail.some((word) => isLongOption(word, "--hard", 4)) ? [{ kind: "revert" }] : []),
  clean: () => [{ kind: "revert" }],
  checkout: classifyCheckout,
  restore: (tail) => (tail.some(isWholeTree) ? [{ kind: "revert" }] : []),
  switch: classifySwitch,
  branch: classifyBranch,
  worktree: classifyWorktree,
  "symbolic-ref": classifySymbolicRef,
  rebase: classifyRebase,
  stash: classifyStash,
  bisect: classifyBisect,
  "checkout-index": classifyCheckoutIndex,
  "read-tree": classifyReadTree,
  "update-ref": classifyUpdateRef,
};

// The verb of a git call, past its global options and any inline alias, and the words after it.
function gitVerb(rest, before = []) {
  const { globals, args } = gitGlobals(rest, before);
  const [word, ...after] = args;
  if (word === undefined) return { globals, verb: undefined, tail: [] };
  const alias = isBuilt(word) ? undefined : aliasOf(globals, word);
  if (alias === undefined) return { globals, verb: word, tail: after };
  if (alias.startsWith("!")) return { globals, verb: "", tail: [] };
  const [verb, ...extra] = alias.split(/\s+/).filter(Boolean);
  return { globals, verb: verb ?? "", tail: [...extra, ...after] };
}

function classifyGit({ rest, before, atCommandWord }) {
  const { globals, verb, tail } = gitVerb(rest, before);
  const unreadable = globals.unreadableConfig && atCommandWord ? [{ kind: "unreadable" }] : [];
  if (verb === undefined) return unreadable;
  if (isBuilt(verb)) return atCommandWord ? [{ kind: "unreadable" }] : [];
  const viaXargs = before.some((word) => word.slice(word.lastIndexOf("/") + 1) === "xargs");
  return [...unreadable, ...(Object.hasOwn(GIT_VERBS, verb) ? GIT_VERBS[verb](tail, { globals, viaXargs }) : [])];
}

const GH_PR_WRITES = new Set(["create", "edit", "ready", "revert", "update-branch"]);

function classifyGh({ rest, atCommandWord }) {
  const { group, sub, after } = ghParts(rest);
  if (group === undefined) return [];
  if (isBuilt(group) || (group === "pr" && isBuilt(sub))) return atCommandWord ? [{ kind: "unreadable" }] : [];
  if (group === "release" && sub === "create") return UNREADABLE_PUSH;
  if (group === "repo" && sub === "sync") return hasLongOption(after, "--force") ? UNREADABLE_PUSH : [];
  if (group !== "pr") return [];
  if (GH_PR_WRITES.has(sub)) return [{ kind: "pr-write" }];
  if (sub === "merge") return [{ kind: "pr-merge" }];
  return sub === "checkout" || sub === "co" ? [{ kind: "branch-change" }] : [];
}

// ---------- the subagent allowlist ----------

const GIT_READ_ONLY = new Set([
  "status", "log", "diff", "show", "rev-parse", "ls-files", "ls-tree", "cat-file", "blame", "grep", "describe", "shortlog", "merge-base", "rev-list",
  "for-each-ref", "name-rev", "check-ignore", "var", "help", "version",
]);
// The working-tree forms the table allows a subagent during a run: kinds say which of them the table still denies.
const GIT_WORKING_TREE = new Set(["checkout", "restore", "switch"]);
const GIT_CONFIG_WRITES = ["--add", "--unset", "--unset-all", "--replace-all", "--edit", "--rename-section", "--remove-section"];
const TAG_CHANGES = ["d", "a", "s", "m", "f", "u", "F", "e"];
const TAG_LISTS = ["--list", "--contains", "--no-contains", "--points-at", "--merged", "--no-merged"];

function gitConfigReads(tail) {
  const reads = hasLongOption(tail, "--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list") || hasShortOption(tail, "l");
  return reads && !hasLongOption(tail, ...GIT_CONFIG_WRITES) && !hasShortOption(tail, "e");
}

function gitReadsOnly(verb, tail) {
  if (GIT_READ_ONLY.has(verb)) return true;
  const [first] = operands(tail);
  if (verb === "branch") return branchLists(tail);
  if (verb === "tag") return !hasShortOption(tail, TAG_CHANGES.join("")) && !hasLongOption(tail, "--delete", "--annotate", "--sign", "--force", "--message", "--file") && (first === undefined || hasShortOption(tail, "l") || hasLongOption(tail, ...TAG_LISTS));
  if (verb === "remote") return first === undefined || first === "show" || first === "get-url";
  if (verb === "stash") return first === "list" || first === "show";
  if (verb === "worktree") return first === "list";
  return verb === "config" && gitConfigReads(tail);
}

const GH_READ_ONLY = { pr: ["view", "list", "status", "checks", "diff"], issue: ["view", "list"], repo: ["view"], run: ["view", "list"] };

function ghApiReads(after) {
  if (hasShortOption(after, "fF") || hasLongOption(after, "--field", "--raw-field", "--input")) return false;
  const methods = [];
  after.forEach((word, i) => {
    if (word === "-X" || word === "--method") methods.push(after[i + 1]);
    else if (word.startsWith("--method=")) methods.push(word.slice("--method=".length));
    else if (word.startsWith("-X")) methods.push(word.slice(2));
  });
  return methods.every((method) => method?.toUpperCase() === "GET");
}

function ghReadsOnly({ group, sub, after }) {
  if (group === undefined || group === "help" || group === "version") return true;
  if (group === "api") return ghApiReads(after);
  return GH_READ_ONLY[group]?.includes(sub) ?? false;
}

// True when a subagent may make this call during a run: it reads, or it is a working-tree form the table lets through
// (checkout, restore and switch with a single file; creating a branch or a worktree), as kinds gave it.
function allowedForSubagent(call, kinds) {
  const onlyBranchChanges = kinds.length > 0 && kinds.every(({ kind }) => kind === "branch-change");
  if (call.name === "gh") return ghReadsOnly(ghParts(call.rest)) || onlyBranchChanges;
  const { verb, tail } = gitVerb(call.rest, call.before);
  if (verb === undefined || gitReadsOnly(verb, tail)) return true;
  if (GIT_WORKING_TREE.has(verb)) return true;
  if (verb === "branch") return onlyBranchChanges && !hasShortOption(tail, "mMcC") && !hasLongOption(tail, "--move", "--copy");
  return verb === "worktree" && onlyBranchChanges;
}

// Reads one call, as toolCalls found it, into the kinds the table has rows for; empty when it is not a table command. For
// a subagent during a run (strict) every call that is not on the allowlist also reads as outside it.
export function classify(call, { strict = false } = {}) {
  const kinds = call.name === "git" ? classifyGit(call) : classifyGh(call);
  if (!strict || allowedForSubagent(call, kinds)) return kinds;
  return [...kinds, { kind: "outside-allowlist" }];
}

// ---------- deciding ----------

const KNOWN_GIT = new Set([
  ...Object.keys(GIT_VERBS),
  ...GIT_READ_ONLY,
  ..."add am annotate apply archive bundle check-attr check-mailmap check-ref-format cherry cherry-pick citool clone column commit-graph commit-tree config count-objects credential diff-files diff-index diff-tree difftool fast-export fast-import fetch fetch-pack filter-branch fmt-merge-msg format-patch fsck gc gui hash-object index-pack init interpret-trailers ls-remote mailinfo mailsplit maintenance merge merge-file merge-index merge-tree mergetool mktag mktree mv notes pack-objects pack-redundant pack-refs patch-id prune prune-packed pull range-diff reflog remote repack replace request-pull rerere revert rm send-email show-branch show-index show-ref sparse-checkout stage submodule tag unpack-file unpack-objects update-index update-server-info verify-commit verify-pack verify-tag whatchanged write-tree".split(" "),
]);
const KNOWN_GH = new Set(["pr", "issue", "repo", "run", "api", "release", "workflow", "auth", "gist", "label", "project", "secret", "variable", "cache", "codespace", "ruleset", "extension", "alias", "config", "browse", "status", "search", "ssh-key", "gpg-key", "org", "help", "version"]);

// Whether the words after a git or gh found off the command word start a known verb.
function recognizes(name, rest) {
  if (name === "git") return KNOWN_GIT.has(gitVerb(rest).verb);
  return KNOWN_GH.has(ghParts(rest).group);
}

function isProtectedPush({ broad, targets }, protectedList, branch, { unknownTarget = false, configuredPush = false } = {}) {
  if (broad || unknownTarget) return true;
  const protectedNames = protectedList.map((name) => name.toLowerCase());
  const isProtected = (name) => protectedNames.includes(name.toLowerCase());
  return targets.some((target) => {
    if (target === UNREADABLE) return true;
    if (target === CURRENT) return configuredPush || branch === null || branch === undefined || isProtected(branch);
    return isProtected(target);
  });
}

// The first kind that the table denies for this cell, or null. branch is what HEAD names (null when unknown); only a push
// with no target of its own reads it, and a protected push is a different row only with no run and a subagent calling.
// unknownTarget says the repo could not be read at all (an unresolvable directory, reftable), configuredPush that its config
// picks the push target.
export function decide({ runState, context, invocation, protectedBranches: protectedList = ["main", "master"], currentBranch: branch = null, unknownTarget = false, configuredPush = false }) {
  for (const entry of invocation) {
    const kind = entry.kind === "push" && isProtectedPush(entry, protectedList, branch, { unknownTarget, configuredPush }) ? "push-protected" : entry.kind;
    if (D17_TABLE[kind][runState][context] === D) return { kind, reason: REASONS[kind](runState) };
  }
  return null;
}

// ---------- reading a command ----------

// A leading ~ or $HOME is the home directory; anything else is as written.
function expandHome(word) {
  const home = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/.exec(word);
  return home === null ? word : homedir() + word.slice(home[0].length);
}

// The directory a call runs in: where cwd, a `cd` and each -C lead, or null when a word is built or cannot be resolved.
function callDirectory({ name, cd, rest, before }, cwd) {
  const steps = [...(cd === undefined ? [] : [cd]), ...(name === "git" ? gitGlobals(rest, before).globals.dirs : [])];
  let dir = cwd;
  for (const step of steps) {
    const expanded = expandHome(step);
    if (isBuilt(expanded) || expanded.startsWith("~") || expanded === "-") return null;
    dir = resolve(dir, expanded);
  }
  return dir;
}

// --git-dir / --work-tree (or GIT_DIR / GIT_WORK_TREE) as the call gave them, or undefined.
function repoOverrides({ name, rest, before }) {
  if (name !== "git") return {};
  const { globals } = gitGlobals(rest, before);
  return { gitDir: globals.gitDir, workTree: globals.workTree };
}

// What the call's directory, --git-dir and --work-tree say about the repo, or null when a word cannot be read.
function callRepo(call, cwd) {
  const dir = callDirectory(call, cwd);
  if (dir === null) return null;
  const { gitDir, workTree } = repoOverrides(call);
  if (gitDir === undefined && workTree === undefined) return { dir, repo: findRepo(dir) };
  const given = [gitDir, workTree].map((word) => (word === undefined ? undefined : expandHome(word)));
  if (given.some((word) => word !== undefined && (isBuilt(word) || word.startsWith("~")))) return null;
  const [gitPath, workPath] = given.map((word) => (word === undefined ? undefined : resolve(dir, word)));
  if (gitPath === undefined) return { dir, repo: findRepo(workPath) };
  return { dir, repo: { top: workPath ?? (basename(gitPath) === ".git" ? dirname(gitPath) : dir), gitDir: gitPath } };
}

// What a push by a subagent with no run needs from the repo's files. A directory that cannot be resolved, or refs that are
// not plain files (reftable), mean the target is unknown, which reads as protected.
function branchFacts(call, cwd) {
  const found = callRepo(call, cwd);
  if (found === null) return { unknownTarget: true };
  const { repo } = found;
  if (repo === null) return {};
  if (!refsAreFiles(repo.gitDir)) return { unknownTarget: true };
  return { protectedBranches: protectedBranches(repo), currentBranch: currentBranch(repo.gitDir), configuredPush: configuresPushTarget(repo.gitDir) };
}

const looksLikePath = (word) => !word.startsWith("-") && !isBuilt(word) && (/^[./]/.test(word) || word.includes("/.."));

// A checkout or restore pathspec that resolves to the repo top reads as `.`, wherever the call stands and however it is spelled.
function withWholeTreePaths(call, cwd) {
  if (call.name !== "git" || !call.rest.some((word) => word === "checkout" || word === "restore") || !call.rest.some(looksLikePath)) return call;
  const found = callRepo(call, cwd);
  if (found === null || found.repo === null) return call;
  return { ...call, rest: call.rest.map((word) => (looksLikePath(word) && resolve(found.dir, expandHome(word)) === found.repo.top ? "." : word)) };
}

const needsFacts = (runState, context) => runState === "none" && context === "subagent";

// The reason to deny this Bash command, or null. runState is "none", "run" or "unit".
export function d17Denial({ command, cwd, runState, isSubagent }) {
  const context = isSubagent ? "subagent" : "main";
  const strict = isSubagent && runState !== "none";
  for (const found of toolCalls(command, ["git", "gh"], recognizes)) {
    const call = withWholeTreePaths(found, cwd);
    const invocation = classify(call, { strict });
    if (invocation.length === 0) continue;
    const facts = needsFacts(runState, context) && invocation.some(({ kind }) => kind === "push") ? branchFacts(call, cwd) : {};
    const verdict = decide({ runState, context, invocation, ...facts });
    if (verdict !== null) return verdict.reason;
  }
  return null;
}

// The directories git and gh calls in the command run in, for finding the runs they touch: each call's directory, its
// --git-dir and its --work-tree. A relative one is read from cwd.
export function commandDirectories(command, cwd) {
  return toolCalls(command, ["git", "gh"], recognizes).flatMap((call) => {
    const dir = callDirectory(call, cwd);
    if (dir === null) return [];
    const { gitDir, workTree } = repoOverrides(call);
    const extra = [gitDir, workTree].filter((word) => word !== undefined).map(expandHome).filter((word) => !isBuilt(word) && !word.startsWith("~"));
    return [dir, ...extra.map((word) => resolve(dir, word))];
  });
}
