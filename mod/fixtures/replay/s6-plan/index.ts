// A trimmed copy of the S6 run recorded in tests/smoke/recordings/s6-t103-run4/ (gitignored, so the test never reads from it): the
// ledger snapshot at t=397.669, when Task 3's code run had finished its safety net and unit B, stacked on unit A, was the open unit.
// The recording keeps no plan MD and no unit.json, so those two are rebuilt from what the run recorded: the plan from tests/smoke/s6.mjs
// with its boxes ticked as the run ticked them and unit A's PR line as pb publish wrote it, the open unit from the ledger's commits.

export const PLAN_TEXT = `# Discounts

## Tasks

### T1: Discounts — Prices come out right

#### PR: Discount fix

PR: https://github.com/example/repo/pull/1 branch: fix/discount-fix

- [x] **Task 1: Fix apply_discount**

  **What to build:** Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90.

- [x] **Task 2: [HUMAN] Check the fix by hand**

  **HUMAN TASK. An agent must stop here, and must not perform or tick this task.**

#### PR: Discounted totals

Depends on: Discount fix

- [x] **Task 3: Add discounted_total**

  **What to build:** Add discounted_total(price, percent, quantity) to discount.py.
`

export const COMMITS = [
  '9b261d47001fab778f9ddc54ec6a28b6cdc9e509',
  '182e190323645a416dfcdadfb16b2249f59a15b1',
  'ce692a4c31a1e6f3c0fec7e7e3f0640aa4d2105c',
  '0bce7a49de1aa8953ffa95c4676dc86a29e958f6',
]

export const UNIT_JSON = JSON.stringify({
  unit: 'Discounted totals',
  plan: 'docs/plans/discounts.md',
  tracer: 'T1: Discounts — Prices come out right',
  branch: 'feat/discounted-totals',
  base: 'fix/discount-fix',
  baseSha: '5e1c0de0000000000000000000000000000000aa',
  tasks: [{ title: 'Task 3: Add discounted_total' }],
  commits: COMMITS,
})

const ledger = [
  {
    t: 397.669,
    ledger: {
      v: 1,
      seq: 32,
      sha: 'fe63e54748e2bffea83c30a6c57cf886c6717f23eae25f7eb1a50f80a2c5f4aa',
      kind: 'code',
      taskType: 'new_feature',
      runId: '17b63eea-5f64-4a35-9459-c268fb561283',
      owner: { sessionId: '05e1b1e4-bdcc-4cd2-81fe-254558b8f46c', lastSeen: '2026-11-13T08:41:07.066Z' },
      task: 'Task 3: Add discounted_total',
      plan: { path: 'docs/plans/discounts.md', title: 'Task 3: Add discounted_total' },
      policy: { mode: 'auto', source: 'permission_mode' },
      stage: { name: 'code-safety-net', status: 'done', runId: 'wf_7a9cbfd4-8af', attempt: 1, startedAt: '2026-11-13T08:41:08.753Z' },
      stages: [
        { name: 'intake', status: 'done', attempt: 1, startedAt: '2026-11-13T08:39:00.082Z', spend: { agents: 4, tokens: 1732, tokensKnown: true } },
        { name: 'code-scenarios', status: 'done', attempt: 2, startedAt: '2026-11-13T08:39:21.537Z', spend: { agents: 4, tokens: 1372, tokensKnown: false } },
        { name: 'code-tdd', status: 'done', attempt: 1, startedAt: '2026-11-13T08:39:47.490Z', spend: { agents: 13, tokens: 13055, tokensKnown: true } },
        { name: 'code-safety-net', status: 'done', attempt: 1, startedAt: '2026-11-13T08:41:08.753Z', spend: { agents: 6, tokens: 3552, tokensKnown: true } },
      ],
      gates: { 'G:type': { source: 'auto' }, 'G:scenarios': { source: 'auto' }, 'G:task-end': { source: 'human-cli', answer: 'approve' } },
      tests: {},
      commits: COMMITS,
      retries: {},
      spend: { agents: 27, tokens: 19711, tokensKnown: false },
      stop: null,
      needsHuman: null,
    },
  },
]

export default { ledger, spawns: [], timing: {} }
