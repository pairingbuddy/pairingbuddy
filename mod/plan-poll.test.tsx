import { expect, test } from 'claude-code/testing'
import { setupReplay } from './testing/replay'
import { LEDGER_PATH, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'
import type { Polled } from './inputs'

const PLAN_PATH = 'docs/plans/shop.md'
const INPUTS = { key: 'inputs' } as const
const TWO_POLLS_MS = POLL_MS * 2

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

// Runs the mod over a ledger that names PLAN_PATH, serving `planText` there. Returns the rig, to change what is served, and a read of what the poll kept as its inputs.
async function startPolling($: any, on: Function, planText: string) {
  const rig = setupReplay(on)
  for (const event of ['audio.play', 'ui.toast', 'ui.status', 'store.get', 'store.set']) on(event, () => ({ value: undefined }))
  const kept = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: kept.get(e.key) ?? null, version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => (kept.set(e.key, e.value), { value: { isSet: true, version: 1 } }))
  rig.served.set(LEDGER_PATH, JSON.stringify({ ...SNAPSHOT_RUNNING, plan: { path: PLAN_PATH, title: 'Shop' } }))
  rig.served.set(`${ROOT}/${PLAN_PATH}`, planText)

  await start($)

  const keptInputs = async (): Promise<Polled> => {
    await rig.clock.advance(TWO_POLLS_MS)
    expect(kept.has(INPUTS.key), 'the poll has kept its inputs').toBe(true)
    return kept.get(INPUTS.key) as Polled
  }
  return { rig, keptInputs }
}

async function pollKeptInputs($: any, on: Function, planText: string): Promise<Polled> {
  return (await startPolling($, on, planText)).keptInputs()
}

test('with a ledger naming a plan path and a plan MD on disk, the poll returns the parsed plan units', async ($, on) => {
  const polled = await pollKeptInputs($, on, PLAN)

  expect(polled.plan?.units, 'the one tracer unit, with its two tasks and their ticked state').toMatchObject([
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

test('after the plan MD changes between polls (a box is ticked), the next poll returns the updated tree', async ($, on) => {
  const { rig, keptInputs } = await startPolling($, on, PLAN)
  const before = await keptInputs()
  expect(before.plan?.units[0].tasks[1], 'Task 2 starts unticked').toMatchObject({ title: 'Task 2: Remove an item', checked: false })

  rig.served.set(`${ROOT}/${PLAN_PATH}`, PLAN.replace('- [ ] Task 2', '- [x] Task 2'))
  const after = await keptInputs()

  expect(after.plan?.units[0].tasks[1], 'the next poll sees Task 2 ticked').toMatchObject({ title: 'Task 2: Remove an item', checked: true })
})

test('a plan path that is missing, empty or unreadable yields no plan and does not throw', async () => {
  throw new Error('not implemented: poll-unreadable-plan-reads-as-none')
})

test('polling and rendering the plan tree writes no file outside reports/', async () => {
  throw new Error('not implemented: view-writes-nothing-outside-reports')
})
