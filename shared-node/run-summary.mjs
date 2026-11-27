// One line for what a test run did, read from the counts a runner prints, so a stop's WHY never carries raw output.

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const NODE_COUNT = (name) => new RegExp(`^ℹ ${name} (\\d+)$`, "m");

// pytest's closing line, e.g. "1 failed, 2 passed in 0.12s", without its rule of = signs.
const PYTEST_SUMMARY = /^=*\s*((?:\d+ \w+(?:, )?)+) in [\d.]+s\s*=*$/m;

export function runSummary(output, exitCode) {
  const tests = NODE_COUNT("tests").exec(output);
  if (tests !== null) return `${plural(Number(tests[1]), "test")}, ${NODE_COUNT("pass").exec(output)?.[1] ?? 0} passed`;
  return PYTEST_SUMMARY.exec(output)?.[1] ?? `it exited ${exitCode}`;
}

// How many failing tests the line names before it counts the rest.
const NAMED_FAILURES = 3;
const PYTEST_FAILED = /^FAILED (\S+)/gm;
const NODE_FAILED = /^\s*(?:✖|not ok \d+ -) (.+?)(?: \([\d.]+m?s\))?$/gm;
const OUTPUT_MARK = ". Its output:\n";

// The failing tests a run's output names, pytest's FAILED lines or node --test's ✖ and not ok ones.
const failedNames = (output) => {
  const pytest = [...output.matchAll(PYTEST_FAILED)].map((match) => match[1]);
  return pytest.length > 0 ? pytest : [...new Set([...output.matchAll(NODE_FAILED)].map((match) => match[1]))];
};

function failuresLine(output) {
  const names = failedNames(output);
  if (names.length === 0) return runSummary(output, "non-zero");
  const more = names.length > NAMED_FAILURES ? `, and ${names.length - NAMED_FAILURES} more` : "";
  return `${names.length === 1 ? "1 test" : `${names.length} tests`} failed: ${names.slice(0, NAMED_FAILURES).join(", ")}${more}`;
}

// A refusal with every quoted run output replaced by one line, so a stop's WHY never carries raw output. A run's output
// runs from its mark to the last blank line before the next run's mark; the last run's, to the end. Escaped line breaks
// read as real ones, so none shows as \n.
export function refusalSummary(text) {
  const parts = String(text).replace(/\\n/g, "\n").split(OUTPUT_MARK);
  const lines = [parts[0]];
  parts.slice(1).forEach((part, i) => {
    const last = i === parts.length - 2;
    const cut = last ? part.length : part.lastIndexOf("\n\n");
    const end = cut === -1 ? part.length : cut;
    lines.push(`: ${failuresLine(part.slice(0, end))}${last ? "" : "; "}${part.slice(end)}`);
  });
  return lines.join("").replace(/\s+/g, " ").trim();
}
