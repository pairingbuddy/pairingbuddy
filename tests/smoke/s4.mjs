#!/usr/bin/env node
// Smoke S4: the scenarios stage's lens round, on S2's task in S3's repo (a bare origin, base develop), on a cheap model, with a clean env.
//
// It asserts flags and records, never findings: the lens return is filed under the run's artifacts with its own pb key
// (code-scenarios.lens.<slug>) and matches lens-result.schema.json; the stage report's survivors and uncovered are arrays
// and equal what shared-node/lens-merge.mjs merges from the recorded returns; the stage's spend and the workflow's
// agentsUsed count the lens agent; and the lens agent ran at the model contracts/lenses.json names, as the smoke env maps
// that alias. Refuters: the stage spawns at most its row's maxRefuters and its agents stay within maxAgents; each filed
// verdict's finding_id is its key's item and names a finding the ranked lens return sent; the report's survivors, refuted
// and unrefuted equal the shared merge over the filed lens returns and verdicts. With no findings the refuter checks hold
// vacuously and S4 says so. The run may go on past scenarios. The report and artifacts are copied the moment the ledger shows the stage
// done, because the next stage overwrites the report and pb task end removes the artifacts. S4 grows with each lens PR.
// Snapshot: the stage's runner runs pb snapshot before the lens round, so run/subject.diff, changed.json and corpus.json
// exist when the stage is done (copied with the whole run dir then), the corpus holds repo paths only, the runner relayed
// that corpus and the workflow's return carries it, and the stage's spend counts the snapshot runner. Confinement: a
// Read outside the repo, built from the lens agent's recorded ids, is denied by the real hooks/gate.mjs with the run's
// state in place (the live one, or the captured copy put back), a Read inside it is not, and none of the lens agent's own
// tool calls was denied, each read among them having passed the gate.
// Light review (new_feature only, since only that type refactors per cycle): the code-tdd stage is copied the moment the
// ledger shows it done, and each test whose GREEN that stage recorded has exactly one light-review return filed under
// code-tdd.lens.<test id>, which matches light-review-result.schema.json, while no identify-* return is filed at all.
// Safety net to draft PR (Task 85): the run goes on to a published draft. The sample carries a README the task makes
// stale, so the safety net's corpus lens has a true finding to fix. The sample's test command runs behind
// force-red.mjs, a test-only fixture outside the sample repo, so the first safety-net fix's test run fails once and the
// fix loop rolls that fix back. S4 checks the safety-net lens record on the code run's ledger and in the unit's task
// record (lens names, models and counts only), a red rollback of a safety-net fix whose private ref held the saved work
// while the run was live, the auto pass at G:publish with its binding, one `gh pr create --draft` on the recording shim
// from the unit branch into develop at the bound HEAD, no refs/pairingbuddy/ on the remote or left locally, and that no
// lens finding's claim shows verbatim in any ledger snapshot, the unit record, or the PR's title and body. A gate that
// asks is answered by S4 from its own shell with pb human approve, as the human would, at most four times, and the
// session resumes; the result lists each such answer. G:publish asking for a missing lens record is never answered and
// fails S4. When G:publish asked for another reason (an open ambiguity in a pr-draft lens return), the result says the
// publish went through the human's approval rather than the auto pass.
//
// Run it by hand, in a separate shell, from the repo root. It spends money, so no suite collects it:
//
//     node tests/smoke/s4.mjs [--type bug_fix|new_feature] [--budget-usd N] [--record-dir DIR] [--recording NAME] [--plugin-dir DIR]
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { buildKey, lensSlug, parseKey } from "../../shared-node/keys.mjs";
import { parseLabel } from "../../shared-node/labels.mjs";
import { acceptVerdict, mergeLensReturns, rankLensReturns, wiredLensConfig } from "../../shared-node/lens-merge.mjs";
import { readReturn, returnsAt } from "../../shared-node/stage-run.mjs";
import { CHANGED_FILE, CORPUS_FILE, SUBJECT_DIFF_FILE } from "../../shared-node/snapshot.mjs";
import { violations } from "../js/schema-check.mjs";
import { Budget, REPO_ROOT, SmokeError, SpendCapError, cleanEnv, runClaude } from "./claude-run.mjs";
import { RunRecorder, transcriptDirs } from "./run-recorder.mjs";
import { flagValues, installGhShim } from "../js/gh-shim.mjs";
import { RECORDINGS, parseOptions, position } from "./s2.mjs";
import { makeS3Repo } from "./s3.mjs";

const STAGE = "code-scenarios";
const TDD_STAGE = "code-tdd";
const LIGHT_REVIEW_SCHEMA = JSON.parse(readFileSync(join(REPO_ROOT, "contracts", "schemas", "light-review-result.schema.json"), "utf8"));
const LENS_ROLE = "lens";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const LENS_MAP = readJson(join(REPO_ROOT, "contracts", "lenses.json"));
const LENS_SCHEMA = readJson(join(REPO_ROOT, "contracts", "schemas", "lens-result.schema.json"));
const REFUTER_SCHEMA = readJson(join(REPO_ROOT, "contracts", "schemas", "refuter-verdict.schema.json"));
const STAGES = readJson(join(REPO_ROOT, "contracts", "stages.json"));
const REFUTER_ROLE = "refuter";
const RUNNER_ROLE = "runner";
const GATE = join(REPO_ROOT, "hooks", "gate.mjs");
const READ_TOOLS = ["Read", "Grep", "Glob"];
const LENS_CONFIG = wiredLensConfig(LENS_MAP, STAGE);
const ROW = LENS_MAP.rows.find(({ stage }) => `code-${stage}` === STAGE);
const MAX_AGENTS = STAGES.stageMaxAgents[STAGE] ?? STAGES.maxAgents;
const SAFETY_NET = "code-safety-net";
const PUBLISH_GATE = "G:publish";
const BASE = "develop";
const FORCE_RED = join(REPO_ROOT, "tests", "smoke", "force-red.mjs");
// A doc in the sample that the bug fix makes wrong, so the safety net's corpus lens has a true finding to send to the
// fix loop, whose first fix force-red.mjs then turns red. Test-only: it is S4's sample, never the plugin's.
const STALE_DOCS = {
  bug_fix: { "README.md": "# Shop\n\n`apply_discount(price, percent)` in discount.py returns the discount amount, so `apply_discount(100, 10)` is 10.\n" },
  new_feature: { "README.md": "# Shop\n\ncart.py has `line_total(p, q)` only. There is no order total: callers add the line totals themselves.\n" },
};
// A gate that asks is answered by S4 as the human, from its own shell, at most this many times: G:scenarios,
// G:task-end and G:publish can each ask once for an open ambiguity.
export const MAX_HUMAN_APPROVALS = 4;
// G:publish asking for this reason means the lens-record rule failed, which S4 never answers for the human.
export const LENS_REASON = "no lens record yet for the safety net";
// The whole run, scenarios to a draft PR, is longer than one S2 task.
export const RUN_TIMEOUT_MS = 45 * 60_000;
// What pb stage finish records for the safety net: names, models and counts, never a finding's words.
const LENS_RECORD_KEYS = ["attempt", "lenses", "refuted", "stage", "survivors", "uncovered", "unrefuted"];
// A claim shorter than this is too generic to call a leak when it shows up somewhere.
const MIN_CLAIM = 16;
// The only ANTHROPIC_ names a smoke run may carry: the alias-to-model mapping cleanEnv sets.
const MODEL_ENV = (alias) => `ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`;

function check(condition, message) {
  if (!condition) throw new SmokeError(message);
}

export function assertCleanEnv(env) {
  const anthropic = Object.keys(env).filter((name) => name.startsWith("ANTHROPIC_"));
  const allowed = ["opus", "sonnet"].map(MODEL_ENV);
  check(anthropic.every((name) => allowed.includes(name)), `the run env carries ${anthropic.filter((name) => !allowed.includes(name))}`);
  return env;
}

// Copies the scenarios stage's report and artifacts the first time a ledger shows the stage done.
class ScenariosRecorder extends RunRecorder {
  constructor(repo, out, options) {
    super(repo, out, options);
    this.runDir = join(repo, ".pairingbuddy", "run");
    this.taskDir = join(this.runDir, "task");
    this.captured = null;
    this.tdd = null;
    this.repo = repo;
    // Every return any stage filed, kept as it lands, since pb task end and pb publish remove run/task.
    this.allArtifacts = join(out, "all-artifacts");
    this.unit = null;
    this.refsSeen = new Map();
    this.lastRefPoll = 0;
  }

  poll() {
    super.poll();
    this.pollRun();
    this.pollTdd();
    if (this.captured !== null || this.last === null) return;
    const entry = this.last.stages?.find(({ name, status }) => name === STAGE && status === "done");
    if (entry === undefined) return;
    const dir = join(this.out, "scenarios");
    try {
      cpSync(join(this.taskDir, "artifacts"), join(dir, "artifacts"), { recursive: true });
      cpSync(join(this.taskDir, "report.json"), join(dir, "report.json"));
      // The whole run dir, snapshot files included: the gate check may need it back once pb task end has removed it.
      cpSync(this.runDir, join(dir, "run"), { recursive: true });
    } catch {
      return;
    }
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(this.last, null, 2));
    this.captured = { dir, artifacts: join(dir, "artifacts"), run: join(dir, "run"), ledger: this.last, entry };
  }

  // The returns, the unit record and the private refs as they stand, before the task end and the publish remove them.
  pollRun() {
    try {
      cpSync(join(this.taskDir, "artifacts"), this.allArtifacts, { recursive: true, force: true });
    } catch {
      // no run/task yet, or it is between runs
    }
    try {
      this.unit = JSON.parse(readFileSync(join(this.runDir, "unit.json"), "utf8"));
    } catch {
      // no unit yet, or it has closed
    }
    if (Date.now() - this.lastRefPoll < 250) return;
    this.lastRefPoll = Date.now();
    const refs = spawnSync("git", ["for-each-ref", "--format=%(refname) %(objectname)", "refs/pairingbuddy/"], { cwd: this.repo, encoding: "utf8", env: cleanEnv() });
    for (const line of (refs.stdout ?? "").split("\n").filter(Boolean)) {
      const [ref, sha] = line.split(" ");
      this.refsSeen.set(ref, sha);
    }
  }

  // The tdd stage's returns, before pb task end removes them.
  pollTdd() {
    if (this.tdd !== null || this.last === null) return;
    const entry = this.last.stages?.find(({ name, status }) => name === TDD_STAGE && status === "done");
    if (entry === undefined) return;
    const dir = join(this.out, "tdd");
    try {
      cpSync(join(this.taskDir, "artifacts"), join(dir, "artifacts"), { recursive: true });
    } catch {
      return;
    }
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(this.last, null, 2));
    this.tdd = { dir, artifacts: join(dir, "artifacts"), ledger: this.last, entry };
  }
}

// One light reviewer per refactored cycle: each test whose GREEN code-tdd recorded at this attempt has exactly one lens
// return filed for it, valid against the light-review schema, and the stage filed no identify-* return.
function assertLightReviews(tdd) {
  const stage = { name: TDD_STAGE, attempt: tdd.entry.attempt };
  const filed = returnsAt(tdd.artifacts, stage);
  const identify = filed.filter(({ role }) => role.startsWith("identify-"));
  check(identify.length === 0, `${TDD_STAGE} filed identify-* returns: ${identify.map(({ pbKey }) => pbKey)}`);
  const perTest = tdd.ledger.tests?.perTest ?? {};
  const cycles = Object.keys(perTest).filter((id) => perTest[id].green?.done && perTest[id].green.stage === TDD_STAGE && perTest[id].green.attempt === stage.attempt);
  check(cycles.length > 0, `${TDD_STAGE} recorded no GREEN, so no cycle was refactored`);
  const lens = filed.filter(({ role }) => role === LENS_ROLE);
  for (const id of cycles) {
    const reviews = lens.filter(({ item }) => item === id);
    check(reviews.length === 1, `cycle ${id} has ${reviews.length} light-review returns, expected 1: ${reviews.map(({ pbKey }) => pbKey)}`);
    const result = readReturn(tdd.artifacts, reviews[0].pbKey);
    check(result !== null, `the light-review return under ${reviews[0].pbKey} does not echo its key`);
    const problems = violations(LIGHT_REVIEW_SCHEMA, result);
    check(problems.length === 0, `the return under ${reviews[0].pbKey} breaks light-review-result.schema.json: ${problems}`);
  }
  const strays = lens.filter(({ item }) => !cycles.includes(item));
  check(strays.length === 0, `light-review returns for no refactored cycle: ${strays.map(({ pbKey }) => pbKey)}`);
  return { cycles: cycles.length, reviewers: lens.length };
}

function lensKeys(stage) {
  return LENS_CONFIG.lenses.map((lens) => ({ lens, key: buildKey({ stage: STAGE, role: LENS_ROLE, item: lensSlug(lens.name), round: 1, attempt: stage.attempt }) }));
}

function assertLensReturns({ artifacts }, keys) {
  check(keys.length > 0, `contracts/lenses.json wires no lens for ${STAGE}`);
  return keys.map(({ lens, key }) => {
    const { stage, role, item } = parseKey(key);
    check(stage === STAGE && role === LENS_ROLE && item === lensSlug(lens.name), `the lens key ${key} names ${stage} ${role} ${item}`);
    check(existsSync(join(artifacts, `${key}.json`)), `no lens return is filed under ${key}: ${readdirSync(artifacts)}`);
    const result = readReturn(artifacts, key);
    check(result !== null, `the return under ${key} does not echo its key`);
    const problems = violations(LENS_SCHEMA, result);
    check(problems.length === 0, `the return under ${key} breaks lens-result.schema.json: ${problems}`);
    return { lens, result };
  });
}

// The verdicts filed at this attempt, each checked against its key and the findings the ranked lens return sent. The
// latest round per finding speaks, through the same acceptVerdict the workflow and the report use.
function assertVerdicts({ artifacts }, stage, returns) {
  const plan = rankLensReturns(returns, LENS_CONFIG);
  const sentIds = plan.sent.map(({ id }) => id);
  const filed = returnsAt(artifacts, stage).filter(({ role }) => role === REFUTER_ROLE).sort((a, b) => a.round - b.round);
  check(filed.length <= ROW.maxRefuters, `${filed.length} refuter verdicts are filed in ${STAGE}, over maxRefuters ${ROW.maxRefuters}`);
  const latest = new Map();
  for (const { item, pbKey } of filed) {
    const verdict = readReturn(artifacts, pbKey);
    check(verdict !== null, `the return under ${pbKey} does not echo its key`);
    const problems = violations(REFUTER_SCHEMA, verdict);
    check(problems.length === 0, `the return under ${pbKey} breaks refuter-verdict.schema.json: ${problems}`);
    check(verdict.finding_id === item, `the verdict under ${pbKey} names finding ${verdict.finding_id}, its key names ${item}`);
    check(sentIds.includes(item), `the verdict under ${pbKey} names ${item}, which the ranked lens return did not send (sent: ${sentIds})`);
    latest.set(item, acceptVerdict(item, verdict));
  }
  return { plan, filed: filed.length, verdicts: [...latest.values()].filter((verdict) => verdict !== null) };
}

function assertReport({ dir }, stage, returns, verdicts) {
  const report = readJson(join(dir, "report.json"));
  check(report.stage === STAGE && report.attempt === stage.attempt, `the report is for ${report.stage} attempt ${report.attempt}`);
  for (const list of ["survivors", "refuted", "unrefuted", "uncovered"]) check(Array.isArray(report[list]), `report ${list} is ${typeof report[list]}`);
  const merged = mergeLensReturns(returns, LENS_CONFIG, verdicts);
  for (const list of ["survivors", "refuted", "unrefuted"]) {
    check(isDeepStrictEqual(report[list], merged[list]), `report ${list} differ from the merge of the recorded returns and verdicts: ${report[list].length} vs ${merged[list].length}`);
  }
  check(isDeepStrictEqual(report.uncovered, merged.uncovered), `report uncovered is ${JSON.stringify(report.uncovered)}, the merge gives ${JSON.stringify(merged.uncovered)}`);
  check(!report.notCovered.includes("no lens round ran in this stage"), "the report says no lens round ran");
  return { report, merged };
}

// The workflow's own return, from the background task's output file the stream names.
function workflowReturn(stream) {
  for (const { event } of stream) {
    if (event.type !== "system" || event.subtype !== "task_notification" || typeof event.output_file !== "string") continue;
    try {
      const output = readJson(event.output_file);
      if (output.result?.lensAttack !== undefined && output.result.pbKey?.startsWith(`${STAGE}.`)) return output.result;
    } catch {
      // not a workflow's JSON output
    }
  }
  return null;
}

function assertSpend({ artifacts, entry }, stage, keys, report, wfReturn, refuterSpawns) {
  // The finishing runner's return is filed after the stage finish it ran, so stage finish counts that runner from the
  // harness transcript instead; the snapshot runner's, round 1, is filed before and counts as a return.
  const filed = returnsAt(artifacts, stage).filter(({ role, round }) => !(role === RUNNER_ROLE && round > 1));
  check(filed.some(({ role, round }) => role === RUNNER_ROLE && round === 1), `no snapshot runner return (runner r1) is filed at attempt ${stage.attempt}`);
  const lensFiled = filed.filter(({ role }) => role === LENS_ROLE).map(({ pbKey }) => pbKey);
  check(isDeepStrictEqual(lensFiled, keys.map(({ key }) => key).sort()), `lens returns at attempt ${stage.attempt} are ${lensFiled}`);
  const counted = filed.length + 1;
  check(report.spend.agents === counted && entry.spend.agents === counted, `spend agents is ${report.spend.agents} in the report and ${entry.spend.agents} in the ledger, with ${filed.length} returns filed before stage finish (snapshot runner and lens included) and the finishing runner`);
  check(/runner that ran stage finish/.test(report.spend.agentsSource), `the report's agentsSource is ${JSON.stringify(report.spend.agentsSource)}, so stage finish did not find its runner in the transcript`);
  // D9's live check: budget.spent() reached stage finish through the transcript, as output tokens.
  check(report.spend.tokensKnown === true && report.spend.tokens > 0 && report.spend.tokensUnit === "output tokens", `the report's token figure is ${JSON.stringify(report.spend)}`);
  check(entry.spend.tokensKnown === true && entry.spend.tokens === report.spend.tokens, `the ledger's stage spend is ${JSON.stringify(entry.spend)}`);
  check(wfReturn !== null, "no code-scenarios workflow return was found in the stream's task output files");
  check(wfReturn.lensAttack.agentsUsed === keys.length + refuterSpawns, `lensAttack.agentsUsed is ${wfReturn.lensAttack.agentsUsed}, expected ${keys.length} lenses + ${refuterSpawns} refuters`);
  for (const list of ["survivors", "refuted", "unrefuted", "uncovered"]) {
    check(isDeepStrictEqual(wfReturn.lensAttack[list], report[list]), `the workflow's merged ${list} differs from the report's`);
  }
  return { filed: filed.length, counted, agentsUsed: wfReturn.lensAttack.agentsUsed, tokens: report.spend.tokens };
}

const transcriptModels = (path) => [...new Set(readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter(({ type }) => type === "assistant").map(({ message }) => message.model))];

const labelOf = (text) => {
  try {
    return parseLabel(text);
  } catch {
    return null;
  }
};

// Every agent the workflow spawned whose label names this stage, from the metas beside the transcripts.
function stageAgents(stream) {
  return transcriptDirs(stream).filter(existsSync).flatMap((dir) => readdirSync(dir).filter((file) => /^agent-.*\.meta\.json$/.test(file)).map((file) => ({ dir, file, meta: readJson(join(dir, file)) }))).filter(({ meta }) => labelOf(meta.description)?.stage === STAGE);
}

// The caps: refuter spawns within the row's maxRefuters, all the stage's agents within its maxAgents.
function assertCaps(agents) {
  const refuters = agents.filter(({ meta }) => meta.agentType === `pairingbuddy:${REFUTER_ROLE}`);
  check(refuters.length <= ROW.maxRefuters, `${refuters.length} refuters spawned in ${STAGE}, over maxRefuters ${ROW.maxRefuters}`);
  check(agents.length <= MAX_AGENTS, `${agents.length} agents spawned in ${STAGE}, over maxAgents ${MAX_AGENTS}`);
  return { refuters: refuters.length, agents: agents.length, maxRefuters: ROW.maxRefuters, maxAgents: MAX_AGENTS };
}

// Each lens agent's transcript, beside the meta the recorder reads for its label, names the model that answered.
function assertLensModels(agents, keys, env) {
  const lensAgents = agents.filter(({ meta }) => meta.agentType === "pairingbuddy:lens");
  check(lensAgents.length === keys.length, `${lensAgents.length} lens agents ran in ${STAGE}, expected ${keys.length}`);
  return keys.map(({ lens }) => {
    const expected = env[MODEL_ENV(lens.model)];
    const found = lensAgents.find(({ meta }) => meta.description.includes(` ${lens.name} `)) ?? lensAgents[0];
    const models = transcriptModels(join(found.dir, found.file.replace(/\.meta\.json$/, ".jsonl")));
    check(expected !== undefined, `the smoke env maps no model for the alias ${lens.model}`);
    check(isDeepStrictEqual(models, [expected]), `lens ${lens.name} (${lens.model}) answered as ${models}, expected ${expected}`);
    return { lens: lens.name, alias: lens.model, model: expected };
  });
}

// pb snapshot ran, through the stage's round-1 runner and before any lens: its three files are in the run dir the stage
// left, the corpus holds paths inside the repo only, and the runner and the workflow's return relayed that same corpus.
function assertSnapshot({ run, artifacts }, stage, repo, agents, wfReturn) {
  for (const file of [SUBJECT_DIFF_FILE, CHANGED_FILE, CORPUS_FILE]) check(existsSync(join(run, file)), `run/${file} is missing when ${STAGE} is done`);
  check(Array.isArray(readJson(join(run, CHANGED_FILE))), `run/${CHANGED_FILE} is not a list`);
  const { paths } = readJson(join(run, CORPUS_FILE));
  check(Array.isArray(paths) && paths.every((p) => typeof p === "string"), `run/${CORPUS_FILE} does not hold {paths: [strings]}`);
  const top = realpathSync(repo);
  for (const p of paths) {
    check(!isAbsolute(p) && !p.split("/").includes(".."), `the corpus path ${p} is not repo-relative`);
    const real = existsSync(join(repo, p)) ? realpathSync(join(repo, p)) : resolve(top, p);
    check(real.startsWith(top + sep), `the corpus path ${p} resolves to ${real}, outside the repo ${top}`);
  }
  const key = buildKey({ stage: STAGE, role: RUNNER_ROLE, item: null, round: 1, attempt: stage.attempt });
  const relayed = readReturn(artifacts, key);
  check(relayed !== null, `no snapshot runner return is filed under ${key}`);
  const printed = (() => {
    try {
      return JSON.parse(relayed.cli_output);
    } catch {
      return null;
    }
  })();
  check(relayed.cli_exit_code === 0 && printed?.ok === true && isDeepStrictEqual(printed.paths, paths), `the snapshot runner relayed exit ${relayed.cli_exit_code} and ${relayed.cli_output.slice(0, 200)}, not the corpus in run/${CORPUS_FILE}`);
  check(wfReturn?.snapshot?.pbKey === key && isDeepStrictEqual(wfReturn.snapshot.result, relayed), `the workflow's return does not carry the snapshot runner's return under ${key}`);
  // The runner that ran it was spawned before every lens.
  const started = ({ dir, file }) => Date.parse(JSON.parse(readFileSync(join(dir, file.replace(/\.meta\.json$/, ".jsonl")), "utf8").split("\n")[0]).timestamp);
  const snapshotRunner = agents.find(({ meta }) => meta.agentType === `pairingbuddy:${RUNNER_ROLE}` && labelOf(meta.description)?.round === 1);
  check(snapshotRunner !== undefined, `no ${STAGE} runner r1 agent ran`);
  const lenses = agents.filter(({ meta }) => meta.agentType === `pairingbuddy:${LENS_ROLE}`);
  check(lenses.every((lens) => started(lens) > started(snapshotRunner)), "a lens agent started before the snapshot runner");
  // The lens prompt names the corpus or not: recorded, not judged, since the workflow hands it to lensAttack's config.
  const prompts = lenses.map(({ dir, file }) => JSON.stringify(JSON.parse(readFileSync(join(dir, file.replace(/\.meta\.json$/, ".jsonl")), "utf8").split("\n")[0]).message?.content ?? ""));
  const promptNamesCorpus = prompts.every((text) => text.includes(CORPUS_FILE) || (paths.length > 0 && paths.every((p) => text.includes(p))));
  return { paths: paths.length, runner: key, promptNamesCorpus };
}

const transcriptOf = ({ dir, file }) => join(dir, file.replace(/\.meta\.json$/, ".jsonl"));
const transcriptLines = (agent) => readFileSync(transcriptOf(agent), "utf8").trim().split("\n").map((line) => JSON.parse(line));

function gateDecision(payload, cwd) {
  const run = spawnSync(process.execPath, [GATE], { cwd, input: JSON.stringify(payload), encoding: "utf8", env: cleanEnv(), timeout: 30_000 });
  check(run.status === 0, `hooks/gate.mjs exited ${run.status}: ${run.stderr}`);
  if (run.stdout.trim() === "") return { decision: "none", reason: "" };
  const { permissionDecision, permissionDecisionReason } = JSON.parse(run.stdout).hookSpecificOutput;
  return { decision: permissionDecision, reason: permissionDecisionReason };
}

// A Read outside the repo, as the lens agent would send it (its recorded agent id, type and session), goes to the real
// gate with the run's state in place: the live run dir if pb task end left one, else the captured copy put back for the call.
function assertOutOfCorpusReadDenied(captured, repo, record, agents) {
  const lens = agents.find(({ meta }) => meta.agentType === `pairingbuddy:${LENS_ROLE}`);
  check(lens !== undefined, `no lens agent ran in ${STAGE}`);
  const first = transcriptLines(lens).find((line) => typeof line.sessionId === "string");
  const runDir = join(repo, ".pairingbuddy", "run");
  const state = existsSync(join(runDir, "task", "ledger.json")) ? "live" : "captured";
  // Only what the copy adds is taken away again: run/ itself can outlive the unit, and a copied unit.json left behind
  // would read as a unit that never closed.
  const added = state === "captured" ? readdirSync(captured.run).filter((name) => !existsSync(join(runDir, name))) : [];
  const dirAdded = state === "captured" && !existsSync(runDir);
  if (state === "captured") cpSync(captured.run, runDir, { recursive: true, force: false, errorOnExist: false });
  const outsideFile = join(record, "outside-the-repo.txt");
  writeFileSync(outsideFile, "not in the corpus\n");
  const payload = (filePath) => ({
    session_id: first.sessionId,
    transcript_path: transcriptOf(lens),
    cwd: repo,
    permission_mode: "auto",
    agent_id: lens.file.slice("agent-".length, -".meta.json".length),
    agent_type: lens.meta.agentType,
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: filePath },
    tool_use_id: "toolu_s4_out_of_corpus",
  });
  try {
    const denied = [outsideFile, transcriptOf(lens)].map((path) => ({ path, ...gateDecision(payload(path), repo) }));
    for (const { path, decision, reason } of denied) {
      check(decision === "deny", `the gate gave ${decision} for a lens Read of ${path}, outside the repo`);
      check(/outside the repo/.test(reason), `the gate denied the lens Read of ${path} for another rule: ${reason}`);
    }
    const { paths } = readJson(join(captured.run, CORPUS_FILE));
    const inside = join(repo, paths[0] ?? "README.md");
    const allowed = gateDecision(payload(inside), repo);
    check(allowed.decision !== "deny", `the gate denied a lens Read of ${inside}, inside the repo: ${allowed.reason}`);
    return { state, denied: denied.length, insideAllowed: true };
  } finally {
    if (dirAdded) rmSync(runDir, { recursive: true, force: true });
    else for (const name of added) rmSync(join(runDir, name), { recursive: true, force: true });
  }
}

// The lens agent's own calls under confinement: no tool result is an error or a denial, each read passed the gate's
// PreToolUse hook, and the lens returned through StructuredOutput.
function assertLensCallsAllowed(agents) {
  const lenses = agents.filter(({ meta }) => meta.agentType === `pairingbuddy:${LENS_ROLE}`);
  const counts = { calls: 0, reads: 0, structuredOutputs: 0 };
  for (const lens of lenses) {
    const lines = transcriptLines(lens);
    const blocks = lines.flatMap(({ message }) => (Array.isArray(message?.content) ? message.content : []));
    const uses = blocks.filter(({ type }) => type === "tool_use");
    const results = new Map(blocks.filter(({ type }) => type === "tool_result").map((block) => [block.tool_use_id, block]));
    const preHooks = lines.filter(({ attachment }) => attachment?.hookEvent === "PreToolUse");
    for (const { id, name } of uses) {
      counts.calls += 1;
      const result = results.get(id);
      check(result !== undefined, `the lens ${name} call ${id} has no result`);
      check(result.is_error !== true, `the lens ${name} call ${id} failed or was denied: ${JSON.stringify(result.content).slice(0, 300)}`);
      const denials = preHooks.filter(({ attachment }) => attachment.toolUseID === id && /"permissionDecision\\?":\\?"deny/.test(JSON.stringify(attachment)));
      check(denials.length === 0, `the gate denied the lens ${name} call ${id}`);
      if (READ_TOOLS.includes(name)) {
        counts.reads += 1;
        check(preHooks.some(({ attachment }) => attachment.toolUseID === id && attachment.hookName === `PreToolUse:${name}`), `the lens ${name} call ${id} never reached the gate's PreToolUse hook`);
      }
      if (name === "StructuredOutput") counts.structuredOutputs += 1;
    }
  }
  check(counts.structuredOutputs >= lenses.length, `${counts.structuredOutputs} StructuredOutput calls from ${lenses.length} lens agents`);
  return counts;
}

// The registered matcher reaches the read tools in the live session: when the main context read anything, the stream
// shows the gate's PreToolUse hook for a read tool.
function assertReadsReachGate(stream) {
  const reads = stream.flatMap(({ event }) => (event.type === "assistant" ? event.message.content : [])).filter((block) => block.type === "tool_use" && READ_TOOLS.includes(block.name)).length;
  const hooked = stream.filter(({ event }) => READ_TOOLS.some((tool) => event.hook_name === `PreToolUse:${tool}`)).length;
  check(reads === 0 || hooked > 0, `the main context made ${reads} read calls and none reached the gate's PreToolUse hook`);
  return { mainReads: reads, readHookEvents: hooked };
}

// The sample repo's test command, behind force-red.mjs: the first safety-net fix's test run fails, once, so the fix
// loop has a red fix to roll back. The fixture lives outside the sample repo and only this test-config names it.
function forceFirstFixRed(repo, marker) {
  const path = join(repo, ".pairingbuddy", "test-config.json");
  const config = readJson(path);
  const runner = config.runners[config.default_runner];
  runner.command = `node ${FORCE_RED} ${marker} ${runner.command}`;
  writeFileSync(path, JSON.stringify(config));
}

export const codeSnapshots = (snapshots) => snapshots.filter(({ kind }) => kind === "code");
const publishSnapshots = (snapshots) => snapshots.filter(({ kind }) => kind === "publish");

// The human's own pb call, from this shell: no claude, no policy env, the shim first on PATH.
export function humanPb(repo, gh, pluginDir, ...args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(pluginDir, "cli", "pb.mjs"), ...args], { cwd: repo, env: { ...cleanEnv(), ...gh.env() }, encoding: "utf8" });
  return { code: status, stdout, stderr };
}

export const sessionOf = (stream) => stream.map(({ event }) => event.session_id).find((id) => typeof id === "string") ?? null;

export function readLedgerOrNull(repo) {
  try {
    return readJson(join(repo, ".pairingbuddy", "run", "task", "ledger.json"));
  } catch {
    return null;
  }
}

// The safety net's lens record: on the code run's ledger once the stage is done, copied into the unit's task record,
// with the lens names and models the lens map wires for this type and counts only.
function assertSafetyNetRecord(snapshots, unit, type) {
  const withRecord = codeSnapshots(snapshots).filter(({ lenses }) => lenses?.["safety-net"] !== undefined);
  check(withRecord.length > 0, `no code-run ledger holds a safety-net lens record; the last code ledger is at ${codeSnapshots(snapshots).at(-1)?.stage?.name}`);
  const record = withRecord.at(-1).lenses["safety-net"];
  check(isDeepStrictEqual(Object.keys(record).sort(), LENS_RECORD_KEYS), `the safety-net lens record has the fields ${Object.keys(record).sort()}`);
  const wired = wiredLensConfig(LENS_MAP, SAFETY_NET, type).lenses.map(({ name, model }) => ({ name, model }));
  check(record.stage === SAFETY_NET && Number.isInteger(record.attempt), `the lens record is for ${record.stage} attempt ${record.attempt}`);
  check(isDeepStrictEqual(record.lenses, wired), `the lens record names ${JSON.stringify(record.lenses)}, the lens map wires ${JSON.stringify(wired)} for ${type}`);
  for (const count of ["survivors", "refuted", "unrefuted"]) check(Number.isInteger(record[count]) && record[count] >= 0, `the lens record's ${count} is ${JSON.stringify(record[count])}, not a count`);
  check(Array.isArray(record.uncovered) && record.uncovered.every((name) => wired.some((lens) => lens.name === name)), `the lens record's uncovered is ${JSON.stringify(record.uncovered)}`);
  check(unit !== null && unit.tasks?.length === 1, `the unit record seen last has ${unit?.tasks?.length ?? "no"} task records`);
  check(isDeepStrictEqual(unit.tasks[0].lenses?.["safety-net"], record), "the unit's task record does not carry the ledger's safety-net lens record");
  return record;
}

// The forced red fix was rolled back: the code run's ledger records a red rollback of a safety-net fix with its private
// ref, that ref held the saved work while the run was live, and nothing of refs/pairingbuddy/ ever reached the remote.
function assertRollback(snapshots, recorder, marker, branch) {
  const fixes = codeSnapshots(snapshots).at(-1)?.fixes ?? {};
  const rollbacks = (fixes.rollbacks ?? []).filter(({ key }) => parseKey(key).stage === SAFETY_NET);
  const fixReturns = existsSync(recorder.allArtifacts) ? readdirSync(recorder.allArtifacts).filter((file) => file.startsWith(`${SAFETY_NET}.fix.`)) : [];
  check(rollbacks.length > 0, `no safety-net fix was rolled back: ${fixReturns.length} fix returns were filed and the forced red ${existsSync(marker) ? "fired" : "never fired"}`);
  check(existsSync(marker), "a safety-net fix was rolled back, but the forced red never fired");
  const red = rollbacks.find(({ kind }) => kind === "red");
  check(red !== undefined, `the safety-net rollbacks are ${JSON.stringify(rollbacks.map(({ kind }) => kind))}, none red`);
  const prefix = `refs/pairingbuddy/${branch}/rollback/${SAFETY_NET}/`;
  check(typeof red.ref === "string" && red.ref.startsWith(prefix) && typeof red.sha === "string", `the red rollback's ref is ${JSON.stringify(red.ref)} at ${red.sha}, expected one under ${prefix}`);
  check(recorder.refsSeen.get(red.ref) === red.sha, `${red.ref} was seen at ${recorder.refsSeen.get(red.ref) ?? "nothing"} while the run was live, the ledger says ${red.sha}`);
  return { rollbacks: rollbacks.length, kinds: rollbacks.map(({ kind }) => kind), ref: red.ref, failedAttempts: fixes.rollbacks.length };
}

const bare = (remote, ...args) => execFileSync("git", ["--git-dir", remote, ...args], { encoding: "utf8", env: cleanEnv() }).trim();

// G:publish passed with its binding, and pb publish opened one draft PR on the shim from the unit branch into develop at
// the bound HEAD, closed the unit and left no private ref anywhere. The pass is the auto policy's, unless the gate asked
// for another reason than a missing lens record (an open ambiguity, say) and S4 approved it as the human; the draft flag
// comes from the auto policy either way.
export function assertDraftPr(snapshots, gh, repo, remote, branch, humanApprovals) {
  const lastPublish = publishSnapshots(snapshots).at(-1);
  check(lastPublish !== undefined, "no publish run was seen");
  check(lastPublish.needsHuman === null, `the publish run asks the human at ${lastPublish.needsHuman?.gate}: ${lastPublish.needsHuman?.reason}`);
  const passed = publishSnapshots(snapshots).map(({ gates }) => gates?.[PUBLISH_GATE]).filter((record) => record !== undefined).at(-1);
  const asked = humanApprovals.find(({ gate }) => gate === PUBLISH_GATE);
  const source = asked === undefined ? "auto" : "human-cli";
  check(passed?.source === source && passed.answer === "approve", `${PUBLISH_GATE} is ${JSON.stringify(passed)}, expected a ${source} approval`);
  check(asked === undefined || asked.reason !== LENS_REASON, `${PUBLISH_GATE} asked for a lens record: ${asked?.reason}`);
  check(typeof passed.headSha === "string" && typeof passed.bodyHash === "string" && passed.target === BASE, `the ${source} approval carries no binding into ${BASE}: ${JSON.stringify(passed)}`);
  const creates = gh.prCreates();
  check(creates.length === 1, `gh saw ${creates.length} pr create calls`);
  const [{ argv, bodyFile }] = creates;
  check(argv.includes("--draft"), `pr create has no --draft: ${argv}`);
  check(isDeepStrictEqual(flagValues(argv, "--base"), [BASE]) && isDeepStrictEqual(flagValues(argv, "--head"), [branch]), `pr create goes from ${flagValues(argv, "--head")} into ${flagValues(argv, "--base")}`);
  const heads = Object.fromEntries(bare(remote, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/").split("\n").filter(Boolean).map((line) => line.split(" ")));
  check(heads[branch] === passed.headSha, `the remote has ${branch} at ${heads[branch]}, the auto pass bound ${passed.headSha}`);
  check(bare(remote, "for-each-ref", "refs/pairingbuddy/") === "", "refs/pairingbuddy/ reached the remote");
  const local = execFileSync("git", ["for-each-ref", `refs/pairingbuddy/${branch}/`], { cwd: repo, encoding: "utf8", env: cleanEnv() }).trim();
  check(local === "", `pb publish left the unit's refs: ${local}`);
  check(!existsSync(join(repo, ".pairingbuddy", "run", "unit.json")), "run/unit.json is still there, so the unit did not close");
  return { title: flagValues(argv, "--title")[0], body: bodyFile ?? "", headSha: passed.headSha, gate: source, askedFor: asked?.reason ?? null };
}

// Every lens finding's claim, from every lens return any stage filed.
function findingClaims(allArtifacts) {
  if (!existsSync(allArtifacts)) return [];
  return readdirSync(allArtifacts).filter((file) => file.endsWith(".json")).flatMap((file) => {
    let parts;
    try {
      parts = parseKey(file.slice(0, -".json".length));
    } catch {
      return [];
    }
    if (parts.role !== LENS_ROLE) return [];
    const result = readReturn(allArtifacts, file.slice(0, -".json".length));
    return (result?.findings ?? []).map(({ claim }) => claim).filter((claim) => typeof claim === "string" && claim.trim().length >= MIN_CLAIM);
  });
}

// No finding's words reach the run record, the unit record or the PR: each claim is looked for verbatim.
function assertNoFindingContent(claims, snapshots, unit, pr) {
  const places = { ledger: snapshots.map((ledger) => JSON.stringify(ledger)).join("\n"), unit: JSON.stringify(unit ?? {}), "PR title": pr.title ?? "", "PR body": pr.body };
  for (const claim of claims) {
    for (const [place, text] of Object.entries(places)) check(!text.includes(claim.trim()), `a finding's claim shows in the ${place}: ${JSON.stringify(claim.slice(0, 120))}`);
  }
  return { claims: claims.length, places: Object.keys(places) };
}

async function runS4(budget, record, out, type, task, pluginDir) {
  // /code opens a unit first, and a unit needs a base on a remote: S3's repo, with its recording gh first on PATH.
  const { repo, remote } = makeS3Repo(record, type, STALE_DOCS[type]);
  const marker = join(record, "force-red.marker");
  forceFirstFixRed(repo, marker);
  const outside = mkdtempSync(join(tmpdir(), "pb-smoke-s4-outside-"));
  const gh = installGhShim({ parent: record, remember: true });
  const env = assertCleanEnv({ ...cleanEnv(), ...gh.env() });
  const recorder = new ScenariosRecorder(repo, out, { streamPath: join(record, "stream.jsonl") }).start();
  const result = { passed: false, cause: "", runNote: "", humanApprovals: [] };
  try {
    let prompt = `/pairingbuddy:code ${task}`;
    let resume = null;
    for (;;) {
      try {
        await runClaude(repo, prompt, budget, { env, onLine: (event) => recorder.line(event), pluginDir, resume, timeoutMs: RUN_TIMEOUT_MS });
      } catch (e) {
        // The run may end badly: S4 judges what it left.
        if (!(e instanceof SmokeError)) throw e;
        result.runNote = `${e.constructor.name}: ${e.message}`;
        if (e instanceof SpendCapError) break;
      }
      recorder.poll();
      // A gate that asks is the human's to answer, and S4 answers it as the human would, then resumes. A G:publish that
      // asks because a lens record is missing is the failure S4 exists to catch, so it is never answered.
      const ledger = readLedgerOrNull(repo);
      const asking = ledger?.stop === null ? ledger.needsHuman : null;
      if (!asking || (asking.gate === PUBLISH_GATE && asking.reason === LENS_REASON) || result.humanApprovals.length >= MAX_HUMAN_APPROVALS) break;
      const approved = humanPb(repo, gh, pluginDir, "human", "approve", asking.gate);
      check(approved.code === 0, `the human's pb human approve ${asking.gate}: exit ${approved.code}, ${approved.stderr}`);
      result.humanApprovals.push({ gate: asking.gate, reason: asking.reason });
      prompt = `I ran the approve command for ${asking.gate}. Continue.`;
      resume = sessionOf(recorder.stream);
      check(resume !== null, "the run's stream has no session id to resume");
    }
    recorder.poll();
    const captured = recorder.captured;
    check(captured !== null, `the scenarios stage never finished; ${result.runNote}`);
    const stage = { name: STAGE, attempt: captured.entry.attempt };
    const keys = lensKeys(stage);
    const returns = assertLensReturns(captured, keys);
    const refuting = assertVerdicts(captured, stage, returns);
    const { report } = assertReport(captured, stage, returns, refuting.verdicts);
    const agents = stageAgents(recorder.stream);
    result.caps = assertCaps(agents);
    const wfReturn = workflowReturn(recorder.stream);
    if (wfReturn !== null) writeFileSync(join(captured.dir, "workflow-return.json"), JSON.stringify(wfReturn, null, 2));
    result.spend = assertSpend(captured, stage, keys, report, wfReturn, result.caps.refuters);
    result.models = assertLensModels(agents, keys, env);
    result.snapshot = assertSnapshot(captured, stage, repo, agents, wfReturn);
    result.confinement = { ...assertOutOfCorpusReadDenied(captured, repo, outside, agents), lensCalls: assertLensCallsAllowed(agents), session: assertReadsReachGate(recorder.stream) };
    const findings = refuting.plan.sent.length + refuting.plan.pastCut.length;
    if (type === "new_feature") {
      check(recorder.tdd !== null, `the ${TDD_STAGE} stage never finished, so the light review cannot be judged; ${result.runNote}`);
      result.lightReview = assertLightReviews(recorder.tdd);
    }
    result.refuters = { findings, sent: refuting.plan.sent.length, spawned: result.caps.refuters, filed: refuting.filed, note: findings === 0 ? "no findings to refute: the refuter checks hold vacuously" : "" };
    if (findings === 0) console.log("S4: the lens returned no findings, so no findings to refute; the refuter checks hold vacuously");
    // What each stage recorded through pb stage finish, for the spend record.
    result.stageSpend = Object.fromEntries((recorder.last?.stages ?? []).map(({ name, spend }) => [name, spend ?? null]));
    result.keys = keys.map(({ key }) => key);
    result.counts = { survivors: report.survivors.length, refuted: report.refuted.length, unrefuted: report.unrefuted.length, uncovered: report.uncovered.length };
    // The safety net, its forced rollback, and the draft PR the auto policy publishes.
    const branch = recorder.unit?.branch;
    check(typeof branch === "string", "no unit record was seen, so the unit branch is unknown");
    result.safetyNet = assertSafetyNetRecord(recorder.snapshots, recorder.unit, type);
    result.rollback = assertRollback(recorder.snapshots, recorder, marker, branch);
    const pr = assertDraftPr(recorder.snapshots, gh, repo, remote, branch, result.humanApprovals);
    result.pr = { title: pr.title, headSha: pr.headSha, gate: pr.gate, askedFor: pr.askedFor };
    result.findingContent = assertNoFindingContent(findingClaims(recorder.allArtifacts), recorder.snapshots, recorder.unit, pr);
    result.passed = true;
  } catch (e) {
    if (!(e instanceof SmokeError)) throw e;
    result.cause = `${e.message}; ${position(recorder.last)}`;
  } finally {
    recorder.stop();
  }
  return { ...result, type, costUsd: Number(budget.spent.toFixed(6)), costKnown: budget.costKnown, seconds: Number(recorder.seconds().toFixed(1)) };
}

async function main() {
  const { type, budgetUsd, recordDir, recording, task, pluginDir } = parseOptions(process.argv.slice(2));
  const record = recordDir ?? mkdtempSync(join(tmpdir(), "pb-smoke-s4-"));
  mkdirSync(record, { recursive: true });
  const out = join(RECORDINGS, recording ?? `s4-${new Date().toISOString().replaceAll(":", "-")}`);
  const result = await runS4(new Budget(budgetUsd), record, out, type, task, pluginDir);
  console.log(JSON.stringify(result));
  console.log(`${result.passed ? "PASS" : "FAIL"} S4, $${result.costUsd}, repo in ${record}, recorded in ${out}`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
