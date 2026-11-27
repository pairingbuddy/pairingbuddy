// Scenario goal-tracer: in a plan with tracer bullets, the pane's GOAL and the band's first row name the tracer the task
// being built belongs to, before the task; a plan with no tracer heading over the task shows the task alone.
import { expect, test } from 'claude-code/testing'
import { PLAN_PATH, paneLines, setupPlanReplay } from './testing/replay'
import { BAND, LEDGER_PATH, SNAPSHOT_RUNNING, isSeparatorRule, start } from './testing/band'
import { POLL_MS } from './poll'

type Harness = Parameters<typeof paneLines>[0]
type On = Parameters<typeof setupPlanReplay>[0]

const TASK_TITLE = 'Task 32: Fetch the dependencies from the lockfile alone in the image builds'
const TRACED = [
  '# Build speed', '', '## Tasks', '',
  '### TB12: CI stack 4: image build cost on pull requests (candidate)', '',
  `- [ ] ${TASK_TITLE}`, '',
].join('\n')

async function showGoal($: Harness, on: On, planText: string, columns: number) {
  const { rig } = setupPlanReplay(on, planText)
  rig.served.set(LEDGER_PATH, JSON.stringify({ ...SNAPSHOT_RUNNING, task: `${TASK_TITLE}.\n\nSteps follow.`, plan: { path: PLAN_PATH, title: TASK_TITLE } }))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  const lines = await paneLines($, { bodyColumns: columns })
  const goalAt = lines.findIndex(line => line.startsWith('GOAL'))
  const statusAt = lines.findIndex(line => line.startsWith('STATUS'))
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns }, surface: 'terminal' })
  const [first] = (await band.findAll({ type: 'Text' })).filter((node: any) => !isSeparatorRule(node))
  await band.unmount()
  return { goal: lines.slice(goalAt, statusAt), band: (first as any).text as string }
}

test('at-120-columns-the-goal-names-the-tracer-before-the-task', async ($, on) => {
  const { goal, band } = await showGoal($, on, TRACED, 120)
  expect(goal.join('\n')).toContain('TB12 · CI stack 4')
  expect(goal.join(' ').replace(/\s+/g, ' ')).toContain(`› ${TASK_TITLE}`)
  expect(band.startsWith('TB12 · CI stack 4'), band).toBe(true)
  expect(band, 'the task follows the tracer').toContain(`› ${TASK_TITLE}`)
})

test('at-80-columns-the-tracer-name-is-cut-first-and-the-task-stays-whole-on-two-lines', async ($, on) => {
  const { goal, band } = await showGoal($, on, TRACED, 80)
  expect(goal.length, 'GOAL keeps to two lines').toBe(2)
  expect(goal[0].startsWith('GOAL     TB12 · '), goal[0]).toBe(true)
  expect(goal.join(' ').replace(/\s+/g, ' ')).toContain(`› ${TASK_TITLE}`)
  expect(band.startsWith('TB12 › Task 32: Fetch the dependencies'), 'the id leads and the task keeps as many words as fit').toBe(true)
  expect([...band].length, 'the band row fits beside the control').toBeLessThanOrEqual(76)
})

const UNTRACED = ['# Build speed', '', '## Tasks', '', `- [ ] ${TASK_TITLE}`, ''].join('\n')

for (const columns of [80, 120]) {
  test(`with-no-tracer-heading-over-the-task-the-goal-is-the-task-alone-at-${columns}-columns`, async ($, on) => {
    const { goal, band } = await showGoal($, on, UNTRACED, columns)
    expect(goal[0].startsWith('GOAL     Task 32: Fetch'), goal[0]).toBe(true)
    expect(band.startsWith('Task 32: Fetch'), band).toBe(true)
  })
}
