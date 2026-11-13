// Stage labels: pb1 <stage> <phase> <role> <item> r<round>
// No imports, no Node APIs. Each export sits alone at the start of a line
// (`export function ...`) so a bundler can inline this file by stripping `export `.

function requireLabelToken(name, value) {
  if (typeof value !== "string" || value === "" || /\s/.test(value)) {
    throw new Error(`label ${name} must be a non-empty string without whitespace: ${JSON.stringify(value)}`);
  }
  return value;
}

function optionalLabelToken(name, value) {
  return value === null || value === undefined ? "-" : requireLabelToken(name, value);
}

export function buildLabel({ stage, phase, role, item, round }) {
  if (!Number.isInteger(round) || round < 1) {
    throw new Error(`label round must be a positive integer: ${JSON.stringify(round)}`);
  }
  return ["pb1", requireLabelToken("stage", stage), optionalLabelToken("phase", phase), requireLabelToken("role", role), optionalLabelToken("item", item), `r${round}`].join(" ");
}

export function parseLabel(text) {
  const match = /^pb1 (\S+) (\S+) (\S+) (\S+) r([1-9]\d*)$/.exec(String(text));
  if (!match) throw new Error(`malformed label: ${JSON.stringify(text)}`);
  const [, stage, phase, role, item, round] = match;
  return { stage, phase: phase === "-" ? null : phase, role, item: item === "-" ? null : item, round: Number(round) };
}
