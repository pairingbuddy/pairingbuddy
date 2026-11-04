// The human-guidance entry the mod writes for a typed suggestion, shared so a test checks the real shape against the schema.
// Pure and import-free, so the mod can load it.
export function suggestionEntry({ timestamp, context, feedback }) {
  return { agent: "orchestrator", timestamp, context, feedback, task_scoped: true };
}
