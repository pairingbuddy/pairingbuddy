// Scenario pb-plan-command: the pane's PLAN block shows a window of the plan; /pb-plan writes the whole plan as a page under
// the reports folder, opens it and says where it is, as /pb-report does for the run.
import { expect, test } from 'claude-code/testing'
import { setupPlanReplay } from './testing/replay'
import { ROOT, start } from './testing/band'
import { recordReportCalls } from './testing/report'
import { POLL_MS } from './poll'
import { REPORTS_DIR } from './report'

const PLAN = ['# Shop', '', '## Tasks', '', '### T1: Cart', '', '- [x] Task 1: Add an item', '- [ ] Task 2: Remove an item', ''].join('\n')

test('pb-plan writes the whole plan as a page under the reports folder, opens it and answers with its path', async ($, on) => {
  const { rig } = setupPlanReplay(on, PLAN)
  const { writes, calls } = recordReportCalls(on)
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  const result: any = await $.command.run({ command: 'pb-plan', args: '' })

  expect(writes.length, 'one page is written').toBe(1)
  const [{ path, text }] = writes
  expect(path, 'under the reports folder, named for the plan').toMatch(new RegExp(`^${ROOT}/${REPORTS_DIR}/\\d{4}-\\d{2}-\\d{2}-\\d{6}-plan\\.html$`))
  expect(text, 'the whole tree').toContain('○ Task 2: Remove an item')
  expect(calls.some(c => c.kind === 'run' && c.argv[0] === 'open' && c.argv[1] === path), 'and opens it').toBe(true)
  expect(result?.text, 'the answer names the absolute path, so it can be clicked').toBe(`Pairing Buddy plan: ${path} · opened in your browser`)
})

test('pb-plan with no plan writes nothing and says plainly there is no plan to show', async ($, on) => {
  const { rig } = setupPlanReplay(on, PLAN)
  rig.served.clear()
  const { writes } = recordReportCalls(on)
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  const result: any = await $.command.run({ command: 'pb-plan', args: '' })

  expect(writes, 'nothing is written').toEqual([])
  expect(result?.text).toBe('Pairing Buddy: no plan to show yet')
})
