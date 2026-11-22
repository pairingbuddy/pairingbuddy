// Scenario stranded: a stage is active but the session that ran it is gone (killed, or closed mid-stage). Nothing will finish
// it, so the pane and the band say the human is needed to take the run over, not "● working".
import { expect, mock, test } from 'claude-code/testing'
import { LEDGER_PATH, ROOT, SNAPSHOT_RUNNING, bandTexts, engine, start } from './testing/band'
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

// The run as seenAfter serves it, with the project's shim (.pairingbuddy/bin/pb, which pb run open writes) beside it.
async function withShim($: any, on: Function, minutes: number) {
  const files = new Map<string, string>([[LEDGER_PATH, JSON.stringify(SNAPSHOT_RUNNING)], [`${ROOT}/.pairingbuddy/bin/pb`, '#!/bin/sh\n']])
  on('session.root', () => ({ value: ROOT }))
  on('session.start', () => ({ cwd: ROOT }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: false } }))
  on('fs.read', (_: unknown, e: { path: string }) => (files.has(e.path) ? { value: files.get(e.path) } : { deny: `ENOENT ${e.path}` }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: files.has(e.path) }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_: unknown, e: { path: string }) => (files.has(e.path) ? { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } } : { deny: `ENOENT ${e.path}` }))
  const clock = mock.clock(on, { now: STARTED + minutes * MINUTE })
  await start($)
  await clock.advance(POLL_MS)
}

test('with the project shim, STATUS gives the line that takes the run over', async ($, on) => {
  await withShim($, on, 11)

  const lines = await paneLines($, { bodyColumns: 120 })
  const at = lines.findIndex(line => line.startsWith('STATUS'))

  expect(lines[at + 1].trim(), 'the adopt line, under the head').toBe('type: !.pairingbuddy/bin/pb human adopt')
})

test('while stranded the SPENT time stops at the last move and says it is paused, in the pane and the band', async ($, on) => {
  engine(on, SNAPSHOT_RUNNING, () => ({ value: { isPlaced: false } }))
  const clock = mock.clock(on, { now: STARTED + 11 * MINUTE })
  await start($)
  await clock.advance(POLL_MS)
  await clock.advance(MINUTE)

  const spent = (await paneLines($, { bodyColumns: 120 })).find(line => line.startsWith('SPENT'))
  const band = (await bandTexts($, { bodyColumns: 200 })).join('')

  expect(spent, 'nothing has run since the stage started').toBe('SPENT    0 agents · 0:00 paused')
  expect(band, `the band says the same: ${band}`).toContain('0:00 paused · 0 agents')
})

test('the band keeps what it needs once the alert opened the pane', async ($, on) => {
  await seenAfter($, on, 11)

  const row = (await bandTexts($, { bodyColumns: 120 })).join('')

  expect(row, `the band asks for the human, not "opened details": ${row}`).toMatch(/^▲ NEEDS YOU · take over the run/)
})
