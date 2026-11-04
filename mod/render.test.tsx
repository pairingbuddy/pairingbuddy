import { expect, mock, test } from 'claude-code/testing'
import { fitBand, glance } from '../shared-node/glance.mjs'
import { bandColumns } from './band'
import { plainName } from '../shared-node/plain-names.mjs'
import { POLL_MS } from './poll'
import { needingHuman, stopped } from './testing/alert'
import { PANE } from './testing/replay'
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
      expect(drawn[surface], `${surface} band draws idle for a ${name} ledger`).toContain(name === 'no current stage yet' ? 'Pairing Buddy · between steps · next: ' : ['missing stage', 'missing stage and stages', 'missing owner', 'empty document'].includes(name) ? 'Pairing Buddy · run open' : 'Pairing Buddy · idle')
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

// Placeholders for band idle and colour cases (scenarios band-never-idle-with-live-ledger, theme-colours-in-band-and-pane).
const doneStage = (name: string, n: number) => ({ name, status: 'done', attempt: 1, startedAt: `2026-11-04T08:13:${10 + n}.000Z`, spend: { agents: 1, tokens: 0, tokensKnown: false } })
// Seq 6 of tests/smoke/recordings/t59-healthy: code-scenarios is done and code-tdd has not started.
const BETWEEN_SCENARIOS_AND_TDD = {
  ...SNAPSHOT_RUNNING,
  seq: 6,
  stage: { name: 'code-scenarios', status: 'done', runId: 'wf_76c46091-82d', attempt: 1, startedAt: '2026-11-04T08:13:26.472Z' },
  stages: [doneStage('code-scenarios', 0)],
}
// Seq 2 of the same recording: right after pb run open, no stage yet.
const JUST_OPENED = { ...SNAPSHOT_NO_STAGE, seq: 2, owner: { sessionId: '3855343a-c693-4213-9f52-91a2ff2021ef', lastSeen: '2026-11-04T08:13:24.369Z' }, policy: { mode: 'auto', source: 'permission_mode' } }

test('between-stages-band-shows-next-step: a live ledger with stage not active and stages done up to a known point draws a band without idle that reads between steps with the next stage plain name', async ($, on) => {
  const cases: [string, unknown, string][] = [
    ['right after run open', JUST_OPENED, plainName('code-scenarios')],
    ['between code-scenarios and code-tdd', BETWEEN_SCENARIOS_AND_TDD, plainName('code-tdd')],
  ]
  const run = bandEngine(on, JUST_OPENED)
  for (const [name, ledger, next] of cases) {
    run.serve(ledger)
    await start($)

    const joined = (await bandTexts($, WIDE)).join('')

    expect(joined, `${name}: the band is not idle: ${joined}`).not.toContain('idle')
    expect(joined, `${name}: the band says between steps: ${joined}`).toContain('between steps')
    expect(joined, `${name}: the band names the next step: ${joined}`).toContain(`next: ${next}`)
  }
})

test('live-ledger-without-known-next-never-idle: a live ledger where no next stage can be named still draws a non-idle band saying the run is open with no invented step name', async ($, on) => {
  const everyStageDone = { ...BETWEEN_SCENARIOS_AND_TDD, stages: ['code-scenarios', 'code-tdd', 'code-safety-net'].map(doneStage) }
  const ledgers: Record<string, unknown> = {
    'every stage done': everyStageDone,
    'stage object absent': without(JUST_OPENED, 'stage'),
    'stage object partial': { ...JUST_OPENED, stage: { name: '' } },
  }
  const run = bandEngine(on, JUST_OPENED)
  for (const [name, ledger] of Object.entries(ledgers)) {
    run.serve(ledger)
    await start($)

    const joined = (await bandTexts($, WIDE)).join('')

    expect(joined, `${name}: the band is not idle: ${joined}`).not.toContain('idle')
    expect(joined, `${name}: the band says the run is open: ${joined}`).toMatch(/run (is )?open|between steps|all steps done/)
    expect(joined, `${name}: no next step is invented: ${joined}`).not.toContain('next:')
  }
})

test('no-ledger-no-snapshot-stays-idle: with no ledger and no snapshot the band reads the dim idle text, and with no ledger but a snapshot it reads last run finished', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = bandEngine(on, null)
  await start($)
  const idle = await bandTexts($, WIDE)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const dim = JSON.stringify(await band.find({ type: 'Text' }))
  await band.unmount()
  run.serve(BETWEEN_SCENARIOS_AND_TDD)
  await clock.advance(POLL_MS)
  run.serve(null)
  await clock.advance(POLL_MS)

  const ended = await bandTexts($, WIDE)

  expect(idle.join(''), `no ledger, no snapshot: idle with the hint: ${JSON.stringify(idle)}`).toBe('Pairing Buddy · idle · /pb for details')
  expect(dim, 'the idle text is dim').toContain('"dimColor":true')
  expect(ended.join(''), `no ledger but a snapshot: last run finished: ${JSON.stringify(ended)}`).toContain('Pairing Buddy · last run finished')
})

test('needs-you-and-stop-use-warning-or-error: a needs-you gate draws in warning and a stop in error in pane and band, while unknown values and the SPENT row stay dimColor', async ($, on) => {
  const run = bandEngine(on, needingHuman())
  const nodes = async (surface: Record<string, unknown>): Promise<{ text: string; props: Record<string, unknown> }[]> => {
    const mounted = await $.ui.mount({ ...surface, surface: 'terminal' })
    const found = await mounted.findAll({ type: 'Text' })
    await mounted.unmount()
    return found
  }
  const band = { ...BAND, props: { ...BAND.props, bodyColumns: 200 } }
  const starting = (nodes: { text: string }[], prefix: string) => nodes.find(node => node.text.startsWith(prefix))!

  await start($)
  const gateBand = await nodes(band)
  run.serve(stopped({ code: 'step-failed' }))
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  const stopBand = await nodes(band)
  const stopPane = await nodes(PANE)

  expect(starting(gateBand, 'needs you').props.color, 'a needs-you gate in the band is warning').toBe('warning')
  expect(starting(stopBand, 'needs you').props.color, 'a stop in the band is error').toBe('error')
  expect(starting(stopPane, 'NOW').props.color, 'a stop in the pane NOW row is error').toBe('error')
  expect(starting(gateBand, 'looping:').props.dimColor, 'an unknown band segment is dim').toBe(true)
  expect(starting(gateBand, 'time unknown').props.dimColor, 'the band spend segment is dim').toBe(true)
  expect(starting(stopPane, 'SPENT').props.dimColor, 'the pane SPENT row is dim').toBe(true)
  expect(starting(stopPane, 'LOOPING').props.dimColor, 'an unknown pane row is dim').toBe(true)
})

test('band-leads-with-needs-you-at-a-gate', async ($, on) => {
  const waiting = { ...BETWEEN_SCENARIOS_AND_TDD, needsHuman: { gate: 'G:scenarios', reason: 'the human decides', seq: 6 } }
  bandEngine(on, waiting)
  await start($)

  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 200 }, surface: 'terminal' })
  const nodes = await band.findAll({ type: 'Text' })
  await band.unmount()

  const shown = nodes.map((node: any) => node.text as string)
  const needs = nodes.find((node: any) => node.text.startsWith('needs you'))
  expect(shown[0], `the band leads with needs you: ${JSON.stringify(shown)}`).toBe('needs you: your OK on the scenarios')
  expect(needs?.props.color, 'needs you is in the warning colour').toBe('warning')
  expect(needs?.props.bold, 'needs you is bold').toBe(true)
  expect(shown.join(''), 'no dim between-steps line').not.toContain('between steps')
})
