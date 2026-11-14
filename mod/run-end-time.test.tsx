// Scenario report-run-time-after-run-ends (placeholders). The mod poller records ended-at when the ledger disappears,
// and the report shows the same run time as the ended pane. Runs under `claude plugin test .`.
import { expect, mock, test } from 'claude-code/testing'
import { POLL_MS } from './poll'
import { engine, SNAPSHOT_RUNNING, start } from './testing/band'
import { PANE, paneLines } from './testing/replay'
import { recordReportCalls, REPORT_KEY } from './testing/report'

test('poller-records-ended-at-when-ledger-disappears', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-04T10:00:00.000Z') })
  const run = engine(on)
  on('audio.play', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  const kept = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: kept.get(e.key) ?? null, version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => (kept.set(e.key, e.value), { value: { isSet: true, version: 1 } }))
  await start($)
  await clock.advance(POLL_MS)
  run.serve(null)

  await clock.advance(POLL_MS)

  const endedAt = kept.get('ended-at')
  expect(typeof endedAt, 'ended-at holds a string once the ledger is gone').toBe('string')
  expect(Number.isNaN(Date.parse(endedAt as string)), 'ended-at is a valid ISO timestamp').toBe(false)
  expect(endedAt, 'ended-at is the mock clock time of the poll that saw the ledger gone').toBe(new Date(Date.parse('2026-11-04T10:00:00.000Z') + POLL_MS * 2).toISOString())
})

test('report-after-run-end-shows-same-run-time-as-pane', async ($, on) => {
  const runStart = '2026-11-04T09:58:00.000Z'
  const ledger = { ...SNAPSHOT_RUNNING, stages: [{ name: 'code-scenarios', status: 'done', attempt: 1, startedAt: runStart }] }
  const clock = mock.clock(on, { now: Date.parse('2026-11-04T10:00:00.000Z') })
  const run = engine(on, ledger)
  on('audio.play', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  const kept = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: kept.get(e.key) ?? null, version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => (kept.set(e.key, e.value), { value: { isSet: true, version: 1 } }))
  const { writes } = recordReportCalls(on)
  await start($)
  await clock.advance(POLL_MS)
  run.serve(null)
  await clock.advance(POLL_MS)
  const spentLine = (await paneLines($)).find((text) => text.startsWith('SPENT'))
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  await pane.unmount()

  expect(writes.length, 'pressing the report button after the run ended writes one report').toBe(1)
  const html = writes[0].text
  const time = /\d+:\d{2}(?::\d{2})?/
  const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? ''
  const glanceSpent = html.match(/Spent[\s\S]*?<\/(?:li|tr|p|div)>/)?.[0] ?? ''
  const paneTime = spentLine?.match(time)?.[0]
  expect(paneTime, `the ended pane shows a run time in SPENT: ${spentLine}`).toBeDefined()
  expect(html, 'the report never says the time is unknown').not.toContain('time unknown')
  expect(header.match(time)?.[0], 'the report header shows the same run time as the ended pane').toBe(paneTime)
  expect(glanceSpent.match(time)?.[0], `the AT A GLANCE Spent shows the same run time as the ended pane: ${glanceSpent}`).toBe(paneTime)
})

test('ended-at-is-written-once-per-run', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-04T10:00:00.000Z') })
  const run = engine(on)
  on('audio.play', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  const kept = new Map<string, unknown>()
  const endedAtWrites: unknown[] = []
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: kept.get(e.key) ?? null, version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    if (e.key === 'ended-at' && e.value !== null) endedAtWrites.push(e.value)
    kept.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } }
  })
  await start($)
  await clock.advance(POLL_MS)
  run.serve(null)
  await clock.advance(POLL_MS)
  const firstEndedAt = kept.get('ended-at')

  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)

  expect(firstEndedAt, 'ended-at was recorded by the first poll that saw the ledger gone').toBeDefined()
  expect(kept.get('ended-at'), 'further polls with the ledger still gone leave ended-at unchanged').toBe(firstEndedAt)
  expect(endedAtWrites.length, 'ended-at is stamped exactly once while the ledger stays gone').toBe(1)
})

test('new-run-clears-ended-at', async ($, on) => {
  const firstStart = '2026-11-04T09:58:00.000Z'
  const secondStart = '2026-11-04T10:00:03.000Z'
  const firstRun = { ...SNAPSHOT_RUNNING, stages: [{ name: 'code-scenarios', status: 'done', attempt: 1, startedAt: firstStart }] }
  const secondRun = { ...SNAPSHOT_RUNNING, stages: [{ name: 'code-scenarios', status: 'active', attempt: 1, startedAt: secondStart }] }
  const clock = mock.clock(on, { now: Date.parse('2026-11-04T10:00:00.000Z') })
  const run = engine(on, firstRun)
  on('audio.play', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  const kept = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: kept.get(e.key) ?? null, version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => (kept.set(e.key, e.value), { value: { isSet: true, version: 1 } }))
  const { writes } = recordReportCalls(on)
  await start($)
  await clock.advance(POLL_MS)
  run.serve(null)
  await clock.advance(POLL_MS)
  const oldEndedAt = kept.get('ended-at')
  run.serve(secondRun)

  await clock.advance(POLL_MS)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  await pane.unmount()

  expect(typeof oldEndedAt, 'the first run recorded an end time').toBe('string')
  expect(kept.get('ended-at'), 'a new ledger clears ended-at').toBeNull()
  expect(writes.length, 'pressing the report button during the live run writes one report').toBe(1)
  const html = writes[0].text
  expect(html, 'the live report does not use the old end time').not.toContain(oldEndedAt as string)
  expect(html, 'the live report is of the running run').toContain('RUNNING')
})

test('report-without-recorded-end-stays-unknown', async ($, on) => {
  const runStart = '2026-11-04T09:58:00.000Z'
  const ledger = { ...SNAPSHOT_RUNNING, stages: [{ name: 'code-scenarios', status: 'done', attempt: 1, startedAt: runStart }] }
  const clock = mock.clock(on, { now: Date.parse('2026-11-04T10:00:00.000Z') })
  const run = engine(on, ledger)
  on('audio.play', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  const kept = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: kept.get(e.key) ?? null, version: 1 } }))
  // No poll managed to record the end: every ended-at write that carries a time is lost.
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    if (e.key !== 'ended-at' || e.value === null) kept.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } }
  })
  const { writes } = recordReportCalls(on)
  await start($)
  await clock.advance(POLL_MS)
  run.serve(null)
  await clock.advance(POLL_MS)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  await pane.unmount()

  expect(kept.get('ended-at') ?? null, 'no end time was recorded').toBeNull()
  expect(writes.length, 'pressing the report button writes one report').toBe(1)
  const html = writes[0].text
  expect(html, 'the report says the run time is unknown').toContain('time unknown')
  expect(html, 'the report does not invent an end time from the clock').not.toContain('2:02')
})
