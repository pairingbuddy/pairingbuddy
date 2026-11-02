// Gates: which gate is due, why it must ask, and what counts as passing it. The policy itself is
// recorded by the gate hook and read here from the ledger, so no caller can supply it. Node built-ins only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { REDO_STATUS, graphFor, withStageStatus } from "./stages.mjs";

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

function isPassed(ledger, gate) {
  if (ledger.needsHuman?.gate === gate) return false;
  const record = Object.hasOwn(ledger.gates, gate) ? ledger.gates[gate] : undefined;
  return record?.source === "auto" || (HUMAN_SOURCES.includes(record?.source) && record.answer === "approve");
}

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

// A report that cannot be read stops too: it may be hiding any of these.
function reportStop(path) {
  if (!existsSync(path)) return null;
  const report = parsedOrNull(path);
  if (!isReport(report)) return `${path} cannot be read`;
  const { survivors = [], gaps = [], uncovered = [], unrefuted = [] } = report;
  if (survivors.some((finding) => finding?.class === "decide")) return "a decide finding survived";
  if (gaps.length > 0) return `coverage gaps remain: ${gaps.length}`;
  if (uncovered.length > 0) return `a lens is uncovered: ${uncovered.join(", ")}`;
  if (unrefuted.some((finding) => finding?.severity === "high")) return "an unrefuted high-severity finding is past the cap";
  return null;
}

function ambiguityStop(dir) {
  if (!existsSync(dir)) return null;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort()) {
    const artifact = parsedOrNull(join(dir, file));
    if (artifact === null) return `the return ${file} cannot be read`;
    const { ambiguity = null } = artifact;
    if (ambiguity !== null && ambiguity !== "") return `the return ${file} carries an open ambiguity`;
  }
  return null;
}

function retriesStop({ retries }) {
  const exhausted = Object.keys(retries).find((stage) => !(retries[stage]?.used < retries[stage]?.max));
  return exhausted === undefined ? null : `retries are exhausted for ${exhausted}`;
}

function configStop({ configHash }, root) {
  const path = join(root, ".pairingbuddy", "test-config.json");
  return existsSync(path) && fileHash(path) === configHash ? null : "the config hash changed during the run";
}

function stopReason(ledger, root) {
  const taskDir = join(root, ".pairingbuddy", "run", "task");
  if (ledger.stop !== null) return `the run stopped: ${ledger.stop.reason}`;
  return retriesStop(ledger) ?? configStop(ledger, root) ?? ambiguityStop(join(taskDir, "artifacts")) ?? reportStop(join(taskDir, "report.json"));
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
export const askReason = (ledger, gate, root) => stopReason(ledger, root) ?? CLASS_REASONS[gate.class] ?? policyReason(ledger);

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
  return answer === "stop" ? { ...recorded, stop: { reason: `the human answered stop at ${name}`, seq: ledger.seq + 1 } } : recorded;
}

// A human's way past any answer: it undoes a redo that has not restarted, and the stop this gate's answer set.
export function recordApproval(ledger, name, gates) {
  const reopened = reopenedGate(gates, ledger);
  const restored = reopened?.name === name ? withStageStatus(ledger, reopened.stage, "done") : ledger;
  const stoppedHere = Object.hasOwn(ledger.gates, name) && ledger.gates[name].answer === "stop";
  return { ...restored, needsHuman: null, stop: stoppedHere ? null : ledger.stop, gates: { ...ledger.gates, [name]: { source: "human-cli", answer: "approve" } } };
}
