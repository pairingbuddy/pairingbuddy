// The human-guidance entry the mod writes for a typed suggestion, shared so a test checks the real shape against the schema.
// Pure and import-free, so the mod can load it.
export function suggestionEntry({ timestamp, context, feedback }) {
  return { agent: "orchestrator", timestamp, context, feedback, task_scoped: true };
}

// The roles a stage spawns that never read human-guidance.json: they run pb, review through a lens, attack or check a finding.
// Every other role writes or fixes the code, the tests or the pull request with the guidance path in its prompt.
const NO_NOTE_ROLES = ["runner", "lens", "refuter", "course-checker", "synthesizer"];

export function readsNotes(role) {
  return typeof role === "string" && !NO_NOTE_ROLES.includes(role);
}
