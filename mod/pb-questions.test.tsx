// Scenario answer-any-time: /pb-questions, one command with no words, opens a menu: answer the open unit's questions for you
// one dialog at a time, or see them all on a page first. An answer is recorded through pb human answer, so the mod itself
// writes nothing outside the reports folder.
import { expect, test } from 'claude-code/testing'
import { setupReplay } from './testing/replay'
import { ROOT, start } from './testing/band'
import { recordReportCalls } from './testing/report'
import { REPORTS_DIR } from './report'

const UNIT = `${ROOT}/.pairingbuddy/run/unit.json`
const question = (n: number, extra = {}) => ({ gate: 'G:task-end', task: `Task ${n}: t${n}`, step: 'a reviewer', ambiguity: `Doubt ${n}?`, ...extra })
const unitWith = (questions: unknown[]) => JSON.stringify({ unit: 'T1a Solo', plan: 'docs/plan.md', tasks: [], commits: [], questions })

function recordRuns(on: Function, reply: { exitCode: number; stdout?: string; stderr?: string }) {
  const runs: { argv: string[]; cwd?: string }[] = []
  on('process.run', async (_: unknown, e: { argv: string[]; init?: { cwd?: string } }) => {
    runs.push({ argv: e.argv, cwd: e.init?.cwd })
    return { value: { stdout: reply.stdout ?? '', stderr: reply.stderr ?? '', exitCode: reply.exitCode } }
  })
  return runs
}

// The walk: /pb-questions, then Answer them now, asks the open questions one dialog at a time. The test plays the person: each entry of
// `replies` answers one dialog with a label or typed words, and `null` dismisses it (Esc).
function recordWrites(on: Function) {
  const writes: { path: string; text: string }[] = []
  on('fs.write', async (_: unknown, e: { path: string; text: string }) => (writes.push(e), { value: undefined }))
  return writes
}

function playDialogs(rig: { onToolCall?: (e: any) => unknown }, replies: (string | null)[]) {
  const asked: { question: string; header: string; options: string[] }[] = []
  rig.onToolCall = (e: any) => {
    if (e.tool !== 'AskUserQuestion') return undefined
    const [q] = e.questions
    asked.push({ question: q.question, header: q.header, options: q.options.map((o: { label: string }) => o.label) })
    const reply = replies[asked.length - 1]
    if (reply === null || reply === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q.question]: reply } } }
  }
  return asked
}

test('pb-questions stops the walk at once when a question dialog is dismissed with Esc, and records nothing more', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1), question(2), question(3)]))
  recordWrites(on)
  const runs = recordRuns(on, { exitCode: 0, stdout: JSON.stringify({ ok: true, open: 2 }) })
  const asked = playDialogs(rig, ['Answer them now', 'Yes.', null, 'never asked'])
  await start($)

  const result: any = await $.command.run({ command: 'pb-questions', args: '' })

  expect(asked.length, 'the menu, then no dialog after the dismissed one').toBe(3)
  expect(runs.filter(r => r.argv[0] === 'node').map(r => r.argv[4])).toEqual(['1'])
  expect(result?.text).toBe('Pairing Buddy: answered 1 · 2 still open · /pb-questions to come back')
})

test('pb-questions skips a question when told and goes on to the next, leaving the skipped one open', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1), question(2, { answer: 'Done.', answeredAt: 't' }), question(3)]))
  recordWrites(on)
  const runs = recordRuns(on, { exitCode: 0, stdout: JSON.stringify({ ok: true, open: 1 }) })
  const asked = playDialogs(rig, ['Answer them now', 'Skip this one', 'Only on main.'])
  await start($)

  const result: any = await $.command.run({ command: 'pb-questions', args: '' })

  expect(asked.slice(1).map(a => a.header), 'only open questions, counted among themselves').toEqual(['Q 1 of 2', 'Q 2 of 2'])
  expect(runs.filter(r => r.argv[0] === 'node').map(r => r.argv.slice(4))).toEqual([['3', 'Only on main.']])
  expect(result?.text).toBe('Pairing Buddy: answered 1 · 1 still open · /pb-questions to come back')
})

test('pb-questions offers up to two of the reviewer suggested answers first, and records the one chosen as the answer', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1, { options: ['Always draft', 'Draft on main only', 'Never draft'] })]))
  recordWrites(on)
  const runs = recordRuns(on, { exitCode: 0, stdout: JSON.stringify({ ok: true, open: 0 }) })
  const asked = playDialogs(rig, ['Answer them now', 'Draft on main only'])
  await start($)

  await $.command.run({ command: 'pb-questions', args: '' })

  expect(asked[1].options).toEqual(['Always draft', 'Draft on main only', 'Skip this one', 'Stop answering'])
  expect(runs.filter(r => r.argv[0] === 'node').map(r => r.argv.slice(4))).toEqual([['1', 'Draft on main only']])
})

const MENU = ['Answer them now', 'See them all first']

test('pb-questions opens a menu, and Answer them now walks the open questions one dialog at a time', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1), question(2), question(3)]))
  recordWrites(on)
  const runs = recordRuns(on, { exitCode: 0, stdout: JSON.stringify({ ok: true, open: 2 }) })
  const asked = playDialogs(rig, ['Answer them now', 'Drafts, always.', 'Stop answering'])
  await start($)

  const result: any = await $.command.run({ command: 'pb-questions', args: '' })

  expect(asked[0], 'the menu').toEqual({ question: '3 questions for you. Answer them now (one at a time, stop whenever you like), or see them all first on a page?', header: 'Questions', options: MENU })
  expect(asked.slice(1).map(a => a.header)).toEqual(['Q 1 of 3', 'Q 2 of 3'])
  expect(asked[1].question, 'each question ends by saying how to answer it').toBe('Task 1: t1 · a reviewer:\nDoubt 1?\n\nTo answer, pick a suggestion or choose "Type something" and write your answer. "Skip this one" leaves it for later; "Stop answering" ends here.')
  expect(runs.filter(r => r.argv[0] === 'node').map(r => r.argv.slice(2))).toEqual([['human', 'answer', '1', 'Drafts, always.']])
  expect(result?.text).toBe('Pairing Buddy: answered 1 · 2 still open · /pb-questions to come back')
})

test('pb-questions See them all first writes the questions page, opens it, asks no question, and answers in one line', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1), question(2, { answer: 'Yes.', answeredAt: 't' }), question(3)]))
  const { writes, calls } = recordReportCalls(on)
  const asked = playDialogs(rig, ['See them all first'])
  await start($)

  const result: any = await $.command.run({ command: 'pb-questions', args: '' })

  expect(asked.length, 'only the menu').toBe(1)
  expect(writes.length, 'one page is written').toBe(1)
  const [{ path, text }] = writes
  expect(path, 'under the reports folder, named for the questions').toMatch(new RegExp(`^${ROOT}/${REPORTS_DIR}/\\d{4}-\\d{2}-\\d{2}-\\d{6}-questions\\.html$`))
  expect(text, 'every question in full').toContain('3. Doubt 3?')
  expect(calls.some(c => c.kind === 'run' && c.argv[0] === 'open' && c.argv[1] === path), 'and opens it').toBe(true)
  expect(result?.text).toBe(`Pairing Buddy: 2 questions for you, opened in your browser: ${path} · to answer, type /pb-questions again`)
})

test('pb-questions closed with Esc at the menu records nothing, writes no page, and says so', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1)]))
  const writes = recordWrites(on)
  const runs = recordRuns(on, { exitCode: 0 })
  const asked = playDialogs(rig, [null])
  await start($)

  const result: any = await $.command.run({ command: 'pb-questions', args: '' })

  expect(asked.length).toBe(1)
  expect(runs).toEqual([])
  expect(writes).toEqual([])
  expect(result?.text).toBe('Pairing Buddy: closed. Your 1 question is still open · /pb-questions to come back')
})

test('pb-questions with no questions at all asks nothing and says so', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([]))
  const writes = recordWrites(on)
  const asked = playDialogs(rig, [])
  await start($)

  const result: any = await $.command.run({ command: 'pb-questions', args: '' })

  expect(asked).toEqual([])
  expect(writes).toEqual([])
  expect(result?.text).toBe('Pairing Buddy: no questions for you right now')
})

test('pb-questions with none open but some answered offers to see what was answered, and opens the page on that choice', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1, { answer: 'Yes.', answeredAt: 't' }), question(2, { answer: 'No.', answeredAt: 't' })]))
  const { writes } = recordReportCalls(on)
  const asked = playDialogs(rig, ['See what you answered'])
  await start($)

  const result: any = await $.command.run({ command: 'pb-questions', args: '' })

  expect(asked[0]).toEqual({ question: 'No questions are open. You answered 2.', header: 'Questions', options: ['See what you answered', 'Close'] })
  expect(writes.length).toBe(1)
  expect(result?.text).toBe(`Pairing Buddy: 2 questions you answered, opened in your browser: ${writes[0].path}`)
})

// Under auto mode with a run open, the gate denies the session's own AskUserQuestion. The bottom tool.check stands in for that
// verdict, as the engine folds the PreToolUse hook's deny into it. The menu is this plugin's own dialog, so it still opens.
const GATE_DENY = 'Under auto mode nobody is asked while a run or unit is open: only the question pb gate eval gives reaches the human.'
// The gate is a settings PreToolUse hook: its deny comes in tool.call, before tool.check could ever overrule it.
function gateDeniesQuestions(on: Function) {
  on('classic.PreToolUse', (_: unknown, e: { tool: string }, next: Function) => (e.tool === 'AskUserQuestion' ? { deny: GATE_DENY } : next(e)))
}

test('pb-questions opens its menu and walks the questions even where the gate denies the session its own questions', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1), question(2)]))
  gateDeniesQuestions(on)
  recordWrites(on)
  const runs = recordRuns(on, { exitCode: 0, stdout: JSON.stringify({ ok: true, open: 1 }) })
  const asked = playDialogs(rig, ['Answer them now', 'Yes.', 'Stop answering'])
  await start($)

  const result: any = await $.command.run({ command: 'pb-questions', args: '' })

  expect(asked.map(a => a.header)).toEqual(['Questions', 'Q 1 of 2', 'Q 2 of 2'])
  expect(runs.filter(r => r.argv[0] === 'node').map(r => r.argv[4])).toEqual(['1'])
  expect(result?.text).toBe('Pairing Buddy: answered 1 · 1 still open · /pb-questions to come back')
})

test('the session own question stays denied where the gate denies it: only this plugin dialogs are let through', async ($, on) => {
  setupReplay(on)
  gateDeniesQuestions(on)
  await start($)

  // A deny resolves the call errored, its reason the text.
  const asked: any = await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'tu1', questions: [{ question: 'Go on?', header: 'Go on', options: [] }] })

  expect({ isError: asked.isError, text: asked.text }).toEqual({ isError: true, text: GATE_DENY })
})

test('pb-questions opens the page instead when its dialog cannot open, and says so, rather than reading it as Esc', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1), question(2)]))
  const { writes } = recordReportCalls(on)
  rig.onToolCall = (e: any) => (e.tool === 'AskUserQuestion' ? { deny: 'no one to ask in a -p run' } : undefined)
  await start($)

  const result: any = await $.command.run({ command: 'pb-questions', args: '' })

  expect(writes.length, 'the questions page').toBe(1)
  expect(result?.text).toBe(`Pairing Buddy: couldn't open the dialog (no answer (no one to ask in a -p run)); opened the page instead: ${writes[0].path}`)
})

test('pb-questions with words that say answer goes straight to the questions, skipping the menu', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1)]))
  recordWrites(on)
  recordRuns(on, { exitCode: 0, stdout: JSON.stringify({ ok: true, open: 0 }) })
  const asked = playDialogs(rig, ['Stop answering'])
  await start($)

  await $.command.run({ command: 'pb-questions', args: 'Answer now' })

  expect(asked.map(a => a.header)).toEqual(['Q 1 of 1'])
})

test('pb-questions with words that say see all opens the page, skipping the menu', async ($, on) => {
  const rig = setupReplay(on)
  rig.served.set(UNIT, unitWith([question(1)]))
  const { writes } = recordReportCalls(on)
  const asked = playDialogs(rig, [])
  await start($)

  await $.command.run({ command: 'pb-questions', args: 'see all' })

  expect({ dialogs: asked.length, pages: writes.length }).toEqual({ dialogs: 0, pages: 1 })
})
