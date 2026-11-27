// The draft's labels against the labels the repo has. gh refuses to open a PR with a label the repo does not have, and
// the approved draft cannot change between retries, so pb checks this at draft time (the lint) and before the push.
// Pure, with no imports, so the lint, the CLI and the views can share it.

// The repo's label names from `gh label list --json name` output, or null when the output says nothing usable (no gh,
// no GitHub remote, an empty answer): then the check is skipped, since an unknown list proves no label missing.
export function parseRepoLabels(text) {
  let rows;
  try {
    rows = JSON.parse(String(text ?? "").trim());
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const names = rows.map((row) => row?.name).filter((name) => typeof name === "string");
  return names.length === 0 ? null : names;
}

// How alike two label names are: the longer of the common prefix and the common suffix, case ignored.
function likeness(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let prefix = 0;
  while (prefix < x.length && x[prefix] === y[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < x.length && suffix < y.length && x[x.length - 1 - suffix] === y[y.length - 1 - suffix]) suffix += 1;
  return Math.max(prefix, suffix);
}

const CLOSEST = 3;

// The draft labels the repo does not have, each with up to three of the repo's closest names. Null repoLabels: none.
export function missingLabels(labels, repoLabels) {
  if (!Array.isArray(repoLabels)) return [];
  const have = new Set(repoLabels);
  return (labels ?? []).filter((label) => !have.has(label)).map((label) => ({
    label,
    closest: repoLabels
      .map((name) => ({ name, score: likeness(label, name) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, CLOSEST)
      .map(({ name }) => name),
  }));
}

// One missing label in words: the label and the repo's closest names.
export function missingLabelText({ label, closest }) {
  const near = closest.length === 0 ? "" : ` (closest in the repo: ${closest.join(", ")})`;
  return `the label ${label} does not exist in the repo${near}`;
}

// The lint's failures for the draft labels the repo does not have, one per label, with the remedy naming what to use.
export function labelFailures(labels, repoLabels) {
  return missingLabels(labels, repoLabels).map((missing) => ({
    rule: "label-exists",
    text: missing.label,
    message: `${missingLabelText(missing)}, and gh refuses to open a PR with it: use a label the repo has, or drop it.`,
    line: null,
  }));
}
