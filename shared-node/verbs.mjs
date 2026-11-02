// The D5 verb table: every pb verb and the one caller class that owns it. Node built-ins only.
export const VERB_CLASSES = {
  runner: ["test", "checkpoint", "stage finish", "snapshot", "artifact check"],
  main: ["unit open", "run open", "stage report", "stage fail", "gate eval", "task end", "plan next", "publish", "status", "git doctor"],
  human: ["human approve", "human abandon", "human accept"],
};

const ALL_VERBS = Object.values(VERB_CLASSES).flat();

// The verb that the words after `pb` name, or undefined. Verbs are one word or two, and the rest are its arguments.
export function matchVerb(words) {
  return [words.slice(0, 2).join(" "), words[0]].find((verb) => ALL_VERBS.includes(verb));
}

export function classOf(verb) {
  return Object.keys(VERB_CLASSES).find((name) => VERB_CLASSES[name].includes(verb));
}
