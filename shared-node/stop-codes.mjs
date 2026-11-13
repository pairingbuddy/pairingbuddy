// Every stop code the CLI can write, with no imports, so the mod can load it too.
// Why a stage's own script may stop the run. A script has no shell, so this is how a stop reaches the ledger.
export const STAGE_STOP_REASONS = {
  "agent-budget": "agent-budget: the stage spawned its maxAgents, and a re-run continues from tests{}",
  "attempt-cap": "attempt-cap: the stage reached its cap of fix attempts, see pb status for the attempts and lessons",
  "step-failed": "step-failed: a step of the stage failed past its retries, and a re-run continues from tests{}",
};

// Stop codes the CLI writes itself; STOP_CODES adds the stage stops.
export const MISSING_ARTIFACT = "missing-artifact";
export const COMMIT_PLAN_UNUSABLE = "commit-plan-unusable";
export const COMMIT_FAILED = "commit-failed";
export const NO_SELECTOR_TEMPLATE = "no-selector-template";
export const HUMAN_STOPPED = "human-stopped";
export const ATTEMPT_CAP = "attempt-cap";
export const STOP_CODES = [MISSING_ARTIFACT, COMMIT_PLAN_UNUSABLE, COMMIT_FAILED, NO_SELECTOR_TEMPLATE, HUMAN_STOPPED, ...Object.keys(STAGE_STOP_REASONS)];
