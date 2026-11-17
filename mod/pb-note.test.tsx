// Scenario pb-note: /pb-note <text> leaves a note for the next agent in human-guidance.json and says where it went.
// Runs under `claude plugin test .`.
import { expect, test } from 'claude-code/testing'
import { engine, SNAPSHOT_RUNNING, start } from './testing/band'
import { NOTE_BLANK, NOTE_NOT_SAVED, NOTE_NO_RUN, NOTE_SAVED } from './suggest'
import { GUIDANCE_PATH, leaveNote, startRunningPane, writtenGuidance } from './testing/suggest'

const TYPED = 'Prefer a table of cases over one test per input'

test('pb-note appends a task-scoped entry and answers in one line where it went', async ($, on) => {
  const { writes } = await startRunningPane($, on, {})

  const result: any = await $.command.run({ command: 'pb-note', args: TYPED })

  const written = writtenGuidance(writes)
  const entry = written.guidance[written.guidance.length - 1]
  expect(written.guidance.length, 'the new entry is appended to the one already there').toBe(2)
  expect(entry.feedback, 'the typed text is the feedback').toBe(TYPED)
  expect(new Date(entry.timestamp).toISOString(), 'the timestamp is ISO 8601').toBe(entry.timestamp)
  expect(entry.context, 'the context names the current task').toBe(SNAPSHOT_RUNNING.task)
  expect(entry.task_scoped, 'the entry carries the task-scoped marking').toBe(true)
  expect(result.text, 'one plain line: where the note went and that the next agent reads it').toBe('Note saved to .pairingbuddy/human-guidance.json. The next agent will read it.')
})

test('pb-note is registered as a command that runs while Claude is working', async ($, on) => {
  const { calls } = engine(on)

  await start($)

  const spec = calls.registered.find(command => command.name === 'pb-note')
  expect(spec?.immediate, 'the pb-note command runs at once, also mid-turn, with no model turn').toBe(true)
})

test('pb-note keeps the entries already there', async ($, on) => {
  const existing = [
    { agent: 'curate-guidance', timestamp: '2026-01-09T21:20:00Z', context: 'carried over from previous session', feedback: 'Structural tests run over the config files.', persistent: true },
    { agent: 'implement-tests', timestamp: '2026-11-03T10:05:00Z', context: 'Task 57', feedback: 'Name the test after the behaviour.', persistent: false },
    { agent: 'orchestrator', timestamp: '2026-11-04T08:00:00Z', context: 'Task 58a', feedback: 'Keep the report self-contained.' },
  ]

  const { writes } = await leaveNote($, on, { text: TYPED, guidance: { guidance: existing } })

  const written = writtenGuidance(writes).guidance
  expect(written.slice(0, -1), 'the existing entries are kept exactly, persistent ones included').toEqual(existing)
  expect(written[written.length - 1].feedback, 'the new entry is last').toBe(TYPED)
})

test('pb-note creates a missing guidance file', async ($, on) => {
  const { writes, answer } = await leaveNote($, on, { text: TYPED, guidance: null })

  expect(writtenGuidance(writes), 'the file is created holding exactly the one new entry').toEqual({
    guidance: [{ agent: 'orchestrator', timestamp: expect.any(String), context: SNAPSHOT_RUNNING.task, feedback: TYPED, task_scoped: true }],
  })
  expect(answer).toBe(NOTE_SAVED)
})

for (const { name, text } of [{ name: 'empty', text: '' }, { name: 'whitespace-only', text: '  \n\t ' }]) {
  test(`pb-note with no text writes nothing and says how to use it (${name})`, async ($, on) => {
    const { writes, answer } = await leaveNote($, on, { text })

    expect(writes, `a ${name} note writes nothing`).toEqual([])
    expect(answer).toBe(NOTE_BLANK)
  })
}

test('pb-note writes only the guidance file', async ($, on) => {
  const { writes, touched, files } = await leaveNote($, on, { text: TYPED })

  expect(writes.map((w) => w.path), 'the one write is to human-guidance.json').toEqual([GUIDANCE_PATH])
  expect([...files.keys()], 'the write is applied').toEqual([GUIDANCE_PATH])
  expect(touched, 'no refused write and no process call').toEqual([])
})

for (const { name, served, unreadable } of [
  { name: 'corrupt JSON', served: '{ "guidance": [ {oops', unreadable: false },
  { name: 'not an object', served: '"just a string"', unreadable: false },
  { name: 'read throws', served: '{"guidance": []}', unreadable: true },
]) {
  test(`pb-note never replaces a guidance file it cannot read (${name})`, async ($, on) => {
    const { writes, answer } = await leaveNote($, on, { text: TYPED, guidanceText: served, unreadable })

    expect(writes, `a ${name} guidance file is left untouched`).toEqual([])
    expect(answer, 'the answer says the note was not saved').toBe(NOTE_NOT_SAVED)
  })
}

test('pb-note says so when the write fails', async ($, on) => {
  const { writes, answer } = await leaveNote($, on, { text: TYPED, unwritable: true })

  expect(writes.map((w) => w.path), 'the save was attempted once, on the guidance file').toEqual([GUIDANCE_PATH])
  expect(answer).toBe(NOTE_NOT_SAVED)
})

test('pb-note with no task running writes nothing and says no agent would read it', async ($, on) => {
  const { writes, answer } = await leaveNote($, on, { text: TYPED, ledger: null })

  expect(writes, 'no note is saved with no run to read it').toEqual([])
  expect(answer).toBe('Note not saved: no Pairing Buddy task is running, so no agent would read it. Start a task first, or add it to .pairingbuddy/human-guidance.json to keep it for every task.')
})
