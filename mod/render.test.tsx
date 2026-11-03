import { expect, test } from 'claude-code/testing'
import { plainName } from '../shared-node/plain-names.mjs'
import { BAND, LEDGER_PATH, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, SURFACES, ROOT, serveLedger, start, without, type Served } from './testing/band'

// The band draws what the session's poll read, so each test starts a session first; the poll runs at session start.
function engine(on: Function, served: Served) {
  serveLedger(on, served)
  on('session.start', () => ({ cwd: ROOT }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
}

const json = (document: unknown) => JSON.stringify(document)

// Mounts the band on every surface and returns the text each one drew. Never throws on a bad ledger:
// a rejection is reported with the surface name.
async function drawnOnEverySurface($: any): Promise<Record<string, string>> {
  const drawn: Record<string, string> = {}
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const text = await ui.find({ type: 'Text' })
    drawn[surface] = JSON.stringify(text ?? null)
    await ui.unmount()
  }
  return drawn
}

test('band draws the where segment of the current stage on every surface when the ledger has one', async ($, on) => {
  const served: Served = { ledger: json(SNAPSHOT_RUNNING), asked: [] }
  engine(on, served)
  await start($)

  const drawn = await drawnOnEverySurface($)

  for (const surface of SURFACES) {
    expect(drawn[surface], `${surface} band draws the where segment for a current stage`).toContain(plainName('code-scenarios'))
  }
  expect(served.asked, 'the band read <root>/<LEDGER>').toContain(LEDGER_PATH)
})

test('band draws one dim "Pairing Buddy · idle" on every surface without throwing when the ledger is absent, empty, truncated or missing its stage fields', async ($, on) => {
  const whole = json(SNAPSHOT_RUNNING)
  const ledgers: Record<string, string | undefined> = {
    absent: undefined,
    empty: '',
    truncated: whole.slice(0, Math.floor(whole.length / 2)),
    'no current stage yet': json(SNAPSHOT_NO_STAGE),
    'missing stage': json(without(SNAPSHOT_RUNNING, 'stage')),
    'missing stage and stages': json(without(SNAPSHOT_RUNNING, 'stage', 'stages')),
    'missing owner': json(without(SNAPSHOT_RUNNING, 'owner', 'stage')),
    'empty document': '{}',
  }

  const served: Served = { ledger: undefined, asked: [] }
  engine(on, served)

  for (const [name, ledger] of Object.entries(ledgers)) {
    served.ledger = ledger
    served.asked.length = 0
    await start($)

    const drawn = await drawnOnEverySurface($)

    for (const surface of SURFACES) {
      expect(drawn[surface], `${surface} band draws idle for a ${name} ledger`).toContain('Pairing Buddy · idle')
      expect(drawn[surface], `${surface} idle text is dim`).toContain('"dimColor":true')
    }
    expect(served.asked, `the band read <root>/<LEDGER> for a ${name} ledger`).toContain(LEDGER_PATH)
  }
})

test('before any poll the band draws one dim "Pairing Buddy · idle" on every surface and reads no file', async ($, on) => {
  const served: Served = { ledger: json(SNAPSHOT_RUNNING), asked: [] }
  engine(on, served)

  const drawn = await drawnOnEverySurface($)

  for (const surface of SURFACES) {
    expect(drawn[surface], `${surface} band draws idle with no poll yet`).toContain('Pairing Buddy · idle')
    expect(drawn[surface], `${surface} idle text is dim`).toContain('"dimColor":true')
  }
  expect(served.asked, 'drawing read no file').toEqual([])
})
