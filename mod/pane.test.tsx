import { expect, mock, test } from 'claude-code/testing'
import { plainName } from '../shared-node/plain-names.mjs'
import { BAND, bandTexts, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, ROOT, engine, serveLedger, start, bandRowTexts, texts, type Served } from './testing/band'
import { PANE, dismissPane, paneLines, paneTexts } from './testing/replay'
import { PANE_ID } from './pane-open'
import { ACCENT_COLOUR } from './pane'
import { POLL_MS } from './poll'
import { REPORT_LABEL, reportButton } from './testing/report'

const IDLE = 'Pairing Buddy · idle'

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
    const segments = await bandRowTexts(band)
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

test('in the pane the unknown-label count sits straight after the raw labels, and no "only watches" footer is drawn', async ($, on) => {
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
  expect(shown.some(text => /only watches/.test(text)), 'the footer is gone: it read as false and took a row').toBe(false)
})

test('with the band mounted, a ledger that goes from idle to an active stage changes what it draws only when the poll interval has passed, with no new mount', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { served } = engine(on, null)
  await start($)

  // The one mount: `band` is the same handle before and after, so the redraw needs no remount.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await bandRowTexts(band), 'with no active stage the band is the dim idle text').toEqual([IDLE])

  served.ledger = JSON.stringify(SNAPSHOT_RUNNING)
  expect(await bandRowTexts(band), 'a changed ledger is not read by the render itself').toEqual([IDLE])
  await clock.advance(POLL_MS - 1)
  expect(await bandRowTexts(band), 'one ms before the interval the band is still idle').toEqual([IDLE])

  await clock.advance(1)
  const after = await bandRowTexts(band)
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

test('pane-step-lines-use-marks-and-light-only-the-current-one: the current step is bold in the accent colour, no other step line is coloured', async ($, on) => {
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
  expect(current?.props.color, 'the current step is lit in the accent colour').toBe(ACCENT_COLOUR)
  expect(current?.props.bold, 'the current step is bold').toBe(true)
  expect(current?.props.dimColor, 'the current step is not dim').not.toBe(true)
  expect(done?.props.color, 'a done step has no colour').toBeUndefined()
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
const nowRow = (shown: string[]) => shown.find(text => text.startsWith('STATUS')) ?? ''
const RETURNED_LENS = 'REVIEW   checked: the code'
const hasReturnedLens = (lines: string[]) => lines.includes(RETURNED_LENS)

test('between-steps-the-pane-and-the-band-lead-with-the-working-mark', async ($, on) => {
  engine(on, AFTER_SCENARIOS)
  await start($)

  const now = nowRow(await paneLines($))
  const mounted = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 200 }, surface: 'terminal' })
  const [mark, rest] = (await mounted.findAll({ type: 'Text' })).filter((node: any) => node.text !== undefined && !/^─+$/.test(node.text) && !node.props.bold)
  await mounted.unmount()

  expect(now, `STATUS reads the plain state: ${now}`).toBe('STATUS   ● working · between steps · next: build test by test')
  expect([mark.text, mark.props.color], 'the band leads with the working mark in the accent').toEqual(['● ', ACCENT_COLOUR])
  expect([rest.text, rest.props.dimColor], 'then the quiet line, dim, with no "Pairing Buddy" label: the goal row above names the session').toEqual(['between steps · next: build test by test', true])
})

test('pane-now-run-open-has-no-band-label', async ($, on) => {
  const { stage: _stage, ...noStage } = AFTER_SCENARIOS
  engine(on, noStage)
  await start($)

  const now = nowRow(await paneLines($))

  expect(now, `STATUS reads the plain run open: ${now}`).toContain('run open')
  expect(now, `STATUS carries no band label: ${now}`).not.toContain('Pairing Buddy ·')
})

test('all-steps-done-before-task-end', async ($, on) => {
  const everyStageDone = { ...AFTER_SCENARIOS, stages: ['intake', 'code-scenarios', 'code-tdd', 'code-safety-net'].map(doneStage) }
  engine(on, everyStageDone)
  await start($)

  const now = nowRow(await paneLines($))
  const band = (await bandTexts($, { bodyColumns: 200 })).join('')

  expect(band, `the band says all steps done: ${band}`).toContain('all steps done')
  expect(band, `the band never says run open: ${band}`).not.toContain('run open')
  expect(now, `STATUS says all steps done: ${now}`).toContain('all steps done')
  expect(now, `STATUS never says run open: ${now}`).not.toContain('run open')
})

// STATUS's nodes as drawn: its head, then what follows it.
async function statusNodes($: any) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = await pane.findAll({ type: 'Text' })
  await pane.unmount()
  const at = drawn.findIndex((node: any) => node.text === 'STATUS   ')
  return { head: drawn[at + 1], rest: drawn[at + 2] }
}

test('pane-now-names-what-is-needed-in-the-strongest-treatment', async ($, on) => {
  const waiting = { ...AFTER_SCENARIOS, needsHuman: { gate: 'G:scenarios', reason: 'the human decides', seq: 6 } }
  engine(on, waiting)
  await start($)

  const { head, rest } = await statusNodes($)

  expect(nowRow(await paneLines($)), 'STATUS names the gate').toBe('STATUS   ▲ NEEDS YOU · your OK on the scenarios')
  expect([head.text, head.props.color, head.props.inverse, head.props.bold], 'the head is a yellow block, bold: the one thing not to miss').toEqual(['▲ NEEDS YOU', 'warning', true, true])
  expect([rest.text, rest.props.color, rest.props.bold, rest.props.inverse], 'what it needs follows in yellow, bold, not a block').toEqual([' · your OK on the scenarios', 'warning', true, undefined])
})

test('pane-status-says-why-it-stopped-as-strongly-in-red', async ($, on) => {
  engine(on, { ...SNAPSHOT_RUNNING, stop: { code: 'step-failed', reason: 'the stage failed three times', seq: 3 } })
  await start($)

  const { head, rest } = await statusNodes($)

  expect(nowRow(await paneLines($)), 'STATUS says why').toBe(`STATUS   ✕ STOPPED · ${plainName('step-failed')}`)
  expect([head.text, head.props.color, head.props.inverse, head.props.bold], 'the head is a red block, bold').toEqual(['✕ STOPPED', 'error', true, true])
  expect([rest.text, rest.props.color, rest.props.inverse], 'why follows in red, not a block').toEqual([` · ${plainName('step-failed')}`, 'error', undefined])
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

  // The last test's step belongs to the TDD stage; in the review, no test is current and NOW names the review.
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
  expect(lines, 'STATUS names the review, not the last test').toContain('STATUS   ● working · safety-net review')
  expect(lines, 'no test is current outside build test by test').toContain('TESTS    —')
  expect(lines.some(line => line.startsWith('TEST ')), 'there is no TEST row').toBe(false)
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
