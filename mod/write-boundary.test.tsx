// Scenario mod-write-boundary: the mod writes only what this task allows, and never the ledger.
// Runs under `claude plugin test .` against mod/testing/refuse.tsx.
import { expect, test } from 'claude-code/testing'
import { LEDGER, ROOT } from './testing/band'
import { ALLOWED_WRITES, recordWrite } from './testing/refuse'
import { POLL_MS } from './poll'
import { needingHuman, stopped } from './testing/alert'
import { PANE, replay, setupReplay } from './testing/replay'
import { quietEngine } from './testing/quiet'
import { recordWrites } from './testing/suggest'
import { BAND, SNAPSHOT_RUNNING, start } from './testing/band'
import gOpen1 from './fixtures/replay/g-open-1'

const GUIDANCE_FILE = `${ROOT}/.pairingbuddy/human-guidance.json`
const REPORT_FILE = `${ROOT}/.pairingbuddy/reports/2026-11-03-x.html`

test('allowed-writes-are-exactly-reports-and-guidance', () => {
  const allowedPaths = [REPORT_FILE, GUIDANCE_FILE]
  const refusedPaths = [
    `${ROOT}/${LEDGER}`,
    `${ROOT}/.pairingbuddy/tests.json`,
    `${ROOT}/.pairingbuddy/task.json`,
    `${GUIDANCE_FILE}.bak`,
    `${ROOT}/.pairingbuddy/reports/../tests.json`,
  ]
  const files = new Map<string, string>()
  const touched: string[] = []

  const allowed = [...ALLOWED_WRITES].sort()
  const allowedResults = allowedPaths.map(path => recordWrite(files, touched, 'boundary', path, 'x'))
  const allowedTouched = [...touched]
  const refusedResults = refusedPaths.map(path => recordWrite(files, touched, 'boundary', path, 'x'))

  expect(allowed, 'the allowed writes are the reports folder and the guidance file, nothing else').toEqual([
    '.pairingbuddy/human-guidance.json',
    '.pairingbuddy/reports/',
  ])
  expect(allowedResults, 'a report file and the guidance file are allowed').toEqual([true, true])
  expect(allowedTouched, 'an allowed write is not recorded as refused').toEqual([])
  expect([...files.keys()], 'only the allowed writes are applied to the files').toEqual(allowedPaths)
  expect(refusedResults, 'the ledger, tests.json, task.json, the .bak neighbour and the ../ path are all refused').toEqual(refusedPaths.map(() => false))
  expect(touched, 'each refused write is recorded with its path').toEqual(refusedPaths.map(path => `boundary: fs.write ${path}`))
})

test('polling-and-rendering-still-write-nothing', async ($, on) => {
  const rig = setupReplay(on)
  const { writes, touched } = recordWrites(on)
  const alerts = quietEngine(on)

  const surfaces = async () => {
    for (const mount of [BAND, PANE]) {
      const ui = await $.ui.mount({ ...mount, surface: 'terminal' })
      await ui.findAll({ type: 'Text' })
      await ui.unmount()
    }
  }
  const standing = async (ledger: unknown) => {
    if (ledger === undefined) rig.served.delete(`${ROOT}/${LEDGER}`)
    else rig.served.set(`${ROOT}/${LEDGER}`, JSON.stringify(ledger))
    for (let poll = 0; poll < 2; poll++) {
      await rig.clock.advance(POLL_MS)
      rig.now += POLL_MS
    }
    await surfaces()
  }

  // Replay first: it sets the mocked clock to the recording's time, and the clock never runs backwards.
  for await (const _step of replay($, rig, gOpen1)) await surfaces()
  await start($)
  await standing(undefined)
  await standing(SNAPSHOT_RUNNING)
  const beforeStop = alerts.length
  await standing(stopped())
  const afterStop = alerts.length
  await standing(needingHuman({ seq: 5 }))
  const afterGate = alerts.length

  expect(afterStop, 'the stop sounded, so its poll finished before the write assertions').toBeGreaterThan(beforeStop)
  expect(afterGate, 'the gate sounded, so the last poll finished before the write assertions').toBeGreaterThan(afterStop)
  expect(writes, 'no fs.write at all, allowed paths included').toEqual([])
  expect(touched, 'no refused write, process run or spawn').toEqual([])
})
