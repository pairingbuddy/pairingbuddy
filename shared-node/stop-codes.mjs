// Every stop code the CLI can write, with no imports, so the mod can load it too.
// Why a stage's own script may stop the run. A script has no shell, so this is how a stop reaches the ledger.
export const STAGE_STOP_REASONS = {
  "agent-budget": "agent-budget: the stage spawned its maxAgents, and a re-run keeps every test already done",
  "attempt-cap": "attempt-cap: the stage reached its cap of fix attempts, see pb status for the attempts and lessons",
  "tests-red": "tests-red: refactoring starts only from green tests, and the full suite was not green when the stage started",
  "step-failed": "step-failed: a step of the stage failed past its retries, and a re-run keeps every test already done",
};

// Stop codes the CLI writes itself; STOP_CODES adds the stage stops.
export const MISSING_ARTIFACT = "missing-artifact";
export const COMMIT_PLAN_UNUSABLE = "commit-plan-unusable";
export const COMMIT_FAILED = "commit-failed";
export const NO_SELECTOR_TEMPLATE = "no-selector-template";
export const HUMAN_STOPPED = "human-stopped";
export const ATTEMPT_CAP = "attempt-cap";
// A test that passes at RED before any code: no retry can change that, so the CLI stops at the first one.
export const RED_PASSES = "red-passes";
// A draft label the repo does not have: the approved draft cannot change between publish retries, so the run stops at
// once and the draft is written again.
export const PR_LABEL_MISSING = "pr-label-missing";
// The views' own stop: no ledger holds it. They read it from the marker hooks/gate-watch.mjs leaves (shared-node/gate-off.mjs).
export const GATE_OFF = "gate-off";
export const STOP_CODES = [MISSING_ARTIFACT, COMMIT_PLAN_UNUSABLE, COMMIT_FAILED, NO_SELECTOR_TEMPLATE, HUMAN_STOPPED, RED_PASSES, PR_LABEL_MISSING, GATE_OFF, ...Object.keys(STAGE_STOP_REASONS)];
