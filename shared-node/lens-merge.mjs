// Merges what the lenses returned into one survivor list. Pure, with no imports, so the bundler can inline it into a
// workflow and the stage report can run the same rules over the recorded returns.

// A finding with a rule is blocking; one without is demoted to low severity.
function tagFinding(lensName, finding, n) {
  const hasRule = String(finding.rule ?? '').trim() !== '';
  return { ...finding, id: `${lensName}-${n + 1}`, ...(hasRule ? { blocking: true } : { blocking: false, severity: 'low' }) };
}

// The lenses a stage runs. Task 76 wires the scenarios stage only, and one lens of its row, the first, so only that one can
// be missing from the report. The other stages have rows but no lens call yet. stage is the stage name, code-<row stage>.
export function wiredLenses(lensMap, stage) {
  const row = lensMap.rows.find((candidate) => `code-${candidate.stage}` === stage);
  return row === undefined ? [] : row.lenses.slice(0, 1);
}

const hasFindings = (result) => result !== null && result !== undefined && Array.isArray(result.findings);

// returns: one { lens: { name }, result } per configured lens, in lens order. A null or missing result means that lens is uncovered.
export function mergeLensReturns(returns) {
  return {
    uncovered: returns.filter(({ result }) => !hasFindings(result)).map(({ lens }) => lens.name),
    // D8 names one return shape; these are neutral until the refute loop fills them.
    refuted: [],
    unrefuted: [],
    attempts: 0,
    lessons: [],
    stopReason: null,
    survivors: returns.flatMap(({ lens, result }) => (hasFindings(result) ? result.findings.map((finding, n) => tagFinding(lens.name, finding, n)) : [])),
  };
}
