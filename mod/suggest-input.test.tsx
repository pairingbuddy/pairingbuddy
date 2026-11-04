// Scenario suggest-input: the 's suggest' input appends a task-scoped note to human-guidance.json.
// Runs under `claude plugin test .`.
import { expect, mock, test } from 'claude-code/testing'
import { engine, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'
import { expectNotSavedNote, GUIDANCE_PATH, SUGGEST_LABEL, suggestInput, typeSuggestion, writtenGuidance } from './testing/suggest'

test('pane-shows-suggest-input', async ($, on) => {
  const { serve } = engine(on)
  const clock = mock.clock(on, { now: 0 })
  await start($)
  const withLedger = await suggestInput($)
  serve(null)
  await clock.advance(POLL_MS)

  const idle = await suggestInput($)

  expect(withLedger?.label, 'with a run the pane holds the suggest input').toBe(SUGGEST_LABEL)
  expect(idle, 'with no run the idle pane holds no suggest input').toBeUndefined()
})

test('suggest-appends-marked-entry', async ($, on) => {
  const typed = 'Prefer a table of cases over one test per input'

  const { writes } = await typeSuggestion($, on, { text: typed })

  const written = writtenGuidance(writes)
  const entry = written.guidance[written.guidance.length - 1]
  expect(written.guidance.length, 'the new entry is appended to the one already there').toBe(2)
  expect(entry.feedback, 'the typed text is the feedback').toBe(typed)
  expect(new Date(entry.timestamp).toISOString(), 'the timestamp is ISO 8601').toBe(entry.timestamp)
  expect(entry.context, 'the context names the current task or step').toBe(SNAPSHOT_RUNNING.task)
  expect(entry.task_scoped, 'the entry carries the task-scoped marking').toBe(true)
})

test('suggest-keeps-existing-entries', async ($, on) => {
  const existing = [
    { agent: 'curate-guidance', timestamp: '2026-01-09T21:20:00Z', context: 'carried over from previous session', feedback: 'Structural tests run over the config files.', persistent: true },
    { agent: 'implement-tests', timestamp: '2026-11-03T10:05:00Z', context: 'Task 57', feedback: 'Name the test after the behaviour.', persistent: false },
    { agent: 'orchestrator', timestamp: '2026-11-03T12:30:00Z', context: 'test language', feedback: 'Use node:test only.', persistent: true },
    { agent: 'orchestrator', timestamp: '2026-11-04T08:00:00Z', context: 'Task 58a', feedback: 'Keep the report self-contained.' },
  ]
  const typed = 'Prefer a table of cases over one test per input'

  const { writes } = await typeSuggestion($, on, { text: typed, guidance: { guidance: existing } })

  const written = writtenGuidance(writes).guidance
  expect(written.slice(0, -1), 'the existing entries are kept exactly, persistent ones included').toEqual(existing)
  expect(written[written.length - 1].feedback, 'the new entry is last').toBe(typed)
})

test('suggest-creates-missing-file', async ($, on) => {
  const typed = 'Prefer a table of cases over one test per input'
  const { writes } = await typeSuggestion($, on, { text: typed, guidance: null })

  const written = writtenGuidance(writes)
  expect(written, 'the file is created holding exactly the one new entry').toEqual({
    guidance: [{
      agent: 'orchestrator',
      timestamp: expect.any(String),
      context: SNAPSHOT_RUNNING.task,
      feedback: typed,
      task_scoped: true,
    }],
  })
})

const BLANK_TEXTS = [
  { name: 'empty', text: '' },
  { name: 'whitespace-only', text: '  \n\t ' },
]

for (const { name, text } of BLANK_TEXTS) {
  test(`suggest-ignores-blank-text (${name})`, async ($, on) => {
    const { writes } = await typeSuggestion($, on, { text })

    expect(writes, `a ${name} submission writes nothing`).toEqual([])
  })
}

test('suggest-writes-only-guidance-file', async ($, on) => {
  const { writes, touched, files } = await typeSuggestion($, on, { text: 'Prefer a table of cases over one test per input' })

  expect(writes.map((w) => w.path), 'the one write is to human-guidance.json').toEqual([GUIDANCE_PATH])
  expect([...files.keys()], 'the write is applied').toEqual([GUIDANCE_PATH])
  expect(touched, 'no refused write and no process call').toEqual([])
})

const UNREADABLE_GUIDANCE = [
  { name: 'corrupt JSON', served: '{ "guidance": [ {oops', unreadable: false },
  { name: 'not an object', served: '"just a string"', unreadable: false },
  { name: 'read throws', served: '{"guidance": []}', unreadable: true },
]

for (const { name, served, unreadable } of UNREADABLE_GUIDANCE) {
  test(`suggest-corrupt-guidance-file-not-replaced (${name})`, async ($, on) => {
    const { writes } = await typeSuggestion($, on, { text: 'Prefer a table of cases over one test per input', guidanceText: served, unreadable })

    expect(writes, `a ${name} guidance file is left untouched`).toEqual([])
    await expectNotSavedNote($)
  })
}

test('suggest-failed-write-shows-not-saved-note', async ($, on) => {
  const { writes } = await typeSuggestion($, on, { text: 'Prefer a table of cases over one test per input', unwritable: true })

  expect(writes.map((w) => w.path), 'the save was attempted once, on the guidance file').toEqual([GUIDANCE_PATH])
  await expectNotSavedNote($)
})

test('with only the snapshot and no live ledger the suggest input is not drawn, and with a live ledger it still is', async ($, on) => {
  const { serve } = engine(on)
  const clock = mock.clock(on, { now: 0 })
  await start($)
  const live = await suggestInput($)
  serve(null)
  await clock.advance(POLL_MS)

  const ended = await suggestInput($)

  expect(live?.label, 'with a live ledger the pane holds the suggest input').toBe(SUGGEST_LABEL)
  expect(ended, 'once the run has ended, the snapshot shows no suggest input').toBeUndefined()
})
