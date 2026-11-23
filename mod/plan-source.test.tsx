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
    '           Receipt · to do',
    '             based on Pay',
    '             ○ Task 2: Send receipt',
  ])
})

const PAY_THEN_HUMAN = [
  '# Shop',
  '',
  '## Tasks',
  '',
  '### Tracer 1: Checkout',
  '',
  '#### PR: Pay',
  '',
  '- [x] Task 1: Take payment',
  '- [ ] Task 2: [HUMAN] Try a real card',
  '',
].join('\n')

test('once the run has ended at a [HUMAN] task, the tree still shows it waiting on a person', async ($, on) => {
  const { rig } = setupPlanReplay(on, PAY_THEN_HUMAN)
  rig.served.set(UNIT_JSON, JSON.stringify(PAY_RECORD))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  // The code run ends: pb removes its ledger, and the unit stays open for the person's task.
  rig.served.delete(LEDGER_PATH)
  await rig.clock.advance(POLL_MS * 2)

  expect(planRows(await paneLines($)), 'the tree as the plan reads now, with the [HUMAN] task waiting').toEqual([
    'PLAN     Tracer 1: Checkout',
    '           Pay · open',
    '             branch feat/pay',
    '             base main',
    '             commit 1111111',
    '             ✓ Task 1: Take payment',
    '             ○ Task 2: [HUMAN] Try a real card · waiting on a person',
  ])
})

const BOTH_PUBLISHED = PAY_AND_RECEIPT
  .replace('#### PR: Pay\n', '#### PR: Pay\n\nPR: https://github.com/acme/shop/pull/1 branch: feat/pay\n')
  .replace('#### PR: Receipt\n', '#### PR: Receipt\n\nPR: https://github.com/acme/shop/pull/2 branch: feat/receipt\n')
  .replace('- [ ] Task 2', '- [x] Task 2')

// What pb keeps of an ended run (keepRun in shared-node/unit-files.mjs): its ledger and kept.json.
function keepRun(served: Map<string, string>, runId: string, ledger: Record<string, unknown>, kept: Record<string, unknown>) {
  served.set(`${ROOT}/.pairingbuddy/reports/runs/${runId}/ledger.json`, JSON.stringify({ ...ledger, runId }))
  served.set(`${ROOT}/.pairingbuddy/reports/runs/${runId}/kept.json`, JSON.stringify(kept))
}

test('with no run going and no unit open, the tree is the plan the kept runs name, the last one first', async ($, on) => {
  const { rig } = setupPlanReplay(on, BOTH_PUBLISHED)
  rig.served.delete(LEDGER_PATH)
  const elsewhere = 'docs/plans/old.md'
  rig.served.set(`${ROOT}/${elsewhere}`, PAY_THEN_HUMAN.replace('Checkout', 'Old'))
  keepRun(rig.served, 'run-old', { ...SNAPSHOT_RUNNING, plan: { path: elsewhere, title: 'Task 1: Take payment' } }, { unit: 'feat/pay abc', endedAt: '2026-11-03T06:00:00.000Z' })
  keepRun(rig.served, 'run-code', { ...SNAPSHOT_RUNNING, plan: { path: PLAN_PATH, title: 'Task 2: Send receipt' } }, { unit: 'feat/receipt def', endedAt: '2026-11-03T07:00:00.000Z' })
  keepRun(rig.served, 'run-publish', PUBLISHING, { unit: 'feat/receipt def', endedAt: '2026-11-03T07:10:00.000Z', prUrl: 'https://github.com/acme/shop/pull/2' })
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  expect(planRows(await paneLines($)), 'the plan of the last kept run that names one, with both PRs').toEqual([
    'PLAN     Tracer 1: Checkout',
    '           Pay · published',
    '             PR https://github.com/acme/shop/pull/1',
    '             ✓ Task 1: Take payment',
    '           Receipt · published',
    '             based on Pay',
    '             PR https://github.com/acme/shop/pull/2',
    '             ✓ Task 2: Send receipt',
  ])
})
