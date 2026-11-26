// Scenario answer-any-time: /pb-answer lists the open unit's questions for you, numbered as pb numbers them, and records
// an answer through pb human answer, so the mod itself writes nothing outside the reports folder.
import { expect, test } from 'claude-code/testing'
import { setupReplay } from './testing/replay'
import { ROOT, start } from './testing/band'
import { recordReportCalls } from './testing/report'
import { REPORTS_DIR } from './report'

const UNIT = `${ROOT}/.pairingbuddy/run/unit.json`
const question = (n: number, extra = {}) => ({ gate: 'G:task-end', task: `Task ${n}: t${n}`, step: 'a reviewer', ambiguity: `Doubt ${n}?`, ...extra })
const unitWith = (questions: unknown[]) => JSON.stringify({ unit: 'T1a Solo', plan: 'docs/plan.md', tasks: [], commits: [], questions })

test('pb-answer with no words writes the questions page, opens it, and answers short: the count, the open questions, how to answer', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1), question(2, { answer: 'Yes.', answeredAt: 't' }), question(3)]))
  const { writes, calls } = recordReportCalls(on)
  await start($)

  const result: any = await $.command.run({ command: 'pb-answer', args: '' })

  expect(writes.length, 'one page is written').toBe(1)
  const [{ path, text }] = writes
  expect(path, 'under the reports folder, named for the questions').toMatch(new RegExp(`^${ROOT}/${REPORTS_DIR}/\\d{4}-\\d{2}-\\d{2}-\\d{6}-questions\\.html$`))
  expect(text, 'every question in full').toContain('3. Doubt 3?')
  expect(calls.some(c => c.kind === 'run' && c.argv[0] === 'open' && c.argv[1] === path), 'and opens it').toBe(true)
  expect(result?.text).toBe([
    `Pairing Buddy: 2 questions for you · opened ${path} in your browser`,
    '1. Doubt 1?',
    '3. Doubt 3?',
    'Answer: /pb-answer <number> <your answer>',
  ].join('\n'))
})

test('pb-answer lists at most three questions in the terminal, each cut to one line, and counts the rest', async ($, on) => {
  const rig = setupReplay(on)
  const long = `${'word '.repeat(40)}end?`
  rig.served.set(UNIT, JSON.stringify({ unit: 'T1a', tasks: [], commits: [], questions: [question(1, { ambiguity: long }), question(2), question(3), question(4)], questionsMore: 2 }))
  recordReportCalls(on)
  await start($)

  const result: any = await $.command.run({ command: 'pb-answer', args: '' })

  const lines = String(result?.text).split('\n')
  expect(lines[0]).toMatch(/^Pairing Buddy: 6 questions for you · opened /)
  expect(lines[1].length, 'cut at a fixed width').toBe(100)
  expect(lines[1].endsWith('…')).toBe(true)
  expect(lines.slice(2)).toEqual(['2. Doubt 2?', '3. Doubt 3?', '+3 more on the page', 'Answer: /pb-answer <number> <your answer>'])
})

function recordRuns(on: Function, reply: { exitCode: number; stdout?: string; stderr?: string }) {
  const runs: { argv: string[]; cwd?: string }[] = []
  on('process.run', async (_: unknown, e: { argv: string[]; init?: { cwd?: string } }) => {
    runs.push({ argv: e.argv, cwd: e.init?.cwd })
    return { value: { stdout: reply.stdout ?? '', stderr: reply.stderr ?? '', exitCode: reply.exitCode } }
  })
  return runs
}

test('pb-answer with a number and words records the answer through pb human answer and says when it takes effect', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1), question(2)]))
  const runs = recordRuns(on, { exitCode: 0, stdout: JSON.stringify({ ok: true, n: 2, open: 1 }) })
  await start($)

  const result: any = await $.command.run({ command: 'pb-answer', args: ' 2  Yes, drafts   always. ' })

  expect(runs.length, 'one pb call').toBe(1)
  const [{ argv, cwd }] = runs
  expect(argv[0]).toBe('node')
  expect(argv[1], 'the plugin own pb').toMatch(/\/cli\/pb\.mjs$/)
  expect(argv.slice(2)).toEqual(['human', 'answer', '2', 'Yes, drafts   always.'])
  expect(cwd, 'run in the project').toBe(ROOT)
  expect(result?.text).toBe('Pairing Buddy: your answer to question 2 is recorded. It reaches the next step that starts; work already done is reworked at the next task if your answer needs it. 1 question still open.')
})

test('pb-answer says plainly what pb refused, and nothing is recorded', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1)]))
  recordRuns(on, { exitCode: 1, stderr: 'pb: there is no question 7 for you: they are numbered 1 to 1. Nothing was recorded.\n' })
  await start($)

  const result: any = await $.command.run({ command: 'pb-answer', args: '7 maybe' })

  expect(result?.text).toBe('Pairing Buddy: not recorded: there is no question 7 for you: they are numbered 1 to 1. Nothing was recorded.')
})

test('pb-answer with words but no number shows how to answer and runs nothing', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1)]))
  const runs = recordRuns(on, { exitCode: 0 })
  await start($)

  const result: any = await $.command.run({ command: 'pb-answer', args: 'yes please' })

  expect(runs).toEqual([])
  expect(result?.text).toBe('Pairing Buddy: start with the question number. Answer with /pb-answer <number> <your answer>. Your answer reaches the next step that starts.')
})
