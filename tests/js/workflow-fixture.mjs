import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeLedger } from "../../shared-node/ledger.mjs";
import { afterIntake, withTypePassed } from "./ledger-fixture.mjs";
import { ROOT, fixture } from "./gate-harness.mjs";

// Shared by the gate tests: a scratch repo with a signed ledger, a scratch plugin root, and Workflow call payloads.

export const CONFIG = "code-config";
export const SAFETY_NET = "code-safety-net";
export const workflowName = (stage) => `pairingbuddy:${stage}`;
export const BUNDLE_PATH = join(ROOT, "workflows", `${CONFIG}.js`);
export const BUNDLE = readFileSync(BUNDLE_PATH, "utf8");
export const SAFETY_NET_BUNDLE = "export const meta = { name: 'code-safety-net' };\n";
export const GOOD_ARGS = { pluginRoot: ROOT, attempt: 1, task: { description: "set x" } };

export const EXPIRED = "2026-01-01T00:00:00.000Z";

export const IDLE_STAGE = { name: "", status: "", runId: null, attempt: 0, startedAt: null };
export const activeStage = (name, attempt = 1, startedAt = EXPIRED) => ({ name, status: "active", runId: "wf_1", attempt, startedAt });
// An active stage with no recorded run. By default its start lease has long expired.
export const unstartedStage = (name, attempt = 1, startedAt = EXPIRED) => ({ name, status: "active", runId: null, attempt, startedAt });

export function makeLedger({ stage = IDLE_STAGE, stages = [], stop = null } = {}) {
  return {
    v: 1, seq: 0, sha: "0".repeat(64), kind: "code", taskType: "config_change",
    owner: { sessionId: null, lastSeen: null }, task: "Task 23",
    plan: { path: "", title: "" }, configHash: "a".repeat(64),
    policy: { mode: "", source: "" }, stage, stages: afterIntake(stages),
    gates: withTypePassed(), tests: {}, commits: [], retries: {}, spend: { agents: 0, tokens: 0 },
    stop, needsHuman: null,
  };
}

export function makeRepo({ ledger = makeLedger(), git = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-")));
  if (git) execFileSync("git", ["init", "-q"], { cwd: dir });
  const ledgerPath = join(dir, ".pairingbuddy", "run", "task", "ledger.json");
  if (ledger) {
    mkdirSync(join(dir, ".pairingbuddy", "run", "task"), { recursive: true });
    writeLedger(ledgerPath, ledger);
  }
  return { dir, ledgerPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function withRepo(opts, fn) {
  const repo = makeRepo(opts);
  try {
    await fn(repo);
  } finally {
    repo.cleanup();
  }
}

// A scratch plugin root: the real contracts, plus only the bundles the test names.
export function makePlugin({ bundles = { [CONFIG]: BUNDLE, [SAFETY_NET]: SAFETY_NET_BUNDLE }, contract = null } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-plugin-")));
  mkdirSync(join(dir, "contracts"));
  mkdirSync(join(dir, "workflows"));
  copyFileSync(join(ROOT, "contracts", "agent-config.yaml"), join(dir, "contracts", "agent-config.yaml"));
  if (contract) writeFileSync(join(dir, "contracts", "stages.json"), JSON.stringify(contract));
  else copyFileSync(join(ROOT, "contracts", "stages.json"), join(dir, "contracts", "stages.json"));
  for (const [stage, text] of Object.entries(bundles)) writeFileSync(join(dir, "workflows", `${stage}.js`), text);
  return dir;
}

export async function withPlugin(opts, fn) {
  const dir = makePlugin(opts);
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function workflowCall(cwd, toolInput) {
  return { ...fixture("pretooluse-workflow.json"), cwd, tool_input: toolInput };
}

export const stageCall = (cwd, stage, args = GOOD_ARGS, extra = {}) => workflowCall(cwd, { name: workflowName(stage), args, ...extra });
export const stageNamed = (cwd, name) => workflowCall(cwd, { name, args: GOOD_ARGS });
