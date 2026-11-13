// Stage keys: <stage>.<role>.<item>.r<round>.a<attempt>
// No imports, no Node APIs. Each export sits alone at the start of a line
// (`export function ...`) so a bundler can inline this file by stripping `export `.

const KEY_TOKEN = /^[a-z0-9_-]{1,64}$/;

function requireKeyToken(name, value) {
  if (typeof value !== "string" || !KEY_TOKEN.test(value)) {
    throw new Error(`key ${name} must be a non-empty string of at most 64 lowercase letters, digits, "-" or "_": ${JSON.stringify(value)}`);
  }
  return value;
}

function requireKeyPositiveInt(name, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`key ${name} must be a positive integer: ${JSON.stringify(value)}`);
  }
  return value;
}

export function buildKey({ stage, role, item, round, attempt }) {
  const itemText = item === null || item === undefined ? "-" : requireKeyToken("item", item);
  return [
    requireKeyToken("stage", stage),
    requireKeyToken("role", role),
    itemText,
    `r${requireKeyPositiveInt("round", round)}`,
    `a${requireKeyPositiveInt("attempt", attempt)}`,
  ].join(".");
}

export function parseKey(text) {
  const match = /^([a-z0-9_-]{1,64})\.([a-z0-9_-]{1,64})\.([a-z0-9_-]{1,64})\.r([1-9]\d*)\.a([1-9]\d*)$/.exec(String(text));
  if (!match) throw new Error(`malformed key: ${JSON.stringify(text)}`);
  const [, stage, role, item, round, attempt] = match;
  return { stage, role, item: item === "-" ? null : item, round: Number(round), attempt: Number(attempt) };
}
