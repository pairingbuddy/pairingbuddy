// The D5 verb table: every pb verb and the one caller class that owns it, and the ! lines a human types.
// Node built-ins only.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { shellWord } from "./shell-word.mjs";

const CLI_PATH = fileURLToPath(new URL("../cli/pb.mjs", import.meta.url));

export const VERB_CLASSES = {
  runner: ["test", "checkpoint", "stage finish", "stage stop", "tdd state", "refactor state", "spike state", "spike write", "snapshot", "artifact check", "pr lint", "rollback"],
  main: ["unit open", "unit status", "run open", "stage report", "stage fail", "stage release", "gate eval", "task end", "spike setup", "plan next", "question settle", "question add", "guidance record", "publish", "pr refresh", "status", "git doctor"],
  human: ["human approve", "human abandon", "human approve-config", "human accept", "human adopt", "human answer", "human reopen"],
};

export { STAGE_STOP_REASONS, MISSING_ARTIFACT, COMMIT_PLAN_UNUSABLE, COMMIT_FAILED, NO_SELECTOR_TEMPLATE, HUMAN_STOPPED, ATTEMPT_CAP, GATE_OFF, STOP_CODES } from "./stop-codes.mjs";

const ALL_VERBS = Object.values(VERB_CLASSES).flat();

// The verb that the words after `pb` name, or undefined. Verbs are one word or two, and the rest are its arguments.
export function matchVerb(words) {
  return [words.slice(0, 2).join(" "), words[0]].find((verb) => ALL_VERBS.includes(verb));
}

export function classOf(verb) {
  return Object.keys(VERB_CLASSES).find((name) => VERB_CLASSES[name].includes(verb));
}

// The project's own pb: a shim at <root>/.pairingbuddy/bin/pb that runs this plugin's CLI from the root, so the line a human
// types is short (a line holding the root's and the plugin's absolute paths broke on paste). Its folder ignores itself, as
// run/ does, so the shim never shows as untracked, and it sits outside run/, whose every entry is run state.
export const SHIM_DIR = join(".pairingbuddy", "bin");
export const SHIM = join(SHIM_DIR, "pb");
const shimText = () => `#!/bin/sh
# Pairing Buddy's pb for this project, written by pb so the line a human types stays short. pb rewrites it.
cd "$(dirname "$0")/../.." || exit 1
exec node ${shellWord(CLI_PATH)} "$@"
`;

const shimPath = (root) => join(root, SHIM);
const holdsShim = (root) => {
  try {
    return readFileSync(shimPath(root), "utf8") === shimText();
  } catch {
    return false;
  }
};

// Writes the shim unless it already holds this plugin's line; pb run open calls it. Never throws: a failed write leaves the
// long line to stand in.
export function ensureShim(root) {
  if (holdsShim(root)) return;
  try {
    mkdirSync(join(root, SHIM_DIR), { recursive: true });
    writeFileSync(join(root, SHIM_DIR, ".gitignore"), "*\n");
    const temp = `${shimPath(root)}.${process.pid}.tmp`;
    writeFileSync(temp, shimText(), { mode: 0o755 });
    chmodSync(temp, 0o755);
    renameSync(temp, shimPath(root));
  } catch {
    // The long line stands in.
  }
}

// What a human types at the Claude prompt, which runs it from the project root: the shim when it runs this plugin's CLI,
// else the long line, whose cd makes it work from any cwd. Reads only, so a dry run that names a line writes nothing.
export const typedCommand = (root, words) => (holdsShim(root) ? `!${SHIM} ${words}` : `!cd ${shellWord(root)} && node ${shellWord(CLI_PATH)} ${words}`);

// What a model runs: `pb` is on no PATH.
export const pbCommand = (words) => `node ${shellWord(CLI_PATH)} ${words}`;

export const humanCommand = (root, verb) => typedCommand(root, `human ${verb}`);

export const shaMismatchRemedy = (message, root) => `${message}. Check the edit, then type ${humanCommand(root, "accept")}`;
