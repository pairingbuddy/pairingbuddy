import { expect, mock } from 'claude-code/testing'
import { POLL_MS } from '../poll'
import { engine, SNAPSHOT_RUNNING, start, texts } from './band'
import { findOnPane, PANE } from './replay'
import { recordOther, recordWrite } from './refuse'

// Shared by the open-report tests. It lives outside the `*.test.tsx` pattern, so `claude plugin test` does not run it.

// The pane's report button is found by this key, as the dismiss button is found by 'dismiss'.
export const REPORT_KEY = 'report'

// The label the button reads: the key hint, then the action (R5-5).
export const REPORT_LABEL = 'r open report'

// Looks up the open-report button on the terminal pane. The text is undefined when the pane draws none.
export async function reportButton($: any): Promise<{ text: string | undefined } | undefined> {
  const button = await findOnPane($, { type: 'Button', key: REPORT_KEY })
  return button === undefined ? undefined : { text: button.text as string | undefined }
}

// The pane's confirmation after the report is written and opened: the file name, not the full path.
export const REPORT_OPENED = 'opened in your browser'
export const reportConfirmation = (fileName: string) => `wrote ${fileName} · ${REPORT_OPENED}`

// Asserts the press wrote exactly one file and returns its base name, the part the pane's lines carry.
export function writtenFileName(writes: { path: string }[], message: string): string {
  expect(writes.length, message).toBe(1)
  return writes[0].path.split('/').pop() as string
}

// The pane's failure lines: the write failed, or the file was written but the open did not work (rejected or exited non-zero).
export const reportWriteFailure = "couldn't write the report"
export const reportOpenFailure = (fileName: string) => `wrote ${fileName} · couldn't open it`

// Mounts the terminal pane, collects its texts and unmounts.
export async function paneTexts($: any): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = await texts(pane)
  await pane.unmount()
  return drawn
}

// The slug the report file name carries for SNAPSHOT_RUNNING.task ('Fix this bug in discount.py: ...').
export const REPORT_SLUG = 'fix-this-bug'

// Registers fs.write, process.run and process.spawn for a press of the report button and records what they were asked.
// An allowed write lands in `files`, a refused one in `touched` and throws; every other world-changing call lands in `touched`; a failing write or run answers an error.
export function recordReportCalls(on: Function, { failWrite = false, failRun = false, exitCode = 0 } = {}) {
  const writes: { path: string; text: string }[] = []
  const touched: string[] = []
  const files = new Map<string, string>()
  // One log in call order, so a test can tell a run that follows the write from one that precedes it.
  const calls: ({ kind: 'write'; path: string } | { kind: 'run'; argv: string[] })[] = []
  on('fs.write', async (_: unknown, e: { path: string; text: string }) => {
    writes.push(e)
    calls.push({ kind: 'write', path: e.path })
    // A refused write is a thrown error, as refuseWorldChanges refuses it.
    if (!recordWrite(files, touched, '', e.path, e.text)) throw new Error('the mod is read-only')
    // The engine accepts only { value } or { deny }; a rejection is a thrown error.
    if (failWrite) throw new Error('the write failed')
    return { value: undefined }
  })
  on('process.run', async (_: unknown, e: { argv: string[] }) => {
    calls.push({ kind: 'run', argv: e.argv })
    recordOther(touched, '', `process.run ${e.argv.join(' ')}`)
    if (failRun) throw new Error('the run failed')
    return { value: { stdout: '', stderr: '', exitCode } }
  })
  on('process.spawn', async function* (_: unknown, e: { argv: string[] }) {
    recordOther(touched, '', `process.spawn ${e.argv.join(' ')}`)
    return { value: undefined } as never
  })
  return { writes, touched, calls, files }
}

// Starts the engine on a mock clock, mounts the terminal pane, presses the report button and unmounts.
// Returns the recorder plus the engine's serve and the mock clock, so a test keeps only its own assertions.
export async function pressReportButton($: any, on: Function, { now = Date.parse('2026-11-03T06:40:00Z'), ledger = SNAPSHOT_RUNNING as unknown, ...failure } = {}) {
  const { serve } = engine(on, ledger)
  const clock = mock.clock(on, { now })
  const recorder = recordReportCalls(on, failure)
  await start($)
  await clock.advance(POLL_MS)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  await pane.unmount()
  return { ...recorder, serve, clock }
}
