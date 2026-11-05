// Scenario status-line-does-not-repeat-plugin-name (placeholders). The platform prefixes the plugin name on the status
// line, so the recorded $.ui.status text carries no 'Pairing Buddy'. Runs under `claude plugin test .`.
import { expect, mock, test } from 'claude-code/testing'
import { alertEngine, needingHuman, stopped } from './testing/alert'
import { bandTexts, start } from './testing/band'
import { POLL_MS } from './poll'
import { stopLine } from '../shared-node/glance.mjs'

test('gate-status-has-no-plugin-name', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(needingHuman({ gate: 'G:scenarios' }))
  await clock.advance(POLL_MS)

  expect(run.calls.status.length, 'the first poll that shows the gate sets one status line').toBe(1)
  expect(run.calls.status[0].text, 'the status text is the plain gate words with no plugin name').toBe('needs you: your OK on the scenarios')
})

test('stop-status-has-no-plugin-name', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ seq: 3, code: 'step-failed' }))
  await clock.advance(POLL_MS)
  run.serve(stopped({ seq: 4, noCode: true }))
  await clock.advance(POLL_MS)

  expect(run.calls.status.length, 'each new stop sets one status line').toBe(2)
  expect(run.calls.status[0].text, 'a stop with a plain name reads as the shared stop line').toBe(stopLine({ code: 'step-failed' }))
  expect(run.calls.status[0].text.includes('Pairing Buddy'), 'the named stop status carries no plugin name').toBe(false)
  expect(run.calls.status[1].text, 'a stop with no plain name falls back to the bare word, with no plugin name').toBe('stopped')
})

test('status-clears-and-band-text-unchanged', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(needingHuman({ gate: 'G:scenarios' }))
  await clock.advance(POLL_MS)
  run.serve(null)
  await clock.advance(POLL_MS)
  const band = (await bandTexts($, { bodyColumns: 200 })).join('')

  expect(run.calls.status.length, 'one call set the line and one cleared it when the run ended').toBe(2)
  expect(run.calls.status[1].text, 'the second call clears the line with undefined text').toBeUndefined()
  expect(band, 'the band still names the plugin in its own text').toContain('Pairing Buddy · last run finished · /pb for details')
})
