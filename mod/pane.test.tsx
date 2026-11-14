import { expect, mock, test } from 'claude-code/testing'
import { plainName } from '../shared-node/plain-names.mjs'
import { BAND, bandTexts, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, ROOT, engine, serveLedger, start, texts, type Served } from './testing/band'
import { PANE, dismissPane, paneLines, paneTexts } from './testing/replay'
import { PANE_ID } from './pane-open'
import { POLL_MS } from './poll'
import { REPORT_LABEL, reportButton } from './testing/report'

const IDLE = 'Pairing Buddy · idle · /pb for details'

test('pressing the band\'s details button opens the pane, closeable by esc', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const details = await band.find({ type: 'Button', key: 'details' })
  expect(details?.text, 'the band holds a details button').toBe('▸ details')
  await band.press({ key: 'details' })
  await band.unmount()

  expect(calls.opened.map(open => open.id), 'the button opens the pane under its id').toEqual([PANE_ID])
  // Esc itself belongs to the engine; the mod's part is to ask for it.
  expect(calls.opened[0].closeOnEscape, 'the pane is opened closeable by esc').toBe(true)
})

test('the mod registers /pb at session start, and running it opens the same pane closeable by esc', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  await $.command.run({ command: 'pb' })

  expect(calls.registered.map(command => command.name), 'the mod registers /pb at session start').toEqual(['pb'])
  expect(calls.opened.map(open => open.id), '/pb opens the pane under its id').toEqual([PANE_ID])
  expect(calls.opened[0].closeOnEscape, '/pb opens it closeable by esc too').toBe(true)
})

test('the dismiss button closes the pane by its id', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  await dismissPane($)

  expect(calls.closed.map(close => close.id), 'the dismiss button closes the pane').toEqual([PANE_ID])
})

test('the band\'s width budget subtracts the details button', async ($, on) => {
  engine(on)
  await start($)

  const fitted = async (bodyColumns: number) => {
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'terminal' })
    const segments = await texts(band)
    const button = (await band.find({ type: 'Button', key: 'details' }))!.text!
    await band.unmount()
    return { segments, button }
  }
  const narrow = await fitted(40)
  const wide = await fitted(200)

  const drawn = narrow.segments.join('').length
  expect(narrow.segments.length, 'the narrow band still draws segments').toBeGreaterThan(0)
  expect(narrow.segments.length, 'the 40 columns force segments to be cut').toBeLessThan(wide.segments.length)
  expect(drawn, `the segments and the button (${drawn}) fit the 40 columns`).toBeLessThanOrEqual(40)
})

test('a spawn with an unparseable label shows the raw label text in the pane and is counted as unknown, without throwing', async ($, on) => {
  engine(on)
  await start($)
  const raw = 'not a pb1 label at all'
  await $.agent.spawn({ prompt: 'p', description: 'd', name: raw, subagentType: 'pairingbuddy:implement-tests' })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = await texts(pane)
  await pane.unmount()

  expect(shown.some(text => text.includes(raw)), `the raw label is in the pane: ${JSON.stringify(shown)}`).toBe(true)
  expect(shown.some(text => /1 label unknown/.test(text)), 'the footer counts it: "1 label unknown"').toBe(true)
})

test('in the pane the unknown-label count sits straight after the raw labels, and the "only watches" footer is last', async ($, on) => {
  engine(on)
  await start($)
  const raws = ['not a pb1 label at all', 'neither is this one']
  for (const name of raws) {
    await $.agent.spawn({ prompt: 'p', description: 'd', name, subagentType: 'pairingbuddy:implement-tests' })
  }

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = await texts(pane)
  await pane.unmount()

  const lastRaw = shown.lastIndexOf(raws[1])
  expect(shown.slice(lastRaw - 1, lastRaw + 2), `the labels, then their count, in ${JSON.stringify(shown)}`).toEqual([raws[0], raws[1], '2 labels unknown'])
  expect(shown.at(-1), 'the footer is the last text').toMatch(/only watches/)
})

test('with the band mounted, a ledger that goes from idle to an active stage changes what it draws only when the poll interval has passed, with no new mount', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { served } = engine(on, null)
  await start($)

  // The one mount: `band` is the same handle before and after, so the redraw needs no remount.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(band), 'with no active stage the band is the dim idle text').toEqual([IDLE])

  served.ledger = JSON.stringify(SNAPSHOT_RUNNING)
  expect(await texts(band), 'a changed ledger is not read by the render itself').toEqual([IDLE])
  await clock.advance(POLL_MS - 1)
  expect(await texts(band), 'one ms before the interval the band is still idle').toEqual([IDLE])

  await clock.advance(1)
  const after = await texts(band)
  expect(after.some(text => text.includes(plainName('code-scenarios'))), `the poll reads the new ledger and the band redraws: ${JSON.stringify(after)}`).toBe(true)
  await band.unmount()
})

test("with no ledger the pane lists no step lines, neither the config change steps nor the safety-net review", async ($, on) => {
  // What the human saw: the run closed (no ledger), the session still holds spawns from it.
  engine(on, null)
  await start($)
  const finishedRun = (stage: string, agent: string) => `pb1 code-tdd ${stage} ${agent} item r1`
  for (const [stage, agent] of [['RED', 'implement-tests'], ['GREEN', 'implement-code']]) {
    await $.agent.spawn({ prompt: 'p', description: 'd', name: finishedRun(stage, agent), subagentType: `pairingbuddy:${agent}` })
  }

  const shown = await paneTexts($)

  const steps = [plainName('code-config'), plainName('code-safety-net'), plainName('code-scenarios'), plainName('code-tdd')]
  for (const step of steps) {
    expect(shown.some(text => text.includes(`${step}`)), `no step line "${step}" in ${JSON.stringify(shown)}`).toBe(false)
  }
  expect(shown.some(text => /^[▸✓○] /.test(text)), `no step marker line in ${JSON.stringify(shown)}`).toBe(false)
})
test("after a poll saw a ledger and then the task file is gone, the pane shows the last run as finished with the open report button", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { serve } = engine(on)
  await start($)
  serve(null)
  await clock.advance(POLL_MS)

  const shown = await paneTexts($)
  const button = await reportButton($)

  expect(shown.some(text => /^[✓○] /.test(text) && text.includes(plainName('code-scenarios'))), `the last run's steps stay: ${JSON.stringify(shown)}`).toBe(true)
  expect(shown.some(text => text.startsWith('▸ ')), `no step is marked as running in ${JSON.stringify(shown)}`).toBe(false)
  expect(button?.text, 'the report button is still on the pane').toBe(REPORT_LABEL)
})
test("before any ledger was polled and with no live ledger the pane shows no steps and no report button", async ($, on) => {
  // A ledger is on disk, but no poll has read it: the render must not read it, nor invent a snapshot.
  engine(on)

  const shown = await paneTexts($)
  const button = await reportButton($)

  expect(shown.some(text => /^[▸✓○] /.test(text)), `no step line in ${JSON.stringify(shown)}`).toBe(false)
  expect(button, 'no report button before the first poll').toBeUndefined()
})

test('details-button-opens-pane-with-focus: pressing the band details button opens the same pane with focus true', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'details' })
  await band.unmount()

  expect(calls.opened.length, 'the details button calls ui.open once').toBe(1)
  expect(calls.opened[0].id, 'it opens the pairingbuddy pane').toBe(PANE_ID)
  expect(calls.opened[0].focus, 'the person asked for the pane, so it takes focus').toBe(true)
  expect(calls.opened[0].closeOnEscape, 'esc returns to the prompt').toBe(true)
  expect(calls.opened[0].holdToasts, 'the pane holds no toasts').toBeUndefined()
})

test('pane-step-lines-use-theme-keys: the current step line uses a theme key and is lit, done ticks use color success, and not-started lines stay plain or dim', async ($, on) => {
  // code-scenarios is done, code-tdd is running, the safety-net review has not started.
  engine(on, {
    ...SNAPSHOT_RUNNING,
    seq: 6,
    stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-03T06:37:08.972Z' },
    stages: [{ name: 'code-scenarios', status: 'done', attempt: 1, startedAt: '2026-11-03T06:36:08.972Z', spend: { agents: 1, tokens: 0, tokensKnown: false } }],
  })
  await start($)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const nodes: { text: string; props: Record<string, unknown> }[] = await pane.findAll({ type: 'Text' })
  await pane.unmount()

  const line = (mark: string) => nodes.find(node => node.text.startsWith(`${mark} `))!
  const current = line('▸')
  const done = line('✓')
  const todo = line('○')
  expect(current?.props.color, 'the current step is lit with the claude theme key').toBe('claude')
  expect(current?.props.bold, 'the current step is bold').toBe(true)
  expect(current?.props.dimColor, 'the current step is not dim').not.toBe(true)
  expect(done?.props.color, 'a done tick is in the success theme key').toBe('success')
  expect(todo?.props.color, 'a step not started has no colour').toBeUndefined()
  expect(todo?.props.bold, 'a step not started is not bold').not.toBe(true)
})

const doneStage = (name: string, n: number) => ({ name, status: 'done', attempt: 1, startedAt: `2026-11-04T08:13:${10 + n}.000Z`, spend: { agents: 1, tokens: 0, tokensKnown: false } })
const AFTER_SCENARIOS = {
  ...SNAPSHOT_RUNNING,
  seq: 6,
  stage: { name: 'code-scenarios', status: 'done', runId: 'wf_76c46091-82d', attempt: 1, startedAt: '2026-11-04T08:13:26.472Z' },
  stages: [doneStage('intake', 0), doneStage('code-scenarios', 1)],
  gates: { ...SNAPSHOT_RUNNING.gates, 'G:type': { source: 'auto' } },
}
const nowRow = (shown: string[]) => shown.find(text => text.startsWith('NOW')) ?? ''
const RETURNED_LENS = 'REVIEW   the code 1'
const hasReturnedLens = (lines: string[]) => lines.includes(RETURNED_LENS)

test('pane-now-between-steps-has-no-band-label', async ($, on) => {
  engine(on, AFTER_SCENARIOS)
  await start($)

  const now = nowRow(await paneLines($))
  const band = (await bandTexts($, { bodyColumns: 200 })).join('')

  expect(now, `NOW reads the plain state: ${now}`).toContain('between steps · next: build test by test')
  expect(now, `NOW carries no band label: ${now}`).not.toContain('Pairing Buddy ·')
  expect(band, `the band keeps its label: ${band}`).toContain('Pairing Buddy · between steps')
})

test('pane-now-run-open-has-no-band-label', async ($, on) => {
  const { stage: _stage, ...noStage } = AFTER_SCENARIOS
  engine(on, noStage)
  await start($)

  const now = nowRow(await paneLines($))

  expect(now, `NOW reads the plain run open: ${now}`).toContain('run open')
  expect(now, `NOW carries no band label: ${now}`).not.toContain('Pairing Buddy ·')
})

test('all-steps-done-before-task-end', async ($, on) => {
  const everyStageDone = { ...AFTER_SCENARIOS, stages: ['intake', 'code-scenarios', 'code-tdd', 'code-safety-net'].map(doneStage) }
  engine(on, everyStageDone)
  await start($)

  const now = nowRow(await paneLines($))
  const band = (await bandTexts($, { bodyColumns: 200 })).join('')

  expect(band, `the band says all steps done: ${band}`).toContain('all steps done')
  expect(band, `the band never says run open: ${band}`).not.toContain('run open')
  expect(now, `NOW says all steps done: ${now}`).toContain('all steps done')
  expect(now, `NOW never says run open: ${now}`).not.toContain('run open')
})

test('pane-now-names-what-is-needed', async ($, on) => {
  const waiting = { ...AFTER_SCENARIOS, needsHuman: { gate: 'G:scenarios', reason: 'the human decides', seq: 6 } }
  const run = engine(on, waiting)
  await start($)

  const now = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const node = (await now.findAll({ type: 'Text' })).find((n: any) => n.text.startsWith('needs you'))
  await now.unmount()

  expect(nowRow(await paneLines($)), 'NOW names the gate').toBe('NOW      needs you: your OK on the scenarios')
  expect(node?.props.color, 'NOW is in the warning tone').toBe('warning')
})

const STAGE_STARTED = '2026-11-04T08:19:00.000Z'
// The mock clock must be after the stage start, or the lens spawn is not counted in the spend line.
const AFTER_STAGE_START = '2026-11-04T08:20:00.000Z'

const lensLedger = (stage: string) => ({
  ...SNAPSHOT_RUNNING,
  stage: { name: stage, status: 'active', runId: null, attempt: 1, startedAt: STAGE_STARTED },
})

test('pane-draws-the-review-row-and-no-test-in-the-safety-net-review', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(AFTER_STAGE_START) })
  on('tool.call', () => ({ result: 'ok' }))
  engine(on, lensLedger('code-safety-net'))
  await start($)

  // The last test's step belongs to the TDD stage; in the review, TEST reads a dash and NOW names the review.
  await $.agent.spawn({ prompt: 'p', description: 'd', name: 'pb1 code-tdd GREEN implement-code ten-percent-off r1', subagentType: 'pairingbuddy:implement-code' })
  const spawned = await $.agent.spawn({ prompt: 'p', description: 'd', name: 'pb1 code-safety-net - lens code r1', subagentType: 'pairingbuddy:lens' })
  await $.tool.call({ tool: 'StructuredOutput', tool_use_id: 'tu1', pb_key: 'code-safety-net.lens.code.r1.a1', findings: [{ where: 'discount.py:3', claim: 'rounds the wrong way' }], agentId: spawned.agentId })
  await clock.advance(POLL_MS * 2)

  const lines = await paneLines($)
  const review = lines.slice(lines.findIndex(line => line.startsWith('REVIEW')))
  expect(review.slice(0, 3), `the REVIEW row: lenses, summary, then each finding: ${JSON.stringify(lines)}`).toEqual([
    RETURNED_LENS,
    '         1 issue found · 1 to fix',
    '           to fix · rounds the wrong way · discount.py:3',
  ])
  expect(lines, 'NOW names the review, not the last test').toContain('NOW      safety-net review')
  expect(lines, 'TEST reads a dash outside build test by test').toContain('TEST     —')
  expect(lines.some(line => /agents? of \d+/.test(line)), 'no "n agents of 1000" line').toBe(false)
})

test('pane-draws-no-lens-lines-without-a-review-round', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(AFTER_STAGE_START) })
  on('tool.call', () => ({ result: 'ok' }))
  engine(on, lensLedger('code-tdd'))
  await start($)

  const spawned = await $.agent.spawn({ prompt: 'p', description: 'd', name: 'pb1 code-safety-net - lens code r1', subagentType: 'pairingbuddy:lens' })
  await $.tool.call({ tool: 'StructuredOutput', tool_use_id: 'tu1', pb_key: 'code-safety-net.lens.code.r1.a1', findings: [{ where: 'discount.py:3', claim: 'rounds the wrong way' }], agentId: spawned.agentId })
  await clock.advance(POLL_MS * 2)
  const lines = await paneLines($)

  expect(lines, `no review round is drawn while the stage is not a review: ${JSON.stringify(lines)}`).toContain('REVIEW   —')
})

const BEFORE_STAGE_START = '2026-11-04T08:18:00.000Z'

const recordLensCall = async ($: any) => {
  const spawned = await $.agent.spawn({ prompt: 'p', description: 'd', name: 'pb1 code-safety-net - lens code r1', subagentType: 'pairingbuddy:lens' })
  await $.tool.call({ tool: 'StructuredOutput', tool_use_id: 'tu1', pb_key: 'code-safety-net.lens.code.r1.a1', findings: [{ where: 'discount.py:3', claim: 'rounds the wrong way' }], agentId: spawned.agentId })
}

test('pane-wraps-lens-lines-at-a-narrow-width-into-indented-continuation-rows', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(AFTER_STAGE_START) })
  on('tool.call', () => ({ result: 'ok' }))
  engine(on, lensLedger('code-safety-net'))
  await start($)
  await recordLensCall($)
  await clock.advance(POLL_MS * 2)

  const lines = await paneLines($, { bodyColumns: 30 })
  const review = lines.slice(lines.findIndex(line => line.startsWith('REVIEW')))

  expect(review.some(line => line.startsWith(`${' '.repeat(9)}  `)), `a review line wraps into a row indented under the label: ${JSON.stringify(review)}`).toBe(true)
  expect(review.every(line => line.length <= 30), `no review row is wider than the pane: ${JSON.stringify(review)}`).toBe(true)
})

test('pane-forgets-recorded-lens-calls-on-session-start-and-on-clear', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(AFTER_STAGE_START) })
  on('tool.call', () => ({ result: 'ok' }))
  engine(on, lensLedger('code-safety-net'))
  await start($)
  await recordLensCall($)
  await clock.advance(POLL_MS * 2)
  expect(hasReturnedLens(await paneLines($)), 'the round is drawn before the clear').toBe(true)

  await $.session.end({ sessionId: 's1', reason: 'clear' })
  await clock.advance(POLL_MS * 2)
  const afterClear = await paneLines($)
  expect(hasReturnedLens(afterClear), `no returned lens remains after a clear: ${JSON.stringify(afterClear)}`).toBe(false)

  await recordLensCall($)
  await clock.advance(POLL_MS * 2)
  expect(hasReturnedLens(await paneLines($)), 'a new call is drawn again').toBe(true)
  await start($)
  await clock.advance(POLL_MS * 2)
  const afterStart = await paneLines($)
  expect(hasReturnedLens(afterStart), `no returned lens remains after a session start: ${JSON.stringify(afterStart)}`).toBe(false)
})

test('pane-does-not-count-a-lens-call-made-before-the-stage-started', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(BEFORE_STAGE_START) })
  on('tool.call', () => ({ result: 'ok' }))
  engine(on, lensLedger('code-safety-net'))
  await start($)
  await recordLensCall($)
  await clock.advance(POLL_MS * 2)

  const shown = await paneLines($)

  expect(hasReturnedLens(shown), `a call from before the stage is not a returned lens: ${JSON.stringify(shown)}`).toBe(false)
})
