// Scenario pb-plan-command: the pane's PLAN block shows a window of the plan; /pb-plan writes the whole plan as a page under
// the reports folder, opens it and says where it is, as /pb-report does for the run.
import { expect, test } from 'claude-code/testing'
import { setupPlanReplay } from './testing/replay'
import { ROOT, start } from './testing/band'
import { recordReportCalls } from './testing/report'
import { POLL_MS } from './poll'
import { commitsArgv, REPORTS_DIR } from './report'

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

const PR_PLAN = ['# Shop', '', '## Tasks', '', '### T1: Cart', '', '#### PR: Add', '', '- [x] Task 1: Add an item', '- [ ] Task 2: Remove an item', ''].join('\n')
const sha = (digit: string) => digit.repeat(40)
const OPEN_ADD = JSON.stringify({ unit: 'Add', plan: 'docs/plans/shop.md', tracer: 'T1: Cart', branch: 'feat/add', base: 'main', baseSha: 'abc', tasks: [{ title: 'Task 1: Add an item', headSha: sha('2') }], commits: [sha('1'), sha('2'), sha('3')] })

// The page's commit subjects come from one read-only git call over the unit's own commits, as /pb-report reads a run's.
test('pb-plan reads the open unit\'s commit subjects with git and groups the commits under the task the record says', async ($, on) => {
  const { rig } = setupPlanReplay(on, PR_PLAN)
  rig.served.set(`${ROOT}/.pairingbuddy/run/unit.json`, OPEN_ADD)
  const writes: { path: string; text: string }[] = []
  const runs: string[][] = []
  on('fs.write', async (_: unknown, e: { path: string; text: string }) => (writes.push(e), { value: undefined }))
  on('process.run', async (_: unknown, e: { argv: string[] }) => {
    runs.push(e.argv)
    const stdout = e.argv[0] === 'git' ? `${sha('1')}\tfeat: add <item>\n${sha('2')}\tdocs: note it\n${sha('3')}\twip: remove\n` : ''
    return { value: { stdout, stderr: '', exitCode: 0 } }
  })
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  await $.command.run({ command: 'pb-plan', args: '' })

  expect(runs[0], 'one git read of exactly the unit\'s commits').toEqual(commitsArgv([sha('1'), sha('2'), sha('3')]))
  const text = writes[0]?.text ?? ''
  expect(text).toContain('<summary>3 commits</summary>')
  expect(text, 'escaped subject').toContain('1111111 feat: add &lt;item&gt;')
  expect(text.indexOf('after the last finished task') < text.indexOf('Task 1: Add an item\n<ul>'), 'Task 1 holds its two commits; the third comes after it').toBe(true)
})

test('pb-plan lists the open unit questions for you on the page', async ($, on) => {
  const { rig } = setupPlanReplay(on, PLAN)
  const question = { gate: 'G:task-end', task: 'Task 1: Add an item', step: 'a reviewer', ambiguity: 'Should removing the last item empty the cart?' }
  rig.served.set(`${ROOT}/.pairingbuddy/run/unit.json`, JSON.stringify({
    unit: 'T1: Cart', plan: 'docs/plans/shop.md', tracer: 'T1: Cart', branch: 'feat/cart', base: 'main', baseSha: 'abc', tasks: [], commits: [], questions: [question],
  }))
  const { writes } = recordReportCalls(on)
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  await $.command.run({ command: 'pb-plan', args: '' })

  expect(writes[0]?.text, 'the question, with its task').toContain('Should removing the last item empty the cart? (Task 1: Add an item)')
})
