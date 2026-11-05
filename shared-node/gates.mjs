// Gates: which gate is due, why it must ask, and what counts as passing it. The policy itself is
// recorded by the gate hook and read here from the ledger, so no caller can supply it. Node built-ins only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { REDO_STATUS, graphFor, isVoidedAttempt, returnFileKey, withStageStatus } from "./stages.mjs";
import { isPassed } from "./gate-passed.mjs";
import { HUMAN_STOPPED } from "./stop-codes.mjs";

export { isPassed };

const HUMAN_SOURCES = ["human", "human-cli"];
const REPORT_LISTS = ["survivors", "gaps", "uncovered", "unrefuted"];

export const GATE_OPTIONS = [
  { label: "approve", description: "Approve this gate and let the run continue." },
  { label: "redo", description: "Redo the stage before this gate." },
  { label: "stop", description: "Stop here." },
];

const gateHeader = (gate) => `PB gate: ${gate}`;
const gateQuestionText = (gate) => `Approve ${gate}?`;

export const gateQuestion = (gate) => ({ question: gateQuestionText(gate), header: gateHeader(gate), options: GATE_OPTIONS, multiSelect: false });

export const fileHash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// ---------- gates of a run ----------

export function gatesFor(contract, taskType) {
  const { nodes, gates } = contract.taskTypes[graphFor(contract, taskType).taskType];
  return nodes.filter(({ gate }) => gate !== null).map(({ name, gate }) => ({ name: gate, stage: name, class: gates[gate].class }));
}

const doneStages = (ledger) => new Set(ledger.stages.filter((s) => s.status === "done").map((s) => s.name));

// The first gate behind a finished stage that stands in the way of the next stage.
export function blockingGate(gates, ledger) {
  const done = doneStages(ledger);
  return gates.find(({ name, stage }) => done.has(stage) && !isPassed(ledger, name));
}

export function dueGate(gates, ledger) {
  const done = doneStages(ledger);
  return gates.find(({ name, stage }) => done.has(stage) && !Object.hasOwn(ledger.gates, name));
}

// The gate a human answered with something other than approve, with that answer. It stands until they approve it.
export function answeredGate(gates, ledger) {
  if (ledger.needsHuman !== null) return undefined;
  const gate = blockingGate(gates, ledger);
  if (gate === undefined || !Object.hasOwn(ledger.gates, gate.name)) return undefined;
  const { source, answer } = ledger.gates[gate.name];
  return HUMAN_SOURCES.includes(source) ? { ...gate, answer } : undefined;
}

// The gate of a stage sent back by redo and not restarted yet. A redo leaves no gate record, so the stage holds this.
export const reopenedGate = (gates, { stage }) => (stage.status === REDO_STATUS ? gates.find((gate) => gate.stage === stage.name) : undefined);

// ---------- always-stop conditions ----------

function parsedOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const isReport = (report) => report !== null && typeof report === "object" && REPORT_LISTS.every((key) => report[key] === undefined || Array.isArray(report[key]));

// A report carries its stage and attempt, and one with no stamp keeps counting, since nothing shows it is stale.
const isVoidedReport = (report, ledger) => typeof report.stage === "string" && isVoidedAttempt(ledger, report.stage, report.attempt);

// A report that cannot be read stops too: it may be hiding any of these.
function reportStop(path, ledger) {
  if (!existsSync(path)) return null;
  const report = parsedOrNull(path);
  if (!isReport(report)) return `${path} cannot be read`;
  if (isVoidedReport(report, ledger)) return null;
  const { survivors = [], gaps = [], uncovered = [], unrefuted = [] } = report;
  if (survivors.some((finding) => finding?.class === "decide")) return "a decide finding survived";
  if (gaps.length > 0) return `coverage gaps remain: ${gaps.length}`;
  if (uncovered.length > 0) return `a lens is uncovered: ${uncovered.join(", ")}`;
  if (unrefuted.some((finding) => finding?.severity === "high")) return "an unrefuted high-severity finding is past the cap";
  return null;
}

function isVoidedReturn(file, ledger) {
  const key = returnFileKey(file);
  return key !== null && isVoidedAttempt(ledger, key.stage, key.attempt);
}

const isHumanApproved = (ledger, gate) => {
  const record = Object.hasOwn(ledger.gates, gate) ? ledger.gates[gate] : undefined;
  return HUMAN_SOURCES.includes(record?.source) && record.answer === "approve";
};

// A human who approved a gate has seen what its stage and every stage before it left open. A redo removes the gate's
// record, so a record always speaks for the attempt that stands, and a stage after it has not been seen by anyone.
function settledStages(contract, ledger) {
  const { nodes } = contract.taskTypes[graphFor(contract, ledger.taskType).taskType];
  const last = nodes.findLastIndex(({ gate }) => gate !== null && isHumanApproved(ledger, gate));
  return new Set(nodes.slice(0, last + 1).map(({ name }) => name));
}

const COVERED_ROLE = "implement-tests";

// A pass at RED after an earlier GREEN is the CLI's call: once it recorded the test covered, a question about it is answered.
function isCoveredPass(key, { tests: { perTest = {} } }) {
  if (key?.role !== COVERED_ROLE || key.item === null || !Object.hasOwn(perTest, key.item)) return false;
  return perTest[key.item].covered?.done === true;
}

function isSettled(file, settled, ledger) {
  const key = returnFileKey(file);
  return settled.has(key?.stage) || isCoveredPass(key, ledger);
}

// It names every open return, because approving this gate settles them all.
function ambiguityStop(dir, ledger, settled) {
  if (!existsSync(dir)) return null;
  const open = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json") && !name.startsWith(".") && !isVoidedReturn(name, ledger)).sort()) {
    const artifact = parsedOrNull(join(dir, file));
    if (artifact === null) return `the return ${file} cannot be read`;
    const { ambiguity = null } = artifact;
    if (ambiguity !== null && ambiguity !== "" && !isSettled(file, settled, ledger)) open.push(file);
  }
  if (open.length === 0) return null;
  return open.length === 1 ? `the return ${open[0]} carries an open ambiguity` : `these returns carry an open ambiguity: ${open.join(", ")}`;
}

const COVERAGE_ROLE = "verify-test-coverage";

// The newest coverage return that stands, since the loop closes gaps round by round and only its last word counts.
function newestCoverage(dir, ledger) {
  const standing = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith(".") && !isVoidedReturn(name, ledger))
    .map((file) => ({ file, key: returnFileKey(file) }))
    .filter(({ key }) => key?.role === COVERAGE_ROLE && key.item === null)
    .sort((a, b) => b.key.attempt - a.key.attempt || b.key.round - a.key.round);
  return standing[0]?.file ?? null;
}

// Gaps the bounded coverage loop left. They outlive the stage's report, which the next stage's report replaces.
function coverageStop(dir, ledger, settled) {
  if (!existsSync(dir)) return null;
  const file = newestCoverage(dir, ledger);
  if (file === null || isSettled(file, settled, ledger)) return null;
  const gaps = parsedOrNull(join(dir, file))?.gaps;
  if (!Array.isArray(gaps)) return `the coverage return ${file} cannot be read`;
  return gaps.length === 0 ? null : `coverage gaps remain: ${gaps.length}, in ${file}`;
}

function retriesStop({ retries }) {
  const exhausted = Object.keys(retries).find((stage) => !(retries[stage]?.used < retries[stage]?.max));
  return exhausted === undefined ? null : `retries are exhausted for ${exhausted}`;
}

function configStop({ configHash }, root) {
  const path = join(root, ".pairingbuddy", "test-config.json");
  return existsSync(path) && fileHash(path) === configHash ? null : "the config hash changed during the run";
}

function stopReason(contract, ledger, root) {
  const taskDir = join(root, ".pairingbuddy", "run", "task");
  if (ledger.stop !== null) return `the run stopped: ${ledger.stop.reason}`;
  const artifacts = join(taskDir, "artifacts");
  const settled = settledStages(contract, ledger);
  return retriesStop(ledger) ?? configStop(ledger, root) ?? ambiguityStop(artifacts, ledger, settled) ?? coverageStop(artifacts, ledger, settled) ?? reportStop(join(taskDir, "report.json"), ledger);
}

// ---------- the decision ----------

const CLASS_REASONS = {
  decide: "it is a decide gate, which always asks",
  conditional: "no classifier reports certain",
};

function policyReason({ policy: { mode } }) {
  if (mode === "auto") return null;
  return mode === "" ? "no gate policy is recorded" : `the gate policy is ${mode}, not auto`;
}

// Why this gate must ask a human, or null when it passes under the recorded policy.
export const askReason = (contract, ledger, gate, root) => stopReason(contract, ledger, root) ?? CLASS_REASONS[gate.class] ?? policyReason(ledger);

// A model writes the dialog, so its words are the human's only when they are the words the CLI emitted, alone in
// the call. Otherwise it could put "approve" on a description that says something else.
export const isGateQuestionCall = (gate, questions) => Array.isArray(questions) && questions.length === 1 && isDeepStrictEqual(questions[0], gateQuestion(gate));

// The approve, redo or stop that a finished AskUserQuestion gave this gate, or null.
export function gateAnswer(gate, toolResponse) {
  if (!isGateQuestionCall(gate, toolResponse?.questions)) return null;
  const answer = toolResponse.answers?.[gateQuestionText(gate)];
  return GATE_OPTIONS.some(({ label }) => label === answer) ? answer : null;
}

// A redo sends the stage back and leaves no record, so the gate comes due again when the stage finishes.
function reopenStage(ledger, name, gates) {
  const { [name]: _cleared, ...kept } = ledger.gates;
  return withStageStatus({ ...ledger, gates: kept }, gates.find((gate) => gate.name === name).stage, REDO_STATUS);
}

// What a human's answer to the asking gate does to the ledger.
export function recordAnswer(ledger, name, answer, gates) {
  const asked = { ...ledger, needsHuman: null };
  if (answer === "redo") return reopenStage(asked, name, gates);
  const recorded = { ...asked, gates: { ...ledger.gates, [name]: { source: "human", answer } } };
  return answer === "stop" ? { ...recorded, stop: { code: HUMAN_STOPPED, reason: `the human answered stop at ${name}`, seq: ledger.seq + 1 } } : recorded;
}

// ---------- redo feedback ----------

function guidanceFile(path) {
  if (!existsSync(path)) return { guidance: [] };
  const file = parsedOrNull(path);
  if (!Array.isArray(file?.guidance)) throw new Error(`${path} holds no guidance list, so a redo's feedback was not added to it`);
  return file;
}

// Only tool_response counts, as for the answer: it holds what the human wrote. A redo with no note still tells the
// next attempt that the last one was sent back.
function redoFeedback(gate, stage, attempt, toolResponse) {
  const notes = toolResponse.annotations?.[gateQuestionText(gate)]?.notes;
  if (typeof notes === "string" && notes.trim() !== "") return notes.trim();
  return `The human sent ${stage} back at ${gate} with no note, after attempt ${attempt}. Do not repeat that result.`;
}

// Stage agents read human-guidance.json, so this is how a redo reaches the next attempt (Data flow step 11).
export function appendRedoFeedback(root, ledger, gates, toolResponse) {
  const gate = ledger.needsHuman.gate;
  const { stage } = gates.find(({ name }) => name === gate);
  const path = join(root, ".pairingbuddy", "human-guidance.json");
  const file = guidanceFile(path);
  const entry = { agent: stage, timestamp: new Date().toISOString(), context: `redo at ${gate}`, feedback: redoFeedback(gate, stage, ledger.stage.attempt, toolResponse) };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ ...file, guidance: [...file.guidance, entry] }, null, 2)}\n`);
  renameSync(temp, path);
}

// A human's way past any answer: it undoes a redo that has not restarted, and the stop this gate's answer set.
export function recordApproval(ledger, name, gates) {
  const reopened = reopenedGate(gates, ledger);
  const restored = reopened?.name === name ? withStageStatus(ledger, reopened.stage, "done") : ledger;
  const stoppedHere = Object.hasOwn(ledger.gates, name) && ledger.gates[name].answer === "stop";
  return { ...restored, needsHuman: null, stop: stoppedHere ? null : ledger.stop, gates: { ...ledger.gates, [name]: { source: "human-cli", answer: "approve" } } };
}
