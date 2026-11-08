// Gates: which gate is due, why it must ask, and what counts as passing it. The policy itself is
// recorded by the gate hook and read here from the ledger, so no caller can supply it. Node built-ins only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { REDO_STATUS, graphFor, isVoidedAttempt, returnFileKey, withStageStatus } from "./stages.mjs";
import { isPassed } from "./gate-passed.mjs";
import { HUMAN_STOPPED } from "./stop-codes.mjs";
import { GitConfigRefused, gitConfigPath, readGitConfig } from "./gitconf.mjs";
import { headOf } from "./checkpoint.mjs";
import { PrLintConfigRefused } from "./pr-lint.mjs";
import { PrLintRunRefused, prBodyPath, prLintPath, readDraftArtifact, readUnit, runPrLint, sha256 } from "./pr-lint-run.mjs";

export { isPassed };

const HUMAN_SOURCES = ["human", "human-cli"];
const REPORT_LISTS = ["survivors", "gaps", "uncovered", "unrefuted"];

export const GATE_OPTIONS = [
  { label: "approve", description: "Approve this gate and let the run continue." },
  { label: "redo", description: "Redo the stage before this gate." },
  { label: "stop", description: "Stop here." },
];

export const PUBLISH_GATE = "G:publish";
export const PUBLISH_LABEL = "publish";
export const KEEP_LOCAL_LABEL = "keep local";
export const KEEP_LOCAL = "keep-local";

const PUBLISH_OPTIONS = [
  { label: PUBLISH_LABEL, description: "Push the branch and open the pull request." },
  { label: KEEP_LOCAL_LABEL, description: "Keep the commits on this branch and publish nothing." },
  { label: "redo", description: "Redo the draft before this gate." },
];

const optionsOf = (gate) => (gate === PUBLISH_GATE ? PUBLISH_OPTIONS : GATE_OPTIONS);

const gateHeader = (gate) => `PB gate: ${gate}`;
const gateQuestionText = (gate) => `Approve ${gate}?`;

export const gateQuestion = (gate) => ({ question: gateQuestionText(gate), header: gateHeader(gate), options: optionsOf(gate), multiSelect: false });

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

export const isHumanApproved = (ledger, gate) => {
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

// The config files whose hash is not the one recorded: test-config.json and git-config.json, in that order. A missing
// test-config.json counts as changed. git-config.json is tracked only when the unit recorded a hash; then a missing file
// counts as changed too.
export function changedConfigs({ configHash, gitConfigHash }, root) {
  const differs = (path, recorded) => !existsSync(path) || fileHash(path) !== recorded;
  return [
    ...(differs(join(root, ".pairingbuddy", "test-config.json"), configHash) ? ["test-config.json"] : []),
    ...(gitConfigHash !== undefined && differs(gitConfigPath(root), gitConfigHash) ? ["git-config.json"] : []),
  ];
}

const CONFIG_STOPS = { "test-config.json": "the config hash changed during the run", "git-config.json": "the git-config hash changed during the run" };

const configStop = (hashes, root) => CONFIG_STOPS[changedConfigs(hashes, root)[0]] ?? null;

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
export const askReason = (contract, ledger, gate, root, voided = null) =>
  stopReason(contract, ledger, root) ?? (gate.name === PUBLISH_GATE ? publishReason(ledger, root, voided) : null) ?? CLASS_REASONS[gate.class] ?? policyReason(ledger);

// ---------- G:publish ----------

export class PublishRefused extends Error {}

// The refusals the binding and the lint can throw: a CLI reports them, and the tap puts them on the gate.
export const isBindingRefusal = (e) => e instanceof PublishRefused || e instanceof PrLintRunRefused || e instanceof PrLintConfigRefused || e instanceof GitConfigRefused;

function currentHead(root) {
  const head = headOf(root);
  if (head === null) throw new PublishRefused("git has no HEAD here, so the publish binding cannot be read");
  return head;
}
const short = (sha) => String(sha).slice(0, 7);

// The lint result as it stands for the body on disk: missing, stale (made for another body), failed or ok.
export function publishLint(root) {
  const lint = existsSync(prLintPath(root)) ? parsedOrNull(prLintPath(root)) : null;
  if (lint === null) return { status: "missing", ok: false, failures: [] };
  const failures = Array.isArray(lint.failures) ? lint.failures : [];
  const current = existsSync(prBodyPath(root)) ? sha256(readFileSync(prBodyPath(root))) : null;
  if (lint.bodyHash !== current) return { status: "stale", ok: false, failures };
  return { status: lint.ok === true ? "ok" : "failed", ok: lint.ok === true, failures };
}

function lintReason(root) {
  const { status, failures } = publishLint(root);
  if (status === "missing") return "the PR lint has not run";
  if (status === "stale") return "the PR lint is stale: it was run for another body than run/pr-body.md";
  if (status === "failed") return `the PR lint failed: ${failures.map(({ rule }) => rule).join(", ")}`;
  return null;
}

const hasLensRecord = ({ lenses }) => lenses?.["safety-net"] !== undefined && lenses["safety-net"] !== null && Object.keys(lenses["safety-net"]).length > 0;

// Why the publish gate asks whatever the policy says. Under auto it never records the approval itself: a lens record only removes that reason.
function publishReason(ledger, root, voided) {
  const reason = voided ?? lintReason(root);
  if (reason !== null || ledger.policy.mode !== "auto") return reason;
  return hasLensRecord(ledger) ? "G:publish is approved by a human, never by the auto policy" : "no lens record yet for the safety net";
}

const publishRecord = (ledger) => (Object.hasOwn(ledger.gates, PUBLISH_GATE) ? ledger.gates[PUBLISH_GATE] : undefined);

// How G:publish stands in the ledger: a human "approve", a human "keep-local", an auto pass, or no usable record.
export function publishApproval(ledger) {
  const record = publishRecord(ledger);
  if (HUMAN_SOURCES.includes(record?.source)) {
    if (record.answer === "approve") return "human";
    if (record.answer === KEEP_LOCAL) return "keep-local";
  }
  return record?.source === "auto" ? "auto" : "none";
}

// The title and labels of the draft, as an approval binds them: a hash of the title (it becomes the squash-merge
// headline) and the labels as they will be passed to gh.
export const draftBinding = (draft) => ({ titleHash: sha256(draft.title), labels: draft.labels ?? [] });

// What an approval is compared with: HEAD, base and target, the body bytes (null when there is no body) and the draft.
export const currentBinding = (root, draft, body) => ({ ...publishFacts(root), bodyHash: body === null ? null : sha256(body), ...draftBinding(draft) });

// Why a G:publish approval no longer matches the current binding, or null when it still does.
export function staleBindingReason(record, current) {
  if (record.headSha === undefined && record.bodyHash === undefined) return "the G:publish approval no longer holds: it carries no binding to HEAD or run/pr-body.md";
  const moved = (name, was, now) => (was === now ? [] : [`${name} changed from ${was ?? "none"} to ${now}`]);
  const changes = [
    ...(record.headSha === current.headSha ? [] : [`HEAD moved from ${short(record.headSha)} to ${short(current.headSha)}`]),
    ...(record.bodyHash === current.bodyHash ? [] : ["run/pr-body.md changed"]),
    ...(record.titleHash === current.titleHash ? [] : ["the PR title changed"]),
    ...(isDeepStrictEqual(record.labels, current.labels) ? [] : ["the PR labels changed"]),
    ...moved("base", record.base, current.base),
    ...moved("target", record.target, current.target),
  ];
  return changes.length === 0 ? null : `the G:publish approval no longer holds: ${changes.join(" and ")}`;
}

// A human approval that no longer matches HEAD, run/pr-body.md or the draft's title and labels does not stand. Null when
// it does, or when there is none. `current` is the binding the caller already read, so one read serves the check and the use.
export function publishVoidReason(ledger, root, current = null) {
  if (publishApproval(ledger) !== "human") return null;
  const draft = current === null ? readDraftArtifact(root, ledger.stage) : null;
  const bound = current ?? currentBinding(root, draft, existsSync(prBodyPath(root)) ? readFileSync(prBodyPath(root)) : null);
  return staleBindingReason(publishRecord(ledger), bound);
}

// The stale approval leaves the gates and is kept in voidedGates with the reason, so the audit trail shows it was given and then voided.
export function voidPublish(ledger, reason) {
  const { [PUBLISH_GATE]: record, ...kept } = ledger.gates;
  if (record === undefined) return ledger;
  return { ...ledger, gates: kept, voidedGates: [...(ledger.voidedGates ?? []), { gate: PUBLISH_GATE, record, reason }] };
}

// A model writes the dialog, so its words are the human's only when they are the words the CLI emitted, alone in
// the call. Otherwise it could put "approve" on a description that says something else.
export const isGateQuestionCall = (gate, questions) => Array.isArray(questions) && questions.length === 1 && isDeepStrictEqual(questions[0], gateQuestion(gate));

// The approve, redo or stop that a finished AskUserQuestion gave this gate, or null.
export function gateAnswer(gate, toolResponse) {
  if (!isGateQuestionCall(gate, toolResponse?.questions)) return null;
  const answer = toolResponse.answers?.[gateQuestionText(gate)];
  return optionsOf(gate).some(({ label }) => label === answer) ? answer : null;
}

// A redo sends the stage back and leaves no record, so the gate comes due again when the stage finishes.
function reopenStage(ledger, name, gates) {
  const { [name]: _cleared, ...kept } = ledger.gates;
  return withStageStatus({ ...ledger, gates: kept }, gates.find((gate) => gate.name === name).stage, REDO_STATUS);
}

// What the human is shown at G:publish and what an approval binds to: HEAD, where the unit started and where the PR goes.
export function publishFacts(root) {
  const unit = readUnit(root);
  return { headSha: currentHead(root), base: unit.base, target: readGitConfig(root).pr.base_branch ?? unit.base };
}

// What G:publish approved: the commit, the body, the title and the labels the human saw, and where they go. It re-runs the lint, so the
// record also says when the human approved over a failed one. `shown` is what gate eval showed (needsHuman.shown): HEAD
// must still be that commit, or the human approves what they did not see. The body hash is not compared: the human may
// edit the body at the gate (D20), so it binds at answer time, after the lint re-run.
export function publishBinding(root, ledger, shown = null) {
  const facts = publishFacts(root);
  if (shown?.headSha !== undefined && shown.headSha !== facts.headSha) {
    throw new PublishRefused(`HEAD moved since the question: the human was shown ${short(shown.headSha)} and HEAD is ${short(facts.headSha)}, so nothing was approved`);
  }
  const draft = readDraftArtifact(root, ledger.stage);
  const lint = runPrLint(root, draft.title);
  const failed = lint.ok ? {} : { lintOk: false, lintFailures: lint.failures };
  return { ...facts, bodyHash: lint.bodyHash, ...draftBinding(draft), ...failed };
}

// The gate record of a human's approval. A publish approval carries its binding.
const approvalRecord = (source, binding = {}) => ({ source, answer: "approve", ...binding });

// What a human's answer to the asking gate does to the ledger. A publish answer is an approval that carries its binding.
export function recordAnswer(ledger, name, answer, gates, binding = {}) {
  const asked = { ...ledger, needsHuman: null };
  if (answer === "redo") return reopenStage(asked, name, gates);
  if (answer === PUBLISH_LABEL) return { ...asked, gates: { ...ledger.gates, [name]: approvalRecord("human", binding) } };
  if (answer === KEEP_LOCAL_LABEL) return { ...asked, gates: { ...ledger.gates, [name]: { source: "human", answer: KEEP_LOCAL } } };
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
export function recordApproval(ledger, name, gates, binding = {}) {
  const reopened = reopenedGate(gates, ledger);
  const restored = reopened?.name === name ? withStageStatus(ledger, reopened.stage, "done") : ledger;
  const stoppedHere = Object.hasOwn(ledger.gates, name) && ledger.gates[name].answer === "stop";
  return { ...restored, needsHuman: null, stop: stoppedHere ? null : ledger.stop, gates: { ...ledger.gates, [name]: approvalRecord("human-cli", binding) } };
}
