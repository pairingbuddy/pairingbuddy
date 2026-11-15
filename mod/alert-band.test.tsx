// Scenarios: band-alert-text, pane-cannot-seat, glance-names-stop (pane side).
// The band carries the alert text; when the pane is not placed, the band carries the alert alone.
import { expect, mock, test } from 'claude-code/testing'
import { BAND, NEEDS_YOU_OPENED, STOPPED_OPENED, bandSays, bandTexts, engine, start, texts } from './testing/band'
import { alertEngine, cleared, needingHuman, sameEventPolledThenNewEvent, stopped } from './testing/alert'
import { PANE } from './testing/replay'
import { POLL_MS } from './poll'

test('band-reads-needs-you-opened-details', async ($, on) => {
  alertEngine(on, { ledger: stopped(), open: 'ok' })
  await start($)

  const shown = await bandTexts($)

  expect(shown[0], `the band leads with "✕ STOPPED · opened details" once the pane is placed: ${JSON.stringify(shown)}`).toBe(STOPPED_OPENED)
})

test('band-shows-needs-you-without-opened-when-pane-unseated', async ($, on) => {
  // The `open: 'not-placed'` answer stands in for a pane that could not seat, so the band carries the alert alone.
  alertEngine(on, { ledger: stopped({ code: 'step-failed' }), open: 'not-placed' })
  await start($)

  const shown = await bandTexts($)

  expect(shown[0], `the band leads with the stop and its plain name: ${JSON.stringify(shown)}`).toBe('✕ STOPPED · a step kept failing')
  expect(shown.some(text => text.includes('opened details')), `the band never claims "opened details" when the pane did not seat: ${JSON.stringify(shown)}`).toBe(false)
})

test('band-for-stop-and-for-needs-human: needs human, placed', async ($, on) => {
  // The stop's band is band-reads-needs-you-opened-details; this is the needsHuman kind, placed: the band reads "opened details".
  alertEngine(on, { ledger: needingHuman({ gate: 'G:task-end' }), open: 'ok' })
  await start($)

  const shown = await bandTexts($)

  expect(shown[0], `the band leads with "▲ NEEDS YOU · opened details" for a gate waiting on the human: ${JSON.stringify(shown)}`).toBe(NEEDS_YOU_OPENED)
})

test('band-for-stop-and-for-needs-human: needs human, unseated', async ($, on) => {
  alertEngine(on, { ledger: needingHuman({ gate: 'G:task-end' }), open: 'not-placed' })
  await start($)

  // Wide enough that the needs-you segment is not shortened to make room.
  const shown = await bandTexts($, { bodyColumns: 120 })

  expect(shown[0], `the band leads with "▲ NEEDS YOU · your sign-off at the end": ${JSON.stringify(shown)}`).toBe('▲ NEEDS YOU · your sign-off at the end')
  expect(shown.some(text => text.includes('opened details')), `the band never claims "opened details" when the pane did not seat: ${JSON.stringify(shown)}`).toBe(false)
})

test('band-clears-when-event-clears', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { open: 'ok' })
  await start($)
  run.serve(stopped({ code: 'step-failed' }))
  await clock.advance(POLL_MS)
  // A wide terminal, so the calm band has room to show its needs-you segment.
  const alerting = await bandTexts($, { bodyColumns: 200 })
  run.serve(cleared())
  await clock.advance(POLL_MS)

  const shown = await bandTexts($, { bodyColumns: 200 })

  expect(bandSays(alerting, STOPPED_OPENED), `the band showed the alert before the event cleared: ${JSON.stringify(alerting)}`).toBe(true)
  expect(shown.some(text => text.includes('opened details')), `the band drops "opened details" once the event clears: ${JSON.stringify(shown)}`).toBe(false)
  expect(shown.some(text => text.includes('a step kept failing')), `the band drops the stop's plain name once the event clears: ${JSON.stringify(shown)}`).toBe(false)
  expect(shown[0], `the band leads with the working step again: ${JSON.stringify(shown)}`).toBe('● write test scenarios')
})

test('ui-open-not-placed-band-still-alerts', async ($, on) => {
  const run = alertEngine(on, { ledger: stopped({ code: 'step-failed' }), open: 'not-placed' })
  await start($)

  const shown = await bandTexts($)

  expect(shown[0], `the band still leads with the stop and its plain name when the pane did not seat: ${JSON.stringify(shown)}`).toBe('✕ STOPPED · a step kept failing')
  expect(run.calls.opened.length, 'the engine was asked to open the pane, so the not-placed answer was exercised').toBe(1)
  expect(run.calls.played.length, 'the sound still plays when the pane did not seat').toBe(1)
  expect(run.calls.status.length, 'the status line is still set when the pane did not seat').toBe(1)
  expect(run.calls.status[0].text, 'the status line names the stop in plain words').toContain('a step kept failing')
})

for (const open of ['reject', 'throw'] as const) {
  test(`ui-open-rejects-does-not-break-alert: ${open}`, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const run = alertEngine(on, { open })
    await start($)
    run.serve(stopped({ code: 'step-failed' }))
    await clock.advance(POLL_MS)

    const afterFirstStop = await bandTexts($, { bodyColumns: 200 })
    run.serve(stopped({ seq: 5, code: 'commit-failed' }))
    await clock.advance(POLL_MS)
    const afterSecondStop = await bandTexts($, { bodyColumns: 200 })

    expect(run.calls.opened.length, `the engine was asked to open the pane for each event, so the ${open} answer was exercised`).toBe(2)
    expect(run.calls.played.length, `the sound still plays when opening the pane ${open}s, and the next event's sound shows the poll kept running`).toBe(2)
    expect(run.calls.status.length, `the status line is still set when opening the pane ${open}s`).toBe(2)
    expect(run.calls.status[0].text, 'the status line names the first stop in plain words').toContain('a step kept failing')
    expect(run.calls.status[1].text, 'the status line names the second stop in plain words').toContain('the commit failed')
    expect(afterFirstStop[0], `after the first stop the band still leads with the stop's plain name: ${JSON.stringify(afterFirstStop)}`).toBe('✕ STOPPED · a step kept failing')
    expect(afterFirstStop.some(text => text.includes('opened details')), `the band never claims "opened details" when opening the pane failed: ${JSON.stringify(afterFirstStop)}`).toBe(false)
    expect(afterSecondStop[0], `after the second stop the band leads with the new stop's plain name: ${JSON.stringify(afterSecondStop)}`).toBe('✕ STOPPED · the commit failed')
    expect(afterSecondStop.some(text => text.includes('a step kept failing')), `the band drops the first stop's name once the second stop arrives: ${JSON.stringify(afterSecondStop)}`).toBe(false)
    expect(afterSecondStop.some(text => text.includes('opened details')), `the band never claims "opened details" after the second failed open: ${JSON.stringify(afterSecondStop)}`).toBe(false)
  })
}

test('not-placed-open-not-retried-every-poll', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { open: 'not-placed' })
  await start($)

  const opened = await sameEventPolledThenNewEvent(run, clock, () => run.calls.opened.length)

  expect(opened.forFirstEvent, 'the pane that did not seat is asked to open once for the event, not on every poll').toBe(1)
  expect(opened.total, 'the poll kept running through the earlier polls, so a new event still opens the pane').toBe(2)
})

test('pane-names-stop-by-plain-name', async ($, on) => {
  const code = 'commit-failed'
  const reason = 'git commit exited 1: hook rejected the message'
  engine(on, stopped({ code, reason }))
  await start($)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = await texts(pane)
  await pane.unmount()

  expect(shown.some(text => text.includes('the commit failed')), `the pane names the stop as "the commit failed": ${JSON.stringify(shown)}`).toBe(true)
  expect(shown.some(text => text.includes(code)), 'the pane never shows the raw code').toBe(false)
})
