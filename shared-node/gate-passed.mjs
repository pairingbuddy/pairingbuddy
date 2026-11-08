// Whether a gate counts as passed in a ledger. Pure: no fs, no node: imports, so the mod can import it.
const HUMAN_SOURCES = ["human", "human-cli"];

export function isPassed(ledger, gate) {
  if (ledger.needsHuman?.gate === gate) return false;
  const record = Object.hasOwn(ledger.gates, gate) ? ledger.gates[gate] : undefined;
  // G:publish: a human approval counts here even if HEAD or the body moved since. This is pure and cannot see HEAD; gate eval voids a stale one, and pb publish (Task 71) rechecks the binding (D17).
  return record?.source === "auto" || (HUMAN_SOURCES.includes(record?.source) && record.answer === "approve");
}
