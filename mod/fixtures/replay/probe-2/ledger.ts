// Verbatim from tests/smoke/recordings/probe-2/ledger.jsonl, trimmed to the snapshots at seq 1, 3, 5, 7.
// Every snapshot where the current stage or its status changed is kept; only repeats of a state are dropped.
// The kit loads only code files, so the recording is a module.
export default [
 {
  "t": 28.435,
  "ledger": {
   "v": 1,
   "seq": 1,
   "sha": "8d9933bf20b3d06af0b2aefa1aee9232040b6d896667b5810e18401a0110d37f",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": null,
    "lastSeen": null
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90",
   "plan": {
    "path": "",
    "title": ""
   },
   "configHash": "7f0e44e3b566f99a7f833786814dd84e0df93b5f018ef8b1b74f0681cec6d54d",
   "policy": {
    "mode": "",
    "source": ""
   },
   "stage": {
    "name": "",
    "status": "",
    "runId": null,
    "attempt": 0,
    "startedAt": null
   },
   "stages": [],
   "gates": {},
   "tests": {},
   "commits": [],
   "retries": {},
   "spend": {
    "agents": 0,
    "tokens": 0
   },
   "stop": null,
   "needsHuman": null
  }
 },
 {
  "t": 34.429,
  "ledger": {
   "v": 1,
   "seq": 3,
   "sha": "ea56f3ed03b6e8588664812da9ad0dccb1b103ab97b75520eb9476f8b3e0438d",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "47a1743a-08fb-4dae-a03b-1744f0417b32",
    "lastSeen": "2026-11-03T02:16:04.428Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90",
   "plan": {
    "path": "",
    "title": ""
   },
   "configHash": "7f0e44e3b566f99a7f833786814dd84e0df93b5f018ef8b1b74f0681cec6d54d",
   "policy": {
    "mode": "auto",
    "source": "permission_mode"
   },
   "stage": {
    "name": "code-scenarios",
    "status": "active",
    "runId": null,
    "attempt": 1,
    "startedAt": "2026-11-03T02:16:08.858Z"
   },
   "stages": [],
   "gates": {},
   "tests": {},
   "commits": [],
   "retries": {},
   "spend": {
    "agents": 0,
    "tokens": 0
   },
   "stop": null,
   "needsHuman": null
  }
 },
 {
  "t": 42.172,
  "ledger": {
   "v": 1,
   "seq": 5,
   "sha": "c8064eb167c782cd98e7b03fa2c86ac4de2d6bb526ebb94bc93024a160c2fde1",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "47a1743a-08fb-4dae-a03b-1744f0417b32",
    "lastSeen": "2026-11-03T02:16:04.428Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90",
   "plan": {
    "path": "",
    "title": ""
   },
   "configHash": "7f0e44e3b566f99a7f833786814dd84e0df93b5f018ef8b1b74f0681cec6d54d",
   "policy": {
    "mode": "auto",
    "source": "permission_mode"
   },
   "stage": {
    "name": "code-scenarios",
    "status": "done",
    "runId": "wf_f6ea24e9-b1b",
    "attempt": 1,
    "startedAt": "2026-11-03T02:16:08.858Z"
   },
   "stages": [
    {
     "name": "code-scenarios",
     "status": "done",
     "attempt": 1,
     "spend": {
      "agents": 1,
      "tokens": 0,
      "tokensKnown": false
     }
    }
   ],
   "gates": {},
   "tests": {},
   "commits": [],
   "retries": {},
   "spend": {
    "agents": 1,
    "tokens": 0,
    "tokensKnown": false
   },
   "stop": null,
   "needsHuman": null
  }
 },
 {
  "t": 51.647,
  "ledger": {
   "v": 1,
   "seq": 7,
   "sha": "00a484385a6d7c88db2662875bd4097ab4acdfef32cba5049f6f3459cebe78e9",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "47a1743a-08fb-4dae-a03b-1744f0417b32",
    "lastSeen": "2026-11-03T02:16:04.428Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90",
   "plan": {
    "path": "",
    "title": ""
   },
   "configHash": "7f0e44e3b566f99a7f833786814dd84e0df93b5f018ef8b1b74f0681cec6d54d",
   "policy": {
    "mode": "auto",
    "source": "permission_mode"
   },
   "stage": {
    "name": "code-tdd",
    "status": "active",
    "runId": null,
    "attempt": 1,
    "startedAt": "2026-11-03T02:16:26.076Z"
   },
   "stages": [
    {
     "name": "code-scenarios",
     "status": "done",
     "attempt": 1,
     "spend": {
      "agents": 1,
      "tokens": 0,
      "tokensKnown": false
     }
    }
   ],
   "gates": {
    "G:scenarios": {
     "source": "auto"
    }
   },
   "tests": {},
   "commits": [],
   "retries": {},
   "spend": {
    "agents": 1,
    "tokens": 0,
    "tokensKnown": false
   },
   "stop": null,
   "needsHuman": null
  }
 }
]
