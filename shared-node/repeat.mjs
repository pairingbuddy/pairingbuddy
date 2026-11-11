// The repeat rule, once: a gate pass on a repeating node records the unit just explored, and while any unit
// remains unexplored the stage repeats and the gate is open again.
import { parseKey } from "./keys.mjs";
import { REPEAT_STATUS, graphFor, withStageStatus } from "./stage-graph.mjs";

// The node that repeats behind this gate, or undefined when the gate's node does not repeat.
export function repeatingNode(contract, taskType, gateName) {
  const { taskType: resolved } = graphFor(contract, taskType);
  return contract.taskTypes[resolved].nodes.find((candidate) => candidate.gate === gateName && candidate.repeat === true);
}

// The checkpoint step that records a unit is named once, in the node's evidence ("checkpoint:<step>").
function unitStep(node) {
  return node.evidence.find((item) => item.startsWith("checkpoint:")).slice("checkpoint:".length);
}

// Call only when repeatingNode(contract, taskType, gateName) is defined: the gate's node repeats.
export function repeatAfterPass(contract, ledger, gateName, unitIds) {
  const node = repeatingNode(contract, ledger.taskType, gateName);
  const { name } = node;
  const step = unitStep(node);
  const checkpoint = ledger.checkpoints.find((candidate) => candidate.attempt === ledger.stage.attempt && candidate.step === step);
  if (checkpoint === undefined) return ledger;
  const entry = ledger.stages.find((stage) => stage.name === name);
  const explored = [...new Set([...(entry.explored ?? []), parseKey(checkpoint.key).item])];
  const recorded = { ...ledger, stages: ledger.stages.map((stage) => (stage.name === name ? { ...stage, explored } : stage)) };
  if (unitIds.every((id) => explored.includes(id))) return recorded;
  const { [gateName]: _removed, ...gates } = recorded.gates;
  return withStageStatus({ ...recorded, gates }, name, REPEAT_STATUS);
}
