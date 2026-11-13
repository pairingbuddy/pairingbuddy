// Limits shared by the workflow stages and the progress view.
// No imports, no Node APIs. The export sits alone at the start of a line so a bundler can inline this file by stripping `export `.

// How often one step is tried before the stage stops: a re-run starts these over, and a human stands between re-runs.
export const MAX_TRIES = 3;

// How many fix attempts the lenses allow before the stage stops; keep equal to maxAttempts in contracts/lenses.json.
export const MAX_FIX_UNDOS = 5;
