// Scenario pb-report-command: /pb-report writes the run report as the pane's 'r open report' does, and says where it is.
// Runs under `claude plugin test .` with recorded fs.write and process.run.
import { expect, mock, test } from 'claude-code/testing'
import { engine, ROOT, start } from './testing/band'
import { POLL_MS } from './poll'
import { REPORTS_DIR } from './report'
import { recordReportCalls } from './testing/report'

// Starts a live run on a mock clock with the report calls recorded, then runs /pb-report.
async function runPbReport($: any, on: Function, failure: Parameters<typeof recordReportCalls>[1] = {}) {
  const rig = engine(on)
  const clock = mock.clock(on, { now: Date.parse('2026-11-03T06:40:00Z') })
  const recorder = recordReportCalls(on, failure)
  await start($)
  await clock.advance(POLL_MS)
  const result: any = await $.command.run({ command: 'pb-report', args: '' })
  return { ...rig, ...recorder, clock, result }
}

test('pb-report is registered as a command that runs while Claude is working', async ($, on) => {
  const { calls } = engine(on)

  await start($)

  const spec = calls.registered.find(command => command.name === 'pb-report')
  expect(spec, 'the mod registers a pb-report command').toBeDefined()
  expect(spec.immediate, 'it runs at once, also mid-turn').toBe(true)
  expect(spec.description.length, 'it has a one-line description').toBeGreaterThan(0)
})

test('pb-report on a live run writes the report, opens it and answers with its absolute path', async ($, on) => {
  const { writes, calls, result } = await runPbReport($, on)

  expect(writes.length, 'the command writes one report').toBe(1)
  const [{ path }] = writes
  expect(path.startsWith(`${ROOT}/${REPORTS_DIR}/`), 'under the reports folder').toBe(true)
  expect(calls.some(c => c.kind === 'run' && c.argv[0] === 'open' && c.argv[1] === path), 'and opens it').toBe(true)
  expect(result?.text, 'the answer names the absolute path, so it can be clicked').toContain(path)
  expect(result.text, 'and says it opened').toContain('opened in your browser')
})

test('pb-report still gives the path when the report could not be opened', async ($, on) => {
  const { writes, result } = await runPbReport($, on, { exitCode: 1 })

  const [{ path }] = writes
  expect(result?.text, 'the path is given, so the report can be opened by hand').toContain(path)
  expect(result.text, 'and it says the open did not work').toContain("couldn't open it")
  expect(result.text, 'it does not claim the report opened').not.toContain('opened in your browser')
})

test('pb-report with no run writes nothing and says plainly there is no run to report', async ($, on) => {
  const { serve } = engine(on, null)
  serve(null)
  const clock = mock.clock(on, { now: Date.parse('2026-11-03T06:40:00Z') })
  const { writes, calls } = recordReportCalls(on)
  await start($)
  await clock.advance(POLL_MS)

  const result: any = await $.command.run({ command: 'pb-report', args: '' })

  expect(writes, 'nothing is written').toEqual([])
  expect(calls.filter(c => c.kind === 'run' && c.argv[0] === 'open'), 'nothing is opened').toEqual([])
  expect(result?.text, 'the answer says there is no run to report').toBe('Pairing Buddy: no run to report yet')
})
