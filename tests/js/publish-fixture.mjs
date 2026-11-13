// Shared setup for the tests of the PR draft and the G:publish gate: a repo with a unit open, commits on the unit
// branch, the draft artifact and run/pr-body.md the tap would have written, and a ledger on the pr-draft stage.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { updateLedger, writeLedger } from "../../shared-node/ledger.mjs";
import { loadStages } from "../../shared-node/stages.mjs";
import { baseLedger } from "./ledger-fixture.mjs";
import { env, makeRepo, pb, ROOT } from "./cli-repo-fixture.mjs";
import { fixture, recordedAnswer, runTap, SESSION, sha256 } from "./tap-fixture.mjs";

export const CLEAN_TITLE = "feat: add export button";
export const CLEAN_BODY = "## Summary\n\nAdds an export button to the report page so a reader can download the table as CSV.\n\n## Impact\n\nReaders get a new button; nothing else changes.\n";
export const COORDINATION = "Touches the report table; tell the reports team before merging.";
export const GATE = "G:publish";
export const BAD_TITLE = "Added the export button";
export const HYPE_BODY = `${CLEAN_BODY}\nA seamless way to export.\n`;
export const draftKey = (attempt) => `pr-draft.draft-pull-request.-.r1.a${attempt}`;

export const git = (repo, ...args) => execFileSync("git", args, { cwd: repo.dir, env: env(), encoding: "utf8" }).trim();

// A repo with a unit open, `commits` commits on the unit branch, the draft artifacts the tap would have filed (one per
// attempt in titles, keyed by attempt number), run/pr-body.md, and a ledger on the pr-draft stage at ledgerAttempt.
// ledger overrides fields of that ledger. recorded lists the SHAs of the commits made.
export function repoWithDrafts({ titles, body, ledgerAttempt = 1, commits = 1, coordination = null, ledger = {} }) {
  const repo = makeRepo({ openTask: false, remote: true });
  const opened = pb(repo, "unit", "open", "--type", "feat", "--slug", "export", "--yes");
  assert.equal(opened.code, 0, `unit open: ${opened.stderr}`);
  const recorded = [];
  for (let n = 1; n <= commits; n++) {
    writeFileSync(join(repo.dir, `export-${n}.txt`), `export ${n}\n`);
    git(repo, "add", `export-${n}.txt`);
    git(repo, "commit", "-q", "-m", `feat: add export ${n}`);
    recorded.push(git(repo, "rev-parse", "HEAD"));
  }
  const runDir = join(repo.dir, ".pairingbuddy", "run");
  mkdirSync(join(runDir, "task", "artifacts"), { recursive: true });
  writeFileSync(join(runDir, "pr-body.md"), body);
  for (const [attempt, title] of Object.entries(titles)) {
    writeFileSync(join(runDir, "task", "artifacts", `${draftKey(attempt)}.json`), JSON.stringify({ pb_key: draftKey(attempt), title, body, labels: [], base: "main", coordination }));
  }
  writeLedger(join(runDir, "task", "ledger.json"), {
    ...baseLedger(),
    stage: { name: "pr-draft", status: "active", runId: "r1", attempt: ledgerAttempt },
    stages: [],
    ...ledger,
  });
  return { repo, runDir, recorded };
}

// The task type whose graph has the pr-draft node.
export function publishTaskType() {
  const { taskTypes } = loadStages(ROOT);
  const name = Object.keys(taskTypes).find((candidate) => taskTypes[candidate].nodes.some((node) => node.name === "pr-draft"));
  assert.ok(name, "some task type has a pr-draft node");
  return name;
}

// The gate policy is recorded by the gate hook from a main-context call's permission_mode, as it is in a real run.
export function setPolicyThroughGate(repo, mode) {
  const { agent_id: _id, agent_type: _type, ...base } = fixture("pretooluse-workflow.json");
  const payload = { ...base, session_id: SESSION, cwd: repo.dir, permission_mode: mode, tool_name: "Bash", tool_input: { command: "ls", description: "list" } };
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(ROOT, "hooks", "gate-boot.mjs")], { cwd: repo.dir, input: JSON.stringify(payload), env: env({ PAIRINGBUDDY_GATE_POLICY: undefined }), encoding: "utf8" });
  assert.equal(status, 0, `the gate hook: ${stderr}`);
  assert.equal(stdout, "", "the gate hook allows the call");
  assert.deepEqual(repo.ledger().policy, { mode, source: "permission_mode" });
}

// A publish unit: repoWithDrafts with the pr-draft stage done (or active), the policy `mode` recorded by the gate hook,
// and `pb pr lint` already run, so G:publish is due. unit.json's commits are seeded with the SHAs made here: pb task
// end is what fills them in a real run, and it removes run/task and needs a finished, green task, so driving it here
// would test that command instead of the gate. The one test that needs the real writer says so where it is.
export function publishRepo({ commits = 1, title = CLEAN_TITLE, body = CLEAN_BODY, coordination = COORDINATION, stageStatus = "done", mode = "default" } = {}) {
  const { repo, runDir, recorded } = repoWithDrafts({ titles: { 1: title }, body, commits, coordination });
  const unitPath = join(runDir, "unit.json");
  writeFileSync(unitPath, JSON.stringify({ ...JSON.parse(readFileSync(unitPath, "utf8")), commits: recorded }, null, 2));
  const stage = { name: "pr-draft", status: stageStatus, runId: "r1", attempt: 1 };
  const ledgerPath = join(runDir, "task", "ledger.json");
  const configText = readFileSync(join(repo.dir, ".pairingbuddy", "test-config.json"), "utf8");
  updateLedger(ledgerPath, (ledger) => ({
    ...ledger,
    taskType: publishTaskType(),
    configHash: sha256(configText),
    owner: { sessionId: SESSION, lastSeen: null },
    stage,
    stages: stageStatus === "done" ? [{ name: "pr-draft", status: "done" }] : [],
  }));
  setPolicyThroughGate(repo, mode);
  const lint = pb(repo, "pr", "lint");
  assert.equal(lint.code, 0, `pr lint: ${lint.stderr}`);
  return { repo, runDir, recorded, lint: JSON.parse(lint.stdout) };
}

export const DRAFT_KEY = draftKey(1);
export const unitFile = (repo) => join(repo.dir, ".pairingbuddy", "run", "unit.json");
export const readUnitRecord = (repo) => JSON.parse(readFileSync(unitFile(repo), "utf8"));
export const gitConfigPath = (repo) => join(repo.dir, ".pairingbuddy", "git-config.json");
export const lintOf = (runDir) => JSON.parse(readFileSync(join(runDir, "pr-lint.json"), "utf8"));

export function evalGate(repo) {
  const result = pb(repo, "gate", "eval");
  assert.equal(result.code, 0, `pb gate eval exits 0, stdout ${result.stdout}, stderr ${result.stderr}`);
  return JSON.parse(result.stdout);
}

export function approvedThroughTap(repo) {
  const { question } = evalGate(repo);
  runTap(repo, recordedAnswer(repo, question, "publish"));
}

export function commitMore(repo, name = "late") {
  writeFileSync(join(repo.dir, `${name}.txt`), `${name}\n`);
  git(repo, "add", `${name}.txt`);
  git(repo, "commit", "-q", "-m", `feat: ${name}`);
}

// The question as a model could reword it: the same labels with other descriptions, so it is not the CLI's.
export const reworded = (question) => ({ ...question, options: question.options.map((option) => ({ ...option, description: "Looks fine, ship it." })) });

// pb exits 1 for a refusal (and 2 for bad arguments).
export const REFUSED = 1;
