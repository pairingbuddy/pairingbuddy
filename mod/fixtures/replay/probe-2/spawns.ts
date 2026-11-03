// Verbatim from tests/smoke/recordings/probe-2/spawns.jsonl (trimmed). The kit loads only code files, so the recording is a module.
export default [
 {
  "t": 8.312,
  "kind": "Agent",
  "name": "pairingbuddy:curate-guidance"
 },
 {
  "t": 20.123,
  "kind": "Agent",
  "name": "pairingbuddy:classify-task"
 },
 {
  "t": 34.342,
  "kind": "Workflow",
  "name": "pairingbuddy:code-scenarios"
 },
 {
  "t": 34.501,
  "kind": "workflow_agent",
  "name": "pb1 code-scenarios - enumerate-scenarios-and-test-cases - r1",
  "id": "aef127ce4c3eee279",
  "agentType": "pairingbuddy:enumerate-scenarios-and-test-cases",
  "phase": "enumerate-scenarios-and-test-cases",
  "seconds": 5.813
 },
 {
  "t": 41.062,
  "kind": "workflow_agent",
  "name": "pb1 code-scenarios - runner - r1",
  "id": "a1f223c826d8c4516",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.78
 },
 {
  "t": 51.558,
  "kind": "Workflow",
  "name": "pairingbuddy:code-tdd"
 },
 {
  "t": 51.941,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - runner - r1",
  "id": "aea507ca7b856464a",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.62
 },
 {
  "t": 55.611,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - create-test-placeholders - r1",
  "id": "ad8da4817b577fae0",
  "agentType": "pairingbuddy:create-test-placeholders",
  "phase": "create-test-placeholders",
  "seconds": 11.456
 },
 {
  "t": 67.806,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - runner - r2",
  "id": "abf26530c6d9a7984",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.941
 },
 {
  "t": 71.448,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED implement-tests ten-percent-off-hundred r1",
  "id": "af1bb7936972bf3e3",
  "agentType": "pairingbuddy:implement-tests",
  "phase": "implement-tests",
  "seconds": 7.942
 },
 {
  "t": 80.218,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED runner ten-percent-off-hundred r1",
  "id": "aad0f58a833f449d7",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.09
 },
 {
  "t": 84.175,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd GREEN implement-code ten-percent-off-hundred r1",
  "id": "a3ed78a45c3abc840",
  "agentType": "pairingbuddy:implement-code",
  "phase": "implement-code",
  "seconds": 7.926
 },
 {
  "t": 92.881,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd GREEN runner ten-percent-off-hundred r2",
  "id": "a849c33922fcf4ada",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.25
 },
 {
  "t": 97.082,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED implement-tests zero-percent-keeps-full-price r1",
  "id": "a05b72d12e5777f39",
  "agentType": "pairingbuddy:implement-tests",
  "phase": "implement-tests",
  "seconds": 10.47
 },
 {
  "t": 108.446,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED runner zero-percent-keeps-full-price r1",
  "id": "a3075aed54cbfffce",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.167
 },
 {
  "t": 112.35,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED implement-tests zero-percent-keeps-full-price r2",
  "id": "adce251cb64a22655",
  "agentType": "pairingbuddy:implement-tests",
  "phase": "implement-tests",
  "seconds": 8.702
 },
 {
  "t": 121.827,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED runner zero-percent-keeps-full-price r2",
  "id": "a09ea6b692b23b818",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.673
 },
 {
  "t": 125.887,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED implement-tests zero-percent-keeps-full-price r3",
  "id": "ada15a245fca5294e",
  "agentType": "pairingbuddy:implement-tests",
  "phase": "implement-tests",
  "seconds": 8.608
 },
 {
  "t": 135.221,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED runner zero-percent-keeps-full-price r3",
  "id": "a9394f6866c181938",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.607
 },
 {
  "t": 138.561,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - runner - r3",
  "id": "acb2e3c7ec4398533",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.579
 }
]
