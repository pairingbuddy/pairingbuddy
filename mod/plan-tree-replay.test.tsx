import { expect, test } from 'claude-code/testing'
import { paneLines, replay, setupPlanReplay } from './testing/replay'
import s6Plan, { PLAN_TEXT, UNIT_JSON } from './fixtures/replay/s6-plan'

test('replaying the recorded S6 run draws a tree whose units, tracers, task states, commits, base and PR links match the recording', async ($, on) => {
  const { rig } = setupPlanReplay(on, PLAN_TEXT)
  for await (const step of replay($, rig, s6Plan, {
    files: { 'docs/plans/discounts.md': PLAN_TEXT, '.pairingbuddy/run/unit.json': UNIT_JSON, '.pairingbuddy/tests.json': '{"tests":[]}' },
  })) {
    expect(step.t, 'the trimmed recording is one snapshot').toBe(397.669)
  }

  const lines = await paneLines($)
  const planRow = lines.findIndex(line => line.startsWith('PLAN'))

  expect(planRow, `a PLAN row in the pane: ${JSON.stringify(lines)}`).toBeGreaterThan(-1)
  expect(lines.slice(planRow), 'the tracer, unit A published with its PR link and stacked-on unit B open with its branch, base and the four commits the ledger recorded').toEqual([
    'PLAN     T1: Discounts — Prices come out right',
    '           Discount fix · published',
    '             PR https://github.com/example/repo/pull/1',
    '             ✓ Task 1: Fix apply_discount',
    '             ✓ Task 2: [HUMAN] Check the fix by hand',
    '           Discounted totals · pull request not opened yet',
    '             based on Discount fix',
    '             branch feat/discounted-totals',
    '             base fix/discount-fix',
    '             commit 9b261d4',
    '             commit 182e190',
    '             commit ce692a4',
    '             commit 0bce7a4',
    '             ✓ Task 3: Add discounted_total',
  ])
})
