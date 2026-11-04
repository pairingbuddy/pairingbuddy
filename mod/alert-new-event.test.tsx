// Scenario: new-event-alerts-again. Event identity (kind + seq, per run) decides what counts as new.
import { expect, mock, test } from 'claude-code/testing'
import { LEDGER_PATH, start } from './testing/band'
import { alertEngine, cleared, needingHuman, seenInEarlierSession, stopped } from './testing/alert'
import { dismissPane } from './testing/replay'
import { PANE_ID } from './pane-open'
import { POLL_MS } from './poll'

test('new-stop-after-cleared-stop-alerts', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ seq: 3 }))
  await clock.advance(POLL_MS)
  run.serve(cleared({ seq: 4 }))
  await clock.advance(POLL_MS)
  run.serve(stopped({ seq: 5 }))
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the first stop and the new stop each play a sound').toBe(2)
  expect(run.calls.status.filter((c) => c.text !== undefined).length, 'the first stop and the new stop each set a status line').toBe(2)
  expect(run.calls.status.some((c) => c.text === undefined), 'the status line was cleared when the stop went away').toBe(true)
  expect(run.calls.opened.length, 'the first stop and the new stop each open the pane').toBe(2)
})

test('stop-then-different-stop-alerts', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ seq: 3 }))
  await clock.advance(POLL_MS)
  run.serve(stopped({ seq: 5, code: 'agent-budget', reason: 'the stage spawned its maxAgents' }))
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the first stop and the different stop each play a sound').toBe(2)
  expect(run.calls.status.length, 'the first stop and the different stop each set a status line').toBe(2)
  expect(run.calls.opened.length, 'the first stop and the different stop each open the pane').toBe(2)
})

test('needs-human-then-new-gate-alerts', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(needingHuman({ seq: 3, gate: 'G:scenarios' }))
  await clock.advance(POLL_MS)
  run.serve(needingHuman({ seq: 5, gate: 'G:task-end' }))
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the first wait and the new wait each play a sound').toBe(2)
  expect(run.calls.status.length, 'the first wait and the new wait each set a status line').toBe(2)
  expect(run.calls.opened.length, 'the first wait and the new wait each open the pane').toBe(2)
})

test('stop-then-needs-human-alerts', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ seq: 3 }))
  await clock.advance(POLL_MS)
  run.serve(needingHuman({ seq: 5, gate: 'G:task-end' }))
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the stop and the wait each play a sound').toBe(2)
  expect(run.calls.status.length, 'the stop and the wait each set a status line').toBe(2)
  expect(run.calls.opened.length, 'the stop and the wait each open the pane').toBe(2)
})

test('same-event-after-clear-and-reappear-with-same-seq', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ seq: 3 }))
  await clock.advance(POLL_MS)
  run.serve(cleared({ seq: 4 }))
  await clock.advance(POLL_MS)
  run.serve(stopped({ seq: 5, eventSeq: 3 }))
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the same stop shown again plays no second sound').toBe(1)
  expect(run.calls.status.filter((c) => c.text !== undefined).length, 'the same stop shown again sets no second status line').toBe(1)
  expect(run.calls.status.some((c) => c.text === undefined), 'the status line was cleared when the stop went away').toBe(true)
  expect(run.calls.opened.length, 'the same stop shown again does not open the pane a second time').toBe(1)
})

test('pane-reopens-for-new-event', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ seq: 3 }))
  await clock.advance(POLL_MS)
  await dismissPane($)
  run.serve(stopped({ seq: 5 }))
  await clock.advance(POLL_MS)

  expect(run.calls.closed.map(close => close.id), 'the human closed the pane after the first stop').toEqual([PANE_ID])
  expect(run.calls.opened.map(open => open.id), 'the new stop opens the pane again after the human closed it').toEqual([PANE_ID, PANE_ID])
})

test('seen-event-in-store-never-realerts', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const seen = await seenInEarlierSession(stopped({ seq: 3 }))
  expect(seen.size, 'the earlier session alerted, so its store holds the seen record').toBe(1)

  const run = alertEngine(on, { ledger: stopped({ seq: 3 }), seen })
  await start($)
  await clock.advance(POLL_MS)

  expect(run.served.asked, 'the new session polled the ledger, so the silence below is not from polling nothing').toContain(LEDGER_PATH)
  expect(run.calls.played, 'the standing stop is already in the store: no sound').toEqual([])
  expect(run.calls.status, 'the standing stop is already in the store: no status line').toEqual([])
  expect(run.calls.opened, 'the standing stop is already in the store: the pane stays shut').toEqual([])
})

// Also covers same-run-twice-new-run-id-alerts: the same task run twice, each run opened by `pb run open` with its own runId.
// The two ledgers share the task and the empty plan.path `pb run open` writes, so only the runId tells the runs apart.
test('same-seq-different-run-alerts', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const earlierRun = stopped({ seq: 3, runId: 'run-a' })
  const laterRun = stopped({ seq: 3, runId: 'run-b' })
  const seen = await seenInEarlierSession(earlierRun)
  expect(seen.size, 'the earlier run alerted, so its store holds the seen record').toBe(1)

  const run = alertEngine(on, { ledger: laterRun, seen })
  await start($)
  await clock.advance(POLL_MS)

  expect(run.served.asked, 'the new run polled the ledger, so the result below is not from polling nothing').toContain(LEDGER_PATH)
  expect(run.calls.played.length, 'the same task run again stops at the same kind and seq: it plays a sound').toBe(1)
  expect(run.calls.status.length, 'the re-run stop sets a status line').toBe(1)
  expect(run.calls.opened.length, 'the re-run stop opens the pane').toBe(1)
})

test('stop-and-needs-human-same-seq-both-alert', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ seq: 3 }))
  await clock.advance(POLL_MS)
  run.serve(needingHuman({ seq: 5, eventSeq: 3, gate: 'G:task-end' }))
  await clock.advance(POLL_MS)

  expect(run.calls.played.length, 'the stop and the wait share a seq but are different kinds: each plays a sound').toBe(2)
  expect(run.calls.status.length, 'the stop and the wait each set a status line').toBe(2)
  expect(run.calls.opened.length, 'the stop and the wait each open the pane').toBe(2)
})

test('status-cleared-when-new-run-starts', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = alertEngine(on)
  await start($)

  run.serve(stopped({ runId: 'run-a' }))
  await clock.advance(POLL_MS)
  run.serve({ ...cleared({ seq: 1 }), runId: 'run-b' })
  await clock.advance(POLL_MS)

  expect(run.calls.status.length, 'the stop of run A set the line and the new run cleared it').toBe(2)
  expect(run.calls.status[1].text, 'the new run clears the line with undefined text').toBeUndefined()

  run.serve(needingHuman({ seq: 2, runId: 'run-b' }))
  await clock.advance(POLL_MS)

  expect(run.calls.status.length, 'a gate in run B sets the line again').toBe(3)
  expect(run.calls.status[2].text, 'the new line is set, not cleared').toBeTruthy()
})
