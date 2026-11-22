// Scenario gate-off: hooks/gate-watch.mjs found that gate-boot.mjs cannot load, so nothing checks the run's tool calls, and it
// left run/gate-off.json. The pane and the band say the run is stopped with the safety checks off, and give the one fix line.
import { expect, test } from 'claude-code/testing'
import { BAND, LEDGER_PATH, ROOT, SNAPSHOT_RUNNING, bandRowTexts, start } from './testing/band'
import { paneLines } from './testing/replay'

const PLUGIN = '/plugins/pairingbuddy'
const GATE_BOOT = `${PLUGIN}/hooks/gate-boot.mjs`
const MARKER_PATH = `${ROOT}/.pairingbuddy/run/gate-off.json`
const MARKER = { path: GATE_BOOT, plugin: PLUGIN, mtimeMs: 1000, size: 42, failure: 'SyntaxError: Unexpected token', at: '2026-11-22T10:00:00.000Z' }

// The run's ledger and the marker; gate-boot.mjs stats as it stood when the marker was written, or as given.
function engineWithMarker(on: Function, gateBoot: { mtimeMs: number; size: number } | null = { mtimeMs: MARKER.mtimeMs, size: MARKER.size }) {
  const files = new Map<string, string>([[LEDGER_PATH, JSON.stringify(SNAPSHOT_RUNNING)], [MARKER_PATH, JSON.stringify(MARKER)]])
  on('session.root', () => ({ value: ROOT }))
  on('session.start', () => ({ cwd: ROOT }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: false } }))
  on('fs.read', (_: unknown, e: { path: string }) => (files.has(e.path) ? { value: files.get(e.path) } : { deny: `ENOENT ${e.path}` }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: files.has(e.path) }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_: unknown, e: { path: string }) => {
    if (e.path === GATE_BOOT && gateBoot) return { value: { kind: 'file', ...gateBoot, isLink: false } }
    return files.has(e.path) ? { value: { kind: 'file', size: files.get(e.path)!.length, mtimeMs: 0, isLink: false } } : { deny: `ENOENT ${e.path}` }
  })
}

const statusOf = (lines: string[]) => {
  const at = lines.findIndex(line => line.startsWith('STATUS'))
  return lines.slice(at, at + 2).map(line => line.replace(/^(STATUS)?\s+/, ''))
}

test('the pane says the run stopped with the safety checks off, and gives the fix line', async ($, on) => {
  engineWithMarker(on)
  await start($)

  const status = statusOf(await paneLines($, { bodyColumns: 120 }))

  expect(status, 'STATUS leads with the stop, then the one fix line').toEqual(['✕ STOPPED · safety checks are off', `fix: git -C ${PLUGIN} checkout -- hooks`])
})

test('the band leads with the same stop', async ($, on) => {
  engineWithMarker(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 120 }, surface: 'terminal' })
  const row = (await bandRowTexts(band)).join('')
  await band.unmount()

  expect(row, `the band leads with the stop: ${row}`).toMatch(/^✕ STOPPED · safety checks are off/)
})

test('a restored gate-boot.mjs clears it at once, before any hook runs again', async ($, on) => {
  engineWithMarker(on, { mtimeMs: MARKER.mtimeMs + 5000, size: MARKER.size + 3 })
  await start($)

  const status = statusOf(await paneLines($, { bodyColumns: 120 }))

  expect(status[0], 'the run reads as working again').toBe('● working · write test scenarios')
})
