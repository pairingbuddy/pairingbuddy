// Scenario alert-unplaced-pane-stays-honest-and-reachable (Finding 25): an unasked pane open that is not placed
// (isPlaced:false) is recorded as not shown, the band keeps the /pb hint, and the alert still beeps and sets the status.
// Placeholders: each fails until implemented.
import { expect, mock, test } from 'claude-code/testing'
import { start } from './testing/band'
import { alertEngine, needingHuman } from './testing/alert'
import { bandSays, bandTexts } from './testing/band'
import { openedKey } from './alert'
import { POLL_MS } from './poll'

test('unplaced-open-recorded-as-not-shown-and-logged', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const reason = 'no room beside the chat'
  const logged: any[] = []
  const run = alertEngine(on, { open: () => ({ value: { isPlaced: false, reason } }) })
  on('ui.log', (_: unknown, e: any) => {
    logged.push(e)
    return { value: undefined }
  })
  const openedWrites: unknown[] = []
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    if (e.key === openedKey()) openedWrites.push(e.value)
    return { value: { isSet: true, version: 1 } }
  })
  await start($)

  run.serve(needingHuman())
  await clock.advance(POLL_MS)

  expect(run.calls.opened.length, 'the engine was asked to open the pane, so the unplaced answer was exercised').toBe(1)
  expect(openedWrites.at(-1), `an unplaced pane is recorded as not opened: ${JSON.stringify(openedWrites)}`).toBe(false)
  expect(JSON.stringify(logged), 'ui.log is called with the reason the pane did not seat').toContain(reason)
})

test('band-keeps-a-way-into-the-pane-while-it-waits-undrawn', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { open: () => ({ value: { isPlaced: false, reason: 'no room beside the chat' } }) })
  await start($)
  run.serve(needingHuman())
  await clock.advance(POLL_MS)
  const shownAt: Record<number, string[]> = {}

  for (const bodyColumns of [50, 55]) shownAt[bodyColumns] = await bandTexts($, { bodyColumns })

  expect(run.calls.opened.length, 'the engine was asked to open the pane, so the unplaced answer was exercised').toBe(1)
  for (const bodyColumns of [50, 55]) {
    const shown = shownAt[bodyColumns]
    const needsYou = shown.filter(text => text.includes('needs you'))
    expect(needsYou.length, `at ${bodyColumns} columns the needs-you segment is shown: ${JSON.stringify(shown)}`).toBe(1)
    expect(needsYou[0].includes('…'), `at ${bodyColumns} columns the needs-you segment is whole, not cut: ${JSON.stringify(needsYou)}`).toBe(false)
    const hasWayIn = shown.some(text => text.includes('▸ details')) || bandSays(shown, '/pb')
    expect(hasWayIn, `at ${bodyColumns} columns, with the pane undrawn, the band keeps the details button or the /pb hint: ${JSON.stringify(shown)}`).toBe(true)
    expect(shown.join('').length, `at ${bodyColumns} columns the band stays within its width: ${JSON.stringify(shown)}`).toBeLessThanOrEqual(bodyColumns)
  }
})

test('alert-still-beeps-and-sets-status-when-unplaced', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on, { open: () => ({ value: { isPlaced: false, reason: 'no room beside the chat' } }) })
  await start($)

  run.serve(needingHuman())
  await clock.advance(POLL_MS)

  expect(run.calls.opened.length, 'the engine was asked to open the pane, so the unplaced answer was exercised').toBe(1)
  expect(run.calls.played.length, 'the sound still plays when the pane did not seat').toBe(1)
  expect(run.calls.status.length, 'the status line is still set when the pane did not seat').toBe(1)
  expect(run.calls.status[0].text, 'the status line names the gate in plain words, as it does when the open is placed').toContain('your sign-off at the end')
  expect(run.calls.status[0].text, 'the line does not show the raw gate id').not.toContain('G:task-end')
})
