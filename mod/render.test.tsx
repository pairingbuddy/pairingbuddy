import { expect, mock, test } from 'claude-code/testing'
import { fitBand, glance } from '../shared-node/glance.mjs'
import { bandColumns } from './band'
import { plainName } from '../shared-node/plain-names.mjs'
import { POLL_MS } from './poll'
import { stopped } from './testing/alert'
import { BAND, bandTexts, engine as bandEngine, LEDGER_PATH, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, SURFACES, ROOT, serveLedger, start, without, type Served } from './testing/band'

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

const isSeparator = (text: string) => /^\s*[·│]\s*$/.test(text)
const WIDE = { bodyColumns: 200 }

test("the running band puts a separator between each glance segment", async ($, on) => {
  bandEngine(on)
  await start($)

  const shown = await bandTexts($, WIDE)

  for (const segment of ['left:', 'looping:', 'off track:', 'needs you:']) {
    const at = shown.findIndex(text => text.startsWith(segment))
    expect(at, `the band draws a "${segment}" segment: ${JSON.stringify(shown)}`).toBeGreaterThan(0)
    expect(isSeparator(shown[at - 1]), `a separator is drawn right before "${segment}": ${JSON.stringify(shown)}`).toBe(true)
  }
  expect(shown.join(''), `no segment runs into the next: ${JSON.stringify(shown)}`).not.toMatch(/agentsleft|unknownlooping|unknownoff track|unknownneeds you/)
})

test("the details button is set off from the last segment by a space", async ($, on) => {
  bandEngine(on)
  await start($)

  const shown = await bandTexts($, WIDE)

  const needsYou = shown.findIndex(text => text.startsWith('needs you:'))
  expect(needsYou, `the band draws needs you: ${JSON.stringify(shown)}`).toBeGreaterThanOrEqual(0)
  const beforeButton = shown.slice(needsYou).join('')
  expect(beforeButton, `the text drawn before the details button ends with a space, so "needs you: no" and "▸ details" do not touch: ${JSON.stringify(shown)}`).toMatch(/\s$/)
})

test("the running band includes a plain-words hint naming /pb for details alongside the details button", async ($, on) => {
  bandEngine(on)
  await start($)

  const shown = await bandTexts($, WIDE)

  const hint = shown.findIndex(text => text.includes('/pb for details'))
  expect(hint, `the running band ends with a plain "/pb for details" hint: ${JSON.stringify(shown)}`).toBeGreaterThan(shown.findIndex(text => text.startsWith('needs you:')))
  expect(shown.some(text => text.includes('▸ details')), `the details button is still drawn: ${JSON.stringify(shown)}`).toBe(true)
  expect(shown.join(' '), 'the band never names ctrl+x or a key it cannot back').not.toMatch(/ctrl\+x|tab\b/i)
})

test('the pb hint is lowest priority: "/pb" shows when all content fits but the long hint does not', async ($, on) => {
  const content = glance({ ledger: SNAPSHOT_RUNNING, spawns: [], tests: [], now: 0 }).band
  const fits = (columns: number, hint?: string) => JSON.stringify(fitBand(content, bandColumns(columns, hint))) === JSON.stringify(content)
  const COLUMNS = Array.from({ length: 300 }, (_, i) => i).find(columns => fits(columns, '/pb') && !fits(columns, '/pb for details'))!
  bandEngine(on, SNAPSHOT_RUNNING)
  await start($)

  const shown = await bandTexts($, { bodyColumns: COLUMNS })

  expect(COLUMNS, 'a width exists where "/pb" fits and "/pb for details" does not').toBeDefined()
  expect(shown.join(''), `at ${COLUMNS} columns the short hint shows: ${JSON.stringify(shown)}`).toContain('/pb')
  expect(shown.join(''), `at ${COLUMNS} columns the long hint is gone: ${JSON.stringify(shown)}`).not.toContain('for details')
  expect(shown.join(' '), `at ${COLUMNS} columns no content is cut: ${JSON.stringify(shown)}`).toContain(content[content.length - 1].text)
})

test('at 70 columns with a standing stop the hint is dropped and needs-you is kept whole', async ($, on) => {
  const COLUMNS = 70
  bandEngine(on, stopped({ code: 'step-failed' }))
  await start($)

  const shown = await bandTexts($, { bodyColumns: COLUMNS })

  const joined = shown.join('')
  expect(joined, `no hint at ${COLUMNS} columns: ${JSON.stringify(shown)}`).not.toContain('/pb')
  expect(shown.some(text => text === 'needs you · opened details'), `the standing needs-you is kept whole: ${JSON.stringify(shown)}`).toBe(true)
  expect(joined.length, `the band is within ${COLUMNS} columns: ${JSON.stringify(shown)}`).toBeLessThanOrEqual(COLUMNS)
})

test("the idle band draws without error and names no focus key it cannot back", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = bandEngine(on, null)
  await start($)
  const idle = await bandTexts($, WIDE)
  run.serve(SNAPSHOT_RUNNING)
  await clock.advance(POLL_MS)
  run.serve(null)
  await clock.advance(POLL_MS)

  const ended = await bandTexts($, WIDE)

  expect(idle.join(''), `with no ledger the band reads idle with the hint: ${JSON.stringify(idle)}`).toBe('Pairing Buddy · idle · /pb for details')
  expect(ended.join(''), `after a run ended the band reads last run finished with the hint, never empty: ${JSON.stringify(ended)}`).toContain('Pairing Buddy · last run finished · /pb for details')
  expect((idle.concat(ended)).join(' '), 'neither band names ctrl+x or a key it cannot back').not.toMatch(/ctrl\+x|\btab\b/i)
})
