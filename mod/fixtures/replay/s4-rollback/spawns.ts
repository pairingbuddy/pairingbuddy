// Verbatim from tests/smoke/recordings/s4-t85-run4/spawns.jsonl (trimmed: task_started, task_progress and task_notification rows dropped). The kit loads only code files, so the recording is a module.
export default [
 {
  "t": 1.577,
  "kind": "Skill",
  "name": "pairingbuddy:coding"
 },
 {
  "t": 9.98,
  "kind": "Agent",
  "name": "pairingbuddy:curate-guidance"
 },
 {
  "t": 24.477,
  "kind": "Agent",
  "name": "pairingbuddy:classify-task"
 },
 {
  "t": 41.408,
  "kind": "Skill",
  "name": "pairingbuddy:code-scenarios"
 },
 {
  "t": 43.507,
  "kind": "Workflow",
  "name": "pairingbuddy:code-scenarios"
 },
 {
  "t": 43.636,
  "kind": "workflow_agent",
  "name": "pb1 code-scenarios - enumerate-scenarios-and-test-cases - r1",
  "id": "a0c95bf9c8863385c",
  "agentType": "pairingbuddy:enumerate-scenarios-and-test-cases",
  "phase": "enumerate-scenarios-and-test-cases",
  "seconds": 3.73
 },
 {
  "t": 47.4,
  "kind": "workflow_agent",
  "name": "pb1 code-scenarios - runner - r1",
  "id": "a046c7fd79050a165",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.477
 },
 {
  "t": 50.759,
  "kind": "workflow_agent",
  "name": "pb1 code-scenarios - lens necessity r1",
  "id": "aafdec40a58718096",
  "agentType": "pairingbuddy:lens",
  "phase": "runner",
  "seconds": 1.422
 },
 {
  "t": 52.188,
  "kind": "workflow_agent",
  "name": "pb1 code-scenarios - runner - r2",
  "id": "aaff1db8587d8313b",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.84
 },
 {
  "t": 62.074,
  "kind": "Skill",
  "name": "pairingbuddy:code-tdd"
 },
 {
  "t": 63.519,
  "kind": "Workflow",
  "name": "pairingbuddy:code-tdd"
 },
 {
  "t": 63.775,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - runner - r1",
  "id": "a9efd91f5d51c51c6",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.758
 },
 {
  "t": 67.15,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - create-test-placeholders - r1",
  "id": "ac614987d406af2fd",
  "agentType": "pairingbuddy:create-test-placeholders",
  "phase": "create-test-placeholders",
  "seconds": 9.622
 },
 {
  "t": 76.854,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - runner - r2",
  "id": "a179508dddd1e9d02",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.924
 },
 {
  "t": 80.553,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED implement-tests apply-discount-10-percent-100-returns-90 r1",
  "id": "a2bf30b22206e6e9f",
  "agentType": "pairingbuddy:implement-tests",
  "phase": "implement-tests",
  "seconds": 11.16
 },
 {
  "t": 91.848,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd RED runner apply-discount-10-percent-100-returns-90 r1",
  "id": "a8b10520ea0e6141e",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.381
 },
 {
  "t": 95.957,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd GREEN implement-code apply-discount-10-percent-100-returns-90 r1",
  "id": "a2cf1725cf233b2b2",
  "agentType": "pairingbuddy:implement-code",
  "phase": "implement-code",
  "seconds": 8.54
 },
 {
  "t": 104.904,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd GREEN runner apply-discount-10-percent-100-returns-90 r2",
  "id": "a826fec0308830363",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.595
 },
 {
  "t": 109.061,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - verify-test-coverage - r1",
  "id": "ad00cb1c640a7833e",
  "agentType": "pairingbuddy:verify-test-coverage",
  "phase": "verify-test-coverage",
  "seconds": 6.21
 },
 {
  "t": 115.374,
  "kind": "workflow_agent",
  "name": "pb1 code-tdd - runner - r3",
  "id": "a60741545070c460e",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.996
 },
 {
  "t": 124.569,
  "kind": "Skill",
  "name": "pairingbuddy:code-safety-net"
 },
 {
  "t": 125.932,
  "kind": "Workflow",
  "name": "pairingbuddy:code-safety-net"
 },
 {
  "t": 126.218,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - runner - r1",
  "id": "a20682f4f2f7fb85a",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.57
 },
 {
  "t": 129.712,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - lens code r1",
  "id": "a9b5e6d1baaec264d",
  "agentType": "pairingbuddy:lens",
  "phase": "runner",
  "seconds": 4.405
 },
 {
  "t": 129.716,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - lens tests r1",
  "id": "a8adc8191c10f9b5b",
  "agentType": "pairingbuddy:lens",
  "phase": "runner",
  "seconds": 4.784
 },
 {
  "t": 129.718,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - lens corpus-misalignment r1",
  "id": "aa9f8983e41a71966",
  "agentType": "pairingbuddy:lens",
  "phase": "runner",
  "seconds": 4.786
 },
 {
  "t": 134.562,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - refuter code-1 r1",
  "id": "a0f7351bc3f024d37",
  "agentType": "pairingbuddy:refuter",
  "phase": "runner",
  "seconds": 5.141
 },
 {
  "t": 134.565,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - refuter corpus-misalignment-1 r1",
  "id": "aaec73b4839fb2989",
  "agentType": "pairingbuddy:refuter",
  "phase": "runner",
  "seconds": 3.48
 },
 {
  "t": 134.568,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - refuter tests-1 r1",
  "id": "a1e99ff9d256a11e8",
  "agentType": "pairingbuddy:refuter",
  "phase": "runner",
  "seconds": 3.818
 },
 {
  "t": 139.741,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - fix g1 r2",
  "id": "a5b413a4e1a9c5070",
  "agentType": "pairingbuddy:refactor-code",
  "phase": "runner",
  "seconds": 7.903
 },
 {
  "t": 148.631,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - runner g1 r2",
  "id": "a720205b99293d075",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.493
 },
 {
  "t": 152.058,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - runner g1-rollback r2",
  "id": "aea61131cdf6bb584",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.882
 },
 {
  "t": 156.928,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - fix g1 r3",
  "id": "aa137156e85d43660",
  "agentType": "pairingbuddy:refactor-code",
  "phase": "runner",
  "seconds": 6.606
 },
 {
  "t": 163.587,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - runner g1 r3",
  "id": "ada27c78172015e6f",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.446
 },
 {
  "t": 166.784,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - fix g2 r4",
  "id": "a94b703ee4b2c2000",
  "agentType": "pairingbuddy:refactor-code",
  "phase": "runner",
  "seconds": 6.34
 },
 {
  "t": 173.188,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - runner g2 r4",
  "id": "a0a5745d1958aebb4",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.259
 },
 {
  "t": 177.004,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - course-checker g2 r4",
  "id": "acec86e5187b53820",
  "agentType": "pairingbuddy:course-checker",
  "phase": "runner",
  "seconds": 3.244
 },
 {
  "t": 180.381,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - fix g3 r5",
  "id": "ad95ff85bb1a9e422",
  "agentType": "pairingbuddy:refactor-tests",
  "phase": "runner",
  "seconds": 8.589
 },
 {
  "t": 189.107,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - runner g3 r5",
  "id": "a686207fab23aa926",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.146
 },
 {
  "t": 192.973,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - course-checker g3 r5",
  "id": "a8067855fee0882db",
  "agentType": "pairingbuddy:course-checker",
  "phase": "runner",
  "seconds": 2.903
 },
 {
  "t": 196.077,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - update-documentation - r1",
  "id": "a06b8550a990d5760",
  "agentType": "pairingbuddy:update-documentation",
  "phase": "update-documentation",
  "seconds": 3.059
 },
 {
  "t": 199.403,
  "kind": "workflow_agent",
  "name": "pb1 code-safety-net - runner - r2",
  "id": "a27f8ce20a9f69cda",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 7.23
 },
 {
  "t": 228.248,
  "kind": "Skill",
  "name": "pairingbuddy:pr-draft"
 },
 {
  "t": 230.176,
  "kind": "Workflow",
  "name": "pairingbuddy:pr-draft"
 },
 {
  "t": 231.285,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - draft-pull-request - r1",
  "id": "aab0b2c1e1527dc95",
  "agentType": "pairingbuddy:draft-pull-request",
  "phase": "draft-pull-request",
  "seconds": 11.095
 },
 {
  "t": 242.41,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - runner - r1",
  "id": "ae3b0eb7ffd376899",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.141
 },
 {
  "t": 246.432,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - runner - r2",
  "id": "ad767a1d0a24214c1",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 3.627
 },
 {
  "t": 250.839,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - lens claims r1",
  "id": "a8f1e41af545b686d",
  "agentType": "pairingbuddy:lens",
  "phase": "runner",
  "seconds": 6.922
 },
 {
  "t": 250.842,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - lens permanence r1",
  "id": "a62af184cefbe08f7",
  "agentType": "pairingbuddy:lens",
  "phase": "runner",
  "seconds": 5.307
 },
 {
  "t": 257.782,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - fix g1 r2",
  "id": "aa8695da54dc32160",
  "agentType": "pairingbuddy:draft-pull-request",
  "phase": "runner",
  "seconds": 9.347
 },
 {
  "t": 267.234,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - runner g1 r2",
  "id": "a135064194f41eb34",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.677
 },
 {
  "t": 270.126,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - course-checker g1 r2",
  "id": "a745c28f54fadfc1d",
  "agentType": "pairingbuddy:course-checker",
  "phase": "runner",
  "seconds": 3.627
 },
 {
  "t": 273.779,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - fix g2 r3",
  "id": "a6265067529e3355e",
  "agentType": "pairingbuddy:draft-pull-request",
  "phase": "runner",
  "seconds": 8.531
 },
 {
  "t": 282.349,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - runner g2 r3",
  "id": "a89c653b6a18c5e06",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 2.592
 },
 {
  "t": 286.07,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - course-checker g2 r3",
  "id": "a955aeef5a9317ed2",
  "agentType": "pairingbuddy:course-checker",
  "phase": "runner",
  "seconds": 3.635
 },
 {
  "t": 289.731,
  "kind": "workflow_agent",
  "name": "pb1 pr-draft - runner - r3",
  "id": "ac689675be2e9a679",
  "agentType": "pairingbuddy:runner",
  "phase": "runner",
  "seconds": 5.508
 }
]
