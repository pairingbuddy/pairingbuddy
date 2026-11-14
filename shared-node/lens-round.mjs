// The review round the progress view shows: which lenses ran, what they found, what was fixed.
// No Node APIs.
import { parseKey, buildFindingId } from "./keys.mjs";
import { readLabel } from "./labels.mjs";
import { plainName } from "./plain-names.mjs";
import { MAX_FIX_UNDOS } from "./limits.mjs";
import { acceptVerdict, lensOfFinding } from "./lens-merge.mjs";
import { ATTEMPT_CAP } from "./stop-codes.mjs";
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
const VERDICTS = { stands: "stands", knockedDown: "knocked-down", challenging: "challenging", unchallenged: "unchallenged", fixed: "fixed", fixing: "fixing", fixUndone: "fix-undone" };

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
    const title = typeof finding.title === "string" && finding.title.trim() !== "" ? { title: finding.title.trim() } : {};
    return { id, lens: shownName(one.key.item), where: finding.where, ...title, claim: finding.claim, focus: finding.focus, verdict: verdicts.get(id) ?? VERDICTS.unchallenged };
  });
}

function lensFindings(returned, verdicts) {
  return returned.flatMap((one) => returnFindings(one, verdicts));
}

// The fix loop groups the upheld findings by lens, in finding order, as g1, g2, ...; so a fix group names the lens at its place.
function groupLenses(findings) {
  const upheld = findings.filter(({ verdict }) => verdict === VERDICTS.stands || verdict === VERDICTS.unchallenged);
  const lenses = [...new Set(upheld.map(lensOfFinding))];
  return new Map(lenses.map((lens, i) => [`g${i + 1}`, lens]));
}

// A finding still upheld whose lens a kept fix answered reads fixed; one whose lens's fix is under way reads fixing; one whose
// lens fix was only undone is to fix again. A fix names its lens by the check's finding, else by its group's place.
function answeredByFixes(findings, fixes) {
  const byGroup = groupLenses(findings);
  const lensOfFix = (fix) => fix.lens ?? byGroup.get(fix.group);
  const lensesOf = (outcomes) => new Set(fixes.filter((fix) => outcomes.includes(fix.outcome)).map(lensOfFix).filter((lens) => lens !== undefined));
  const inProgress = [FIX_OUTCOMES.fixing, FIX_OUTCOMES.checking, FIX_OUTCOMES.undoing];
  const [kept, fixing, undone] = [lensesOf([FIX_OUTCOMES.kept]), lensesOf(inProgress), lensesOf([FIX_OUTCOMES.undone])];
  const settled = (verdict) => verdict === VERDICTS.stands || verdict === VERDICTS.unchallenged;
  return findings.map((finding) => {
    const lens = lensOfFinding(finding);
    if (finding.verdict !== VERDICTS.knockedDown && kept.has(lens)) return { ...finding, verdict: VERDICTS.fixed };
    if (settled(finding.verdict) && fixing.has(lens)) return { ...finding, verdict: VERDICTS.fixing };
    return settled(finding.verdict) && undone.has(lens) ? { ...finding, verdict: VERDICTS.fixUndone } : finding;
  });
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
  // The lens the fix answered: a group is one lens's findings, and the check names one of them (as the gate reads it).
  const lens = typeof verdict?.input.finding_id === "string" ? { lens: lensOfFinding({ id: verdict.input.finding_id }) } : {};
  if (rollback) return { outcome: FIX_OUTCOMES.undone, why: undoReason(rollback, verdict), ...lens };
  if (verdict) return { ...CHECKER_VERDICTS[verdict.input.verdict], ...lens };
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

// The lenses seen from a spawn or a return, in first-seen order; a return overrides its spawn by lens item.
function lensStates(spawned, returned, nameOf) {
  const lenses = new Map();
  for (const label of spawned) lenses.set(label.item, { id: label.item, name: nameOf(label.item), ...spawnState(label) });
  for (const one of returned) lenses.set(one.key.item, { id: one.key.item, name: nameOf(one.key.item), ...returnState(one) });
  return [...lenses.values()];
}

const LIGHT_REVIEW = "light-review";

// A cycle's light review is a lens spawn that names a TDD phase; its item is the test, so only the latest test's review is
// the round, and its lens reads by the light review's plain name. Any other round shows every lens by its own name.
function reviewScope(spawned, returned) {
  const light = spawned.filter((label) => label.phase !== null);
  if (!light.length) return { spawned, returned, nameOf: shownName, light: null };
  const item = light.at(-1).item;
  return { spawned: spawned.filter((label) => label.item === item), returned: returned.filter(({ key }) => key.item === item), nameOf: () => plainName(LIGHT_REVIEW), light: { item } };
}

// The light review's test focuses go to the tests fixer, the rest to the code fixer (as code-tdd splits them).
const TEST_FOCUSES = ["test-quality", "test-level"];
const fixerOf = (finding) => (TEST_FOCUSES.includes(finding.focus) ? "refactor-tests" : "refactor-code");

// A light review finding reads fixing while its side's fixer runs on the test, and fixed once that fixer finished.
function answeredByFixers(findings, labels, item) {
  const fixers = (role) => labels.filter((label) => label.role === role && label.item === item);
  return findings.map((finding) => {
    if (finding.verdict !== VERDICTS.unchallenged && finding.verdict !== VERDICTS.stands) return finding;
    const runs = fixers(fixerOf(finding));
    if (!runs.length) return finding;
    return { ...finding, verdict: runs.some((run) => !run.finished) ? VERDICTS.fixing : VERDICTS.fixed };
  });
}

// A light review has ended once a later agent in the stage works on another test.
function movedOn(labels, item) {
  const last = labels.findLastIndex((label) => label.role === "lens" && label.item === item);
  return labels.slice(last + 1).some((label) => label.item !== item);
}

// What happens to a finding, in the words the per-finding lines and the summary both use, in the summary's order.
export const FINDING_WORDS = { fixed: "fixed", fixing: "fixing", toFix: "to fix", checking: "checking", leftAsIs: "left as is", notReal: "not a real problem" };

// A finding no refuter challenged is upheld, as one its refuter upheld is; one whose fix was undone is to fix again.
const VERDICT_WORDS = {
  [VERDICTS.stands]: FINDING_WORDS.toFix,
  [VERDICTS.knockedDown]: FINDING_WORDS.notReal,
  [VERDICTS.challenging]: FINDING_WORDS.checking,
  [VERDICTS.unchallenged]: FINDING_WORDS.toFix,
  [VERDICTS.fixed]: FINDING_WORDS.fixed,
  [VERDICTS.fixing]: FINDING_WORDS.fixing,
  [VERDICTS.fixUndone]: FINDING_WORDS.toFix,
};

// A finding still open once its round ended was left as is.
const OPEN_WORDS = [FINDING_WORDS.toFix, FINDING_WORDS.fixing, FINDING_WORDS.checking];
function findingWord(verdict, ended) {
  const word = VERDICT_WORDS[verdict];
  return ended && OPEN_WORDS.includes(word) ? FINDING_WORDS.leftAsIs : word;
}

/**
 * @typedef {{ stage: string, lenses: { name: string, state: string, found?: number }[], findings: { id: string, lens: string, where?: string, title?: string, claim?: string, verdict: string, word: string }[],
 *   counts: Record<string, number>, fixes: { group: string, round: number, outcome: string, why?: string, lens?: string }[], undone: number, cap: number, stopped: boolean }} LensRound
 */

/**
 * The round for a ledger; total over a partial one: undefined unless ledger.stage is an object with a string name.
 * A call is { agentId?, at?, input }; `at` is an ISO time. ended: the run is over, so the round is too, whatever its last ledger said.
 * @returns {LensRound | undefined}
 */
export function lensRound({ ledger, calls: allCalls = [], spawns: allSpawns = [], ended: runEnded = false }) {
  const current = ledger?.stage;
  if (!current || typeof current.name !== "string") return undefined;
  const spawns = sinceStart(allSpawns, (spawn) => spawn.startedAt, current.startedAt);
  const calls = sinceStart(allCalls, (call) => call.at, current.startedAt);
  const stage = ledger.stage.name;
  const attempt = ledger.stage.attempt;
  const stopped = ledger.stop?.code === ATTEMPT_CAP;
  const { spawned, returned, nameOf, light } = reviewScope(roleSpawns(spawns, stage, "lens"), lensReturns(calls, stage, attempt));
  if (!spawned.length && !returned.length && !stopped) return undefined;
  const sources = { calls, spawns, stage, attempt, stageRollbacks: stageRollbacksOf(ledger, stage) };
  const fixes = fixOutcomes(sources);
  const labels = stageLabels(spawns, stage);
  const ended = runEnded || current.status !== "active" || (light !== null && movedOn(labels, light.item));
  const answered = answeredByFixes(lensFindings(returned, refuterVerdicts(sources)), fixes);
  const findings = (light ? answeredByFixers(answered, labels, light.item) : answered).map((finding) => ({ ...finding, word: findingWord(finding.verdict, ended) }));
  return {
    stage: shownName(stage),
    lenses: lensStates(spawned, returned, nameOf),
    findings,
    counts: verdictCounts(findings),
    fixes,
    undone: sources.stageRollbacks.length,
    cap: MAX_FIX_UNDOS,
    stopped,
  };
}

// What the lens line says of the lenses in each state, in this order, so it needs no legend: the finding lines say what each found.
const LENS_WORDS = [
  [LENS_STATES.returned, "checked"],
  [LENS_STATES.running, "still looking at"],
  [LENS_STATES.uncovered, "could not check"],
];

// A cycle's quick review is one lens, so its line says how it went: "quick review done".
const LIGHT_WORDS = { [LENS_STATES.returned]: "done", [LENS_STATES.running]: "under way", [LENS_STATES.uncovered]: "could not be done" };

// The lens line's parts: one per state that has lenses, naming them, as "checked: the code, the tests".
function lensParts(lenses) {
  const quick = plainName(LIGHT_REVIEW);
  if (lenses.length === 1 && lenses[0].name === quick) return [`${quick} ${LIGHT_WORDS[lenses[0].state]}`];
  return LENS_WORDS.map(([state, words]) => [words, lenses.filter((lens) => lens.state === state).map(({ name }) => name)])
    .filter(([, names]) => names.length > 0)
    .map(([words, names]) => `${words}: ${names.join(", ")}`);
}

// The issues count line: how many were found, then how many read each word, each part left out when 0.
function findingsSummary(findings) {
  if (!findings.length) return "no issues found";
  const counted = Object.values(FINDING_WORDS).map((word) => [word, findings.filter((finding) => finding.word === word).length]);
  const parts = [`${plural(findings.length, "issue")} found`, ...counted.filter(([, count]) => count > 0).map(([word, count]) => `${count} ${word}`)];
  return parts.join(PART_BREAK);
}

const SHOWN_FINDINGS = 3;

// Run files are the run's own working files, not the user's code, so their folder is left out.
const RUN_FOLDER = ".pairingbuddy/run/";
const shownWhere = (where) => (typeof where === "string" && where.startsWith(RUN_FOLDER) ? where.slice(RUN_FOLDER.length) : where);

// The most a gist holds, as the lens's title does.
export const GIST_LENGTH = 60;

// Text cut to at most `room` characters at a word boundary, never with an ellipsis; a single word longer than the room is cut at the room.
export function cutAtWord(text, room) {
  if (!(room > 0) || [...text].length <= room) return text;
  const head = [...text].slice(0, room + 1).join("");
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : [...text].slice(0, room).join("")).trimEnd();
}

// The gist of a finding: its title, or for an older return with none, the claim's first sentence cut at a word boundary.
export function findingGist({ title, claim }) {
  if (typeof title === "string" && title.trim() !== "") return title.trim();
  if (typeof claim !== "string") return "";
  const first = claim.trim().split(/(?<=[.!?])\s+/)[0];
  return cutAtWord(first, GIST_LENGTH);
}

// One line per finding, never folded: what happens to it, the gist, then where. Too long for the columns, where gives way first,
// then the gist is cut at a word boundary; nothing is cut with an ellipsis.
function findingLine({ word, where, ...finding }, columns) {
  const gist = findingGist(finding);
  const full = `  ${[word, gist, shownWhere(where)].filter(Boolean).join(PART_BREAK)}`;
  if (!(columns > 0) || full.length <= columns) return { text: full, whole: true };
  const lead = `  ${word}${PART_BREAK}`;
  return { text: `${lead}${cutAtWord(gist, columns - lead.length)}`, whole: true };
}

export function findingLines(findings, columns) {
  const lines = findings.slice(0, SHOWN_FINDINGS).map((finding) => findingLine(finding, columns));
  const more = findings.length - SHOWN_FINDINGS;
  return more > 0 ? [...lines, { text: `  + ${more} more`, tone: "dim" }] : lines;
}

const cut = (text, columns) => (text.length > columns ? `${text.slice(0, columns - 1)}…` : text);

// The breaks a line folds at: PART_BREAK, and for the lens line also the comma between lens names.
const PART_FOLDS = /( · )/;
const LENS_FOLDS = /( · |, )/;

// A line longer than columns folds at its breaks (`at`, PART_BREAK by default) onto indented continuation lines that each fit;
// a whole line, a line with no break (or a part still too long) is cut to columns characters, the last being an ellipsis.
export function fit({ text, whole = false, at = PART_FOLDS, ...rest }, columns) {
  if (!(columns > 0) || text.length <= columns) return [{ text, ...rest }];
  if (whole) return [{ text: cut(text, columns), ...rest }];
  const rows = [];
  // Split with a capture, so the pieces alternate part, break, part: a joined row keeps the break it was split at.
  const pieces = text.split(at);
  for (let i = 0; i < pieces.length; i += 2) {
    const last = rows.length - 1;
    const joined = last >= 0 ? `${rows[last]}${pieces[i - 1]}${pieces[i]}` : undefined;
    if (joined !== undefined && joined.length <= columns) rows[last] = joined;
    else rows.push(rows.length ? `  ${pieces[i]}` : pieces[i]);
  }
  return rows.map((row) => ({ text: cut(row, columns), ...rest }));
}

// The plain lines of the REVIEW row for a round (the object lensRound returns), in order: the lenses with their finding
// counts, the summary, then one line per finding. No line carries a colour: colour marks only a phase, needs-you or a stop.
export function lensLines(round, columns = 0) {
  if (!round) return [];
  const lenses = round.lenses.length ? [{ text: lensParts(round.lenses).join(PART_BREAK), at: LENS_FOLDS }] : [];
  const lines = [...lenses, { text: findingsSummary(round.findings) }, ...findingLines(round.findings, columns)];
  return lines.flatMap((line) => fit(line, columns));
}
