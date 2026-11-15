// Scenario alert-done (sixth watched run): when the unit's work is over with nothing left to do, the mod alerts as it does for
// a question (sound, status line, pane), once per run end, so a finished session does not sit idle unnoticed.
import { expect, mock, test } from 'claude-code/testing'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, bandTexts, start } from './testing/band'
import { setupReplay } from './testing/replay'
import { alertEngine } from './testing/alert'
import { PANE_ID } from './pane-open'
import { POLL_MS } from './poll'

// A code run whose task-end gate passed and whose stages are all done: pb task end removes its ledger next.
const SIGNED_OFF = {
  ...SNAPSHOT_RUNNING,
  runId: 'code-run',
  stage: { name: 'code-safety-net', status: 'done', runId: null, attempt: 1, startedAt: '2026-11-03T06:40:00.000Z' },
  gates: { 'G:task-end': { source: 'human-cli', answer: 'approve' } },
}
const DONE_WORDS = 'done · ready for your next task'
const UNIT = '.pairingbuddy/run/unit.json'
const UNIT_FILE = { unit: null, plan: null, tracer: null, branch: 'fix/discount', base: 'main', baseSha: 'abc', tasks: [{ stages: ['intake', 'code-scenarios', 'code-tdd', 'code-safety-net'] }], commits: [] }

test('done-alerts-once-with-sound-status-and-pane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: SIGNED_OFF })
  await start($)
  await clock.advance(POLL_MS)
  expect(run.calls.played, 'a signed-off run that is still live is not done yet').toEqual([])
  // The pane opened by itself when the run was first seen; the done alert's open comes after it.
  const atStart = run.calls.opened.length

  // The run ends with no unit open: nothing is left to publish.
  run.serve(null)
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the end plays one sound').toBe(1)
  expect(run.calls.status.map(status => status.text), 'the status line says it is done').toEqual([DONE_WORDS])
  expect(run.calls.opened.slice(atStart).map(open => open.id), 'the done alert opens the pane once').toEqual([PANE_ID])
})

test('a-stop-after-the-sign-off-alerts-as-a-stop-never-as-done', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: { ...SIGNED_OFF, stop: { code: 'commit-failed', reason: 'the commit failed', seq: 9 } } })
  await start($)
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the stop alerts once').toBe(1)
  expect(run.calls.status.map(status => status.text), 'as a stop').toEqual(['stopped: the commit failed'])
})

test('the-band-says-done-and-ready-for-the-next-task', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: SIGNED_OFF })
  await start($)
  await clock.advance(POLL_MS)
  run.serve(null)
  await clock.advance(POLL_MS)

  const shown = await bandTexts($)

  expect(shown.some(text => text.startsWith(`Pairing Buddy · ${DONE_WORDS}`)), `the band says it is done: ${JSON.stringify(shown)}`).toBe(true)
  expect(shown.some(text => text.includes('last run finished')), 'not the vague "last run finished"').toBe(false)
})

test('no-done-alert-while-the-open-unit-still-publishes-then-one-once-it-closes', async ($, on) => {
  const rig = setupReplay(on)
  const played: unknown[] = []
  const statuses: string[] = []
  on('audio.play', (_: unknown, e: unknown) => { played.push(e); return { value: undefined } })
  on('ui.status', (_: unknown, e: { text: string }) => { statuses.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => { store.set(e.key, e.value); return { value: undefined } })
  rig.served.set(`${ROOT}/${LEDGER}`, JSON.stringify(SIGNED_OFF))
  rig.served.set(`${ROOT}/${UNIT}`, JSON.stringify(UNIT_FILE))
  await rig.clock.set(Date.parse('2026-11-03T06:41:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS)

  // pb task end removes the code run's ledger; the unit stays open for the publish run.
  rig.served.delete(`${ROOT}/${LEDGER}`)
  for (let poll = 0; poll < 3; poll++) await rig.clock.advance(POLL_MS)
  expect(played, 'the pull request is still to come, so this is no end').toEqual([])

  // pb publish opens the pull request and closes the unit.
  rig.served.delete(`${ROOT}/${UNIT}`)
  for (let poll = 0; poll < 3; poll++) await rig.clock.advance(POLL_MS)
  expect(played.length, 'nothing is left to do: one sound').toBe(1)
  expect(statuses, 'the status line says it is done').toEqual([DONE_WORDS])
})
