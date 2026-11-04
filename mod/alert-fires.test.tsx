// Scenario: alert-fires-once-per-event. A stop or needsHuman in the ledger triggers sound, status line and pane open,
// once per event, tracked in the mod's own state.
import { expect, mock, test } from 'claude-code/testing'
import { LEDGER_PATH, ROOT, SNAPSHOT_RUNNING, bandTexts, start } from './testing/band'
import { plainName } from '../shared-node/plain-names.mjs'
import { alertEngine, needingHuman, stopped } from './testing/alert'
import { PANE_ID } from './pane-open'
import { POLL_MS } from './poll'

test('stop-plays-one-sound', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped())
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the first poll that shows the stop plays one sound').toBe(1)
})

test('needs-human-plays-one-sound', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(needingHuman())
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the first poll that shows needsHuman plays one sound').toBe(1)
})

test('stop-sets-status-line', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ code: 'step-failed' }))
  await clock.advance(POLL_MS)

  expect(run.calls.status.length, 'the first poll that shows the stop sets one status line').toBe(1)
  expect(run.calls.status[0].text, 'the line names the stop in plain words').toContain('a step kept failing')
})

test('needs-human-sets-status-line', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(needingHuman({ gate: 'G:task-end' }))
  await clock.advance(POLL_MS)

  expect(run.calls.status.length, 'the first poll that shows needsHuman sets one status line').toBe(1)
  expect(run.calls.status[0].text, 'the line names the gate in plain words').toContain('your sign-off at the end')
  expect(run.calls.status[0].text, 'the line does not show the raw gate id').not.toContain('G:task-end')
})

test('stop-opens-pane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped())
  await clock.advance(POLL_MS)

  expect(run.calls.opened.map(open => open.id), 'the first poll that shows the stop opens the pairingbuddy pane once').toEqual([PANE_ID])
  expect(run.calls.opened[0].closeOnEscape, 'the pane is opened closeable by esc, as the details button opens it').toBe(true)
})

test('needs-human-opens-pane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(needingHuman())
  await clock.advance(POLL_MS)

  expect(run.calls.opened.map(open => open.id), 'the first poll that shows needsHuman opens the pairingbuddy pane once').toEqual([PANE_ID])
})

test('repeated-polls-do-not-realert', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped())
  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'several polls of the same stop play one sound').toBe(1)
  expect(run.calls.status.length, 'several polls of the same stop set one status line').toBe(1)
  expect(run.calls.opened.length, 'several polls of the same stop open the pane once').toBe(1)
})

test('no-toast', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped())
  await clock.advance(POLL_MS)
  run.serve(needingHuman({ seq: 4 }))
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'both events alerted, so the test exercised the alert').toBe(2)
  expect(run.calls.toasted, 'neither a stop nor a needsHuman calls $.ui.toast').toEqual([])
})

test('no-alert-when-neither-set', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: { ...SNAPSHOT_RUNNING, stop: null, needsHuman: null } })
  await start($)

  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)

  expect(run.served.asked, 'the polls read the running ledger, so the silence below is not from polling nothing').toContain(LEDGER_PATH)
  expect(run.calls.played, 'a ledger with stop and needsHuman null plays nothing').toEqual([])
  expect(run.calls.status, 'a ledger with stop and needsHuman null sets no status line').toEqual([])
  expect(run.calls.opened, 'a ledger with stop and needsHuman null opens nothing').toEqual([])
})

test('standing-event-at-session-start-alerts-once-if-unseen', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { ledger: stopped() })

  await start($)

  expect(run.calls.played.length, 'the immediate poll at session start plays one sound for the standing stop').toBe(1)
  expect(run.calls.status.length, 'the immediate poll at session start sets one status line').toBe(1)
  expect(run.calls.opened.length, 'the immediate poll at session start opens the pane once').toBe(1)

  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the polls after session start do not play the sound again').toBe(1)
  expect(run.calls.status.length, 'the polls after session start do not set the status line again').toBe(1)
  expect(run.calls.opened.length, 'the polls after session start do not open the pane again').toBe(1)
})

test('sound-plays-bundled-asset', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped())
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the first poll that shows the stop plays one clip').toBe(1)
  expect(run.calls.played[0].clip, 'the clip is the plugin\'s bundled alert file, asked for by asset path').toEqual({ asset: 'mod/assets/alert.wav' })
})

test('seen-record-keyed-by-run-kind-seq', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  const key = `alert-seen:${ROOT}`
  await start($)

  run.serve(stopped({ seq: 7 }))
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the stop alerted, so the test exercised the seen record').toBe(1)
  expect([...run.store.keys()], 'the store holds one record for the project, under a project-scoped key').toEqual([key])
  const seen = run.store.get(key) as { run: unknown; stop: unknown; needsHuman: unknown }
  expect(seen.run, 'the record holds the run identity').toBeTruthy()
  expect(seen.stop, 'the record holds the seq of the stop').toBe(7)
  expect(seen.needsHuman, 'the record holds no seq for the kind that did not fire').toBeNull()
})

for (const [name, store] of [
  ['store-get-rejects', { get: 'reject' }],
  ['store-get-throws', { get: 'throw' }],
  ['store-set-rejects', { set: 'reject' }],
  ['store-set-throws', { set: 'throw' }],
] as const) {
  test(`store-failure-does-not-break-alert: ${name}`, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const run = alertEngine(on, { store })
    await start($)

    run.serve(stopped())
    await clock.advance(POLL_MS)

    expect(run.calls.played.length, 'the stop alerted though the store failed: one sound').toBe(1)
    expect(run.calls.status.length, 'the stop alerted though the store failed: one status line').toBe(1)
    expect(run.calls.opened.length, 'the stop alerted though the store failed: the pane opened').toBe(1)

    const next = stopped({ seq: 5 })
    run.serve({ ...next, stage: { ...next.stage, name: 'code-tdd' } })
    await clock.advance(POLL_MS)

    expect((await bandTexts($)).join(' '), 'the poll kept running, so the band shows the next ledger\'s stage').toContain(plainName('code-tdd'))
    expect(run.calls.played.length, 'the new event alerted again on the next poll').toBe(2)
  })
}

test('older-ledger-stop-without-code-still-alerts', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ noCode: true }))
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'a stop with no code plays one sound').toBe(1)
  expect(run.calls.status.length, 'a stop with no code sets one status line').toBe(1)
  expect(run.calls.status[0].text, 'the line falls back to the plain stopped message').toBe('Pairing Buddy stopped')
  expect(run.calls.opened.map(open => open.id), 'a stop with no code opens the pairingbuddy pane once').toEqual([PANE_ID])
})
