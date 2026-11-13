// Verbatim from tests/smoke/recordings/probe-2/ledger.jsonl, trimmed to the snapshots at seq 1, 3, 5, 7 and 10 to 16 (the ones that carry per-test results).
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
 },
 {
  "t": 81.778,
  "ledger": {
   "v": 1,
   "seq": 10,
   "sha": "b20756bb68aad28c5cc3aed09bf15917fb05c0823b7596500e282029a048fb02",
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
    "runId": "wf_c4cab36d-4f8",
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
   "tests": {
    "perTest": {
     "ten-percent-off-hundred": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_hundred_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": false,
       "sha": null,
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n___________________ test_ten_percent_off_hundred_returns_90 ____________________\n\n    def test_ten_percent_off_hundred_returns_90():\n        result = apply_discount(100, 10)\n    \n>       assert result == 90\nE       assert 10.0 == 90\n\ntests/test_discount.py:11: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_hundred_returns_90 - asse...\n1 failed in 0.01s\n",
       "head": "9e7035987e09da448d46feb6800c4a3c77e162b6"
      }
     }
    }
   },
   "commits": [
    "9e7035987e09da448d46feb6800c4a3c77e162b6"
   ],
   "retries": {},
   "spend": {
    "agents": 1,
    "tokens": 0,
    "tokensKnown": false
   },
   "stop": null,
   "needsHuman": null,
   "checkpoints": [
    {
     "step": "placeholders",
     "key": "code-tdd.create-test-placeholders.-.r1.a1",
     "committed": true,
     "sha": "9e7035987e09da448d46feb6800c4a3c77e162b6",
     "stage": "code-tdd",
     "attempt": 1
    }
   ]
  }
 },
 {
  "t": 81.8,
  "ledger": {
   "v": 1,
   "seq": 11,
   "sha": "7d316957616d462c2587e0354081bc144e73a9e9157a2e8743235ba9afa8d071",
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
    "runId": "wf_c4cab36d-4f8",
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
   "tests": {
    "perTest": {
     "ten-percent-off-hundred": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_hundred_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "5643302fd9ff69843bbd965441c46e5272094208",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n___________________ test_ten_percent_off_hundred_returns_90 ____________________\n\n    def test_ten_percent_off_hundred_returns_90():\n        result = apply_discount(100, 10)\n    \n>       assert result == 90\nE       assert 10.0 == 90\n\ntests/test_discount.py:11: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_hundred_returns_90 - asse...\n1 failed in 0.01s\n",
       "head": "9e7035987e09da448d46feb6800c4a3c77e162b6"
      }
     }
    }
   },
   "commits": [
    "9e7035987e09da448d46feb6800c4a3c77e162b6",
    "5643302fd9ff69843bbd965441c46e5272094208"
   ],
   "retries": {},
   "spend": {
    "agents": 1,
    "tokens": 0,
    "tokensKnown": false
   },
   "stop": null,
   "needsHuman": null,
   "checkpoints": [
    {
     "step": "placeholders",
     "key": "code-tdd.create-test-placeholders.-.r1.a1",
     "committed": true,
     "sha": "9e7035987e09da448d46feb6800c4a3c77e162b6",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "5643302fd9ff69843bbd965441c46e5272094208",
     "stage": "code-tdd",
     "attempt": 1
    }
   ]
  }
 },
 {
  "t": 94.564,
  "ledger": {
   "v": 1,
   "seq": 12,
   "sha": "3841331acafad36de509fee044fa54c497aa711f0ad797723f0ad495af0f2ae2",
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
    "runId": "wf_c4cab36d-4f8",
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
   "tests": {
    "perTest": {
     "ten-percent-off-hundred": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_hundred_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "5643302fd9ff69843bbd965441c46e5272094208",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n___________________ test_ten_percent_off_hundred_returns_90 ____________________\n\n    def test_ten_percent_off_hundred_returns_90():\n        result = apply_discount(100, 10)\n    \n>       assert result == 90\nE       assert 10.0 == 90\n\ntests/test_discount.py:11: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_hundred_returns_90 - asse...\n1 failed in 0.01s\n",
       "head": "9e7035987e09da448d46feb6800c4a3c77e162b6"
      },
      "green": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": false,
       "sha": null,
       "passed": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "5643302fd9ff69843bbd965441c46e5272094208"
      }
     }
    }
   },
   "commits": [
    "9e7035987e09da448d46feb6800c4a3c77e162b6",
    "5643302fd9ff69843bbd965441c46e5272094208"
   ],
   "retries": {},
   "spend": {
    "agents": 1,
    "tokens": 0,
    "tokensKnown": false
   },
   "stop": null,
   "needsHuman": null,
   "checkpoints": [
    {
     "step": "placeholders",
     "key": "code-tdd.create-test-placeholders.-.r1.a1",
     "committed": true,
     "sha": "9e7035987e09da448d46feb6800c4a3c77e162b6",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "5643302fd9ff69843bbd965441c46e5272094208",
     "stage": "code-tdd",
     "attempt": 1
    }
   ]
  }
 },
 {
  "t": 94.607,
  "ledger": {
   "v": 1,
   "seq": 13,
   "sha": "85b21fe2ca521f206a5fdf56ece52446300a5baa5a1a74dd24d489de9029a04f",
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
    "runId": "wf_c4cab36d-4f8",
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
   "tests": {
    "perTest": {
     "ten-percent-off-hundred": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_hundred_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "5643302fd9ff69843bbd965441c46e5272094208",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n___________________ test_ten_percent_off_hundred_returns_90 ____________________\n\n    def test_ten_percent_off_hundred_returns_90():\n        result = apply_discount(100, 10)\n    \n>       assert result == 90\nE       assert 10.0 == 90\n\ntests/test_discount.py:11: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_hundred_returns_90 - asse...\n1 failed in 0.01s\n",
       "head": "9e7035987e09da448d46feb6800c4a3c77e162b6"
      },
      "green": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "2ae1fed4056de7594b49f0551b400cc31f82d54a",
       "passed": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "5643302fd9ff69843bbd965441c46e5272094208"
      }
     }
    }
   },
   "commits": [
    "9e7035987e09da448d46feb6800c4a3c77e162b6",
    "5643302fd9ff69843bbd965441c46e5272094208",
    "2ae1fed4056de7594b49f0551b400cc31f82d54a"
   ],
   "retries": {},
   "spend": {
    "agents": 1,
    "tokens": 0,
    "tokensKnown": false
   },
   "stop": null,
   "needsHuman": null,
   "checkpoints": [
    {
     "step": "placeholders",
     "key": "code-tdd.create-test-placeholders.-.r1.a1",
     "committed": true,
     "sha": "9e7035987e09da448d46feb6800c4a3c77e162b6",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "5643302fd9ff69843bbd965441c46e5272094208",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "green",
     "key": "code-tdd.implement-code.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "2ae1fed4056de7594b49f0551b400cc31f82d54a",
     "stage": "code-tdd",
     "attempt": 1
    }
   ]
  }
 },
 {
  "t": 110.507,
  "ledger": {
   "v": 1,
   "seq": 14,
   "sha": "e914c911bf15e4ac0193b84f4e04c0b4311bd436c831112d159e8cdcce9456d0",
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
    "runId": "wf_c4cab36d-4f8",
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
   "tests": {
    "perTest": {
     "ten-percent-off-hundred": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_hundred_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "5643302fd9ff69843bbd965441c46e5272094208",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n___________________ test_ten_percent_off_hundred_returns_90 ____________________\n\n    def test_ten_percent_off_hundred_returns_90():\n        result = apply_discount(100, 10)\n    \n>       assert result == 90\nE       assert 10.0 == 90\n\ntests/test_discount.py:11: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_hundred_returns_90 - asse...\n1 failed in 0.01s\n",
       "head": "9e7035987e09da448d46feb6800c4a3c77e162b6"
      },
      "green": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "2ae1fed4056de7594b49f0551b400cc31f82d54a",
       "passed": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "5643302fd9ff69843bbd965441c46e5272094208"
      }
     },
     "zero-percent-keeps-full-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_zero_percent_keeps_full_price"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": false,
       "sha": null,
       "passed": false,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "2ae1fed4056de7594b49f0551b400cc31f82d54a"
      }
     }
    }
   },
   "commits": [
    "9e7035987e09da448d46feb6800c4a3c77e162b6",
    "5643302fd9ff69843bbd965441c46e5272094208",
    "2ae1fed4056de7594b49f0551b400cc31f82d54a"
   ],
   "retries": {},
   "spend": {
    "agents": 1,
    "tokens": 0,
    "tokensKnown": false
   },
   "stop": null,
   "needsHuman": null,
   "checkpoints": [
    {
     "step": "placeholders",
     "key": "code-tdd.create-test-placeholders.-.r1.a1",
     "committed": true,
     "sha": "9e7035987e09da448d46feb6800c4a3c77e162b6",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "5643302fd9ff69843bbd965441c46e5272094208",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "green",
     "key": "code-tdd.implement-code.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "2ae1fed4056de7594b49f0551b400cc31f82d54a",
     "stage": "code-tdd",
     "attempt": 1
    }
   ]
  }
 },
 {
  "t": 123.392,
  "ledger": {
   "v": 1,
   "seq": 15,
   "sha": "66dfe1c9e6ff6c711025fa4f17651e4304ee125593e34e6799eb5ef87bc4fea7",
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
    "runId": "wf_c4cab36d-4f8",
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
   "tests": {
    "perTest": {
     "ten-percent-off-hundred": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_hundred_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "5643302fd9ff69843bbd965441c46e5272094208",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n___________________ test_ten_percent_off_hundred_returns_90 ____________________\n\n    def test_ten_percent_off_hundred_returns_90():\n        result = apply_discount(100, 10)\n    \n>       assert result == 90\nE       assert 10.0 == 90\n\ntests/test_discount.py:11: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_hundred_returns_90 - asse...\n1 failed in 0.01s\n",
       "head": "9e7035987e09da448d46feb6800c4a3c77e162b6"
      },
      "green": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "2ae1fed4056de7594b49f0551b400cc31f82d54a",
       "passed": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "5643302fd9ff69843bbd965441c46e5272094208"
      }
     },
     "zero-percent-keeps-full-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_zero_percent_keeps_full_price"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": false,
       "sha": null,
       "passed": false,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "2ae1fed4056de7594b49f0551b400cc31f82d54a"
      }
     }
    }
   },
   "commits": [
    "9e7035987e09da448d46feb6800c4a3c77e162b6",
    "5643302fd9ff69843bbd965441c46e5272094208",
    "2ae1fed4056de7594b49f0551b400cc31f82d54a"
   ],
   "retries": {},
   "spend": {
    "agents": 1,
    "tokens": 0,
    "tokensKnown": false
   },
   "stop": null,
   "needsHuman": null,
   "checkpoints": [
    {
     "step": "placeholders",
     "key": "code-tdd.create-test-placeholders.-.r1.a1",
     "committed": true,
     "sha": "9e7035987e09da448d46feb6800c4a3c77e162b6",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "5643302fd9ff69843bbd965441c46e5272094208",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "green",
     "key": "code-tdd.implement-code.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "2ae1fed4056de7594b49f0551b400cc31f82d54a",
     "stage": "code-tdd",
     "attempt": 1
    }
   ]
  }
 },
 {
  "t": 139.689,
  "ledger": {
   "v": 1,
   "seq": 16,
   "sha": "3cc3064c85c6d29d0e477cd8e628f78ed1d400249310e2869cc9c1148b590149",
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
    "runId": "wf_c4cab36d-4f8",
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
   "tests": {
    "perTest": {
     "ten-percent-off-hundred": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_hundred_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "5643302fd9ff69843bbd965441c46e5272094208",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n___________________ test_ten_percent_off_hundred_returns_90 ____________________\n\n    def test_ten_percent_off_hundred_returns_90():\n        result = apply_discount(100, 10)\n    \n>       assert result == 90\nE       assert 10.0 == 90\n\ntests/test_discount.py:11: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_hundred_returns_90 - asse...\n1 failed in 0.01s\n",
       "head": "9e7035987e09da448d46feb6800c4a3c77e162b6"
      },
      "green": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "2ae1fed4056de7594b49f0551b400cc31f82d54a",
       "passed": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "5643302fd9ff69843bbd965441c46e5272094208"
      }
     },
     "zero-percent-keeps-full-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_zero_percent_keeps_full_price"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": false,
       "sha": null,
       "passed": false,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "2ae1fed4056de7594b49f0551b400cc31f82d54a"
      }
     }
    }
   },
   "commits": [
    "9e7035987e09da448d46feb6800c4a3c77e162b6",
    "5643302fd9ff69843bbd965441c46e5272094208",
    "2ae1fed4056de7594b49f0551b400cc31f82d54a"
   ],
   "retries": {},
   "spend": {
    "agents": 1,
    "tokens": 0,
    "tokensKnown": false
   },
   "stop": {
    "reason": "step-failed: a step of the stage failed past its retries, and a re-run continues from tests{}",
    "seq": 16
   },
   "needsHuman": null,
   "checkpoints": [
    {
     "step": "placeholders",
     "key": "code-tdd.create-test-placeholders.-.r1.a1",
     "committed": true,
     "sha": "9e7035987e09da448d46feb6800c4a3c77e162b6",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "5643302fd9ff69843bbd965441c46e5272094208",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "green",
     "key": "code-tdd.implement-code.ten-percent-off-hundred.r1.a1",
     "committed": true,
     "sha": "2ae1fed4056de7594b49f0551b400cc31f82d54a",
     "stage": "code-tdd",
     "attempt": 1
    }
   ]
  }
 }
]
