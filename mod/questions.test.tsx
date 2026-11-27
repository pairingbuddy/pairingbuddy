// Scenario questions-for-you: doubts an auto-mode gate set aside wait on the open unit (run/unit.json questions) until
// G:publish asks them. While they wait, STATUS and the band count them, so the human sees there is something for them
// before the pull request, though nothing stops the run.
import { expect, test } from 'claude-code/testing'
import { paneLines, setupReplay, type Rig } from './testing/replay'
import { BAND, LEDGER, ROOT, SNAPSHOT_RUNNING, bandTexts, start } from './testing/band'
import { QUESTION_COLOUR } from './pane'
import { POLL_MS } from './poll'

const UNIT = '.pairingbuddy/run/unit.json'
const QUESTION_SOUND = { asset: 'mod/assets/question.wav' }
const question = (n: number) => ({ gate: 'G:task-end', task: 'Task 1: one', step: 'a reviewer', ambiguity: `Doubt ${n}?` })
const unitWith = (questions: unknown[], more?: number) => ({
  unit: null, plan: null, tracer: null, branch: 'feat/x', base: 'main', baseSha: 'abc', tasks: [], commits: [],
  questions, ...(more === undefined ? {} : { questionsMore: more }),
})
const running = { ...SNAPSHOT_RUNNING, kind: 'code', taskType: 'new_feature', stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-14T10:00:00.000Z' } }

function serve(rig: Rig, files: Record<string, unknown>) {
  rig.served.clear()
  for (const [path, value] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, JSON.stringify(value))
}

async function shown($: any, on: Function, unit: unknown) {
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: running, [UNIT]: unit })
  await rig.clock.set(Date.parse('2026-11-14T10:01:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  return { lines: await paneLines($), band: (await bandTexts($)).join('') }
}

// The STATUS row with its wrapped continuation lines, joined as one text: the pane wraps a long STATUS at a part boundary.
function statusText(lines: string[]): string {
  const at = lines.findIndex(line => line.startsWith('STATUS'))
  const rest = lines.slice(at + 1)
  const more = rest.slice(0, Math.max(0, rest.findIndex(line => !line.startsWith(' '))))
  return [lines[at], ...more.map(line => line.trim())].join(' · ').replace(/\s+/g, ' ')
}

test('questions-the-unit-holds-are-counted-in-status-and-the-band', async ($, on) => {
  const { lines, band } = await shown($, on, unitWith([question(1), question(2)], 1))

  const status = statusText(lines)
  expect(status, `STATUS adds the count after what the run is doing, and how to answer: ${JSON.stringify(lines)}`).toMatch(/· 3 questions for you · type \/pb-questions$/)
  expect(band, 'the band counts them too, and says how to answer').toContain('? 3 questions · /pb-questions')
})

// Three states: questions that wait while the run goes on are the quiet one: a blue count, no block, no bar.
test('the-band-counts-questions-in-a-calm-blue-with-no-block', async ($, on) => {
  await shown($, on, unitWith([question(1), question(2)]))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const nodes = (await band.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown> }[]
  await band.unmount()

  const count = nodes.find(node => node.text.startsWith('? '))
  expect([count?.text, count?.props.color, count?.props.inverse], 'the count in blue, not a block').toEqual(['? 2 questions · /pb-questions', QUESTION_COLOUR, undefined])
  expect(nodes.some(node => node.props.inverse === true), 'no bar: the run goes on').toBe(false)
})

test('a question the human answered is no longer counted', async ($, on) => {
  const { lines, band } = await shown($, on, unitWith([question(1), { ...question(2), answer: 'Yes.', answeredAt: 't' }]))

  const status = statusText(lines)
  expect(status, `only the open one counts: ${JSON.stringify(lines)}`).toMatch(/· 1 question for you · type \/pb-questions$/)
  expect(band).toContain('? 1 question · /pb-questions')
})

test('a new question sends one notice and the soft question chime, never repeated, and no status line', async ($, on) => {
  const notified: any[] = []
  const played: unknown[] = []
  const statuses: unknown[] = []
  on('ui.notify', (_: unknown, e: any) => (notified.push(e), { value: { isSent: true, channel: 'terminal_bell' } }))
  on('audio.play', (_: unknown, e: unknown) => (played.push(e), { value: undefined }))
  on('ui.status', (_: unknown, e: unknown) => (statuses.push(e), { value: undefined }))
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => (store.set(e.key, e.value), { value: undefined }))
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: running, [UNIT]: unitWith([question(1)]) })
  await rig.clock.set(Date.parse('2026-11-14T10:01:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 3)

  expect(notified.map(({ text }) => text), 'one notice for the question').toEqual(['Question for you: Doubt 1? · /pb-questions'])

  serve(rig, { [LEDGER]: running, [UNIT]: unitWith([{ ...question(1), answer: 'Yes.', answeredAt: 't' }, question(2)]) })
  await rig.clock.advance(POLL_MS * 3)

  expect(notified.map(({ text }) => text), 'the next question gets its own, the first is not repeated').toEqual(['Question for you: Doubt 1? · /pb-questions', 'Question for you: Doubt 2? · /pb-questions'])
  expect(played.map((e: any) => e.clip), 'the soft question chime, once per poll that found new questions, never the stop sound').toEqual([QUESTION_SOUND, QUESTION_SOUND])
  expect(statuses.filter(Boolean), 'no warning status line either').toEqual([])
})

// The question chime has its own off switch, and the alertSound switch silences every sound, the chime included.
for (const options of [{ questionSound: false }, { alertSound: false }]) {
  test(`a new question plays no chime with ${JSON.stringify(options)}, and still sends its notice`, { options }, async ($, on) => {
    const notified: any[] = []
    const played: unknown[] = []
    on('ui.notify', (_: unknown, e: any) => (notified.push(e), { value: { isSent: true, channel: 'terminal_bell' } }))
    on('audio.play', (_: unknown, e: unknown) => (played.push(e), { value: undefined }))
    const store = new Map<string, unknown>()
    on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
    on('store.set', (_: unknown, e: { key: string; value: unknown }) => (store.set(e.key, e.value), { value: undefined }))
    const rig = setupReplay(on)
    serve(rig, { [LEDGER]: running, [UNIT]: unitWith([question(1)]) })
    await rig.clock.set(Date.parse('2026-11-14T10:01:00.000Z'))
    await start($)
    await rig.clock.advance(POLL_MS * 3)

    expect(notified.map(({ text }) => text), 'the notice still goes out').toEqual(['Question for you: Doubt 1? · /pb-questions'])
    expect(played, 'no chime with the sound turned off').toEqual([])
  })
}

// Live 2026-11-27: the count rode inside the red bar and pushed its end past the edge. The bar holds only the state and why;
// the count keeps its own quiet line under it, in blue.
test('a-stop-keeps-the-question-count-out-of-its-bar', async ($, on) => {
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: { ...running, stop: { code: 'step-failed', reason: 'r', seq: 3, why: 'GREEN for t1 was refused 3 times' } }, [UNIT]: unitWith([question(1), question(2)]) })
  await rig.clock.set(Date.parse('2026-11-14T10:01:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  const pane = await $.ui.mount({ plugin: 'pairingbuddy', component: 'Pane', requestId: 'pairingbuddy', props: { title: 'Pairing Buddy', isFocused: false, bodyColumns: 120, placement: 'dock' }, surface: 'terminal' })
  const nodes = (await pane.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown> }[]
  await pane.unmount()

  const bar = nodes.filter(node => node.props.inverse === true).map(node => node.text).join('').trimEnd()
  const count = nodes.find(node => node.text.includes('questions for you'))
  expect(bar, 'the bar is the state and why alone').toBe('✗ STOPPED · GREEN for t1 was refused 3 times')
  expect([count?.text, count?.props.color], 'the count on its own line, in blue').toEqual(['2 questions for you · type /pb-questions', QUESTION_COLOUR])
})
