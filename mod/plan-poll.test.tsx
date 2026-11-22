import { expect, test } from 'claude-code/testing'
import { setupReplay } from './testing/replay'
import { LEDGER_PATH, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'

const PLAN_PATH = 'docs/plans/shop.md'
const INPUTS = { key: 'inputs' } as const

const PLAN = [
  '# Shop',
  '',
  '## Tasks',
  '',
  '### Tracer 1: Cart',
  '',
  '- [x] Task 1: Add an item',
  '- [ ] Task 2: Remove an item',
  '',
].join('\n')

type PlanUnit = { unit: string; tracer: string | null; tasks: { title: string; checked: boolean }[] }

test('with a ledger naming a plan path and a plan MD on disk, the poll returns the parsed plan units', async ($, on) => {
  const rig = setupReplay(on)
  on('audio.play', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  const kept = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: kept.get(e.key) ?? null, version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => (kept.set(e.key, e.value), { value: { isSet: true, version: 1 } }))
  rig.served.set(LEDGER_PATH, JSON.stringify({ ...SNAPSHOT_RUNNING, plan: { path: PLAN_PATH, title: 'Shop' } }))
  rig.served.set(`${ROOT}/${PLAN_PATH}`, PLAN)

  await start($)
  await rig.clock.advance(POLL_MS * 2)
  const polled = kept.get(INPUTS.key) as { plan?: { units: PlanUnit[] } | null }
  const units = (polled.plan?.units ?? []).map(({ unit, tracer, tasks }) => ({ unit, tracer, tasks: tasks.map(({ title, checked }) => ({ title, checked })) }))

  expect(units, 'the one tracer unit, with its two tasks and their ticked state').toEqual([
    {
      unit: 'Tracer 1: Cart',
      tracer: 'Tracer 1: Cart',
      tasks: [
        { title: 'Task 1: Add an item', checked: true },
        { title: 'Task 2: Remove an item', checked: false },
      ],
    },
  ])
})

test('after the plan MD changes between polls (a box is ticked), the next poll returns the updated tree', async () => {
  throw new Error('not implemented: poll-picks-up-plan-change')
})

test('a plan path that is missing, empty or unreadable yields no plan and does not throw', async () => {
  throw new Error('not implemented: poll-unreadable-plan-reads-as-none')
})

test('polling and rendering the plan tree writes no file outside reports/', async () => {
  throw new Error('not implemented: view-writes-nothing-outside-reports')
})
