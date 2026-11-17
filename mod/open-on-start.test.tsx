// Scenario open-on-run-start (seventh watched run): a run with no question showed only the band until the done alert, so the
// pane opens by itself when a run starts, once per run, without the keyboard, and never again for that run once closed.
import { expect, mock, test } from 'claude-code/testing'
import { SNAPSHOT_RUNNING, start } from './testing/band'
import { alertEngine, needingHuman } from './testing/alert'
import { closeWithPb } from './testing/replay'
import { PANE_ID } from './pane-open'
import { POLL_MS } from './poll'

test('the-pane-opens-unfocused-when-a-run-starts', async ($, on) => {
  mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: SNAPSHOT_RUNNING, startOpened: false })

  await start($)

  expect(run.calls.opened.map(open => open.id), 'the first poll that sees the run opens the pane').toEqual([PANE_ID])
  expect(run.calls.opened[0].focus, 'the pane never takes the keyboard from a person typing').toBeFalsy()
})

test('it-opens-once-per-run-and-again-for-the-next-run', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: { ...SNAPSHOT_RUNNING, runId: 'code-run' }, startOpened: false })
  await start($)

  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)
  const forFirstRun = run.calls.opened.length
  run.serve({ ...SNAPSHOT_RUNNING, kind: 'publish', runId: 'publish-run' })
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)

  expect(forFirstRun, 'later polls of the same run open nothing more').toBe(1)
  expect(run.calls.opened.length, 'the next run opens the pane once more').toBe(2)
})

test('a-pane-closed-for-a-run-never-opens-again-for-it-also-after-a-reload', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: SNAPSHOT_RUNNING, startOpened: false })
  await start($)

  await closeWithPb($)
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)
  // A new session (or a reload of the mod) sees the same run.
  await start($)
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)

  expect(run.calls.closed.map(close => close.id), 'the human closed the pane with /pb').toEqual([PANE_ID])
  expect(run.calls.opened.length, 'the run start opened it once, and nothing opened it again').toBe(1)
})

test('a-start-open-that-is-not-placed-says-once-how-to-open-the-pane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const reason = 'the terminal is narrower than 144 columns'
  const run = alertEngine(on, { ledger: SNAPSHOT_RUNNING, startOpened: false, open: () => ({ value: { isPlaced: false, reason } }) })
  const logged: string[] = []
  on('ui.log', (_: unknown, e: { text: string }) => {
    logged.push(e.text)
    return { value: undefined }
  })
  await start($)
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)

  expect(run.calls.opened.length, 'the pane was asked for once').toBe(1)
  expect(logged.length, `one line says the pane waits: ${JSON.stringify(logged)}`).toBe(1)
  expect(logged[0], 'it gives the reason').toContain(reason)
  expect(logged[0], 'and the way in: /pb, a command, not a band button').toContain('/pb')
  expect(logged[0], 'it names no band button').not.toContain('▸ details')
})

test('a-run-first-seen-with-a-question-opens-the-pane-once-for-the-alert', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: needingHuman(), startOpened: false })
  await start($)
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the question alerted').toBe(1)
  expect(run.calls.opened.length, 'one open, not one for the start and one for the alert').toBe(1)
})

test('a-store-that-fails-opens-nothing-so-a-close-is-never-undone', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: SNAPSHOT_RUNNING, startOpened: false, store: { get: 'reject' } })
  await start($)
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)

  expect(run.served.asked.length, 'the ledger was polled').toBeGreaterThan(0)
  expect(run.calls.opened, 'with no record of the run, the pane is not opened every poll').toEqual([])
})
