// What a stage attempt leaves behind: its returns, whether its evidence is complete, its report and its spend.
// A model wrote the returns, so a return counts only under its own key at its own attempt. Node built-ins only.
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { evidenceFor, returnFileKey } from "./stages.mjs";

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

function testsProblem(name, { ledger: { tests, stage } }) {
  const record = Object.hasOwn(tests, name) ? tests[name] : undefined;
  if (!isAttemptRecord(record, stage)) return `tests:${name} has no run at attempt ${stage.attempt}`;
  return record.passed ? null : `tests:${name} failed at attempt ${stage.attempt}`;
}

const PROBLEMS = { artifact: artifactProblem, checkpoint: checkpointProblem, tests: testsProblem };

function evidenceProblem(entry, context) {
  const [kind, name] = entry.split(":");
  return PROBLEMS[kind](name, context);
}

// Everything standing between this attempt and done, so one refusal names it all.
export function finishProblems(contract, ledger, artifactsDir) {
  const context = { ledger, artifactsDir };
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
  const closed = { ...entry, ...notes, name, status, attempt, spend: addAgents(entry?.spend ?? NO_SPEND, agents) };
  const stages = entry === undefined ? [...ledger.stages, closed] : ledger.stages.map((stage) => (stage === entry ? closed : stage));
  return { ...ledger, stage: { ...ledger.stage, status }, stages, spend: addAgents(ledger.spend, agents) };
}

const spendFigures = ({ agents, tokens, tokensKnown }, more) => ({ agents: agents + more, tokens, tokensKnown: tokensKnown === true });

// The stage and task totals, with an active stage's returns so far, which no closed attempt has counted yet.
export function spendTotals(ledger, artifactsDir, maxAgents) {
  const live = ledger.stage.status === "active" ? returnsAt(artifactsDir, ledger.stage).length : 0;
  return {
    maxAgents,
    label: SPEND_LABEL,
    stage: { name: ledger.stage.name, ...spendFigures(stageEntry(ledger)?.spend ?? NO_SPEND, live) },
    task: spendFigures(ledger.spend, live),
  };
}

// ---------- the report ----------

const attemptTests = ({ tests, stage }) => Object.entries(tests).filter(([, record]) => isAttemptRecord(record, stage)).map(([key, record]) => ({ key, ...record }));

function notCovered({ uncovered, gaps }, testRuns, returns) {
  const lensRan = returns.some((artifact) => REPORT_LISTS.some((key) => artifact[key] !== undefined));
  return [
    ...uncovered,
    ...gaps,
    ...(testRuns.some(({ key }) => key === "full") ? [] : ["the full suite did not run in this stage"]),
    ...(lensRan ? [] : ["no lens round ran in this stage"]),
    ...(testRuns.length > 0 ? ["exit codes show that tests passed or failed, not why: read the excerpts"] : []),
    `${TOKENS_UNIT} are unknown: this stage supplied no budget.spent() figure`,
  ];
}

// Built from what was recorded, never from a model's summary of it.
export function buildReport(ledger, artifactsDir) {
  const { name, attempt, runId } = ledger.stage;
  const current = returnsAt(artifactsDir, ledger.stage);
  const returns = current.map(({ pbKey }) => readReturn(artifactsDir, pbKey) ?? {});
  const lists = Object.fromEntries(REPORT_LISTS.map((key) => [key, returns.flatMap((artifact) => artifact[key] ?? [])]));
  const tests = attemptTests(ledger);
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
    notCovered: notCovered(lists, tests, returns),
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
