// A real task trimmed from a watched run (pb-t4a-labs 20261116-154348-ask): its build ran, then its publish run, whose
// question waited four hours on the human before the pull request opened. What pb kept of each run under reports/runs/
// (keepRun in shared-node/unit-files.mjs): ledger, kept.json and the returns the end state reads.
export const UNIT_KEY = 'feat/order-total 5b3a163a5d3486d7d287c70592afc78b770c1752'
export const UNIT_FILE = { unit: null, plan: null, tracer: null, branch: 'feat/order-total', base: 'main', baseSha: '5b3a163a5d3486d7d287c70592afc78b770c1752', tasks: [], commits: [] }
export const CHANGED = [{ path: 'cart.py', status: 'M' }, { path: 'tests/test_cart.py', status: 'M' }]

export const CODE_RUN = {
  "kind": "code",
  "taskType": "new_feature",
  "runId": "38d87bbb-83da-40fa-b9b2-5ab8f85e810a",
  "task": "Add order_total(lines) to cart.py: it takes a list of (price, quantity) pairs and returns the sum of line_total(price, quantity) over them, so order_total([(10, 2), (4, 1)]) returns 30.0, which is 25.0 plus 5.0. One test for exactly that example is the whole scope",
  "stage": {
    "name": "code-safety-net",
    "status": "done",
    "runId": "wf_d5b89b84-bb3",
    "attempt": 1,
    "startedAt": "2026-11-16T15:40:25.684Z"
  },
  "stages": [
    {
      "name": "intake",
      "status": "done",
      "attempt": 1,
      "startedAt": "2026-11-16T15:17:53.278Z",
      "spend": {
        "agents": 6,
        "tokens": 4367,
        "tokensKnown": true
      }
    },
    {
      "name": "code-scenarios",
      "status": "done",
      "attempt": 1,
      "startedAt": "2026-11-16T15:20:39.378Z",
      "spend": {
        "agents": 4,
        "tokens": 2191,
        "tokensKnown": true
      }
    },
    {
      "name": "code-tdd",
      "status": "done",
      "attempt": 1,
      "startedAt": "2026-11-16T15:38:56.453Z",
      "spend": {
        "agents": 13,
        "tokens": 12882,
        "tokensKnown": true
      }
    },
    {
      "name": "code-safety-net",
      "status": "done",
      "attempt": 1,
      "startedAt": "2026-11-16T15:40:25.684Z",
      "spend": {
        "agents": 9,
        "tokens": 8339,
        "tokensKnown": true
      }
    }
  ],
  "gates": {
    "G:type": {
      "source": "human",
      "answer": "approve"
    },
    "G:scenarios": {
      "source": "human",
      "answer": "approve"
    },
    "G:task-end": {
      "source": "human",
      "answer": "approve",
      "doubts": [
        {
          "step": "fixing a finding",
          "ambiguity": "Should order_total round its sum to cents? Summing float line totals can drift past the cent rounding in line_total for non-exact binary values. Rounding the sum would change order_total's behaviour beyond the single requested example, so it was left alone pending a human decision."
        }
      ]
    }
  },
  "tests": {
    "perTest": {
      "order-total-sums-two-lines": {
        "red": {
          "stage": "code-tdd",
          "attempt": 1,
          "done": true,
          "passed": true,
          "exitCodes": [
            1
          ]
        },
        "green": {
          "stage": "code-tdd",
          "attempt": 1,
          "done": true,
          "passed": true,
          "exitCodes": [
            0
          ]
        }
      }
    }
  },
  "commits": [
    "45a2e703990a6acc8fddd744d306567981724263",
    "bea095237417863fb77c44d6d6456c983d40c7be",
    "541ca0bd9493a90fa20336e13ab22e141a326cbc",
    "ae5a3e246a68e767d10bebba32d31bd1862036d5"
  ],
  "spend": {
    "agents": 32,
    "tokens": 27779,
    "tokensKnown": true
  },
  "stop": null,
  "needsHuman": null,
  "lenses": {
    "safety-net": {
      "stage": "code-safety-net",
      "attempt": 1,
      "lenses": [
        {
          "name": "code",
          "model": "sonnet"
        },
        {
          "name": "tests",
          "model": "sonnet"
        },
        {
          "name": "corpus-misalignment",
          "model": "sonnet"
        }
      ],
      "survivors": 1,
      "refuted": 0,
      "unrefuted": 0,
      "uncovered": []
    }
  }
}

export const PUBLISH_RUN = {
  "kind": "publish",
  "taskType": "publish",
  "runId": "9a8f8143-dacc-458f-a516-e74099d07dc5",
  "task": "Add order_total(lines) to cart.py: it takes a list of (price, quantity) pairs and returns the sum of line_total(price, quantity) over them, so order_total([(10, 2), (4, 1)]) returns 30.0, which is 25.0 plus 5.0. One test for exactly that example is the whole scope",
  "stage": {
    "name": "pr-draft",
    "status": "done",
    "runId": "wf_5e03b87c-99f",
    "attempt": 1,
    "startedAt": "2026-11-16T15:42:22.817Z"
  },
  "stages": [
    {
      "name": "pr-draft",
      "status": "done",
      "attempt": 1,
      "startedAt": "2026-11-16T15:42:22.817Z",
      "spend": {
        "agents": 9,
        "tokens": 12077,
        "tokensKnown": true
      }
    }
  ],
  "gates": {
    "G:publish": {
      "source": "human",
      "answer": "approve"
    }
  },
  "tests": {},
  "commits": [],
  "spend": {
    "agents": 9,
    "tokens": 12077,
    "tokensKnown": true
  },
  "stop": null,
  "needsHuman": null
}

const KEPT = '.pairingbuddy/reports/runs'
const artifacts = (runId: string, returns: { pb_key: string }[]) => Object.fromEntries(returns.map(value => [`${KEPT}/${runId}/artifacts/${value.pb_key}.json`, value]))

export const KEPT_FILES: Record<string, unknown> = {
  [`${KEPT}/38d87bbb-83da-40fa-b9b2-5ab8f85e810a/kept.json`]: {
  "unit": "feat/order-total 5b3a163a5d3486d7d287c70592afc78b770c1752",
  "endedAt": "2026-11-16T15:42:17.253Z"
},
  [`${KEPT}/38d87bbb-83da-40fa-b9b2-5ab8f85e810a/ledger.json`]: CODE_RUN,
  ...artifacts('38d87bbb-83da-40fa-b9b2-5ab8f85e810a', [
  {
    "pb_key": "code-safety-net.lens.code.r1.a1",
    "ambiguity": null,
    "not_checked": "I read cart.py, tests/test_cart.py, the subject diff and changed.json. I did not read pytest.ini or .gitignore, and I did not run the test suite. The pass result comes from working the arithmetic by hand: line_total(10, 2) is 25.0 and line_total(4, 1) is 5.0, so the sum is 30.0.",
    "findings": [
      {
        "rule": "",
        "severity": "low",
        "kind": "risk",
        "title": "Float sum of cent-rounded totals may drift",
        "claim": "order_total sums float results of line_total with the built-in sum, so totals with non-exact binary floats (for example 0.1 + 0.2 style values) can carry a tiny error past the cents rounding that line_total applies. The task's single example is exact, so the test does not catch this; it is a latent risk, not a bug in the requested scope.",
        "where": "cart.py:9-10"
      }
    ]
  },
  {
    "pb_key": "code-safety-net.lens.corpus-misalignment.r1.a1",
    "ambiguity": null,
    "not_checked": "The corpus holds only .gitignore and pytest.ini, so I compared the change against those two files alone. I did not open cart.py in full, so I did not check line_total against the test's expected values beyond the arithmetic in the task (10 x 2 gives 25.0, 4 x 1 gives 5.0).",
    "findings": []
  },
  {
    "pb_key": "code-safety-net.lens.tests.r1.a1",
    "ambiguity": null,
    "not_checked": "I did not run pytest. I checked the expected value by hand: line_total(10, 2) is 25.0 and line_total(4, 1) is 5.0, so the sum 30.0 is exact in floating point and the assertion should pass.",
    "findings": []
  },
  {
    "pb_key": "code-safety-net.refuter.code-1.r1.a1",
    "finding_id": "code-1",
    "verdict": "survives",
    "ambiguity": null,
    "not_checked": "I read cart.py and tests/test_cart.py, and the repo grep for the two function names. I did not run Python, so I did not execute a concrete float-error example such as an order_total call with values like 0.08 and 0.02. The claim rests on the general behaviour of binary floats: line_total returns floats like round(x)/100, and order_total adds them with the built-in sum without re-rounding, so an inexact sum is possible in principle."
  },
  {
    "pb_key": "code-safety-net.fix.g1.r2.a1",
    "ambiguity": "Should order_total round its sum to cents? Summing float line totals can drift past the cent rounding in line_total for non-exact binary values. Rounding the sum would change order_total's behaviour beyond the single requested example, so it was left alone pending a human decision.",
    "commit_subject": "",
    "approach": "",
    "no_change_reason": "Finding code-1 is low severity, non-blocking, and by its own account a latent risk outside the requested scope. The only way to address it is to round the sum in order_total, which changes its behaviour beyond the one example the task specifies, and the task forbids that. cart.py was read and left unchanged.",
    "files_changed": []
  }
]),
  [`${KEPT}/9a8f8143-dacc-458f-a516-e74099d07dc5/kept.json`]: {
  "unit": "feat/order-total 5b3a163a5d3486d7d287c70592afc78b770c1752",
  "endedAt": "2026-11-16T19:44:01.242Z",
  "prUrl": "https://github.com/example/repo/pull/7"
},
  [`${KEPT}/9a8f8143-dacc-458f-a516-e74099d07dc5/ledger.json`]: PUBLISH_RUN,
  ...artifacts('9a8f8143-dacc-458f-a516-e74099d07dc5', [
  {
    "pb_key": "pr-draft.draft-pull-request.-.r1.a1",
    "title": "feat: add order_total summing line totals",
    "body": "## Summary\n\nAdds `order_total(lines)` to `cart.py`. It takes a list of `(price, quantity)` pairs and returns the sum of `line_total` over them.\n\n## Impact\n\nCode that totals an order can call `order_to",
    "labels": [],
    "base": "main",
    "coordination": null
  }
]),
}
