// Turns the D17 table into one case per cell and command, and says which rule each deny must come from.
//
// A row with `also` cells or an array `command` is several checks. Each becomes a case of its own, so a failure names the
// cell and the command that failed and the others still run.

// The text of each D17 denial, one pattern per rule family. Written out here, not read from shared-node/d17.mjs, so a
// reworded or misrouted reason fails the table instead of following it.
export const FAMILIES = {
  commit: /^Subagents do not commit during a run/,
  bypass: /^A commit that skips hooks or signing/,
  push: /^git push is denied during a run/,
  "protected-push": /^A subagent never pushes to a protected branch/,
  "pr-write": /^gh pr create, edit, ready, revert and update-branch are denied during a run/,
  "pr-merge": /^(?:A subagent never merges a pull request|gh pr merge is denied during a run)/,
  revert: /^(?:A subagent reverts nothing|Nothing reverts during a run)/,
  unreadable: /^A git or gh call whose words a shell builds/,
  branch: /^While a unit is open the branch stays where it is/,
  allowlist: /^A subagent during a run only reads/,
};

// Denials that do not come from the D17 table: the hook's own fail-closed paths.
export const FALLBACKS = {
  "no-run-gate-error": /^Gate error with no run open/,
  "run-gate-error": /^Gate error during a run, so the call is denied/,
  "verb-class": /^pb [a-z -]+ belongs to /,
  drift: /^Platform drift: /,
};

const union = (names) => new RegExp(names.map((name) => (FAMILIES[name] ?? FALLBACKS[name]).source).join("|"));

// The setups the unit layer can give a repo made of plain files. Every other setup, and any path into the plugin, needs the
// real hook process.
export const UNIT_SETUPS = [
  "HEAD on main",
  "alias defined in git config, not inline",
  "repo config sets remote.origin.push to HEAD:main",
  "repo config sets push.default to upstream",
];
export const runsInUnitLayer = (row) => (row.setup === undefined || UNIT_SETUPS.includes(row.setup)) && ![row.command].flat().some((command) => command.includes("<plugin>"));

const oneLine = (command) => command.replace(/\n/g, " NL ");

// A rule is a family name, a list of names (either may deny), or an object by run state ({ none, run, unit, otherwise }) of
// those, for rows whose no-run denial reads differently from the run one.
function ruleOf(scenario, row, runState) {
  const rule = row.rule ?? scenario.rule;
  if (rule === undefined || typeof rule === "string" || Array.isArray(rule)) return rule;
  return rule[runState] ?? rule.otherwise;
}

// The patterns a deny's reason must match: the row's own message and the rule's family. A deny row names at least one of them,
// so a deny from another rule (the verb class, platform drift, a gate error) never passes as the intended one.
export function expectedReasons(scenario, row, runState) {
  const patterns = row.message ? [row.message] : [];
  const rule = ruleOf(scenario, row, runState);
  if (rule === undefined) {
    if (row.message) return patterns;
    throw new Error(`${row.id}: a deny row needs a rule or a message`);
  }
  const names = [rule].flat();
  const unknown = names.find((name) => FAMILIES[name] === undefined && FALLBACKS[name] === undefined);
  if (unknown !== undefined) throw new Error(`${row.id}: unknown rule "${unknown}"`);
  return [...patterns, union(names)];
}

export function expandRows(scenarios, keep = () => true) {
  const cases = [];
  for (const scenario of scenarios) {
    for (const row of scenario.rows.filter(keep)) {
      const cells = [{ runState: row.runState, context: row.context }, ...(row.also ?? [])];
      for (const cell of cells) {
        for (const command of [row.command].flat()) {
          const pinned = row.pin ? " (pin)" : "";
          const name = `${row.id} ${row.expect}${pinned} [${cell.runState}/${cell.context}]: ${oneLine(command)}`;
          const reasons = row.expect === "deny" ? expectedReasons(scenario, row, cell.runState) : [];
          cases.push({ name, scenario, row, cell, command, reasons });
        }
      }
    }
  }
  return cases;
}
