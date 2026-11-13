// Verbatim from tests/smoke/recordings/g-open-1/ledger.jsonl, trimmed to the snapshots at seq 1, 3, 5, 7, 20, 21, 25 and 26.
// Every snapshot where the current stage or its status changed is kept; only repeats of a state are dropped.
// The kit loads only code files, so the recording is a module.
export default [
 {
  "t": 28.673,
  "ledger": {
   "v": 1,
   "seq": 1,
   "sha": "37cdad536b6e4c26df148ac407a770ec60bfae1a394c9b7a2f98703c911cc46d",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": null,
    "lastSeen": null
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. Cover the edge cases too, such as 0 and 100 percent",
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
  "t": 32.597,
  "ledger": {
   "v": 1,
   "seq": 3,
   "sha": "d8a245990964331d07a0d3c53eae6fd5ea9d2cf8e935bb88f5ea71b7f724c5ee",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "7cdabc43-0e70-4d16-bd00-b6317e0dae88",
    "lastSeen": "2026-11-03T07:10:27.194Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. Cover the edge cases too, such as 0 and 100 percent",
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
    "startedAt": "2026-11-03T07:10:29.429Z"
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
  "t": 40.589,
  "ledger": {
   "v": 1,
   "seq": 5,
   "sha": "47420e3706971214334d1f315e52a9ad239a13a3978594298fb7cfe359949a38",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "7cdabc43-0e70-4d16-bd00-b6317e0dae88",
    "lastSeen": "2026-11-03T07:10:27.194Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. Cover the edge cases too, such as 0 and 100 percent",
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
    "runId": "wf_e16ec758-e78",
    "attempt": 1,
    "startedAt": "2026-11-03T07:10:29.429Z"
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
  "t": 49.891,
  "ledger": {
   "v": 1,
   "seq": 7,
   "sha": "aaec1a038aa49742f62a9c505a6c4ef2a1c57518617076a49819f6cdbfaa42ad",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "7cdabc43-0e70-4d16-bd00-b6317e0dae88",
    "lastSeen": "2026-11-03T07:10:27.194Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. Cover the edge cases too, such as 0 and 100 percent",
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
    "startedAt": "2026-11-03T07:10:46.729Z"
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
  "t": 141.309,
  "ledger": {
   "v": 1,
   "seq": 20,
   "sha": "74ab258c6c55766d094a9b9bbb8d82d5548f94c958b84b0c436764ef04548e69",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "7cdabc43-0e70-4d16-bd00-b6317e0dae88",
    "lastSeen": "2026-11-03T07:10:27.194Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. Cover the edge cases too, such as 0 and 100 percent",
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
    "status": "done",
    "runId": "wf_e86bf999-eac",
    "attempt": 1,
    "startedAt": "2026-11-03T07:10:46.729Z"
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
    },
    {
     "name": "code-tdd",
     "status": "done",
     "attempt": 1,
     "spend": {
      "agents": 13,
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
     "ten-percent-off-100-returns-90": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_100_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n_____________________ test_ten_percent_off_100_returns_90 ______________________\n\n    def test_ten_percent_off_100_returns_90():\n        sut = apply_discount\n    \n        result = sut(100, 10)\n    \n>       assert result == 90, f\"expected 90 for 10% off 100, got {result}\"\nE       AssertionError: expected 90 for 10% off 100, got 10.0\nE       assert 10.0 == 90\n\ntests/test_discount.py:13: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_100_returns_90 - Assertio...\n1 failed in 0.01s\n",
       "head": "52cead937c9eaf986faad77b5ceebe680e1ed1e0"
      },
      "green": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
       "passed": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "0c683723c5d5028c036ab3b073c7f8b8de0b3387"
      }
     },
     "discount-non-round-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_discount_on_non_round_price_returns_discounted_amount"
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
       "head": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
       "sha": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     },
     "zero-percent-original-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_zero_percent_returns_original_price"
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
       "head": "3aaba6a3505328a9a7203d904eda4f62fc2b7649"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
       "sha": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     },
     "hundred-percent-returns-zero": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_hundred_percent_returns_zero"
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
       "head": "f00ecbee3bd592f58ec137d97b4e41baa460634b"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
       "sha": "9ff21daa79c223157a24b6cc946d1717684f70ac",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     }
    }
   },
   "commits": [
    "52cead937c9eaf986faad77b5ceebe680e1ed1e0",
    "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
    "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
    "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
    "f00ecbee3bd592f58ec137d97b4e41baa460634b",
    "9ff21daa79c223157a24b6cc946d1717684f70ac"
   ],
   "retries": {},
   "spend": {
    "agents": 14,
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
     "sha": "52cead937c9eaf986faad77b5ceebe680e1ed1e0",
     "base": "0a6214068f290091e2c56b46ad1eb2eb35ac5c5c",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-100-returns-90.r1.a1",
     "committed": true,
     "sha": "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "green",
     "key": "code-tdd.implement-code.ten-percent-off-100-returns-90.r1.a1",
     "committed": true,
     "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.discount-non-round-price.r1.a1",
     "committed": true,
     "sha": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.zero-percent-original-price.r1.a1",
     "committed": true,
     "sha": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.hundred-percent-returns-zero.r1.a1",
     "committed": true,
     "sha": "9ff21daa79c223157a24b6cc946d1717684f70ac",
     "stage": "code-tdd",
     "attempt": 1
    }
   ]
  }
 },
 {
  "t": 147.99,
  "ledger": {
   "v": 1,
   "seq": 21,
   "sha": "9b93c48856d355324807a5a9efb6920e03f8115c526b1a74098175f8656bc90a",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "7cdabc43-0e70-4d16-bd00-b6317e0dae88",
    "lastSeen": "2026-11-03T07:10:27.194Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. Cover the edge cases too, such as 0 and 100 percent",
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
    "name": "code-safety-net",
    "status": "active",
    "runId": null,
    "attempt": 1,
    "startedAt": "2026-11-03T07:12:24.827Z"
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
    },
    {
     "name": "code-tdd",
     "status": "done",
     "attempt": 1,
     "spend": {
      "agents": 13,
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
     "ten-percent-off-100-returns-90": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_100_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n_____________________ test_ten_percent_off_100_returns_90 ______________________\n\n    def test_ten_percent_off_100_returns_90():\n        sut = apply_discount\n    \n        result = sut(100, 10)\n    \n>       assert result == 90, f\"expected 90 for 10% off 100, got {result}\"\nE       AssertionError: expected 90 for 10% off 100, got 10.0\nE       assert 10.0 == 90\n\ntests/test_discount.py:13: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_100_returns_90 - Assertio...\n1 failed in 0.01s\n",
       "head": "52cead937c9eaf986faad77b5ceebe680e1ed1e0"
      },
      "green": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
       "passed": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "0c683723c5d5028c036ab3b073c7f8b8de0b3387"
      }
     },
     "discount-non-round-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_discount_on_non_round_price_returns_discounted_amount"
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
       "head": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
       "sha": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     },
     "zero-percent-original-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_zero_percent_returns_original_price"
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
       "head": "3aaba6a3505328a9a7203d904eda4f62fc2b7649"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
       "sha": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     },
     "hundred-percent-returns-zero": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_hundred_percent_returns_zero"
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
       "head": "f00ecbee3bd592f58ec137d97b4e41baa460634b"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
       "sha": "9ff21daa79c223157a24b6cc946d1717684f70ac",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     }
    }
   },
   "commits": [
    "52cead937c9eaf986faad77b5ceebe680e1ed1e0",
    "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
    "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
    "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
    "f00ecbee3bd592f58ec137d97b4e41baa460634b",
    "9ff21daa79c223157a24b6cc946d1717684f70ac"
   ],
   "retries": {},
   "spend": {
    "agents": 14,
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
     "sha": "52cead937c9eaf986faad77b5ceebe680e1ed1e0",
     "base": "0a6214068f290091e2c56b46ad1eb2eb35ac5c5c",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-100-returns-90.r1.a1",
     "committed": true,
     "sha": "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "green",
     "key": "code-tdd.implement-code.ten-percent-off-100-returns-90.r1.a1",
     "committed": true,
     "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.discount-non-round-price.r1.a1",
     "committed": true,
     "sha": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.zero-percent-original-price.r1.a1",
     "committed": true,
     "sha": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.hundred-percent-returns-zero.r1.a1",
     "committed": true,
     "sha": "9ff21daa79c223157a24b6cc946d1717684f70ac",
     "stage": "code-tdd",
     "attempt": 1
    }
   ]
  }
 },
 {
  "t": 156.812,
  "ledger": {
   "v": 1,
   "seq": 25,
   "sha": "c87e528ac1aa2ae04ef31ac114e04fadbea02f888cd51d8949728cba53f69951",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "7cdabc43-0e70-4d16-bd00-b6317e0dae88",
    "lastSeen": "2026-11-03T07:10:27.194Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. Cover the edge cases too, such as 0 and 100 percent",
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
    "name": "code-safety-net",
    "status": "done",
    "runId": "wf_ff85b240-087",
    "attempt": 1,
    "startedAt": "2026-11-03T07:12:24.827Z"
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
    },
    {
     "name": "code-tdd",
     "status": "done",
     "attempt": 1,
     "spend": {
      "agents": 13,
      "tokens": 0,
      "tokensKnown": false
     }
    },
    {
     "name": "code-safety-net",
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
     "ten-percent-off-100-returns-90": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_100_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n_____________________ test_ten_percent_off_100_returns_90 ______________________\n\n    def test_ten_percent_off_100_returns_90():\n        sut = apply_discount\n    \n        result = sut(100, 10)\n    \n>       assert result == 90, f\"expected 90 for 10% off 100, got {result}\"\nE       AssertionError: expected 90 for 10% off 100, got 10.0\nE       assert 10.0 == 90\n\ntests/test_discount.py:13: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_100_returns_90 - Assertio...\n1 failed in 0.01s\n",
       "head": "52cead937c9eaf986faad77b5ceebe680e1ed1e0"
      },
      "green": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
       "passed": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "0c683723c5d5028c036ab3b073c7f8b8de0b3387"
      }
     },
     "discount-non-round-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_discount_on_non_round_price_returns_discounted_amount"
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
       "head": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
       "sha": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     },
     "zero-percent-original-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_zero_percent_returns_original_price"
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
       "head": "3aaba6a3505328a9a7203d904eda4f62fc2b7649"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
       "sha": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     },
     "hundred-percent-returns-zero": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_hundred_percent_returns_zero"
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
       "head": "f00ecbee3bd592f58ec137d97b4e41baa460634b"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
       "sha": "9ff21daa79c223157a24b6cc946d1717684f70ac",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     }
    },
    "full": {
     "stage": "code-safety-net",
     "attempt": 1,
     "passed": true,
     "red": false,
     "runs": [
      {
       "runner": "pytest",
       "argv": [
        "uv",
        "run",
        "--no-project",
        "--with",
        "pytest",
        "pytest",
        "tests",
        "-q"
       ],
       "exitCode": 0,
       "signal": null,
       "timedOut": false,
       "durationMs": 343,
       "excerpt": ".....                                                                    [100%]\n5 passed in 0.00s\n",
       "excerptTruncated": false
      }
     ],
     "head": "9ff21daa79c223157a24b6cc946d1717684f70ac"
    }
   },
   "commits": [
    "52cead937c9eaf986faad77b5ceebe680e1ed1e0",
    "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
    "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
    "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
    "f00ecbee3bd592f58ec137d97b4e41baa460634b",
    "9ff21daa79c223157a24b6cc946d1717684f70ac"
   ],
   "retries": {},
   "spend": {
    "agents": 15,
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
     "sha": "52cead937c9eaf986faad77b5ceebe680e1ed1e0",
     "base": "0a6214068f290091e2c56b46ad1eb2eb35ac5c5c",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-100-returns-90.r1.a1",
     "committed": true,
     "sha": "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "green",
     "key": "code-tdd.implement-code.ten-percent-off-100-returns-90.r1.a1",
     "committed": true,
     "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.discount-non-round-price.r1.a1",
     "committed": true,
     "sha": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.zero-percent-original-price.r1.a1",
     "committed": true,
     "sha": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.hundred-percent-returns-zero.r1.a1",
     "committed": true,
     "sha": "9ff21daa79c223157a24b6cc946d1717684f70ac",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "docs",
     "key": "code-safety-net.update-documentation.-.r1.a1",
     "committed": false,
     "sha": null,
     "stage": "code-safety-net",
     "attempt": 1
    }
   ]
  }
 },
 {
  "t": 163.721,
  "ledger": {
   "v": 1,
   "seq": 26,
   "sha": "a58a8284f2b0384df05515d1be166cb4bedfa07fb90c3be049ddd94044bc2d35",
   "kind": "code",
   "taskType": "bug_fix",
   "owner": {
    "sessionId": "7cdabc43-0e70-4d16-bd00-b6317e0dae88",
    "lastSeen": "2026-11-03T07:10:27.194Z"
   },
   "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. Cover the edge cases too, such as 0 and 100 percent",
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
    "name": "code-safety-net",
    "status": "done",
    "runId": "wf_ff85b240-087",
    "attempt": 1,
    "startedAt": "2026-11-03T07:12:24.827Z"
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
    },
    {
     "name": "code-tdd",
     "status": "done",
     "attempt": 1,
     "spend": {
      "agents": 13,
      "tokens": 0,
      "tokensKnown": false
     }
    },
    {
     "name": "code-safety-net",
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
    },
    "G:task-end": {
     "source": "auto"
    }
   },
   "tests": {
    "perTest": {
     "ten-percent-off-100-returns-90": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_ten_percent_off_100_returns_90"
      },
      "red": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
       "passed": true,
       "exitCodes": [
        1
       ],
       "timedOut": false,
       "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n_____________________ test_ten_percent_off_100_returns_90 ______________________\n\n    def test_ten_percent_off_100_returns_90():\n        sut = apply_discount\n    \n        result = sut(100, 10)\n    \n>       assert result == 90, f\"expected 90 for 10% off 100, got {result}\"\nE       AssertionError: expected 90 for 10% off 100, got 10.0\nE       assert 10.0 == 90\n\ntests/test_discount.py:13: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_ten_percent_off_100_returns_90 - Assertio...\n1 failed in 0.01s\n",
       "head": "52cead937c9eaf986faad77b5ceebe680e1ed1e0"
      },
      "green": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
       "passed": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "0c683723c5d5028c036ab3b073c7f8b8de0b3387"
      }
     },
     "discount-non-round-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_discount_on_non_round_price_returns_discounted_amount"
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
       "head": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
       "sha": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     },
     "zero-percent-original-price": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_zero_percent_returns_original_price"
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
       "head": "3aaba6a3505328a9a7203d904eda4f62fc2b7649"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
       "sha": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     },
     "hundred-percent-returns-zero": {
      "selector": {
       "runner_id": "pytest",
       "test_file": "tests/test_discount.py",
       "test_function": "test_hundred_percent_returns_zero"
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
       "head": "f00ecbee3bd592f58ec137d97b4e41baa460634b"
      },
      "covered": {
       "stage": "code-tdd",
       "attempt": 1,
       "done": true,
       "exitCodes": [
        0
       ],
       "timedOut": false,
       "excerpt": ".                                                                        [100%]\n1 passed in 0.00s\n",
       "head": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
       "sha": "9ff21daa79c223157a24b6cc946d1717684f70ac",
       "after": {
        "test_id": "ten-percent-off-100-returns-90",
        "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e"
       }
      }
     }
    },
    "full": {
     "stage": "code-safety-net",
     "attempt": 1,
     "passed": true,
     "red": false,
     "runs": [
      {
       "runner": "pytest",
       "argv": [
        "uv",
        "run",
        "--no-project",
        "--with",
        "pytest",
        "pytest",
        "tests",
        "-q"
       ],
       "exitCode": 0,
       "signal": null,
       "timedOut": false,
       "durationMs": 343,
       "excerpt": ".....                                                                    [100%]\n5 passed in 0.00s\n",
       "excerptTruncated": false
      }
     ],
     "head": "9ff21daa79c223157a24b6cc946d1717684f70ac"
    }
   },
   "commits": [
    "52cead937c9eaf986faad77b5ceebe680e1ed1e0",
    "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
    "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
    "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
    "f00ecbee3bd592f58ec137d97b4e41baa460634b",
    "9ff21daa79c223157a24b6cc946d1717684f70ac"
   ],
   "retries": {},
   "spend": {
    "agents": 15,
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
     "sha": "52cead937c9eaf986faad77b5ceebe680e1ed1e0",
     "base": "0a6214068f290091e2c56b46ad1eb2eb35ac5c5c",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.ten-percent-off-100-returns-90.r1.a1",
     "committed": true,
     "sha": "0c683723c5d5028c036ab3b073c7f8b8de0b3387",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "green",
     "key": "code-tdd.implement-code.ten-percent-off-100-returns-90.r1.a1",
     "committed": true,
     "sha": "96ae092f55ed4fcd1744c07756b3a360d5be0c7e",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.discount-non-round-price.r1.a1",
     "committed": true,
     "sha": "3aaba6a3505328a9a7203d904eda4f62fc2b7649",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.zero-percent-original-price.r1.a1",
     "committed": true,
     "sha": "f00ecbee3bd592f58ec137d97b4e41baa460634b",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "red",
     "key": "code-tdd.implement-tests.hundred-percent-returns-zero.r1.a1",
     "committed": true,
     "sha": "9ff21daa79c223157a24b6cc946d1717684f70ac",
     "stage": "code-tdd",
     "attempt": 1
    },
    {
     "step": "docs",
     "key": "code-safety-net.update-documentation.-.r1.a1",
     "committed": false,
     "sha": null,
     "stage": "code-safety-net",
     "attempt": 1
    }
   ]
  }
 }
]
