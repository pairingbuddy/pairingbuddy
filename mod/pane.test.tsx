import { expect, mock, test } from 'claude-code/testing'
import { plainName } from '../shared-node/plain-names.mjs'
import { BAND, bandTexts, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, ROOT, engine, serveLedger, start, bandRowTexts, texts, type Served } from './testing/band'
import { PANE, paneLines, paneTexts } from './testing/replay'
import { firstGlance } from './testing/glance'
import { PANE_ID } from './pane-open'
import { ACCENT_COLOUR } from './pane'
import { POLL_MS } from './poll'

const IDLE = 'Pairing Buddy · idle · details: /pb · report: /pb-report · plan: /pb-plan'

// The classic renderer has no mouse, and reaching a band button takes ctrl+x tab, tab, enter: the band names commands instead.
test('the band draws no button, in any state', async ($, on) => {
  const { serve } = engine(on)
  const clock = mock.clock(on, { now: 0 })
  await start($)
  const buttons: Record<string, unknown[]> = {}

  for (const [state, ledger] of [['running', SNAPSHOT_RUNNING], ['between steps', SNAPSHOT_NO_STAGE], ['idle', null]] as const) {
    serve(ledger)
    await clock.advance(POLL_MS)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    buttons[state] = await band.findAll({ type: 'Button' })
    await band.unmount()
  }

  expect(buttons, 'no state of the band draws a button').toEqual({ running: [], 'between steps': [], idle: [] })
})

test('the mod registers /pb at session start, and running it opens the same pane closeable by esc', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  await $.command.run({ command: 'pb' })

  expect(calls.registered.map(command => command.name), 'the mod registers /pb, /pb-report, /pb-plan and /pb-questions at session start').toEqual(['pb', 'pb-report', 'pb-plan', 'pb-questions'])
  expect(calls.opened.map(open => open.id), '/pb opens the pane under its id').toEqual([PANE_ID])
  expect(calls.opened[0].closeOnEscape, '/pb opens it closeable by esc too').toBe(true)
})

// Nobody reaches a pane button (ctrl+x tab, then tab and enter): /pb closes the pane and /pb-report writes the report.
test('the pane draws no button, in any state', async ($, on) => {
  const { serve } = engine(on)
  const clock = mock.clock(on, { now: 0 })
  await start($)
  const buttons: Record<string, unknown[]> = {}

  for (const [state, ledger] of [['running', SNAPSHOT_RUNNING], ['between steps', SNAPSHOT_NO_STAGE], ['ended', null]] as const) {
    serve(ledger)
    await clock.advance(POLL_MS)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    buttons[state] = await pane.findAll({ type: 'Button' })
    await pane.unmount()
  }

  expect(buttons, 'no state of the pane draws a button').toEqual({ running: [], 'between steps': [], ended: [] })
})

// Typing into the pane took its focus first.
test('the pane draws no input, in any state', async ($, on) => {
  const { serve } = engine(on)
  const clock = mock.clock(on, { now: 0 })
  await start($)
  const inputs: Record<string, unknown[]> = {}

  for (const [state, ledger] of [['running', SNAPSHOT_RUNNING], ['between steps', SNAPSHOT_NO_STAGE], ['ended', null]] as const) {
    serve(ledger)
    await clock.advance(POLL_MS)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    inputs[state] = await pane.findAll({ type: 'Input' })
    await pane.unmount()
  }

  expect(inputs, 'no state of the pane draws an input').toEqual({ running: [], 'between steps': [], ended: [] })
})

test('the band\'s width budget fits its segments beside the [-] control', async ($, on) => {
  engine(on)
  await start($)

  const fitted = async (bodyColumns: number) => {
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'terminal' })
    const segments = await bandRowTexts(band)
    await band.unmount()
    return { segments }
  }
  const narrow = await fitted(40)
  const wide = await fitted(200)

  const drawn = narrow.segments.join('').length
  expect(narrow.segments.length, 'the narrow band still draws segments').toBeGreaterThan(0)
  expect(narrow.segments.length, 'the 40 columns force segments to be cut').toBeLessThan(wide.segments.length)
  expect(drawn, `the segments (${drawn}) fit the 40 columns`).toBeLessThanOrEqual(40)
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
test("after a poll saw a ledger and then the task file is gone, the pane shows the last run as finished", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { serve } = engine(on)
  await start($)
  serve(null)
  await clock.advance(POLL_MS)

  const shown = await paneTexts($)

  expect(shown.some(text => /^[✓○] /.test(text) && text.includes(plainName('code-scenarios'))), `the last run's steps stay: ${JSON.stringify(shown)}`).toBe(true)
  expect(shown.some(text => text.startsWith('▸ ')), `no step is marked as running in ${JSON.stringify(shown)}`).toBe(false)
})
test("before any ledger was polled and with no live ledger the pane shows no steps", async ($, on) => {
  // A ledger is on disk, but no poll has read it: the render must not read it, nor invent a snapshot.
  engine(on)

  const shown = await paneTexts($)

  expect(shown.some(text => /^[▸✓○] /.test(text)), `no step line in ${JSON.stringify(shown)}`).toBe(false)
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
  expect([rest.text, rest.props.dimColor], 'then the quiet line, dim, with no "Pairing Buddy" label: the goal row above names the session').toEqual(['between steps · next: build test by test · details: /pb · report: /pb-report · plan: /pb-plan', true])
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

// A loud state's bar as drawn: its first node (the state's words and what about) and its text, trimmed of the padding.
async function barNodes($: any) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = (await pane.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown> }[]
  await pane.unmount()
  const bar = drawn.slice(0, drawn.findIndex(node => node.text.startsWith('GOAL')))
  return { head: bar[0], text: bar.map(node => node.text).join('').trimEnd() }
}

test('pane-now-names-what-is-needed-in-the-strongest-treatment', async ($, on) => {
  const waiting = { ...AFTER_SCENARIOS, needsHuman: { gate: 'G:scenarios', reason: 'the human decides', seq: 6 } }
  engine(on, waiting)
  await start($)

  const { head, text } = await barNodes($)

  expect(text, 'the bar names the gate').toBe('⏸ WAITING FOR YOU · your OK on the scenarios')
  expect([head.props.color, head.props.inverse, head.props.bold], 'a yellow block, bold: the one thing not to miss').toEqual(['warning', true, true])
})

// Claude Code's own permission prompt, unanswered (hooks/permission.mjs opened the wait): the human is needed, as at a gate.
test('pane-and-band-say-needs-you-while-claude-code-asks-permission', async ($, on) => {
  const asking = { ...AFTER_SCENARIOS, permissionWaits: [{ askedAt: '2026-11-04T08:14:00.000Z', seq: 7, tool: 'Workflow' }] }
  engine(on, asking)
  await start($)

  const { head } = await barNodes($)
  const band = (await bandTexts($, { bodyColumns: 200 })).join('')

  // Wider than a 70-column pane, the bar wraps at words onto a second line, never cut.
  const bar = firstGlance(await paneLines($, { bodyColumns: 70 }))

  expect(bar, 'the bar says what Claude Code is asking, whole').toEqual(['⏸ WAITING FOR YOU · Claude Code is asking your permission to start the', 'next step'])
  expect([head.props.color, head.props.inverse], 'in the yellow block').toEqual(['warning', true])
  expect(band, `the band leads with it and says what it asks: ${band}`).toMatch(/^⏸ WAITING FOR YOU · Claude Code is asking your permission/)
})

test('pane-status-says-why-it-stopped-as-strongly-in-red', async ($, on) => {
  engine(on, { ...SNAPSHOT_RUNNING, stop: { code: 'step-failed', reason: 'the stage failed three times', seq: 3 } })
  await start($)

  const { head, text } = await barNodes($)

  expect(text, 'the bar says why').toBe(`✗ STOPPED · ${plainName('step-failed')}`)
  expect([head.props.color, head.props.inverse, head.props.bold], 'a red block, bold').toEqual(['error', true, true])
})

// No black box: a stop that recorded what happened says it under STATUS, with what the human can do, each bounded.
const EXPLAINED_STOP = {
  code: 'step-failed',
  reason: 'step-failed',
  seq: 3,
  why: 'GREEN for t1 was refused 3 times',
  detail: `GREEN for t1 was refused 3 times, so the stage stopped. The last refusal: ${'x'.repeat(400)}`,
  options: ['Read the refusal and tell the session what to change.', `Cut it: ${'y'.repeat(300)}`],
}

test('pane-says-why-a-stop-happened-and-what-the-human-can-do', async ($, on) => {
  engine(on, { ...SNAPSHOT_RUNNING, stop: EXPLAINED_STOP })
  await start($)

  const lines = await paneLines($)
  const why = lines.findIndex(line => line.startsWith('WHY'))
  const rows = lines.slice(why, lines.findIndex((line, i) => i > why && /^[A-Z]{2,}/.test(line)))

  expect(lines[0].trimEnd(), 'the bar says why in short').toBe('✗ STOPPED · GREEN for t1 was refused 3 times')
  expect(why, 'WHY follows the first glance').toBeGreaterThan(lines.findIndex(line => line.startsWith('GOAL')))
  const parts = rows.map(line => line.replace(/^(WHY)?\s+/, ''))
  expect(parts[0], 'the cause leads').toMatch(/^GREEN for t1 was refused 3 times, so the stage stopped\./)
  expect(parts.findIndex(part => part.endsWith('x…')), 'the cause is cut with an ellipsis').toBeGreaterThan(0)
  expect(parts.filter(part => /^\d\. /.test(part)), 'then each option, numbered').toEqual(['1. Read the refusal and tell the session what to change.', '2. Cut it:'])
  expect(parts.some(part => part.endsWith('y…')), 'a long option is cut with an ellipsis').toBe(true)
  expect(parts.at(-1), 'the whole text is in the report').toBe('full text: /pb-report')
  expect(rows.join('').length, 'bounded').toBeLessThan(700)
})

// An option that fits in two lines of a 120-column pane is shown whole: its end ("then tell the session to go on") is
// what the human acts on.
test('pane-shows-an-option-whole-when-it-fits-in-two-lines', async ($, on) => {
  const cut = "Cut it, if the code already does what it checks: type !.pairingbuddy/bin/pb human cut-test s4-gate-denies-outside --reason '<why>', then tell the session to go on."
  engine(on, { ...SNAPSHOT_RUNNING, stop: { ...EXPLAINED_STOP, options: [cut] } })
  await start($)

  const lines = await paneLines($, { bodyColumns: 120 })
  const why = lines.findIndex(line => line.startsWith('WHY'))
  const text = lines.slice(why).map(line => line.replace(/^(WHY)?\s+/, '').trimEnd()).join(' ')

  expect(text, 'the option whole').toContain('then tell the session to go on.')
})

// Three states: the human's own stop is no failure, so it waits in amber and red stays for what went wrong.
test('pane-status-draws-the-humans-own-stop-as-waiting-not-as-a-failure', async ($, on) => {
  engine(on, { ...SNAPSHOT_RUNNING, stop: { code: 'human-stopped', reason: 'the human answered stop at G:scenarios', seq: 3 } })
  await start($)

  const { head, text } = await barNodes($)

  expect([text, head.props.color, head.props.inverse], 'the amber waiting bar, not the red stop').toEqual([`⏸ WAITING FOR YOU · ${plainName('human-stopped')}`, 'warning', true])
})

// Three states: a loud one draws a bar across the top of the pane, the pane's whole width, above GOAL.
async function paneTop($: any, columns = 80) {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface: 'terminal' })
  const nodes = (await pane.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown> }[]
  await pane.unmount()
  const goal = nodes.findIndex(node => node.text.startsWith('GOAL'))
  return nodes.slice(0, goal)
}

test('pane-draws-a-red-bar-the-whole-width-across-its-top-for-a-failure-stop', async ($, on) => {
  engine(on, { ...SNAPSHOT_RUNNING, stop: { code: 'step-failed', reason: 'the stage failed three times', seq: 3 } })
  await start($)

  const bar = await paneTop($, 80)

  const text = bar.map(node => node.text).join('')
  expect(text.trimEnd(), 'the bar says why').toBe(`✗ STOPPED · ${plainName('step-failed')}`)
  expect(text.length, 'the bar spans the pane').toBe(80)
  expect(bar.every(node => node.props.color === 'error' && node.props.inverse === true && node.props.bold === true), 'all of it in red reverse, bold').toBe(true)
})

test('pane-draws-no-bar-while-the-run-works', async ($, on) => {
  engine(on, SNAPSHOT_RUNNING)
  await start($)

  expect(await paneTop($), 'GOAL leads: nothing above it').toEqual([])
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

// Live 2026-11-27: STOPPED drawn in the bar and again on STATUS read as noise. The bar says it; nothing else in the pane repeats it.
test('pane-says-a-loud-state-once-in-its-bar', async ($, on) => {
  engine(on, { ...SNAPSHOT_RUNNING, stop: { code: 'step-failed', reason: 'the stage failed three times', seq: 3 } })
  await start($)

  const lines = await paneLines($)

  expect(lines.filter(line => line.includes('STOPPED')), `STOPPED once: ${JSON.stringify(lines)}`).toHaveLength(1)
})

// Live 2026-11-27: "a lot of red there". The bar is the one red thing; what happened and the options under it read plain.
test('pane-draws-why-in-plain-text-under-the-red-bar', async ($, on) => {
  engine(on, { ...SNAPSHOT_RUNNING, stop: EXPLAINED_STOP })
  await start($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const nodes = (await pane.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown> }[]
  await pane.unmount()

  const red = nodes.filter(node => node.props.color === 'error' && node.props.inverse !== true).map(node => node.text)

  expect(red, 'no red outside the bar').toEqual([])
})
