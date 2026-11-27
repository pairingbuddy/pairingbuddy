// A change the session proposes to a config file a run protects (test-config.json, git-config.json). The session cannot
// edit those files during a run; it proposes the change with pb config propose, and only the human's typed
// pb human config apply writes it. Proposals live in .pairingbuddy/run/config-proposals.json. Node built-ins only.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PROPOSABLE = ["test-config.json", "git-config.json"];

export class ProposalRefused extends Error {}

export const proposalsPath = (root) => join(root, ".pairingbuddy", "run", "config-proposals.json");

export function readProposals(root) {
  const path = proposalsPath(root);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).proposals : [];
}

export function writeProposals(root, proposals) {
  const path = proposalsPath(root);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ proposals }, null, 2)}\n`);
  renameSync(temp, path);
}

// A value as typed: JSON when it parses (true, 3, null, ["a"]), else the text itself.
export function parsedValue(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The value at a dotted key, or undefined.
export const valueAt = (object, key) => key.split(".").reduce((node, part) => (node !== null && typeof node === "object" ? node[part] : undefined), object);

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

// A copy of the object with the dotted key set to value, creating objects on the way.
export function withValue(object, key, value) {
  const parts = key.split(".");
  if (parts.some((part) => part === "" || UNSAFE.has(part))) throw new ProposalRefused(`"${key}" is not a key pb can set`);
  const copy = structuredClone(object);
  let node = copy;
  for (const part of parts.slice(0, -1)) {
    if (node[part] === null || typeof node[part] !== "object" || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
  return copy;
}
