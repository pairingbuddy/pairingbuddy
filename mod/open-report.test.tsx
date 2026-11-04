// Scenario open-report-button: the pane's 'r open report' button writes the report and opens it.
// Runs under `claude plugin test .` with recorded fs.write and process.run.
import { expect, mock, test } from 'claude-code/testing'
import { engine, start, ROOT, SNAPSHOT_RUNNING } from './testing/band'
import { commitsArgv, REPORTS_DIR } from './report'
import { POLL_MS } from './poll'
import { PANE } from './testing/replay'
import { recordReportCalls, REPORT_KEY, REPORT_LABEL, REPORT_SLUG, paneTexts, pressReportButton, reportButton, reportConfirmation, reportOpenFailure, reportWriteFailure, REPORT_OPENED, writtenFileName } from './testing/report'

test('pane-shows-open-report-button', async ($, on) => {
  engine(on)
  mock.clock(on, { now: 0 })
  await start($)

  const withLedger = await reportButton($)

  expect(withLedger?.text, 'while a ledger is live the pane holds the open-report button').toBe(REPORT_LABEL)
})

test('pane-has-no-open-report-button-before-any-ledger-is-polled', async ($, on) => {
  const { serve } = engine(on)
  serve(null)
  const clock = mock.clock(on, { now: 0 })
  await start($)
  await clock.advance(POLL_MS)

  const noLedgerYet = await reportButton($)

  expect(noLedgerYet, 'with no ledger polled in the session the pane holds no open-report button').toBeUndefined()
})

test('open-report-writes-html-under-reports-dir', async ($, on) => {
  const day = '2026-11-03'

  const { writes } = await pressReportButton($, on, { now: Date.parse(`${day}T06:40:00Z`) })

  const [written] = writes
  expect(writes.length, 'pressing the button writes exactly one file').toBe(1)
  expect(written.path, 'the report goes under the reports folder').toContain('.pairingbuddy/reports/')
  expect(written.path.endsWith('.html'), 'the report file is html').toBe(true)
  expect(written.path, 'the file name carries the mock clock date').toContain(day)
  expect(written.path, 'the file name carries a slug of the task').toContain(REPORT_SLUG)
  expect(written.text.startsWith('<!doctype html>'), 'the text is the rendered report page').toBe(true)
  expect(written.text, 'the report holds the task text').toContain(SNAPSHOT_RUNNING.task.slice(0, 30))
})

test('open-report-opens-written-file', async ($, on) => {
  const { writes, calls } = await pressReportButton($, on)

  expect(writes.length, 'the report was written before it can be opened').toBe(1)
  const [{ path }] = writes
  const runs = calls.flatMap((c) => (c.kind === 'run' ? [c.argv] : []))
  expect(runs, 'process.run is called with open and the written path').toContainEqual(['open', path])
  expect(path.startsWith('/'), 'the opened path is absolute').toBe(true)
  const writeAt = calls.findIndex((c) => c.kind === 'write' && c.path === path)
  const openAt = calls.findIndex((c) => c.kind === 'run' && c.argv[0] === 'open')
  expect(openAt, 'the open happens after the write').toBeGreaterThan(writeAt)
})

test('open-report-confirms-in-pane', async ($, on) => {
  const { writes } = await pressReportButton($, on)
  const fileName = writtenFileName(writes, 'the press wrote no report, so there is no file name to confirm')

  const drawn = await paneTexts($)

  expect(drawn, 'the pane confirms the file name, not the full path, and the browser open').toContain(reportConfirmation(fileName))
})

test('open-report-failure-shown-not-thrown: the write rejects', async ($, on) => {
  const { calls } = await pressReportButton($, on, { failWrite: true })

  const drawn = await paneTexts($)

  expect(drawn, 'the pane names the write as what failed').toContain(reportWriteFailure)
  expect(calls.filter((c) => c.kind === 'run' && c.argv[0] === 'open'), 'no open is attempted after a failed write').toEqual([])
  expect(drawn.some((t) => t.includes(REPORT_OPENED)), 'the pane does not claim the report was opened').toBe(false)
})

test('open-report-failure-shown-not-thrown: the open rejects', async ($, on) => {
  const { writes, calls } = await pressReportButton($, on, { failRun: true })
  const fileName = writtenFileName(writes, 'the report was written before the open failed')

  const drawn = await paneTexts($)

  expect(drawn, 'the pane says the file was written but could not be opened').toContain(reportOpenFailure(fileName))
  expect(calls.some((c) => c.kind === 'run' && c.argv[0] === 'open'), 'the open was attempted').toBe(true)
  expect(drawn.some((t) => t.includes(REPORT_OPENED)), 'the pane does not claim the report was opened').toBe(false)
})

test('open-report-failure-shown-not-thrown: the open exits non-zero', async ($, on) => {
  const { writes } = await pressReportButton($, on, { exitCode: 1 })
  const fileName = writtenFileName(writes, 'the report was written before the open failed')

  const drawn = await paneTexts($)

  expect(drawn, 'the pane says the file was written but could not be opened').toContain(reportOpenFailure(fileName))
  expect(drawn.some((t) => t.includes(REPORT_OPENED)), 'the pane does not claim the report was opened').toBe(false)
})

test('open-report-writes-only-the-report', async ($, on) => {
  const shas = ['a1b2c3d', 'e4f5a6b']
  const ledger = { ...SNAPSHOT_RUNNING, commits: shas }

  const { writes, touched, files } = await pressReportButton($, on, { ledger })

  const [{ path }] = writes
  expect([...files.keys()], 'the one write is applied, to a file in the reports folder').toEqual([path])
  expect(path.startsWith(`${ROOT}/${REPORTS_DIR}/`), 'the report is written under <root>/.pairingbuddy/reports/').toBe(true)
  expect(touched, 'no refused write: the press only reads the commits and opens the report').toEqual([`process.run ${commitsArgv(shas).join(' ')}`, `process.run open ${path}`])
})

// Chosen rule: the note is shown only while a ledger exists. The other rule (a new run, a different runId) needs two runIds,
// and no fixture or snapshot carries a top-level runId, so it would mean inventing values.
test('report-note-shown-only-while-ledger-exists', async ($, on) => {
  const { writes, serve, clock } = await pressReportButton($, on)
  const fileName = writtenFileName(writes, 'the press wrote the report, so a note is shown')
  const whileLedger = await paneTexts($)
  serve(null)
  await clock.advance(POLL_MS)
  const idle = await paneTexts($)
  serve(SNAPSHOT_RUNNING)
  await clock.advance(POLL_MS)

  const nextRun = await paneTexts($)

  expect(whileLedger, 'the note is shown while the run has a ledger').toContain(reportConfirmation(fileName))
  expect(idle.some((t) => t.includes(fileName)), 'once the poll sees no ledger the pane no longer shows the note').toBe(false)
  expect(nextRun.some((t) => t.includes(fileName)), 'a ledger served again does not bring back the note from the earlier run').toBe(false)
})

test('pressing the report button after the live ledger is gone writes a report named and filled from the last polled ledger', async ($, on) => {
  const sha = 'abc1234def5678abc1234def5678abc1234def56'
  const { serve } = engine(on, { ...SNAPSHOT_RUNNING, commits: [sha] })
  const clock = mock.clock(on, { now: Date.parse('2026-11-03T06:40:00Z') })
  const recorder = recordReportCalls(on)
  await start($)
  serve(null)
  await clock.advance(POLL_MS)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  await pane.unmount()

  const fileName = writtenFileName(recorder.writes, 'the press writes one report although the live ledger is gone')
  expect(fileName, 'the file name carries the last run slug').toContain(REPORT_SLUG)
  expect(recorder.writes[0].text, 'the report holds the last run task').toContain(SNAPSHOT_RUNNING.task.slice(0, 30))
  const runs = recorder.calls.flatMap((c) => (c.kind === 'run' ? [c.argv] : []))
  expect(runs, 'the commits are read via git from the snapshot shas').toContainEqual(commitsArgv([sha]))
})

test('report-from-snapshot-ignores-stale-legacy-tests', async ($, on) => {
  const healthyId = 'apply-discount-100-by-10-returns-90'
  const legacyId = 'apply-discount-100-by-10-percent'
  // The snapshot is written by the poll from the served ledger; the kit gives a test no way to write state, so the stale legacy list cannot be planted directly.
  const record = (exitCode: number) => ({ stage: 'code-tdd', attempt: 1, done: true, passed: true, timedOut: false, excerpt: '', head: 'abc1234', sha: null, exitCodes: [exitCode] })
  const ledger = { ...SNAPSHOT_RUNNING, tests: { perTest: { [healthyId]: { selector: { runner_id: 'node', test_file: 'tests/discount.test.mjs', test_function: healthyId }, red: record(1), green: record(0) } } } }
  const { serve } = engine(on, ledger)
  const clock = mock.clock(on, { now: Date.parse('2026-11-03T06:40:00Z') })
  const recorder = recordReportCalls(on)
  await start($)
  serve(null)
  await clock.advance(POLL_MS)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  await pane.unmount()

  writtenFileName(recorder.writes, 'the press writes one report')
  const html = recorder.writes[0].text.match(/<h2>TESTS<\/h2>[\s\S]*?<\/section>/)?.[0] ?? ''
  expect(html, 'the ledger key is in the report').toContain(healthyId)
  expect(html, 'the ledger result is shown').toContain('passed (exit 0)')
  expect(html.includes('not reached'), 'no test card says not reached').toBe(false)
  expect(html.includes(legacyId), 'the legacy-only id is not shown').toBe(false)
})
