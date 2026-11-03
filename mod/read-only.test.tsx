import { expect, test } from 'claude-code/testing'
import { plainName } from '../shared-node/plain-names.mjs'
import { BAND, LEDGER_PATH, ROOT, SNAPSHOT_RUNNING, serveLedger, start, type Served } from './testing/band'
import { eventsFor, recordHooks } from './testing/hooks'

// A run's state: a ledger and what sits beside it. The mod only ever reads this.
const FIXTURE: Record<string, string> = {
  [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING),
  [`${ROOT}/.pairingbuddy/test-state.json`]: '{"results":[]}',
}

// The one place that says which paths the mod may write. Empty today: the mod writes nothing.
const ALLOWED_WRITES: string[] = []

// Reads answered from the fixture, shared by the direct hook calls and the mounted band.
const READS = {
  read: (files: Map<string, string>, path?: string) => files.get(String(path)) ?? '',
  exists: (files: Map<string, string>, path?: string) => files.has(String(path)),
  list: () => [],
  stat: (files: Map<string, string>, path?: string) => ({
    kind: 'file',
    size: files.get(String(path))?.length ?? 0,
    mtimeMs: 0,
    isLink: false,
  }),
  ancestors: () => [],
}

// The one write recorder. An allowed path is applied to the fixture copy, so the unchanged check
// sees it; anything else is recorded with where it came from and refused.
function write(files: Map<string, string>, touched: string[], where: string, path: string, text: string): boolean {
  if (ALLOWED_WRITES.some(allowed => path === allowed || path.startsWith(allowed))) {
    files.set(path, text)
    return true
  }
  touched.push(`${where}: fs.write ${path}`)
  return false
}

function recordOther(touched: string[], where: string, call: string) {
  touched.push(`${where}: ${call}`)
}

// The test's `$` has neither a drawing surface nor fs and process of its own. This one lends element
// stand-ins, serves reads from the fixture and records any other fs or process call, whatever its name.
function recordingEngine(files: Map<string, string>, touched: string[], where: string): never {
  const Stand = (props: unknown) => props
  const ui = { resolve: () => new Proxy({}, { get: () => Stand }) }
  const fs = new Proxy({}, {
    get: (_, name) => async (path?: string, text?: string) => {
      if (name in READS) return (READS as Record<string, Function>)[String(name)](files, path)
      if (name === 'write') {
        write(files, touched, where, String(path), String(text))
        return
      }
      recordOther(touched, where, `fs.${String(name)} ${String(path)}`)
    },
  })
  const process = new Proxy({}, {
    get: (_, name) => async () => {
      recordOther(touched, where, `process.${String(name)}`)
    },
  })
  // Named values are the session's, not files: reads find nothing, writes are not file writes.
  const state = { get: async () => ({ value: undefined, version: 0 }), set: async () => ({ isSet: true, version: 1 }) }
  const engine: Record<string, unknown> = { ui, fs, process, state }
  return new Proxy({}, { get: (_, key) => engine[String(key)] }) as never
}

test('running hooks and band against a fixture ledger leaves .pairingbuddy/ unchanged and makes no $.fs write', async ($, on) => {
  const files = new Map(Object.entries(FIXTURE))
  const before = JSON.stringify([...files])
  const touched: string[] = []
  let where = 'mount'

  // Beneath the plugin these stand for the engine: the fixture answers reads, and the three calls
  // that change the world (fs.write, process.run, process.spawn) go through the recorder and are
  // refused unless the path is allowed.
  const served: Served = { ledger: files.get(LEDGER_PATH), asked: [] }
  serveLedger(on, served)
  on('session.start', () => ({ cwd: ROOT }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.write', (_, e) =>
    write(files, touched, where, e.path, e.text) ? { value: undefined } : { deny: 'the mod is read-only' })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('process.run', (_, e) => {
    recordOther(touched, where, `process.run ${e.argv.join(' ')}`)
    return { deny: 'the mod is read-only' }
  })
  on('process.spawn', async function* (_, e) {
    recordOther(touched, where, `process.spawn ${e.argv.join(' ')}`)
    return { deny: 'the mod is read-only' } as never
  })

  // Every hook the mod registers, whatever it is, with a survey in the slot and without.
  for (const { event, matcher, hook } of recordHooks()) {
    const { surveyed, idle } = eventsFor(event, matcher)
    for (const [hasSurvey, fed] of [[true, surveyed], [false, idle]] as const) {
      await hook(recordingEngine(files, touched, `hook ${event} hasSurvey=${hasSurvey}`), fed, (e: unknown) => e)
    }
  }

  // The band as the engine draws it, on every surface, once a session has started and the poll has read the run.
  where = 'session start'
  await start($)
  const drawn: Record<string, string | undefined> = {}
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const hasSurvey of [true, false]) {
      where = `mount ${surface} hasSurvey=${hasSurvey}`
      const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, hasSurvey } })
      if (!hasSurvey) {
        drawn[surface] = (await ui.find({ type: 'Text' }))?.text
      }
      await ui.unmount()
    }
  }

  expect(served.asked, 'the band read the ledger at <root>/<LEDGER>').toContain(LEDGER_PATH)
  const stage = plainName('code-scenarios')
  expect(drawn, 'the band drew the where segment from the ledger on every surface').toEqual({
    terminal: stage,
    desktop: stage,
    vscode: stage,
    mobile: stage,
  })
  expect(touched, 'no $.fs write and no $.process call').toEqual([])
  expect(JSON.stringify([...files]), '.pairingbuddy/ fixture is unchanged').toBe(before)
})
