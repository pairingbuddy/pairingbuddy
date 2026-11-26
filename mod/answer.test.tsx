// Scenario answer-any-time: /pb-answer lists the open unit's questions for you, numbered as pb numbers them, and records
// an answer through pb human answer, so the mod itself writes nothing outside the reports folder.
import { expect, test } from 'claude-code/testing'
import { setupReplay } from './testing/replay'
import { ROOT, start } from './testing/band'

const UNIT = `${ROOT}/.pairingbuddy/run/unit.json`
const question = (n: number, extra = {}) => ({ gate: 'G:task-end', task: `Task ${n}: t${n}`, step: 'a reviewer', ambiguity: `Doubt ${n}?`, ...extra })
const unitWith = (questions: unknown[]) => JSON.stringify({ unit: 'T1a Solo', plan: 'docs/plan.md', tasks: [], commits: [], questions })

test('pb-answer with no words lists the open questions by their numbers and says how to answer', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1), question(2, { answer: 'Yes.', answeredAt: 't' }), question(3)]))
  await start($)

  const result: any = await $.command.run({ command: 'pb-answer', args: '' })

  expect(result?.text).toBe([
    'Pairing Buddy: 2 questions for you, 1 already answered',
    '1. (Task 1: t1) Doubt 1?',
    '3. (Task 3: t3) Doubt 3?',
    'Answer with /pb-answer <number> <your answer>. Your answer reaches the next step that starts.',
  ].join('\n'))
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
