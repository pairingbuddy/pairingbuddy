// Scenario pane-height: the platform shows a pane's body in a room of so many rows and draws no "more" hint under it, so a
// PLAN block drawn after every other row fell below the window. With the room known the pane folds STEPS, then TESTS, then
// REVIEW until the PLAN block keeps its floor, gives the plan what is left, and tells the rows past the room on its last row.
import { expect, test } from 'claude-code/testing'
import { PANE, setupPlanReplay, setupReplay } from './testing/replay'
import { bigBuild, bigEnd } from './testing/big-task'
import { ROOT, start } from './testing/band'
import { POLL_MS } from './poll'

type Harness = Parameters<typeof start>[0]
type On = Parameters<typeof setupPlanReplay>[0]

// A plan of `tracers` tracers, each with two PR units of five tasks; the first `ticked` tasks are ticked.
function bigPlan(tracers: number, ticked: number): string {
  const lines = ['# Big', '', '## Tasks', '']
  let task = 0
  for (let t = 1; t <= tracers; t++) {
    lines.push(`### T${t}: Tracer ${t}`, '')
    for (const part of ['a', 'b']) {
      lines.push(`#### PR: T${t}${part} Unit`, '')
      for (let i = 0; i < 5; i++) {
        task += 1
        lines.push(`- [${task <= ticked ? 'x' : ' '}] Task ${task}: Do step ${task}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

const textOf = (node: any): string => (typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join(''))

// Every row the pane draws, in order, as its text: one per top-level child of its body.
// offset: the first row the window shows; extra: other props, such as isFocused.
async function bodyRows($: Harness, room: number | undefined, { offset = 0, ...extra }: Record<string, unknown> = {}): Promise<string[]> {
  const { scroll: _unknown, ...props } = { ...PANE.props, bodyColumns: 140, ...extra } as Record<string, unknown>
  const ui = await $.ui.mount({ ...PANE, props: room === undefined ? props : { ...props, scroll: { offset, bodyRows: room } }, surface: 'terminal' })
  const tree = await (ui as any).drawn()
  await ui.unmount()
  return (tree?.children ?? []).filter((node: any) => node && typeof node === 'object').map(textOf)
}

async function servePlan($: Harness, on: On, planText: string, files: Record<string, string> = {}) {
  const { rig } = setupPlanReplay(on, planText)
  for (const [path, content] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, content)
  await start($)
  await rig.clock.advance(POLL_MS * 2)
}

const rowOf = (rows: string[], name: string) => rows.findIndex(row => row.startsWith(name.padEnd(9)))

test('in a room of 18 rows a 150-task plan still shows: STEPS folds to one line and the pane keeps to the room', async ($, on) => {
  await servePlan($, on, bigPlan(15, 100))

  const rows = await bodyRows($, 18)

  expect(rows.length <= 18, `the pane keeps to 18 rows, got ${rows.length}:\n${rows.join('\n')}`).toBe(true)
  expect(rows[rowOf(rows, 'STEPS')], 'STEPS on one line: none done, the running step, three to come').toBe('STEPS    ▸ write test scenarios · 3 to come')
  expect(rows[rowOf(rows, 'STEPS') + 1].startsWith('TESTS'), `STEPS is one line:\n${rows.join('\n')}`).toBe(true)
  expect(rowOf(rows, 'PLAN') >= 0, 'PLAN shows').toBe(true)
})

// A row's lines: from its label to the next row's label.
function rowLinesOf(rows: string[], name: string): string[] {
  const from = rowOf(rows, name)
  const to = rows.findIndex((row, at) => at > from && row.slice(0, 9).trim() !== '')
  return from < 0 ? [] : rows.slice(from, to < 0 ? undefined : to)
}

test('mid-build a short room folds TESTS to its count and the running test, after STEPS', async ($, on) => {
  const rig = setupReplay(on)
  await bigBuild($, rig)

  // 18 rows in full; STEPS on one line leaves 15, still more than the room.
  const rows = await bodyRows($, 14)

  expect(rowLinesOf(rows, 'STEPS').length, `STEPS folds first:\n${rows.join('\n')}`).toBe(1)
  expect(rowLinesOf(rows, 'TESTS'), 'TESTS keeps its count and the test being built').toEqual([
    'TESTS    10 of 40 done',
    expect.stringMatching(/^ {9}▸ s3 t3 .*RED/),
  ])
})

test('at the end a short room folds TESTS to its settled count and REVIEW to its summary line', async ($, on) => {
  const rig = setupReplay(on)
  await bigEnd($, rig)

  const rows = await bodyRows($, 12)

  expect(rowLinesOf(rows, 'TESTS'), `TESTS is its count:\n${rows.join('\n')}`).toEqual(['TESTS    ✓ 40 of 40 passing'])
  expect(rowLinesOf(rows, 'REVIEW'), 'REVIEW is its summary line').toEqual([expect.stringMatching(/^REVIEW   review: 8 issues/)])
})

test('when even the folds leave too little room, the last row it shows counts the rows below and how to reach them', async ($, on) => {
  await servePlan($, on, bigPlan(15, 100))

  const rows = await bodyRows($, 12)
  const scrolled = await bodyRows($, 12, { offset: 1 })
  const focused = await bodyRows($, 12, { isFocused: true })

  expect(rows[11], `the 12th row counts the rest:\n${rows.join('\n')}`).toBe(`↓ ${scrolled.length - 11} more rows · ctrl+x tab, then arrows`)
  expect(rows.slice(0, 11), 'the rows above it are the pane\'s first 11').toEqual(scrolled.slice(0, 11))
  expect(scrolled.some(row => row.startsWith('↓')), 'scrolled, the window no longer starts at the top, and the count is gone').toBe(false)
  expect(focused[11], 'once the pane has the keys, the arrows scroll it').toBe(`↓ ${scrolled.length - 11} more rows · arrows scroll`)
})

test('labels pb cannot read take at most three rows, the latest ones, with the count of all of them under', async ($, on) => {
  const rig = setupReplay(on)
  await bigBuild($, rig)
  const raws = Array.from({ length: 6 }, (_, i) => `not a pb1 label ${i + 1}`)
  for (const name of raws) await $.agent.spawn({ prompt: 'p', description: 'd', name, subagentType: 'pairingbuddy:implement-tests' })

  const rows = await bodyRows($, undefined)

  expect(rows.filter(row => row.startsWith('not a pb1 label')), 'the latest three').toEqual(raws.slice(3))
  expect(rows, 'then the count of all six').toContain('6 labels unknown')
})
