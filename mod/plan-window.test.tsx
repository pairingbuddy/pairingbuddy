// Scenario plan-window: a real plan has 150 tasks, and a PLAN tree of every one buried the task being built far below the
// ticked ones. The PLAN block has a fixed most rows, whatever the plan's size: a window around the focus, the focus's tracer
// and unit rows kept, each cut marked by an ellipsis row that counts what it hides.
import { expect, test } from 'claude-code/testing'
import { paneLines, setupPlanReplay } from './testing/replay'
import { ROOT, start } from './testing/band'
import { POLL_MS } from './poll'
import { PLAN_ROWS } from '../shared-node/plan-window.mjs'

type Harness = Parameters<typeof paneLines>[0]
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

async function planBlock($: Harness, on: On, planText: string, files: Record<string, string> = {}, columns = 140): Promise<string[]> {
  const { rig } = setupPlanReplay(on, planText)
  for (const [path, content] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, content)
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  const lines = await paneLines($, { bodyColumns: columns })
  return lines.slice(lines.findIndex(line => line.startsWith('PLAN')))
}

test('a 150-task plan draws a window around the next task in at most PLAN_ROWS rows, each cut end marked', async ($, on) => {
  const rows = await planBlock($, on, bigPlan(15, 100))

  expect(rows.length <= PLAN_ROWS, `the block keeps to ${PLAN_ROWS} rows, got ${rows.length}:\n${rows.join('\n')}`).toBe(true)
  expect(rows[0], 'the first row says what is cut above').toMatch(/^PLAN     … \d+ tasks done above$/)
  expect(rows, 'the next task keeps its tracer and unit rows').toEqual(expect.arrayContaining(['         T11: Tracer 11', '           T11a Unit', '             ○ Task 101: Do step 101']))
  expect(rows.at(-1), 'the last row says what is cut below').toMatch(/^ {9}… \d+ tasks to do below/)
})

test('above the focus one ellipsis row opens the block, however many units it hides, even one under a shown tracer', async ($, on) => {
  const rows = await planBlock($, on, bigPlan(15, 100))

  expect(rows.slice(0, 4), 'T10a, cut under its tracer, is counted in the one row above, not given a row of its own').toEqual([
    'PLAN     … 95 tasks done above',
    '         T10: Tracer 10',
    '           T10b Unit',
    '             ✓ Task 96: Do step 96',
  ])
  expect(rows.filter(row => row.includes('…')).length, 'one cut above and one below').toBe(2)
})

const ONE_UNIT = ['# Shop', '', '## Tasks', '', '### T1: Pay', '', '- [x] Task 1: Take payment', '- [ ] Task 2: Refund', ''].join('\n')
const sha = (n: number) => String(n).padStart(7, '0') + 'f'.repeat(33)
const openWithCommits = (count: number) => JSON.stringify({ unit: 'T1: Pay', plan: 'docs/plans/shop.md', tracer: 'T1: Pay', branch: 'feat/pay', base: 'main', baseSha: 'abc', tasks: [{ title: 'Task 1: Take payment' }], commits: Array.from({ length: count }, (_, i) => sha(i + 1)) })

test('the open unit shows at most four commit rows: past four, a count of the earlier ones and the latest three', async ($, on) => {
  const rows = await planBlock($, on, ONE_UNIT, { '.pairingbuddy/run/unit.json': openWithCommits(12) })

  expect(rows.filter(row => /commit/.test(row)), 'the newest commits, the earlier ones counted').toEqual([
    '             … 9 earlier commits',
    '             commit 0000010',
    '             commit 0000011',
    '             commit 0000012',
  ])
})

test('plan problems take at most three rows, the rest counted, and the block with them keeps to PLAN_ROWS', async ($, on) => {
  const strays = Array.from({ length: 10 }, (_, i) => `- [ ] Stray ${i + 1}`)
  const rows = await planBlock($, on, bigPlan(15, 100).replace('## Tasks\n', `## Tasks\n\n${strays.join('\n')}\n`))

  expect(rows.length <= PLAN_ROWS, `the block keeps to ${PLAN_ROWS} rows, got ${rows.length}`).toBe(true)
  expect(rows.slice(-3), 'the first two problems, then how many more').toEqual([
    '         the task "Stray 1" is not under a tracer',
    '         the task "Stray 2" is not under a tracer',
    '         … 8 more plan problems',
  ])
})

test('a unit of 50 tasks is windowed too: its tracer and unit rows stay above a window over its tasks', async ($, on) => {
  const boxes = Array.from({ length: 50 }, (_, i) => `- [${i < 30 ? 'x' : ' '}] Task ${i + 1}: Step ${i + 1}`)
  const rows = await planBlock($, on, ['# Long', '', '## Tasks', '', '### T1: Long', '', ...boxes, ''].join('\n'))

  expect(rows.length <= PLAN_ROWS, `the block keeps to ${PLAN_ROWS} rows, got ${rows.length}`).toBe(true)
  expect(rows.slice(0, 3), 'the tracer and unit rows lead, then the cut of the unit\'s done tasks').toEqual([
    'PLAN     T1: Long',
    '           T1: Long',
    expect.stringMatching(/^ {13}… \d+ tasks done$/),
  ])
  expect(rows, 'the next task is in the window').toContain('             ○ Task 31: Step 31')
  expect(rows.at(-1)).toMatch(/^ {13}… \d+ tasks to do below/)
})

test('the cut at the tree\'s end names /pb-plan, which shows the whole plan, shortened to fit a narrow pane', async ($, on) => {
  const wide = await planBlock($, on, bigPlan(15, 100))

  expect(wide.at(-1), 'the cut below says how to see it all').toBe('         … 40 tasks to do below · /pb-plan shows all')
  expect(wide.filter(row => row.includes('/pb-plan')).length, 'named once').toBe(1)
})

test('in a narrow pane the hint on the cut gives way to its short form, and never runs past the width', async ($, on) => {
  const narrow = await planBlock($, on, bigPlan(15, 150), {}, 50)

  expect(narrow[0], 'all done: the only cut is above, and it carries the hint').toBe('PLAN     … 135 tasks done above · /pb-plan')
})

// The open unit once pb has built and ticked all its tasks (first..last): its pull request is not opened yet.
const openUnit = (name: string, tracer: string, first: number, last: number) => JSON.stringify({ unit: name, plan: 'docs/plans/shop.md', tracer, branch: 'feat/t3b', base: 'main', baseSha: 'abc', tasks: Array.from({ length: last - first + 1 }, (_, i) => ({ title: `Task ${first + i}: Do step ${first + i}` })), commits: [] })

test('an open unit whose pull request is not opened yet is the focus, not the next unticked task', async ($, on) => {
  const rows = await planBlock($, on, bigPlan(15, 100), { '.pairingbuddy/run/unit.json': openUnit('T3b Unit', 'T3: Tracer 3', 26, 30) })

  expect(rows, `the open unit's title and its last task show:\n${rows.join('\n')}`).toEqual(expect.arrayContaining(['           T3b Unit · pull request not opened yet', '             ✓ Task 30: Do step 30']))
  expect(rows.some(row => row.includes('Task 101')), 'the next unticked task is far below, cut').toBe(false)
})
