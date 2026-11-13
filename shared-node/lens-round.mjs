// The review round the progress view shows: which lenses ran, what they found, what was fixed.
// No Node APIs.
import { parseKey, buildFindingId } from "./keys.mjs";
import { readLabel } from "./labels.mjs";
import { plainName } from "./plain-names.mjs";
import { MAX_FIX_UNDOS } from "./limits.mjs";
import { acceptVerdict } from "./lens-merge.mjs";
import { ATTEMPT_CAP } from "./stop-codes.mjs";
import { maxAgentsOf } from "./stage-graph.mjs";
import { TOKENS_UNIT } from "./spent-line.mjs";
import { plural } from "./glance.mjs";

// The plain name for an id, or the id with its dashes as spaces when there is none.
const shownName = (id) => plainName(id) ?? id.replaceAll("-", " ");

// The spawns whose label is known and names this stage, with their finished flag and start time.
function stageLabels(spawns, stage) {
  return spawns
    .map((spawn) => ({ ...readLabel(spawn.name), finished: Boolean(spawn.finished), startedAt: spawn.startedAt }))
    .filter((label) => label.stage === stage);
}

function roleSpawns(spawns, stage, role) {
  return stageLabels(spawns, stage).filter((label) => label.role === role);
}

// The parsed key, or null when the text is not a well-formed key.
function parsedKey(text) {
  try {
    return parseKey(text);
  } catch {
    return null;
  }
}

// The calls whose pb_key parses and names this role, stage and attempt; a malformed key is ignored.
function keyedCalls(calls, { role, stage, attempt }) {
  return calls
    .map((call) => ({ key: parsedKey(call?.input?.pb_key), input: call.input }))
    .filter(({ key }) => key?.role === role && key.stage === stage && key.attempt === attempt);
}

function lensReturns(calls, stage, attempt) {
  return keyedCalls(calls, { role: "lens", stage, attempt }).map(({ key, input }) => ({ key, findings: Array.isArray(input.findings) ? input.findings : null }));
}

// The break lines fold at when too long for the pane; every joined line and fit's split use it.
const PART_BREAK = " · ";

// The shown verdicts, named once: the key is the tally name in counts, the value is what the view shows.
const VERDICTS = { stands: "stands", knockedDown: "knocked-down", challenging: "challenging", unchallenged: "unchallenged" };

// The lens states, named once.
const LENS_STATES = { returned: "returned", running: "running", uncovered: "uncovered" };

const REFUTER_VERDICTS = { survives: VERDICTS.stands, refuted: VERDICTS.knockedDown };

// The shown verdict per finding id: challenging while a refuter is spawned, then stands or knocked-down
// from a refuter return whose finding_id matches its key item and whose verdict is known.
function refuterVerdicts({ calls, spawns, stage, attempt }) {
  const verdicts = new Map();
  for (const label of roleSpawns(spawns, stage, "refuter")) verdicts.set(label.item, VERDICTS.challenging);
  for (const { key, input } of keyedCalls(calls, { role: "refuter", stage, attempt })) {
    if (acceptVerdict(key.item, input) && Object.hasOwn(REFUTER_VERDICTS, input.verdict)) verdicts.set(key.item, REFUTER_VERDICTS[input.verdict]);
  }
  return verdicts;
}

function spawnState(label) {
  return { state: label.finished ? LENS_STATES.uncovered : LENS_STATES.running };
}

// The entries of one lens return that show as findings, each with its 1-based position in the array: objects
// only, and none at all when the return's item cannot form a finding id.
function findingEntries({ key, findings }) {
  try {
    buildFindingId({ lens: key.item, index: 1 });
  } catch {
    return [];
  }
  return (findings ?? []).map((finding, index) => ({ finding, index: index + 1 })).filter(({ finding }) => finding !== null && typeof finding === "object");
}

function returnState(one) {
  return one.findings ? { state: LENS_STATES.returned, found: findingEntries(one).length } : { state: LENS_STATES.uncovered };
}

// One lens return's findings, ids by position in its array.
function returnFindings(one, verdicts) {
  return findingEntries(one).map(({ finding, index }) => {
    const id = buildFindingId({ lens: one.key.item, index });
    return { id, lens: shownName(one.key.item), where: finding.where, claim: finding.claim, verdict: verdicts.get(id) ?? VERDICTS.unchallenged };
  });
}

function lensFindings(returned, verdicts) {
  return returned.flatMap((one) => returnFindings(one, verdicts));
}

function verdictCounts(findings) {
  const counts = { found: findings.length };
  for (const tally of Object.keys(VERDICTS)) {
    counts[tally] = findings.filter(({ verdict }) => verdict === VERDICTS[tally]).length;
  }
  return counts;
}

// The shown fix outcomes, named once.
const FIX_OUTCOMES = { undone: "undone", kept: "kept", undoing: "undoing", checking: "checking", fixing: "fixing" };

// What a course checker's verdict says about its fix: the outcome it leads to and the plain reason.
const CHECKER_VERDICTS = {
  better: { outcome: FIX_OUTCOMES.kept, why: "the check said it is better" },
  "wrong-direction": { outcome: FIX_OUTCOMES.undoing, why: "the check said it went the wrong way" },
  "broke-something": { outcome: FIX_OUTCOMES.undoing, why: "the check said it broke something" },
};

// The plain reason a rollback of each kind gives; a kind with none gives no reason.
const ROLLBACK_WHY = { red: "the tests went red", repeated: "it repeated an approach already undone" };

// The rollbacks whose key parses and names this stage; a malformed key is skipped.
function stageRollbacksOf(ledger, stage) {
  const rollbacks = Array.isArray(ledger.fixes?.rollbacks) ? ledger.fixes.rollbacks : [];
  return rollbacks
    .filter((rollback) => rollback != null)
    .map(({ key, kind }) => ({ key: parsedKey(key), kind }))
    .filter(({ key }) => key?.stage === stage);
}

// Why a rolled-back fix was undone: the rollback kind's own reason first; else the checker's reason, but only
// from an undoing verdict (a "better" verdict explains nothing about an undo); else none: "undone" is the outcome, not a reason.
function undoReason(rollback, verdict) {
  const checked = verdict && CHECKER_VERDICTS[verdict.input.verdict];
  const checkerWhy = checked?.outcome === FIX_OUTCOMES.undoing ? checked.why : undefined;
  return ROLLBACK_WHY[rollback.kind] ?? checkerWhy;
}

// The outcome (and plain reason, when a checker gave one) for one fix. A known course checker verdict
// decides it; else a returned fix with a later-round fix is kept; else checking once a checker is
// spawned for the same group and round; else fixing.
function fixOutcome({ item, round }, { checkerReturns, returnedFixes, checkers, ordered, rollbacks }) {
  const sameFix = (other) => other.item === item && other.round === round;
  const verdict = checkerReturns.find(({ key, input }) => sameFix(key) && Object.hasOwn(CHECKER_VERDICTS, input.verdict));
  const rollback = rollbacks.find(({ key }) => sameFix(key));
  if (rollback) return { outcome: FIX_OUTCOMES.undone, why: undoReason(rollback, verdict) };
  if (verdict) return CHECKER_VERDICTS[verdict.input.verdict];
  if (returnedFixes.some(sameFix) && ordered.some((other) => other.round > round)) return { outcome: FIX_OUTCOMES.kept };
  return { outcome: checkers.some(sameFix) ? FIX_OUTCOMES.checking : FIX_OUTCOMES.fixing };
}

// One fix per (group, round) seen from a fix spawn or a fix return, in round order.
function fixOutcomes({ calls, spawns, stage, attempt, stageRollbacks }) {
  const checkers = roleSpawns(spawns, stage, "course-checker");
  const checkerReturns = keyedCalls(calls, { role: "course-checker", stage, attempt });
  const returnedFixes = keyedCalls(calls, { role: "fix", stage, attempt }).map(({ key }) => key);
  const attemptRollbacks = stageRollbacks.filter(({ key }) => key.attempt === attempt);
  const seen = [...roleSpawns(spawns, stage, "fix"), ...returnedFixes, ...attemptRollbacks.map(({ key }) => key)];
  const fixes = new Map();
  for (const { item, round } of seen) fixes.set(`${item}\u0000${round}`, { item, round });
  const ordered = [...fixes.values()].sort((a, b) => a.round - b.round);
  const context = { checkerReturns, returnedFixes, checkers, ordered, rollbacks: attemptRollbacks };
  return ordered.map((fix) => ({ group: fix.item, round: fix.round, ...fixOutcome(fix, context) }));
}

// The items (spawns or calls) since the stage started, compared as instants; one with no time, or a time that does not parse, still counts.
const sinceStart = (items, timeOf, startedAt) =>
  items.filter((item) => {
    const [seen, started] = [Date.parse(timeOf(item)), Date.parse(startedAt)];
    return Number.isNaN(seen) || Number.isNaN(started) || seen >= started;
  });

function spendOf({ ledger, spawns, contract, stage, attempt }) {
  const stages = Array.isArray(ledger.stages) ? ledger.stages : [];
  const entry = stages.find((done) => done.name === stage && done.attempt === attempt);
  const tokens = entry?.spend?.tokensKnown && typeof entry.spend.tokens === "number" ? entry.spend.tokens : null;
  return { agents: stageLabels(spawns, stage).length, maxAgents: maxAgentsOf(contract, stage), tokens };
}

// The lenses seen from a spawn or a return, in first-seen order; a return overrides its spawn by lens item.
function lensStates(spawned, returned) {
  const lenses = new Map();
  for (const label of spawned) lenses.set(label.item, { name: shownName(label.item), ...spawnState(label) });
  for (const one of returned) lenses.set(one.key.item, { name: shownName(one.key.item), ...returnState(one) });
  return [...lenses.values()];
}

/**
 * @typedef {{ stage: string, lenses: { name: string, state: string, found?: number }[], findings: { id: string, lens: string, where?: string, claim?: string, verdict: string }[],
 *   counts: Record<string, number>, fixes: { group: string, round: number, outcome: string, why?: string }[], undone: number, cap: number, stopped: boolean,
 *   spend: { agents: number, maxAgents: number, tokens: number | null } }} LensRound
 */

/**
 * The round for a ledger; total over a partial one: undefined unless ledger.stage is an object with a string name.
 * A call is { agentId?, at?, input }; `at` is an ISO time.
 * @returns {LensRound | undefined}
 */
export function lensRound({ ledger, calls: allCalls = [], spawns: allSpawns = [], contract }) {
  const current = ledger?.stage;
  if (!current || typeof current.name !== "string") return undefined;
  const spawns = sinceStart(allSpawns, (spawn) => spawn.startedAt, current.startedAt);
  const calls = sinceStart(allCalls, (call) => call.at, current.startedAt);
  const stage = ledger.stage.name;
  const attempt = ledger.stage.attempt;
  const stopped = ledger.stop?.code === ATTEMPT_CAP;
  const spawned = roleSpawns(spawns, stage, "lens");
  const returned = lensReturns(calls, stage, attempt);
  if (!spawned.length && !returned.length && !stopped) return undefined;
  const sources = { calls, spawns, stage, attempt, stageRollbacks: stageRollbacksOf(ledger, stage) };
  const findings = lensFindings(returned, refuterVerdicts(sources));
  const spend = spendOf({ ledger, spawns, contract, stage, attempt });
  return {
    stage: shownName(stage),
    lenses: lensStates(spawned, returned),
    findings,
    counts: verdictCounts(findings),
    fixes: fixOutcomes(sources),
    undone: sources.stageRollbacks.length,
    cap: MAX_FIX_UNDOS,
    stopped,
    spend,
  };
}

const LENS_MARKS = { [LENS_STATES.returned]: "✓", [LENS_STATES.running]: "▸", [LENS_STATES.uncovered]: "✗" };

function lensSummary({ name, state, found }) {
  return `${LENS_MARKS[state]} ${name}${state === LENS_STATES.returned ? ` ${found}` : ""}`;
}

// The plain verdict wording, named once; the per-finding lines and the count line both use it.
const VERDICT_WORDS = {
  [VERDICTS.stands]: "stands",
  [VERDICTS.knockedDown]: "knocked down",
  [VERDICTS.challenging]: "being challenged",
  [VERDICTS.unchallenged]: "not challenged",
};

// The findings count line's parts: the tally word per count, left out when 0 (found always shows).
// Wording comes from VERDICT_WORDS; "standing" is the one tally word that differs from the per-finding "stands".
const COUNT_WORD_OVERRIDES = { stands: "standing" };
const COUNT_PARTS = Object.keys(VERDICTS).map((tally) => [tally, COUNT_WORD_OVERRIDES[tally] ?? VERDICT_WORDS[VERDICTS[tally]]]);

function findingsSummary(counts) {
  const parts = [`${counts.found} found`, ...COUNT_PARTS.filter(([tally]) => counts[tally] > 0).map(([tally, word]) => `${counts[tally]} ${word}`)];
  return `findings  ${parts.join(PART_BREAK)}`;
}

const FIX_WORDS = {
  [FIX_OUTCOMES.undone]: "undone",
  [FIX_OUTCOMES.kept]: "kept",
  [FIX_OUTCOMES.undoing]: "being undone",
  [FIX_OUTCOMES.checking]: "being checked",
  [FIX_OUTCOMES.fixing]: "fixing",
};

function fixLine({ outcome, why }, index) {
  return { text: `  fix ${index + 1}  ${FIX_WORDS[outcome]}${why ? `: ${why}` : ""}` };
}

const SHOWN_FIXES = 4;

// The last few fix lines, numbered by place in the whole list, behind a dim count of the earlier ones.
function foldedFixLines(fixes) {
  const hidden = Math.max(0, fixes.length - SHOWN_FIXES);
  const shown = fixes.map(fixLine).slice(hidden);
  return hidden ? [{ text: `  ${hidden} earlier`, tone: "dim" }, ...shown] : shown;
}

const SHOWN_FINDINGS = 3;

function findingLine({ verdict, where, claim }) {
  return { text: `  ${[VERDICT_WORDS[verdict], where, claim].filter(Boolean).join("  ")}` };
}

function findingLines(findings) {
  const lines = findings.slice(0, SHOWN_FINDINGS).map(findingLine);
  const more = findings.length - SHOWN_FINDINGS;
  return more > 0 ? [...lines, { text: `  + ${more} more`, tone: "dim" }] : lines;
}

const cut = (text, columns) => (text.length > columns ? `${text.slice(0, columns - 1)}…` : text);

// A line longer than columns folds at its PART_BREAK breaks onto indented continuation lines that each fit;
// a line with no break (or a part still too long) is cut to columns characters, the last being an ellipsis.
function fit({ text, ...rest }, columns) {
  if (!(columns > 0) || text.length <= columns) return [{ text, ...rest }];
  const rows = [];
  for (const part of text.split(PART_BREAK)) {
    const last = rows.length - 1;
    const joined = last >= 0 ? `${rows[last]}${PART_BREAK}${part}` : undefined;
    if (joined !== undefined && joined.length <= columns) rows[last] = joined;
    else rows.push(rows.length ? `  ${part}` : part);
  }
  return rows.map((row) => ({ text: cut(row, columns), ...rest }));
}

function spendLine({ agents, maxAgents, tokens }) {
  const tokenPart = tokens === null ? `${TOKENS_UNIT} unknown until this step ends` : `${tokens} ${TOKENS_UNIT}`;
  return { text: `${plural(agents, "agent")} of ${maxAgents}${PART_BREAK}${tokenPart}`, tone: "dim" };
}

// The plain pane lines for a round (the object lensRound returns), in order.
export function lensLines(round, columns = 0) {
  if (!round) return [];
  const lines = [{ text: `review round${PART_BREAK}${round.stage}` }];
  lines.push({ text: `lenses  ${round.lenses.map(lensSummary).join(PART_BREAK)}` });
  const uncovered = round.lenses.filter(({ state }) => state === LENS_STATES.uncovered);
  if (uncovered.length) lines.push({ text: `not covered: ${uncovered.map(({ name }) => name).join(", ")}`, tone: "warning" });
  if (round.counts.found > 0) lines.push({ text: findingsSummary(round.counts) }, ...findingLines(round.findings));
  if (round.fixes.length || round.undone > 0) {
    lines.push({ text: `fixes  ${round.fixes.length} tried${PART_BREAK}${round.undone} undone of ${round.cap} allowed` });
    lines.push(...foldedFixLines(round.fixes));
  }
  if (round.stopped) lines.push({ text: `stopped: ${plainName(ATTEMPT_CAP)}`, tone: "error" });
  lines.push(spendLine(round.spend));
  return lines.flatMap((line) => fit(line, columns));
}
