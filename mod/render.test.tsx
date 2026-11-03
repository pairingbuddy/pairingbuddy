import { expect, test } from 'claude-code/testing'
import { BAND, LEDGER_PATH, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, SURFACES, serveLedger, without, type Served } from './testing/band'

// Only the band exists today; the pane arrives with Task 57, which extends these tests to mount it.

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

test('band draws "running" on every surface when the ledger has a current stage', async ($, on) => {
  const served: Served = { ledger: json(SNAPSHOT_RUNNING), asked: [] }
  serveLedger(on, served)

  const drawn = await drawnOnEverySurface($)

  for (const surface of SURFACES) {
    expect(drawn[surface], `${surface} band draws running for a current stage`).toContain('running')
  }
  expect(served.asked, 'the band read <root>/<LEDGER>').toContain(LEDGER_PATH)
})

test('band draws "idle" on every surface without throwing when the ledger is absent, empty, truncated or missing its stage fields', async ($, on) => {
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
  serveLedger(on, served)

  for (const [name, ledger] of Object.entries(ledgers)) {
    served.ledger = ledger
    served.asked.length = 0

    const drawn = await drawnOnEverySurface($)

    for (const surface of SURFACES) {
      expect(drawn[surface], `${surface} band draws idle for a ${name} ledger`).toContain('idle')
    }
    expect(served.asked, `the band read <root>/<LEDGER> for a ${name} ledger`).toContain(LEDGER_PATH)
  }
})
