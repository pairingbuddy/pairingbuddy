// What a stage attempt leaves behind: its returns, whether its evidence is complete, its report and its spend.
// A model wrote the returns, so a return counts only under its own key at its own attempt. Node built-ins only.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { lensSlug } from "./keys.mjs";
import { acceptVerdict, mergeLensReturns, wiredLensConfig } from "./lens-merge.mjs";
import { evidenceFor, maxAgentsOf, returnFileKey } from "./stages.mjs";
import { TestRunRefused, testRows } from "./test-run.mjs";

const REPORT_LISTS = ["survivors", "refuted", "gaps", "uncovered", "unrefuted"];
const TOKENS_UNIT = "output tokens";

export const SPEND_LABEL = `tokens are ${TOKENS_UNIT} from budget.spent(), and unknown while tokensKnown is false, so a 0 there is no measurement. agents counts recorded returns.`;

// ---------- returns ----------

function stageReturns(artifactsDir, name) {
  return readdirSync(artifactsDir)
    .filter((file) => file.endsWith(".json") && !file.startsWith("."))
    .map((file) => ({ pbKey: file.slice(0, -".json".length), ...returnFileKey(file) }))
    .filter(({ stage }) => stage === name)
    .sort((a, b) => a.pbKey.localeCompare(b.pbKey));
}

export const returnsAt = (artifactsDir, { name, attempt }) => stageReturns(artifactsDir, name).filter((key) => key.attempt === attempt);

// The return filed under this key, or null when it cannot be read or names another key.
export function readReturn(artifactsDir, pbKey) {
  try {
    const artifact = JSON.parse(readFileSync(join(artifactsDir, `${pbKey}.json`), "utf8"));
    return artifact?.pb_key === pbKey ? artifact : null;
  } catch {
    return null;
  }
}

// The newest return of a role under any key with no item, or null. keep decides which attempts count.
export function newestReturn(artifactsDir, role, keep = () => true) {
  const found = readdirSync(artifactsDir)
    .filter((file) => file.endsWith(".json") && !file.startsWith("."))
    .map((file) => ({ pbKey: file.slice(0, -".json".length), ...returnFileKey(file) }))
    .filter((key) => key.role === role && key.item === null && keep(key))
    .sort((a, b) => b.attempt - a.attempt || b.round - a.round);
  return found[0]?.pbKey ?? null;
}

// ---------- evidence ----------

function artifactProblem(role, { artifactsDir, ledger: { stage } }) {
  const returns = stageReturns(artifactsDir, stage.name).filter((key) => key.role === role);
  const current = returns.filter(({ attempt }) => attempt === stage.attempt);
  if (current.length === 0) {
    const others = [...new Set(returns.map(({ attempt }) => attempt))];
    return `artifact:${role} has no return at attempt ${stage.attempt}${others.length > 0 ? `, only at attempt ${others.join(", ")}` : ""}`;
  }
  const unreadable = current.find(({ pbKey }) => readReturn(artifactsDir, pbKey) === null);
  return unreadable === undefined ? null : `artifact:${role} return ${unreadable.pbKey} cannot be read`;
}

const attemptCheckpoints = ({ checkpoints = [], stage }) => checkpoints.filter((record) => record.stage === stage.name && record.attempt === stage.attempt);

function checkpointProblem(step, { ledger }) {
  const found = attemptCheckpoints(ledger).some((record) => record.step === step);
  return found ? null : `checkpoint:${step} has no checkpoint at attempt ${ledger.stage.attempt}`;
}

const isAttemptRecord = (record, { name, attempt }) => record?.stage === name && record?.attempt === attempt;

// A green run proves the commit it ran on, so a commit after it undoes the proof.
function testsProblem(name, { ledger: { tests, stage }, head }) {
  const record = Object.hasOwn(tests, name) ? tests[name] : undefined;
  if (!isAttemptRecord(record, stage)) return `tests:${name} has no run at attempt ${stage.attempt}`;
  if (!record.passed) return `tests:${name} failed at attempt ${stage.attempt}`;
  return record.head === head ? null : `tests:${name} ran at ${record.head ?? "an unknown HEAD"}, and HEAD is now ${head}`;
}

export const perTestOf = ({ tests: { perTest = {} } }, id) => (Object.hasOwn(perTest, id) ? perTest[id] : {});

// Every row of this attempt must stand through both steps, at whichever attempt each got there.
function cycleProblem({ ledger, artifactsDir, config }) {
  let rows;
  try {
    rows = testRows(config(), artifactsDir, ledger.stage);
  } catch (e) {
    if (e instanceof TestRunRefused) return `tests:cycle cannot read the tests: ${e.message}`;
    throw e;
  }
  const isClosed = ({ red, green, covered }) => covered?.done || (red?.done && green?.done);
  const open = rows.map(({ test_id: id }) => id).filter((id) => !isClosed(perTestOf(ledger, id)));
  return open.length === 0 ? null : `tests:cycle has no RED and GREEN, and no covered pass, for ${open.join(", ")}`;
}

const testsEvidence = (name, context) => (name === "cycle" ? cycleProblem(context) : testsProblem(name, context));

const PROBLEMS = { artifact: artifactProblem, checkpoint: checkpointProblem, tests: testsEvidence };

function evidenceProblem(entry, context) {
  const [kind, name] = entry.split(":");
  return PROBLEMS[kind](name, context);
}

// Everything standing between this attempt and done, so one refusal names it all.
export function finishProblems(contract, ledger, artifactsDir, head, config) {
  const context = { ledger, artifactsDir, head, config };
  const evidence = evidenceFor(contract, ledger.taskType, ledger.stage.name).map((entry) => evidenceProblem(entry, context));
  return [ledger.stage.runId === null ? "the stage has no recorded run" : null, ...evidence].filter((problem) => problem !== null);
}

// ---------- spend ----------

// Tokens stay 0 and unknown until a stage can hand over budget.spent(): stage finish takes no input from a model.
const addAgents = ({ agents, tokens }, count) => ({ agents: agents + count, tokens, tokensKnown: false });

const NO_SPEND = { agents: 0, tokens: 0 };

const stageEntry = ({ stages, stage }) => stages.find(({ name }) => name === stage.name);

// Closes the active attempt as done or failed. Spend is what happened, so a failed attempt's counts too.
export function closeStage(ledger, status, agents, notes = {}) {
  const { name, attempt } = ledger.stage;
  const entry = stageEntry(ledger);
  const closed = { ...entry, ...notes, name, status, attempt, startedAt: entry?.startedAt ?? ledger.stage.startedAt, spend: addAgents(entry?.spend ?? NO_SPEND, agents) };
  const stages = entry === undefined ? [...ledger.stages, closed] : ledger.stages.map((stage) => (stage === entry ? closed : stage));
  return { ...ledger, stage: { ...ledger.stage, status }, stages, spend: addAgents(ledger.spend, agents) };
}

const spendFigures = ({ agents, tokens, tokensKnown }, more) => ({ agents: agents + more, tokens, tokensKnown: tokensKnown === true });

// The stage and task totals, with an active stage's returns so far, which no closed attempt has counted yet.
export function spendTotals(ledger, artifactsDir, contract) {
  const live = ledger.stage.status === "active" ? returnsAt(artifactsDir, ledger.stage).length : 0;
  return {
    maxAgents: maxAgentsOf(contract, ledger.stage.name),
    label: SPEND_LABEL,
    stage: { name: ledger.stage.name, ...spendFigures(stageEntry(ledger)?.spend ?? NO_SPEND, live) },
    task: spendFigures(ledger.spend, live),
  };
}

// ---------- the report ----------

const attemptTests = ({ tests, stage }) => Object.entries(tests).filter(([, record]) => isAttemptRecord(record, stage)).map(([key, record]) => ({ key, ...record }));

// Exit codes cannot prove a test failed for the right reason, so the report shows why each one failed (D5). It covers
// every test, at the attempt that proved it, because a re-run proves only what is left.
function redEvidence({ tests: { perTest = {} }, stage: { name } }) {
  return Object.entries(perTest)
    .filter(([, { red }]) => red?.done && red.stage === name)
    .map(([test_id, { red: { attempt, exitCodes, excerpt } }]) => ({ test_id, attempt, exitCodes, excerpt }));
}

// A test that passed at RED after an earlier GREEN, kept with its GREEN skipped: the human should know it never failed.
function coveredEvidence({ tests: { perTest = {} }, stage: { name } }) {
  return Object.entries(perTest)
    .filter(([, { covered }]) => covered?.done && covered.stage === name)
    .map(([test_id, { covered: { attempt, exitCodes, excerpt, after } }]) => ({ test_id, attempt, exitCodes, excerpt, after }));
}

// Every test of the task that an earlier GREEN covered, for pb status.
export const coveredTests = ({ tests: { perTest = {} } }) =>
  Object.entries(perTest).filter(([, { covered }]) => covered?.done).map(([test_id, { covered: { after, sha } }]) => ({ test_id, after, sha }));

function notCovered({ uncovered, gaps }, testRuns, returns, red, lensRan) {
  const anyLensRan = lensRan || returns.some((artifact) => REPORT_LISTS.some((key) => artifact[key] !== undefined));
  return [
    ...uncovered,
    ...gaps,
    ...(testRuns.some(({ key }) => key === "full") ? [] : ["the full suite did not run in this stage"]),
    ...(anyLensRan ? [] : ["no lens round ran in this stage"]),
    ...(testRuns.length > 0 || red.length > 0 ? ["exit codes show that tests passed or failed, not why: read the excerpts"] : []),
    `${TOKENS_UNIT} are unknown: this stage supplied no budget.spent() figure`,
  ];
}

const COVERAGE_ROLE = "verify-test-coverage";
const LENS_ROLE = "lens";
const REFUTER_ROLE = "refuter";

// Read once per process: which lenses a stage runs comes from the same map and wiredLensConfig rule the workflow uses.
const LENS_MAP = JSON.parse(readFileSync(new URL("../contracts/lenses.json", import.meta.url), "utf8"));

// The same merge the workflow runs, over what the tap recorded: a lens with no recorded return is uncovered. A return counts
// for the lens its key names (the tap only files a lens key from a lens agent, and each call's schema pins its own key, so
// a lens agent cannot file under another lens's name through the runtime). Of the rounds recorded for one lens the latest
// speaks, and a return for a lens the stage does not wire is ignored.
// The run dir holds the artifacts dir's parent: run/task/artifacts -> run.
const runDirOf = (artifactsDir) => dirname(dirname(artifactsDir));

// The corpus the stage used, as pb snapshot writes it into the run dir. Absent leaves the config without one; one that is
// not a list of path strings is refused, since an empty corpus would hide a lens that needs one.
function corpusPaths(artifactsDir) {
  const file = join(runDirOf(artifactsDir), "corpus.json");
  if (!existsSync(file)) return undefined;
  let paths;
  try {
    paths = JSON.parse(readFileSync(file, "utf8"))?.paths;
  } catch (e) {
    throw new Error(`${file} is unreadable: ${e.message}`);
  }
  if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) throw new Error(`${file} must hold {"paths": [strings]}`);
  return paths;
}

function mergedLensRound(current, artifactsDir, stageName, lensMap) {
  const recorded = current.filter(({ role }) => role === LENS_ROLE);
  const config = { ...wiredLensConfig(lensMap, stageName), corpus: corpusPaths(artifactsDir) };
  const returns = config.lenses.map((lens) => {
    const [latest] = recorded.filter(({ item }) => item === lensSlug(lens.name)).sort((a, b) => b.round - a.round);
    return { lens, result: latest === undefined ? null : readReturn(artifactsDir, latest.pbKey) };
  });
  // A verdict counts for the finding its refuter was sent, which its key names as the item. Of the rounds recorded for one
  // finding the latest speaks, even when it is dropped; mergeLensReturns ignores verdicts when the stage does not refute.
  const latestVerdicts = new Map(current.filter(({ role }) => role === REFUTER_ROLE).sort((a, b) => a.round - b.round)
    .map(({ item, pbKey }) => [item, acceptVerdict(item, readReturn(artifactsDir, pbKey))]));
  const verdicts = [...latestVerdicts.values()].filter((verdict) => verdict !== null);
  return { merged: mergeLensReturns(returns, config, verdicts), lensRan: recorded.length > 0 };
}

// Each coverage round returns the gaps it still sees, so the newest round of the attempt speaks for the stage.
function coverageGaps(current, returns) {
  const rounds = current.map((key, i) => ({ ...key, artifact: returns[i] })).filter(({ role, item }) => role === COVERAGE_ROLE && item === null);
  const newest = rounds.sort((a, b) => b.round - a.round)[0];
  return Array.isArray(newest?.artifact.gaps) ? newest.artifact.gaps : [];
}

// Built from what was recorded, never from a model's summary of it. A coverage check is no lens round, so its gaps join
// the lists apart from the lens returns.
// lensMap is a test seam: production passes none and gets contracts/lenses.json.
export function buildReport(ledger, artifactsDir, lensMap = LENS_MAP) {
  const { name, attempt, runId } = ledger.stage;
  const current = returnsAt(artifactsDir, ledger.stage);
  const returns = current.map(({ pbKey }) => readReturn(artifactsDir, pbKey) ?? {});
  const lensReturns = returns.filter((_, i) => ![COVERAGE_ROLE, LENS_ROLE, REFUTER_ROLE].includes(current[i].role));
  const found = Object.fromEntries(REPORT_LISTS.map((key) => [key, lensReturns.flatMap((artifact) => artifact[key] ?? [])]));
  const { merged, lensRan } = mergedLensRound(current, artifactsDir, name, lensMap);
  const lists = {
    ...found,
    survivors: [...found.survivors, ...merged.survivors],
    refuted: [...found.refuted, ...merged.refuted],
    unrefuted: [...found.unrefuted, ...merged.unrefuted],
    uncovered: [...found.uncovered, ...merged.uncovered],
    gaps: [...found.gaps, ...coverageGaps(current, returns)],
  };
  const tests = attemptTests(ledger);
  const red = redEvidence(ledger);
  const ambiguities = current.map(({ pbKey }, i) => ({ key: pbKey, ambiguity: returns[i].ambiguity ?? "" })).filter(({ ambiguity }) => ambiguity !== "");
  return {
    stage: name,
    attempt,
    runId,
    ran: {
      returns: current.map(({ pbKey }) => pbKey),
      tests,
      checkpoints: attemptCheckpoints(ledger),
      voided: stageReturns(artifactsDir, name).filter((key) => key.attempt < attempt).map(({ pbKey }) => pbKey),
    },
    ...lists,
    ambiguities,
    redEvidence: red,
    covered: coveredEvidence(ledger),
    notCovered: notCovered(lists, tests, lensReturns, red, lensRan),
    spend: { agents: current.length, agentsSource: "recorded returns", tokens: 0, tokensKnown: false, tokensUnit: TOKENS_UNIT },
  };
}

export function writeReport(path, report) {
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temp, path);
}

// The report of this attempt, or null when none is on file.
export function readReportOf(path, { name, attempt }) {
  try {
    const report = JSON.parse(readFileSync(path, "utf8"));
    return report?.stage === name && report?.attempt === attempt ? report : null;
  } catch {
    return null;
  }
}
