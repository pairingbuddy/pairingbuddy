// The D5 verb table: every pb verb and the one caller class that owns it, and the ! lines a human types.
// Node built-ins only.
import { fileURLToPath } from "node:url";

import { shellWord } from "./shell-word.mjs";

const CLI_PATH = fileURLToPath(new URL("../cli/pb.mjs", import.meta.url));

export const VERB_CLASSES = {
  runner: ["test", "checkpoint", "stage finish", "stage stop", "tdd state", "refactor state", "spike state", "spike write", "snapshot", "artifact check", "pr lint", "rollback"],
  main: ["unit open", "run open", "stage report", "stage fail", "gate eval", "task end", "plan next", "publish", "pr refresh", "status", "git doctor"],
  human: ["human approve", "human abandon", "human approve-config", "human accept"],
};

export { STAGE_STOP_REASONS, MISSING_ARTIFACT, COMMIT_PLAN_UNUSABLE, COMMIT_FAILED, NO_SELECTOR_TEMPLATE, HUMAN_STOPPED, ATTEMPT_CAP, STOP_CODES } from "./stop-codes.mjs";

const ALL_VERBS = Object.values(VERB_CLASSES).flat();

// The verb that the words after `pb` name, or undefined. Verbs are one word or two, and the rest are its arguments.
export function matchVerb(words) {
  return [words.slice(0, 2).join(" "), words[0]].find((verb) => ALL_VERBS.includes(verb));
}

export function classOf(verb) {
  return Object.keys(VERB_CLASSES).find((name) => VERB_CLASSES[name].includes(verb));
}

// The cd makes the line work from any cwd: a session can have left the run.
export const typedCommand = (root, words) => `!cd ${shellWord(root)} && node ${shellWord(CLI_PATH)} ${words}`;

// What a model runs: `pb` is on no PATH.
export const pbCommand = (words) => `node ${shellWord(CLI_PATH)} ${words}`;

export const humanCommand = (root, verb) => typedCommand(root, `human ${verb}`);

export const shaMismatchRemedy = (message, root) => `${message}. Check the edit, then type ${humanCommand(root, "accept")}`;
