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
