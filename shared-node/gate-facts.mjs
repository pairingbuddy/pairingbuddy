// The facts a gate question shows, read by pb gate eval from where the run already keeps them, so the stored question
// carries them and no session can change or misreport them. A fact that cannot be read is left out, never guessed.
// Node built-ins only.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REVIEWER, firstSentence, keptFixLenses, openDoubts } from "./gates.mjs";
import { findingOutcomes, lensOfFinding } from "./lens-merge.mjs";
import { mostOpen, samePlaceGroups } from "./lens-round.mjs";
import { plainName } from "./plain-names.mjs";
import { returnFileKey } from "./stages.mjs";
import { keptIntakeReturn, lensRoundAt, readReturn, returnsAt, standingScenariosKey } from "./stage-run.mjs";
import { finalCheckRows, scenarioRows } from "./standing-scenarios.mjs";

const artifactsDirOf = (root) => join(root, ".pairingbuddy", "run", "task", "artifacts");

const text = (value) => (typeof value === "string" && value.trim() !== "" ? value : undefined);

function typeFacts(root, ledger) {
  const content = keptIntakeReturn(artifactsDirOf(root), ledger.stage.attempt)?.content;
  const facts = { rationale: text(content?.rationale), ambiguity: text(content?.ambiguity) };
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined));
}

function scenarioFacts(root, ledger) {
  const dir = artifactsDirOf(root);
  const key = standingScenariosKey(dir, ledger);
  const standing = key === null ? undefined : readReturn(dir, key);
  const scenarios = scenarioRows(standing?.scenarios);
  const finalChecks = finalCheckRows(standing?.final_checks);
  return { ...(scenarios === undefined ? {} : { scenarios }), ...(finalChecks === undefined ? {} : { finalChecks }) };
}

// One fact, or undefined when it cannot be read: one broken file leaves only its own line out.
function fact(read) {
  try {
    return read();
  } catch {
    return undefined;
  }
}

const stateJson = (root, name) => JSON.parse(readFileSync(join(root, ".pairingbuddy", name), "utf8"));

const goalOf = (root) => text(stateJson(root, "task.json")?.description);

// The files pb snapshot recorded as changed since the unit's base.
function changedFiles(root) {
  const changed = stateJson(root, "run/changed.json");
  if (!Array.isArray(changed) || changed.length === 0) return undefined;
  const paths = changed.map((entry) => text(entry?.path));
  return paths.includes(undefined) ? undefined : paths;
}

// The tests the TDD cycle closed: RED and GREEN, or a covered pass. The CLI wrote these, so no model can add one.
function closedTests({ tests: { perTest } }) {
  if (perTest === null || typeof perTest !== "object") return undefined;
  const closed = Object.values(perTest).filter(({ red, green, covered }) => covered?.done === true || (red?.done === true && green?.done === true));
  return closed.length;
}

const fullSuitePassed = ({ tests: { full } }) => (full?.passed === true ? true : undefined);
const lintNoteOf = ({ tests: { full } }) => (typeof full?.lint === "string" ? full.lint : undefined);
// The failures the task's baseline already had, which the full run was excused (judgedRecord in test-run.mjs).
const preexistingOf = ({ tests: { full } }) => (Array.isArray(full?.preexisting) && full.preexisting.length > 0 ? full.preexisting : undefined);

// The final checks the session ran and recorded with pb final-check, as the ledger keeps them.
const ranFinalChecksOf = ({ finalChecks }) => (Array.isArray(finalChecks) && finalChecks.length > 0 ? finalChecks : undefined);

// The lens that reads the change against the repo's docs and plan: the safety net's goal check.
const GOAL_LENS = "corpus-misalignment";

// A finding told short: the lens's title, or its claim's first sentence whole, since a cut sentence cannot be judged.
const gistOf = ({ title, claim }) => text(title) ?? firstSentence(claim);

// What became of each finding of the stage's lens round, by the rule the stage's return gives the session. A round
// with no lens recorded has no review to tell.
function reviewOf(root, ledger) {
  const dir = artifactsDirOf(root);
  if (!returnsAt(dir, ledger.stage).some(({ role }) => role === "lens")) return undefined;
  const round = lensRoundAt(dir, ledger.stage, ledger.taskType);
  const outcomes = findingOutcomes(round, keptFixLenses(dir, ledger.stage, ledger));
  const byId = new Map([...round.survivors, ...round.refuted, ...round.unrefuted].map((finding) => [finding.id, finding]));
  const goalCheck = outcomes
    .filter(({ id, outcome }) => lensOfFinding({ id }) === GOAL_LENS && outcome !== "not a real problem")
    .map(({ id, outcome }) => ({ gist: gistOf(byId.get(id)), outcome }))
    .filter(({ gist }) => gist !== null);
  // Counted as the pane and the report show them: findings told once for the same lines are one issue, at its most open outcome.
  const review = samePlaceGroups(outcomes).map((group) => mostOpen(group.map(({ outcome }) => outcome)));
  return { review, ...(goalCheck.length > 0 && { goalCheck }) };
}

function taskEndFacts(root, ledger) {
  const facts = {
    goal: fact(() => goalOf(root)),
    files: fact(() => changedFiles(root)),
    tests: fact(() => closedTests(ledger)),
    passing: fact(() => fullSuitePassed(ledger)),
    lint: fact(() => lintNoteOf(ledger)),
    preexisting: fact(() => preexistingOf(ledger)),
    finalChecks: fact(() => ranFinalChecksOf(ledger)),
    ...fact(() => reviewOf(root, ledger)),
  };
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined));
}

const READERS = { "G:type": typeFacts, "G:scenarios": scenarioFacts, "G:task-end": taskEndFacts };

const REVIEW_ROLES = ["lens", "refuter"];

// The step a return came from, in plain words: a reviewer for a lens or refuter, else its agent's name, else its stage's.
const stepOf = (file) => {
  const key = returnFileKey(file);
  if (REVIEW_ROLES.includes(key?.role)) return REVIEWER;
  return plainName(key?.role ?? "") ?? plainName(key?.stage ?? "");
};

const reviewedStage = (file) => {
  const key = returnFileKey(file);
  return REVIEW_ROLES.includes(key?.role) && typeof key.stage === "string" ? { stage: key.stage } : {};
};

// Every open doubt in full, with the step that had it. One that cannot be told leaves them all out, so none is hidden.
function doubtsOf(root, ledger, contract) {
  const open = openDoubts(contract, ledger, root);
  if (open === null || open.length === 0) return undefined;
  // A reviewer's doubt keeps the stage it reviewed, so the report can say which review raised it.
  const doubts = open.map(({ file, ambiguity, options }) => ({ step: stepOf(file), ...reviewedStage(file), ambiguity: text(ambiguity), ...(options?.length ? { options } : {}) }));
  return doubts.every(({ step, ambiguity }) => step !== undefined && ambiguity !== undefined) ? doubts : undefined;
}

// A gate's reader that fails as a whole leaves its facts out: the question still asks, with less to show.
// The contract settles which doubts a human already approved; without it no doubt is read.
export function gateFacts(gate, root, ledger, contract) {
  const doubts = contract === undefined ? undefined : fact(() => doubtsOf(root, ledger, contract));
  return { ...(fact(() => READERS[gate]?.(root, ledger)) ?? {}), ...(doubts === undefined ? {} : { doubts }) };
}
