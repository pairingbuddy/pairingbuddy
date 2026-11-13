// Scenarios: audio-unavailable and sound-preference (mod side). The alertSound option is passed to test() as
// { options: { alertSound: false } } where the preference is off.
import { expect, mock, test } from 'claude-code/testing'
import { POLL_MS } from './poll'
import { NEEDS_YOU_OPENED, ROOT, bandSays, bandTexts, start } from './testing/band'
import { outcome, isDeny } from './testing/hooks'
import { PANE_ID } from './pane-open'
import { alertOn } from './alert'
import { alertEngine, alertOnlyEngine, needingHuman, sameEventPolledThenNewEvent, stopped } from './testing/alert'

for (const play of ['reject', 'throw'] as const) {
  test(`audio-play-rejects-band-and-status-remain: ${play}`, async ($, on) => {
    const run = alertEngine(on, { ledger: stopped({ code: 'step-failed' }), play })
    await start($)

    const shown = await bandTexts($)

    expect(run.calls.played.length, `the engine was asked to play the sound, so the ${play} answer was exercised`).toBe(1)
    expect(run.calls.status.length, `the status line is still set when the sound ${play}s`).toBe(1)
    expect(run.calls.status[0].text, 'the status line names the stop in plain words').toContain('a step kept failing')
    expect(run.calls.opened.length, `the pane still opens when the sound ${play}s`).toBe(1)
    expect(bandSays(shown, NEEDS_YOU_OPENED), `the band still reads "needs you · opened details" when the sound ${play}s: ${JSON.stringify(shown)}`).toBe(true)
  })
}

test('audio-failure-not-retried-for-same-event', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { play: 'reject' })
  await start($)

  const played = await sameEventPolledThenNewEvent(run, clock, () => run.calls.played.length)

  expect(played.forFirstEvent, 'the sound that failed is played once for the event, not on every poll').toBe(1)
  expect(played.total, 'the poll kept running through the earlier polls, so a new event still plays the sound').toBe(2)
})

for (const play of ['reject', 'throw'] as const) {
  test(`audio-failure-does-not-deny-or-throw: ${play}`, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const run = alertEngine(on, { ledger: stopped({ code: 'step-failed' }), play })

    const started = await outcome(() => start($))
    const polled = await outcome(() => clock.advance(POLL_MS))
    run.serve(stopped({ seq: 5, code: 'commit-failed' }))
    const polledAgain = await outcome(() => clock.advance(POLL_MS))

    expect(run.calls.played.length, `both the first stop and the new stop asked for the sound and it ${play}ed, so both failures were exercised`).toBe(2)
    expect(started.error, `session.start does not throw when the sound ${play}s`).toBeUndefined()
    expect(isDeny(started.value), `session.start does not deny when the sound ${play}s`).toBe(false)
    expect(started.value, `session.start hands on what next answered when the sound ${play}s`).toEqual({ cwd: ROOT })
    expect(polled.error, `a poll does not throw when the sound ${play}s`).toBeUndefined()
    expect(polledAgain.error, `a poll on a new event does not throw when the sound ${play}s`).toBeUndefined()
  })
}

// Deliberate partner of the alertSound: false cases below; mirrors stop-plays-one-sound on purpose.
test('sound-on-by-default', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped())
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'with no alertSound option set, the stop plays the sound once').toBe(1)
})

test('sound-off-plays-nothing', { options: { alertSound: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped())
  await clock.advance(POLL_MS)
  run.serve(needingHuman({ seq: 5 }))
  await clock.advance(POLL_MS)

  expect(run.calls.status.length, 'the stop and the needsHuman both alerted, so the alert ran').toBe(2)
  expect(run.calls.played, 'with the preference off, neither the stop nor the needsHuman plays a sound').toEqual([])
})

test('sound-off-keeps-status-line', { options: { alertSound: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ code: 'step-failed' }))
  await clock.advance(POLL_MS)

  expect(run.calls.status.length, 'the stop alerted once, so the status line is set once with the sound off').toBe(1)
  expect(run.calls.status[0].text, 'the status line names the stop by its plain name').toContain('a step kept failing')
})

test('sound-off-keeps-band', { options: { alertSound: false } }, async ($, on) => {
  const run = alertEngine(on, { ledger: stopped(), open: 'ok' })
  await start($)

  const shown = await bandTexts($)

  expect(run.calls.played, 'the preference is off, so no sound was played').toEqual([])
  expect(bandSays(shown, NEEDS_YOU_OPENED), `the band still reads "needs you · opened details" with the sound off: ${JSON.stringify(shown)}`).toBe(true)
})

test('sound-off-keeps-pane-open', { options: { alertSound: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  const opened = await sameEventPolledThenNewEvent(run, clock, () => run.calls.opened.length)

  expect(run.calls.played, 'the preference is off, so no sound was played for either event').toEqual([])
  expect(opened.forFirstEvent, 'four polls of the same stop open the pane once with the sound off').toBe(1)
  expect(opened.total, 'the new stop opens the pane again, so two events give two opens with the sound off').toBe(2)
  expect(run.calls.opened.map(open => open.id), 'both opens with the sound off are the pairingbuddy pane').toEqual([PANE_ID, PANE_ID])
})

// A /config change reloads the plugin and re-runs register with new options, so alertOn must use the options it is handed
// each time, not a default or a value captured earlier. The kit cannot re-run register inside one test, so each alertOn call
// below stands for one activation's options, run against a recording engine fake (the test's `$` only drives the plugin).
test('preference-read-at-alert-time', async () => {
  const { engine, played, statuses } = alertOnlyEngine()

  await alertOn(engine, stopped({ seq: 3 }), { alertSound: false })
  const afterOff = played.length
  await alertOn(engine, stopped({ seq: 5, code: 'commit-failed' }), { alertSound: true })
  const afterOn = played.length
  await alertOn(engine, needingHuman({ seq: 7 }), { alertSound: false })

  expect(statuses.length, 'all three events alerted, so each call reached the sound decision').toBe(3)
  expect([afterOff, afterOn, played.length], 'only the second call, made with the option on, plays the sound; the off calls stay silent').toEqual([0, 1, 1])
})

// Direct alertOn with {} rather than the rig: the kit fills userConfig defaults (alertSound: true), so the rig could never leave the option absent.
test('alert-sound-default-true-when-option-absent', async () => {
  const { engine, played } = alertOnlyEngine()

  await alertOn(engine, stopped(), {})

  expect(played.length, 'with no alertSound key in the options alertOn was handed, the stop plays the sound once').toBe(1)
})
