// The PLAN tree when no ledger names the plan: a publish run's ledger names none, and with no run going there is no ledger.
// The pane then finds the plan by the open unit's unit.json, else by the runs pb kept under reports/runs.
import { expect, test } from 'claude-code/testing'
import { PLAN_FILE, PLAN_PATH, paneLines, setupPlanReplay } from './testing/replay'
import { LEDGER_PATH, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'

const UNIT_JSON = `${ROOT}/.pairingbuddy/run/unit.json`

const PAY_AND_RECEIPT = [
  '# Shop',
  '',
  '## Tasks',
  '',
  '### Tracer 1: Checkout',
  '',
  '#### PR: Pay',
  '',
  '- [x] Task 1: Take payment',
  '',
  '#### PR: Receipt',
  '',
  'Depends on: Pay',
  '',
  '- [ ] Task 2: Send receipt',
  '',
].join('\n')

const PAY_RECORD = { unit: 'Pay', plan: PLAN_PATH, tracer: 'Tracer 1: Checkout', branch: 'feat/pay', base: 'main', baseSha: 'abc1234def5678', tasks: [{ title: 'Task 1: Take payment' }], commits: ['1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] }

// The publish run's ledger: it names no plan.
const PUBLISHING = { ...SNAPSHOT_RUNNING, kind: 'publish', task: '', plan: { path: '', title: '' }, stage: { ...SNAPSHOT_RUNNING.stage, name: 'pr-draft' } }

function planRows(lines: string[]): string[] {
  const at = lines.findIndex(line => line.startsWith('PLAN'))
  return at === -1 ? [] : lines.slice(at)
}

test('a publish run, whose ledger names no plan, shows the plan the open unit.json names', async ($, on) => {
  const { rig } = setupPlanReplay(on, PAY_AND_RECEIPT)
  rig.served.set(LEDGER_PATH, JSON.stringify(PUBLISHING))
  rig.served.set(UNIT_JSON, JSON.stringify(PAY_RECORD))
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  expect(planRows(await paneLines($)), 'the tree of the plan unit.json names, with Pay\'s branch, base and commit').toEqual([
    'PLAN     Tracer 1: Checkout',
    '           Pay · unpublished',
    '             branch feat/pay',
    '             base main',
    '             commit 1111111',
    '             ✓ Task 1: Take payment',
    '           Receipt · open',
    '             based on Pay',
    '             ○ Task 2: Send receipt',
  ])
})
