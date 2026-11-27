import type { EngineInterface, PluginOptions } from 'claude-code'
import type { Ledger, Unit } from './inputs'
import { openPane } from './pane-open'
import { needsYouLine, stopLine } from '../shared-node/glance.mjs'
import { doneWords } from '../shared-node/end-state.mjs'

const OPENED = { plugin: 'pairingbuddy', key: 'opened' }

// The key of the opened state, for tests. A function declaration returning the literal: the loader rejects OPENED being exported or read beyond $.state calls, so the key is written here too.
export function openedKey() {
  return 'opened'
}

// The run the status line is set for. Repeated on purpose in register.tsx (statusSetAtom); keep the copies in step.
const STATUS_SET = { plugin: 'pairingbuddy', key: 'status-set' }

const SOUND = { asset: 'mod/assets/alert.wav' }

// The softer chime for a question that waits while the run goes on; the stop sound above stays for real stops.
const QUESTION_SOUND = { asset: 'mod/assets/question.wav' }

// Runs one alert effect fire and forget: a sync throw, a non-promise return or a rejection is dropped, so one failed effect never reaches the others. Never waits, since play settles only when the clip ends and the poll holds its lock while it waits on us.
function quietly(effect: () => unknown) {
  try {
    void Promise.resolve(effect()).catch(() => {})
  } catch {
    // A failed alert effect is dropped.
  }
}

// What the alert reads: the live ledger, or with none, the run whose end left nothing to do (done: its id, else null).
type Event = { ledger: NonNullable<Ledger> } | { done: string }

// Raises the alert for what the ledger shows, or, with no ledger, for a unit done with nothing left to do (done: the code run's
// id; next: the plan's next unit, which the done notice names). Never throws and never waits for the clip: a failed or slow
// alert must not break or block the poll or a hook.
export async function alertOn($: EngineInterface, ledger: Ledger | null, options: PluginOptions = {}, done: string | null = null, next?: string) {
  const event: Event | null = ledger ? { ledger } : done ? { done } : null
  await clearStaleStatus($, event)
  if (!event) return
  if (!(await anyUnseen($, event))) {
    if (KINDS.every((kind) => standing(event)[kind] === null)) quietly(() => $.state.set(OPENED, false))
    return
  }
  // Read as the alert fires; an absent option means on.
  if (options.alertSound !== false) quietly(() => $.audio.play(SOUND))
  quietly(() => setStatus($, event))
  if (!('ledger' in event)) quietly(() => $.ui.notify(doneWords(next), { title: NOTICE_TITLE }))
  quietly(() => markStatusSet($, event))
  quietly(() => $.state.set(OPENED, false).then(() => openAndRecord($)))
}

// The pane opened for the alert is recorded as mod state, so the band can read it; a pane that did not seat records nothing.
async function openAndRecord($: EngineInterface) {
  const placed = (await openPane($)) as { isPlaced?: boolean; reason?: string } | undefined
  if (placed?.isPlaced) await $.state.set(OPENED, true)
  else quietly(() => $.ui.log(`Details pane waits: ${placed?.reason ?? 'no room for it'}. Show it with /pb or a wider terminal.`))
}

const waitsLine = (reason?: string) => `The Pairing Buddy pane is not shown yet (${reason ?? 'no room for it'}). Type /pb to open it, or /pb-report for the run report.`

// The mod-store key of the run the pane last opened by itself for, per project.
export function startOpenedKey(root: string) {
  return `start-opened:${root}`
}

// Opens the pane, without the keyboard, once per run when the run is first seen, so a run with no question is not watched
// through the band alone. The run is recorded before the open, so a pane closed (with /pb or esc) is never opened again for it (also after
// a reload); a store that fails opens nothing, as reopening every poll would undo that close. A standing stop or question is
// left to the alert, which opens it. Never throws.
export async function openOnRunStart($: EngineInterface, ledger: Ledger | null) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return
  try {
    const key = startOpenedKey(await $.session.root())
    const run = runOf(ledger)
    if ((await $.store.get(key)) === run) return
    await $.store.set(key, run)
    if (ledger.stop || ledger.needsHuman) return
    const placed = (await openPane($)) as { isPlaced?: boolean; reason?: string } | undefined
    // Unasked, the engine places a pane only from 144 columns (110 once asked for); else it waits undrawn, so say how to open it.
    if (!placed?.isPlaced) quietly(() => $.ui.log(waitsLine(placed?.reason)))
  } catch {
    // A failed open is dropped; /pb stays the way in.
  }
}

// The mod-store key of the seen record for a project.
export function seenKey(root: string) {
  return `alert-seen:${root}`
}

const KINDS = ['stop', 'needsHuman', 'done'] as const

type Seen = { run: string; stop: number | null; needsHuman: number | null; done?: string | null }

// The ledger's own runId; ledgers without one fall back to the plan and task.
export function runOf(ledger: NonNullable<Ledger>) {
  return ledger.runId ?? `${ledger.plan?.path ?? ''}|${ledger.task ?? ''}`
}

// The key a done run's alert and status line are kept under, apart from the run's own stop or question.
const doneRun = (done: string) => `done:${done}`
const runOfEvent = (event: Event) => ('ledger' in event ? runOf(event.ledger) : doneRun(event.done))

// What stands now: the run and the seq of each standing event, or the done run.
function standing(event: Event): Seen {
  if (!('ledger' in event)) return { run: doneRun(event.done), stop: null, needsHuman: null, done: event.done }
  const { ledger } = event
  return { run: runOf(ledger), stop: ledger.stop?.seq ?? null, needsHuman: ledger.needsHuman?.seq ?? null, done: null }
}

// An event is new when it stands now and the seen record is of another run or holds another seq for it.
function hasNew(now: Seen, seen: Seen | undefined) {
  return KINDS.some((kind) => (now[kind] ?? null) !== null && (seen?.run !== now.run || seen[kind] !== now[kind]))
}

// One record per project, overwritten as events arrive, in the mod's store so it survives a reload. A store that fails reads as unseen, so the alert still fires.
async function anyUnseen($: EngineInterface, event: Event) {
  const now = standing(event)
  if (KINDS.every((kind) => (now[kind] ?? null) === null)) return false
  try {
    const key = seenKey(await $.session.root())
    const unseen = hasNew(now, (await $.store.get(key)) as Seen | undefined)
    if (unseen) await $.store.set(key, now)
    return unseen
  } catch {
    return true
  }
}

// Claude Code draws every plugin status line as a warning ("⚠ pairingbuddy: …", in the warning colour), and $.ui.status takes no
// mark or colour. That fits a question or a stop; done gets no status line and says so through a native notice instead.
const NOTICE_TITLE = 'Pairing Buddy'

function statusWords(event: Event) {
  if (!('ledger' in event)) return null
  const { ledger } = event
  if (ledger.stop) return stopLine(ledger.stop)
  const gate = ledger.needsHuman?.gate
  return gate ? needsYouLine(gate) : null
}

// The status line words the stop as the pane and band do.
function setStatus($: EngineInterface, event: Event) {
  const words = statusWords(event)
  if (words) return $.ui.status(words)
}

// Clears the status line once, when it is set and its cause is gone: the ledger is gone (a done run sets no line), a new run began, or nothing is pending and no stop stands. A line never set is never cleared. The run it was set for is kept in mod state, which a new session starts without.
async function clearStaleStatus($: EngineInterface, event: Event | null) {
  try {
    const setFor = (await $.state.get(STATUS_SET)).value
    if (!setFor) return
    if (event && runOfEvent(event) === setFor && statusWords(event)) return
    await $.state.set(STATUS_SET, null)
    quietly(() => $.ui.status(undefined))
  } catch {
    // A failed clear is dropped.
  }
}

// Records the run the status line was set for.
async function markStatusSet($: EngineInterface, event: Event) {
  if (statusWords(event)) await $.state.set(STATUS_SET, runOfEvent(event))
}

// The mod-store key of how many questions for you a unit has been noticed for, per project.
export function questionsSeenKey(root: string) {
  return `questions-seen:${root}`
}

// How many quiet notices one poll sends at most; the rest are counted in the last one.
const NOTICES_PER_POLL = 3

const noticeText = (text: string) => `Question for you: ${text.replace(/\s+/g, ' ').trim()} · /pb-questions`

// The third alert level: the run goes on, and has questions for you when you have time. Each question the unit gains gets
// one notice, never repeated, and a poll that found any plays the soft question chime once; no status line and no pane
// opened, which stay for real stops. The count noticed is kept per unit in the mod's store, so a reload does not repeat
// them. Never throws.
export async function noticeNewQuestions($: EngineInterface, unit: Unit | null, options: PluginOptions = {}) {
  try {
    if (!unit?.asked) return
    const key = questionsSeenKey(await $.session.root())
    const seen = (await $.store.get(key)) as { unit: string; count: number } | undefined
    const from = seen?.unit === unit.key ? seen.count : 0
    const { count, texts } = unit.asked
    if (count <= from) return
    await $.store.set(key, { unit: unit.key, count })
    const fresh = Array.from({ length: count - from }, (_, i) => texts[from + i] ?? null)
    const shown = fresh.slice(0, NOTICES_PER_POLL)
    const rest = fresh.length - shown.length
    if (options.alertSound !== false && options.questionSound !== false) quietly(() => $.audio.play(QUESTION_SOUND))
    shown.forEach((text, i) => {
      const more = i === shown.length - 1 && rest > 0 ? ` (+${rest} more)` : ''
      quietly(() => $.ui.notify(text === null ? `${count - from} new questions for you · /pb-questions` : `${noticeText(text)}${more}`, { title: NOTICE_TITLE }))
    })
  } catch {
    // A failed notice is dropped; the band still counts the questions.
  }
}
