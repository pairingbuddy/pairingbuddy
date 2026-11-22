// Scenario stranded: a stage is active but the session that ran it is gone (killed, or closed mid-stage). Nothing will finish
// it, so the pane and the band say the human is needed to take the run over, not "● working".
import { expect, mock, test } from 'claude-code/testing'
import { SNAPSHOT_RUNNING, bandTexts, engine, start } from './testing/band'
import { paneLines } from './testing/replay'
import { POLL_MS } from './poll'

const STARTED = Date.parse(SNAPSHOT_RUNNING.stage.startedAt)
const MINUTE = 60_000

const statusOf = (lines: string[]) => {
  const at = lines.findIndex(line => line.startsWith('STATUS'))
  return lines[at].replace(/^STATUS\s+/, '')
}

// The run as SNAPSHOT_RUNNING left it (its ledger last written at epoch 0), seen this many minutes after its stage started.
async function seenAfter($: any, on: Function, minutes: number, open?: () => unknown) {
  engine(on, SNAPSHOT_RUNNING, open)
  const clock = mock.clock(on, { now: STARTED + minutes * MINUTE })
  await start($)
  await clock.advance(POLL_MS)
}

test('a stage whose session is gone reads as needs you: take over the run', async ($, on) => {
  await seenAfter($, on, 11)

  expect(statusOf(await paneLines($, { bodyColumns: 120 })), 'STATUS asks the human to take over').toBe('▲ NEEDS YOU · take over the run: its session is gone')
})

test('a stage moved within the last ten minutes still reads as working', async ($, on) => {
  await seenAfter($, on, 9)

  expect(statusOf(await paneLines($, { bodyColumns: 120 })), 'STATUS stays calm').toBe('● working · write test scenarios')
})

test('a stage this session is still running an agent for reads as working', async ($, on) => {
  engine(on, SNAPSHOT_RUNNING)
  const clock = mock.clock(on, { now: STARTED + 11 * MINUTE })
  await start($)
  await $.agent.spawn({ prompt: 'p', description: 'd', name: 'pb1 code-scenarios enumerate-scenarios-and-test-cases - r1', subagentType: 'pairingbuddy:enumerate-scenarios-and-test-cases' })
  await clock.advance(POLL_MS)

  expect(statusOf(await paneLines($, { bodyColumns: 120 })), 'its own agent is still on it').toMatch(/^● working/)
})

test('the band leads with it too', async ($, on) => {
  // The pane is not seated, so the band carries what is needed, not "opened details".
  await seenAfter($, on, 11, () => ({ value: { isPlaced: false } }))

  const row = (await bandTexts($, { bodyColumns: 120 })).join('')

  expect(row, `the band asks for the human: ${row}`).toMatch(/^▲ NEEDS YOU · take over the run/)
})
