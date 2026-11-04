import { STOP_CODES } from '../../shared-node/stop-codes.mjs'
import type { EngineInterface } from 'claude-code'
import { alertOn } from '../alert'
import { PLACED, ROOT, SNAPSHOT_RUNNING, engine } from './band'
import { POLL_MS } from '../poll'

// Shared by the alert tests. It lives outside the `*.test.tsx` pattern, so `claude plugin test` does not run it.

// The top-level runId `pb run open` writes; absent unless a test names one, so older tests keep the ledger they had.
const withRun = (runId?: string) => (runId === undefined ? {} : { runId })

// A running ledger that has stopped: the stop carries its own seq, which is part of the event's identity.
// `seq` is the ledger's seq, which only moves forward. `eventSeq` is the stop's own seq and defaults to `seq`;
// pass it to show an older stop again in a later ledger.
// The code must be one the CLI can write (STOP_CODES), so a test cannot build a ledger that never occurs.
// A test of the unknown-code fallback opts in explicitly with `unknownCode`, which replaces `code`.
// A test of a stop from an older ledger, which wrote no code, opts in with `noCode: true`, which omits the field.
export const stopped = (options: { seq?: number; eventSeq?: number; code?: string; reason?: string; unknownCode?: string; noCode?: boolean; runId?: string } = {}) => {
  const { seq = 3, eventSeq = seq, code = 'step-failed', reason = 'the stage failed three times', unknownCode, noCode = false, runId } = options
  if (noCode && (unknownCode !== undefined || options.code !== undefined)) {
    throw new Error(`stopped(): { noCode: true } omits the code, so it cannot be combined with code or unknownCode.`)
  }
  if (!noCode && unknownCode === undefined && !STOP_CODES.includes(code)) {
    throw new Error(`stopped(): '${code}' is not a stop code the CLI can write (${STOP_CODES.join(', ')}). Pass { unknownCode: '${code}' } if the test needs an unknown code.`)
  }
  const stop = { reason, seq: eventSeq, ...(noCode ? {} : { code: unknownCode ?? code }) }
  return { ...SNAPSHOT_RUNNING, ...withRun(runId), seq, stop }
}

// A running ledger that waits for a human at a gate. `eventSeq` works as in stopped().
export const needingHuman = ({ seq = 3, eventSeq = seq, gate = 'G:task-end', reason = 'the human decides', runId }: { seq?: number; eventSeq?: number; gate?: string; reason?: string; runId?: string } = {}) => ({
  ...SNAPSHOT_RUNNING,
  ...withRun(runId),
  seq,
  needsHuman: { gate, reason, seq: eventSeq },
})

// A running ledger with nothing stopped and nobody awaited: the stop or the wait has cleared.
export const cleared = ({ seq = 4 } = {}) => ({ ...SNAPSHOT_RUNNING, seq })

// How the engine answers a request. The kit takes one handler per action, so a test picks the answer here
// and the rig registers it once: 'ok' (the default), 'reject' (a rejected promise), 'throw' (a synchronous
// throw), or its own responder. `ui.open` also takes 'not-placed': the pane could not be seated.
export type Answer = 'ok' | 'reject' | 'throw' | 'not-placed' | ((request: any) => unknown)

function responder(answer: Answer, ok: (request: any) => unknown): (request: any) => unknown {
  if (typeof answer === 'function') return answer
  if (answer === 'reject') return async () => { throw new Error('the engine rejected the request') }
  if (answer === 'throw') return () => { throw new Error('the engine failed the request') }
  if (answer === 'not-placed') return () => ({ value: { isPlaced: false } })
  return ok
}

// One answer for every store action, or an answer per action (the others succeed): { get: 'reject' } fails only reads.
type StoreAnswers = Answer | { get?: Answer; set?: Answer }
type AlertAnswers = { ledger?: unknown; seen?: Map<string, unknown>; play?: Answer; store?: StoreAnswers; open?: Answer }

// A Map-backed fake of only the parts of the engine alertOn reaches for (session.root, store.get/set, state.set,
// audio.play, ui.status, ui.open), recording what it was asked to play and show. The one cast is why this is not a
// second rig engine: the fake is only as wide as alertOn.
export function alertOnlyEngine() {
  const store = new Map<string, unknown>()
  const played: unknown[] = []
  const statuses: unknown[] = []
  const engine = {
    session: { root: async () => ROOT },
    store: { get: async (key: string) => store.get(key), set: async (key: string, value: unknown) => void store.set(key, value) },
    state: { set: async () => {} },
    audio: { play: async (sound: unknown) => void played.push(sound) },
    ui: { status: async (line: unknown) => void statuses.push(line), open: async () => ({ isPlaced: true }) },
  } as unknown as EngineInterface
  return { engine, store, played, statuses }
}

// The store an earlier session left behind: runs the real alertOn against alertOnlyEngine, so the record has the shape alertOn writes.
// Pass the result as `seen` to alertEngine.
export async function seenInEarlierSession(ledger: Parameters<typeof alertOn>[1]) {
  const earlier = alertOnlyEngine()
  await alertOn(earlier.engine, ledger)
  return earlier.store
}

// The engine beneath the mod (band.tsx's `engine`), plus what the alert reaches for: the sound it plays and
// the mod's own store, kept in memory. Every answer defaults to success. Registered before `$` is first touched.
// Every recorded request to the engine is under `calls`: opened, closed, registered, played, status and toasted.
export function alertEngine(on: Function, { ledger = SNAPSHOT_RUNNING, seen, play = 'ok', store: storing = 'ok', open = 'ok' }: AlertAnswers = {}) {
  const base = engine(on, ledger, responder(open, PLACED))
  const calls = { ...base.calls, played: [] as any[], status: [] as any[], toasted: [] as any[] }
  const store = new Map<string, unknown>(seen)
  const stored = (action: 'get' | 'set' | 'delete' | 'keys', ok: (request: any) => unknown) =>
    responder(typeof storing === 'object' ? (storing as Record<string, Answer | undefined>)[action] ?? 'ok' : storing, ok)
  on('audio.play', (_: unknown, e: any) => {
    calls.played.push(e)
    return responder(play, () => ({ value: undefined }))(e)
  })
  on('ui.toast', (_: unknown, e: any) => {
    calls.toasted.push(e)
    return { value: undefined }
  })
  on('ui.status', (_: unknown, e: any) => {
    calls.status.push(e)
    return { value: undefined }
  })
  on('store.get', (_: unknown, e: { key: string }) => stored('get', () => ({ value: store.get(e.key) }))(e))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) =>
    stored('set', () => {
      store.set(e.key, e.value)
      return { value: undefined }
    })(e))
  on('store.delete', (_: unknown, e: { key: string }) =>
    stored('delete', () => {
      store.delete(e.key)
      return { value: undefined }
    })(e))
  on('store.keys', (_: unknown, e: unknown) => stored('keys', () => ({ value: [...store.keys()] }))(e))
  return { ...base, calls, store }
}

// The same stop seen over four polls, then a new stop (seq 5, commit-failed) and one more poll.
// `count` reads the calls the test is about (for example `() => run.calls.played.length`), taken after the four polls and at the end.
// The run must already be started and answering with the engine under test; this serves the first stop itself.
export async function sameEventPolledThenNewEvent(
  run: { serve: (ledger: any) => unknown },
  clock: { advance: (ms: number) => Promise<unknown> },
  count: () => number,
): Promise<{ forFirstEvent: number; total: number }> {
  run.serve(stopped({ code: 'step-failed' }))
  for (let poll = 0; poll < 4; poll++) await clock.advance(POLL_MS)
  const forFirstEvent = count()
  run.serve(stopped({ seq: 5, code: 'commit-failed' }))
  await clock.advance(POLL_MS)
  return { forFirstEvent, total: count() }
}
