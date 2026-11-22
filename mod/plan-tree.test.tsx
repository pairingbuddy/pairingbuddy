import { expect, test } from 'claude-code/testing'
import { paneLines, setupReplay } from './testing/replay'
import { LEDGER_PATH, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'

const PLAN_PATH = 'docs/plans/shop.md'

// Runs the mod over a ledger that names PLAN_PATH, serving `planText` there, and lets two polls pass so the pane has drawn from it.
async function showPlan($: any, on: Function, planText: string): Promise<string[]> {
  const rig = setupReplay(on)
  for (const event of ['audio.play', 'ui.toast', 'ui.status', 'store.get', 'store.set']) on(event, () => ({ value: undefined }))
  const kept = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: kept.get(e.key) ?? null, version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => (kept.set(e.key, e.value), { value: { isSet: true, version: 1 } }))
  rig.served.set(LEDGER_PATH, JSON.stringify({ ...SNAPSHOT_RUNNING, plan: { path: PLAN_PATH, title: 'Shop' } }))
  rig.served.set(`${ROOT}/${PLAN_PATH}`, planText)
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  return paneLines($)
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

  const at = (name: string) => lines.findIndex(line => line.includes(name))
  const order = ['Tracer 1: Cart', 'Task 1: Add an item', 'Task 2: Remove an item', 'Tracer 2: Checkout', 'Pay', 'Task 3: Take payment', 'Receipt', 'Task 4: Send receipt']
  expect(order.filter(name => at(name) === -1), 'every tracer, unit and task of the plan is drawn').toEqual([])
  expect(order.map(at), 'they appear in plan order').toEqual([...order.map(at)].sort((a, b) => a - b))
  const column = (name: string) => lines[at(name)].indexOf(name)
  expect(column('Pay'), 'a unit is nested under its tracer, further in').toBeGreaterThan(column('Tracer 2: Checkout'))
  expect(column('Receipt'), 'its sibling unit sits at the same depth').toBe(column('Pay'))
  const mark = (title: string) => lines[at(title)].slice(0, lines[at(title)].indexOf(title)).trim()
  expect(mark('Task 1: Add an item'), 'a ticked task is marked differently from an unticked one').not.toBe(mark('Task 2: Remove an item'))
})

test('each unit shows the state unitStates gives it: open, hand-ticked, unpublished, published, accepted or legacy', async () => {
  throw new Error('not implemented: tree-shows-unit-state')
})

test('a unit with a Depends on line shows the unit it is based on', async () => {
  throw new Error('not implemented: tree-shows-dependency-base')
})

test('the open unit from unit.json shows its branch, base and the commits recorded for it', async () => {
  throw new Error('not implemented: tree-marks-open-unit-with-base-and-commits')
})

test('a unit with a PR: line shows its PR link', async () => {
  throw new Error('not implemented: tree-shows-pr-link')
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
