// Ranks, caps and settles what the lenses returned. Pure, with no imports, so the bundler can inline it into a workflow
// and the stage report can run the same rules over the recorded returns.

// A finding with a rule is blocking; one without is demoted to low severity.
function tagFinding(lensName, finding, n) {
  const hasRule = String(finding.rule ?? '').trim() !== '';
  return { ...finding, id: `${lensName}-${n + 1}`, ...(hasRule ? { blocking: true } : { blocking: false, severity: 'low' }) };
}

const rowOf = (lensMap, stage) => lensMap.rows.find((candidate) => `code-${candidate.stage}` === stage);

// A stage's lens config from its row in lenses.json: the one shape lensAttack is given and the report reads, so both
// apply the same lenses, refute setting and caps. stage is the stage name, code-<row stage>. Task 76 wires the scenarios
// stage only, and one lens of its row, the first, so only that one can be missing from the report. The other stages have
// rows but no lens call yet, and get no lenses.
export function wiredLensConfig(lensMap, stage) {
  const row = rowOf(lensMap, stage);
  if (row === undefined) return { lenses: [] };
  const { refute, maxRefuters, maxFindingsPerLens } = row;
  return { lenses: row.lenses.slice(0, 1), refute, maxRefuters, maxFindingsPerLens };
}

// A verdict counts only for the finding it was sent for: the refuter returns the finding_id it believes it attacked, and a
// verdict naming another id is dropped, so that finding stays unrefuted. sentId is the id the workflow sent, which the
// refuter's key and label carry too. Returns the verdict, or null.
export function acceptVerdict(sentId, verdict) {
  return verdict !== null && verdict !== undefined && verdict.finding_id === sentId ? verdict : null;
}

const KIND_ORDER = ['fix-here', 'risk', 'drift'];
const SEVERITY_ORDER = ['high', 'medium', 'low'];
// A missing or unknown value sorts last. Array.prototype.sort is stable, so ties keep lens then finding order.
const rankIn = (field, order) => (finding) => {
  const at = order.indexOf(finding[field]);
  return at === -1 ? order.length : at;
};
const kindRank = rankIn('kind', KIND_ORDER);
const severityRank = rankIn('severity', SEVERITY_ORDER);
const byRank = (a, b) => kindRank(a) - kindRank(b) || severityRank(a) - severityRank(b);

const hasFindings = (result) => result !== null && result !== undefined && Array.isArray(result.findings);

// config: { refute, maxRefuters, maxFindingsPerLens }, as in wiredLensConfig. How many top-ranked findings get a refuter;
// null when the stage does not refute.
function refuterCountOf({ refute, maxRefuters }) {
  return refute === undefined || refute === 'none' ? null : maxRefuters;
}

// returns: one { lens: { name }, result } per configured lens, in lens order. A null or missing result means that lens is uncovered.
// Each lens's findings are tagged and ranked and cut to config.maxFindingsPerLens (no cap keeps all), then all are ranked
// together. The plan splits that list: sent is what goes to a refuter (the top maxRefuters, or everything when the stage
// does not refute), pastCut is the rest, which nobody attacks.
export function rankLensReturns(returns, config) {
  const refuterCount = refuterCountOf(config);
  const perLens = returns.map(({ lens, result }) => {
    const covered = hasFindings(result);
    const ranked = (covered ? result.findings.map((finding, n) => tagFinding(lens.name, finding, n)) : []).sort(byRank);
    const kept = config.maxFindingsPerLens === undefined ? ranked : ranked.slice(0, config.maxFindingsPerLens);
    return { lens: lens.name, covered, kept, dropped: ranked.length - kept.length };
  });
  const ranked = perLens.flatMap(({ kept }) => kept).sort(byRank);
  const cut = refuterCount === null ? ranked.length : refuterCount;
  return {
    refuting: refuterCount !== null,
    uncovered: perLens.filter(({ covered }) => !covered).map(({ lens }) => lens),
    trimmed: perLens.filter(({ dropped }) => dropped > 0).map(({ lens, dropped }) => ({ lens, dropped })),
    sent: ranked.slice(0, cut),
    pastCut: ranked.slice(cut),
  };
}

// verdicts: the verdicts acceptVerdict let through, one per finding at most. They count only when the plan refutes. A sent
// finding with a "refuted" verdict moves from survivors to refuted; a sent finding with no verdict is unrefuted, like every
// finding past the cut, and unrefuted findings never block.
// stopReason, attempts and lessons are neutral: lensAttack sets stopReason, and later tasks fill the rest.
export function settleLensRound({ refuting, uncovered, sent, pastCut }, verdicts = []) {
  const byId = new Map(refuting ? verdicts.map((verdict) => [verdict.finding_id, verdict]) : []);
  const answered = refuting ? sent.filter(({ id }) => byId.has(id)) : sent;
  const unanswered = refuting ? sent.filter(({ id }) => !byId.has(id)) : [];
  const isRefuted = ({ id }) => byId.get(id)?.verdict === 'refuted';
  return {
    uncovered,
    refuted: answered.filter(isRefuted),
    unrefuted: [...unanswered, ...pastCut].map((finding) => ({ ...finding, blocking: false })),
    attempts: 0,
    lessons: [],
    stopReason: null,
    survivors: answered.filter((finding) => !isRefuted(finding)),
  };
}

// The report's one call: rank, then settle over the verdicts the tap recorded.
export function mergeLensReturns(returns, config, verdicts = []) {
  return settleLensRound(rankLensReturns(returns, config), verdicts);
}
