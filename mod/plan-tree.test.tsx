import { expect, test } from 'claude-code/testing'
import { PLAN_PATH, paneLines, setupPlanReplay } from './testing/replay'
import { ROOT, start } from './testing/band'
import { POLL_MS } from './poll'

type Harness = Parameters<typeof paneLines>[0]
type On = Parameters<typeof setupPlanReplay>[0]

// The pane rows from the row that starts with PLAN to the end; fails with the whole pane when no row is drawn for the plan.
function planRows(lines: string[]): string[] {
  const planRow = lines.findIndex(line => line.startsWith('PLAN'))
  if (planRow === -1) throw new Error(`no PLAN row in pane:\n${lines.join('\n')}`)
  return lines.slice(planRow)
}

// Runs the mod over a ledger that names a plan, serving `planText` there plus any `extraFiles` (root-relative path to content),
// and lets two polls pass so the pane has drawn from it. Returns the PLAN rows.
async function showPlan($: Harness, on: On, planText: string, extraFiles: Record<string, string> = {}): Promise<string[]> {
  const { rig } = setupPlanReplay(on, planText)
  for (const [path, content] of Object.entries(extraFiles)) rig.served.set(`${ROOT}/${path}`, content)
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  return planRows(await paneLines($))
}

const TWO_TRACERS = [
  '# Shop',
  '',
  '## Tasks',
  '',
  '### Tracer 1: Cart',
  '',
  '- [x] Task 1: Add an item',
  '- [ ] Task 2: Remove an item',
  '',
  '### Tracer 2: Checkout',
  '',
  '#### PR: Pay',
  '',
  '- [ ] Task 3: Take payment',
  '',
  '#### PR: Receipt',
  '',
  '- [ ] Task 4: Send receipt',
  '',
].join('\n')

test('units appear nested under their tracer, in plan order, each with its task titles and ticked state', async ($, on) => {
  const lines = await showPlan($, on, TWO_TRACERS)

  expect(lines, 'the PLAN rows: each tracer, its units nested one step in, each unit\'s tasks under it in plan order, ✓ for ticked and ○ for unticked').toEqual([
    'PLAN     Tracer 1: Cart',
    '           Tracer 1: Cart',
    '             ✓ Task 1: Add an item',
    '             ○ Task 2: Remove an item',
    '         Tracer 2: Checkout',
    '           Pay',
    '             ○ Task 3: Take payment',
    '           Receipt',
    '             ○ Task 4: Send receipt',
  ])
})

const ONE_UNIT_PER_STATE = [
  '# Shop',
  '',
  '## Tasks',
  '',
  '### Tracer 1: Fresh',
  '',
  '- [ ] Task 1: Start',
  '',
  '### Tracer 2: Halfway',
  '',
  '- [x] Task 2: Ticked by hand',
  '- [ ] Task 3: Still to do',
  '',
  '### Tracer 3: Done',
  '',
  '- [x] Task 4: Built',
  '',
  '### Tracer 4: Sent',
  '',
  'PR: https://github.com/acme/shop/pull/7',
  '',
  '- [x] Task 5: Shipped',
  '',
  '### Tracer 5: Taken',
  '',
  'Legacy: accepted',
  '',
  '- [x] Task 6: Old work',
  '',
  '### Tracer 6: Old',
  '',
  '- [x] Task 7: Before pb',
  '',
].join('\n')

// The open unit is Done, with a record of its one task, so only it can read as unpublished.
const OPEN_UNIT_DONE = JSON.stringify({ unit: 'Done', plan: PLAN_PATH, tracer: 'Tracer 3: Done', branch: 'feat/done', base: 'main', baseSha: 'abc123', tasks: [{ title: 'Task 4: Built' }], commits: [] })

test('each unit shows the state unitStates gives it: open, hand-ticked, unpublished, published, accepted or legacy', async ($, on) => {
  const lines = await showPlan($, on, ONE_UNIT_PER_STATE, { '.pairingbuddy/run/unit.json': OPEN_UNIT_DONE })

  expect(lines, 'every unit row ends with the state unitStates gives that unit, each state shown once').toEqual([
    'PLAN     Tracer 1: Fresh',
    '           Tracer 1: Fresh · open',
    '             ○ Task 1: Start',
    '         Tracer 2: Halfway',
    '           Tracer 2: Halfway · hand-ticked',
    '             ✓ Task 2: Ticked by hand',
    '             ○ Task 3: Still to do',
    '         Tracer 3: Done',
    '           Tracer 3: Done · unpublished',
    '             ✓ Task 4: Built',
    '         Tracer 4: Sent',
    '           Tracer 4: Sent · published',
    '             PR https://github.com/acme/shop/pull/7',
    '             ✓ Task 5: Shipped',
    '         Tracer 5: Taken',
    '           Tracer 5: Taken · accepted',
    '             ✓ Task 6: Old work',
    '         Tracer 6: Old',
    '           Tracer 6: Old · legacy',
    '             ✓ Task 7: Before pb',
  ])
})

const RECEIPT_DEPENDS_ON_PAY = [
  '# Shop',
  '',
  '## Tasks',
  '',
  '### Tracer 1: Checkout',
  '',
  '#### PR: Pay',
  '',
  '- [ ] Task 1: Take payment',
  '',
  '#### PR: Receipt',
  '',
  'Depends on: Pay',
  '',
  '- [ ] Task 2: Send receipt',
  '',
].join('\n')

test('a unit with a Depends on line shows the unit it is based on', async ($, on) => {
  const lines = await showPlan($, on, RECEIPT_DEPENDS_ON_PAY)

  expect(lines, 'the Receipt unit names Pay as its base on its own row under it, before its tasks; Pay, which depends on nothing, shows no base').toEqual([
    'PLAN     Tracer 1: Checkout',
    '           Pay',
    '             ○ Task 1: Take payment',
    '           Receipt',
    '             based on Pay',
    '             ○ Task 2: Send receipt',
  ])
})

// Pay is the open unit, with two commits recorded for it; unit.json names no other unit, so Receipt shows no branch, base or commits
// (its `open` label comes from unitStates, not from a record).
const OPEN_UNIT_PAY = JSON.stringify({
  unit: 'Pay',
  plan: PLAN_PATH,
  tracer: 'Tracer 1: Checkout',
  branch: 'feat/pay',
  base: 'main',
  baseSha: 'abc1234def5678',
  tasks: [],
  commits: ['1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
})

test('the open unit from unit.json shows its branch, base and the commits recorded for it', async ($, on) => {
  const lines = await showPlan($, on, RECEIPT_DEPENDS_ON_PAY, { '.pairingbuddy/run/unit.json': OPEN_UNIT_PAY })

  expect(lines, 'only the open unit, Pay, shows its branch, its base and each recorded commit by its short sha, before its tasks; Receipt shows none of them').toEqual([
    'PLAN     Tracer 1: Checkout',
    '           Pay · open',
    '             branch feat/pay',
    '             base main',
    '             commit 1111111',
    '             commit 2222222',
    '             ○ Task 1: Take payment',
    '           Receipt · open',
    '             based on Pay',
    '             ○ Task 2: Send receipt',
  ])
})

const PAY_WITH_PR = [
  '# Shop',
  '',
  '## Tasks',
  '',
  '### Tracer 1: Checkout',
  '',
  '#### PR: Pay',
  '',
  'PR: https://github.com/acme/shop/pull/7',
  '',
  '- [x] Task 1: Take payment',
  '',
  '#### PR: Receipt',
  '',
  '- [ ] Task 2: Send receipt',
  '',
].join('\n')

test('a unit with a PR: line shows its PR link', async ($, on) => {
  const lines = await showPlan($, on, PAY_WITH_PR)

  const prRows = lines.filter(line => line.trimStart().startsWith('PR '))

  expect(prRows, 'one PR row, for Pay, on its own row; Receipt, which has no PR: line, shows none').toEqual([
    '             PR https://github.com/acme/shop/pull/7',
  ])
})

test('when parsePlan reports problems, the view shows them instead of hiding them', async () => {
  throw new Error('not implemented: tree-shows-plan-problems')
})

test('an unchecked [HUMAN] task shows as waiting on a person, with its title', async () => {
  throw new Error('not implemented: human-task-shows-waiting-on-person')
})

test('a ticked [HUMAN] task no longer shows as waiting', async () => {
  throw new Error('not implemented: checked-human-task-not-waiting')
})

test('an unchecked agent task is not shown as waiting on a person', async () => {
  throw new Error('not implemented: agent-task-not-marked-waiting')
})

test('with no plan MD and no plan path in the ledger, the view renders a plain no-plan state and nothing else breaks', async () => {
  throw new Error('not implemented: no-plan-renders-without-error')
})

test('with an open unit in unit.json but no plan, the unit still shows its branch, base and PR link', async () => {
  throw new Error('not implemented: unit-without-plan-still-shows')
})

test('with no ledger, unit or plan, the pane renders as before', async () => {
  throw new Error('not implemented: no-plan-no-unit-no-ledger')
})
