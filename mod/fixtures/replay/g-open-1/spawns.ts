// Verbatim from tests/smoke/recordings/g-open-1/spawns.jsonl (trimmed). The kit loads only code files, so the recording is a module.
export default [
 {
  "t": 21.031,
  "kind": "Agent",
  "name": "pairingbuddy:classify-task"
 },
 {
  "t": 32.51,
  "kind": "Workflow",
  "name": "pairingbuddy:code-scenarios"
 },
 {
  "t": 32.65,
  "kind": "workflow_agent",
  "name": "pb1 code-scenarios - enumerate-scenarios-and-test-cases - r1",
  "id": "afbf7634332689a4c",
  "agentType": "pairingbuddy:enumerate-scenarios-and-test-cases",
  "phase": "enumerate-scenarios-and-test-cases",
  "seconds": 6.044
 },
 {
  "t": 39.519,
  "kind": "workflow_agent",
  "name": "pb1 code-scenarios - runner - r1",
  "id": "a122e2fa6f6094711",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.843
 },
 {
  "t": 49.807,
  "kind": "Workflow",
  "name": "pairingbuddy:code-tdd"
 },
 {
  "t": 50.076,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - runner - r1",
  "id": "a7a49ef450bc51cb6",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.533
 },
 {
  "t": 53.328,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - create-test-placeholders - r1",
  "id": "adc43a99e4342cff0",
  "agentType": "pairingbuddy:create-test-placeholders",
  "phase": "create-test-placeholders",
  "seconds": 9.721
 },
 {
  "t": 147.905,
  "kind": "Workflow",
  "name": "pairingbuddy:code-safety-net"
 },
 {
  "t": 148.104,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - update-documentation - r1",
  "id": "a6e52f925f5257c0f",
  "agentType": "pairingbuddy:update-documentation",
  "phase": "update-documentation",
  "seconds": 3.883
 }
]
