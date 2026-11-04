import { expect, mock, test } from 'claude-code/testing'
import { BAND, LEDGER_PATH, ROOT, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, start, texts } from './testing/band'
import { POLL_MS } from './poll'
import { PANE } from './testing/replay'
import { plainName } from '../shared-node/plain-names.mjs'

const TESTS_PATH = `${ROOT}/.pairingbuddy/tests.json`
const label = (item: string) => `pb1 code-tdd RED implement-tests ${item} r1`

// Files the engine serves and how often the ledger was read. While `hold` is set, a ledger read waits for it.
function engine(on: Function, files: Record<string, string>) {
  const run = { files, ledgerReads: 0, hold: undefined as Promise<void> | undefined }
  on('session.root', () => ({ value: ROOT }))
  on('session.start', () => ({ cwd: ROOT }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('fs.read', async (_: unknown, e: { path: string }) => {
    if (e.path === LEDGER_PATH) {
      run.ledgerReads++
      await run.hold
    }
    return e.path in run.files ? { value: run.files[e.path] } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path in run.files }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_: unknown, e: { path: string }) =>
    e.path in run.files
      ? { value: { kind: 'file', size: run.files[e.path].length, mtimeMs: 0, isLink: false } }
      : { deny: `ENOENT ${e.path}` })
  return run
}

const spawn = ($: any, name: string) => $.agent.spawn({ prompt: 'p', description: 'd', name, subagentType: 'pairingbuddy:implement-tests' })
const agentsIn = (shown: string[]) => shown.find(text => /\d+ agents?/.test(text))?.match(/\d+ agents?/)?.[0]

test('a session.end with reason clear empties the spawn history, so the next draw\'s agent count restarts, while the poller keeps running', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = engine(on, { [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING) })
  await start($)
  await spawn($, label('one'))
  await spawn($, label('two'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(agentsIn(await texts(band)), 'two agents are counted before the clear').toBe('2 agents')

  await $.session.end({ sessionId: 's1', reason: 'clear' })
  await spawn($, label('three'))
  const readsAfterClear = run.ledgerReads
  run.files[LEDGER_PATH] = JSON.stringify(SNAPSHOT_NO_STAGE)
  await clock.advance(POLL_MS)

  expect(run.ledgerReads, 'the poller read the ledger again after the clear').toBeGreaterThan(readsAfterClear)
  expect(await texts(band), 'the poller still redraws the band: the ledger is now idle').toEqual(['Pairing Buddy · idle · /pb for details'])
  run.files[LEDGER_PATH] = JSON.stringify(SNAPSHOT_RUNNING)
  await clock.advance(POLL_MS)
  expect(agentsIn(await texts(band)), 'only the agent spawned after the clear is counted').toBe('1 agent')
  await band.unmount()
})

test('a second session.start does not start a second poller', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = engine(on, { [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING) })
  await start($)
  await start($)

  const before = run.ledgerReads
  await clock.advance(POLL_MS)

  expect(run.ledgerReads - before, 'one poll per interval, from one poller').toBe(1)
})

test('ticks do not overlap while a poll is still running', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = engine(on, { [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING) })
  await start($)
  let release!: () => void
  run.hold = new Promise(resolve => { release = resolve })

  const before = run.ledgerReads
  await clock.advance(POLL_MS * 5)
  const started = run.ledgerReads - before
  release()

  expect(started, 'five ticks while the first poll is still reading start one poll').toBe(1)
})

test('a tests.json entry without a test_id is not counted', async ($, on) => {
  engine(on, {
    [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING),
    [TESTS_PATH]: JSON.stringify({ tests: [{ test_id: 'first' }, {}, { test_id: '' }, { test_id: 'last' }] }),
  })
  await start($)
  await spawn($, label('first'))

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const shown = await texts(band)
  await band.unmount()

  expect(shown, 'the band reads "test 1 of 2": the entries without an id are left out').toContain('RED · test 1 of 2')
})

test("when a new run ledger appears the pane shows the new run and its ended snapshot replaces the old one", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = engine(on, { [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING) })
  await start($)
  const steps = async () => {
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const shown = await texts(pane)
    await pane.unmount()
    return shown.filter(text => /^[▸✓○] /.test(text))
  }
  const first = plainName('code-scenarios')
  const second = plainName('code-config')

  delete run.files[LEDGER_PATH]
  await clock.advance(POLL_MS)
  const afterFirstEnd = await steps()
  run.files[LEDGER_PATH] = JSON.stringify({ ...SNAPSHOT_RUNNING, taskType: 'config_change', stage: { ...SNAPSHOT_RUNNING.stage, name: 'code-config' } })
  await clock.advance(POLL_MS)
  const whileSecondRuns = await steps()
  delete run.files[LEDGER_PATH]
  await clock.advance(POLL_MS)
  const afterSecondEnd = await steps()

  expect(afterFirstEnd.some(line => line.includes(first)), `the first ended run is shown: ${JSON.stringify(afterFirstEnd)}`).toBe(true)
  expect(whileSecondRuns.some(line => line.includes(second)), `the new run is shown: ${JSON.stringify(whileSecondRuns)}`).toBe(true)
  expect(afterSecondEnd.some(line => line.includes(second)), `the snapshot is the new run's: ${JSON.stringify(afterSecondEnd)}`).toBe(true)
  expect(afterSecondEnd.some(line => line.includes(first)), `the old run's steps are gone: ${JSON.stringify(afterSecondEnd)}`).toBe(false)
})
