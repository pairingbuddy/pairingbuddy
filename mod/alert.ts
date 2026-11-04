import type { EngineInterface, PluginOptions } from 'claude-code'
import type { Ledger } from './inputs'
import { openPane } from './pane-open'
import { needsYouLine, stopLine } from '../shared-node/glance.mjs'

const OPENED = { plugin: 'pairingbuddy', key: 'opened' }

// The key of the opened state, for tests. A function declaration returning the literal: the loader rejects OPENED being exported or read beyond $.state calls, so the key is written here too.
export function openedKey() {
  return 'opened'
}

const SOUND = { asset: 'mod/assets/alert.wav' }

// Runs one alert effect fire and forget: a sync throw, a non-promise return or a rejection is dropped, so one failed effect never reaches the others. Never waits, since play settles only when the clip ends and the poll holds its lock while it waits on us.
function quietly(effect: () => unknown) {
  try {
    void Promise.resolve(effect()).catch(() => {})
  } catch {
    // A failed alert effect is dropped.
  }
}

// Raises the alert for what the ledger shows. Never throws and never waits for the clip: a failed or slow alert must not break or block the poll or a hook.
export async function alertOn($: EngineInterface, ledger: Ledger | null, options: PluginOptions = {}) {
  if (!ledger) return
  if (!(await anyUnseen($, ledger))) {
    if (KINDS.every((kind) => standing(ledger)[kind] === null)) quietly(() => $.state.set(OPENED, false))
    return
  }
  // Read as the alert fires; an absent option means on.
  if (options.alertSound !== false) quietly(() => $.audio.play(SOUND))
  quietly(() => setStatus($, ledger))
  quietly(() => $.state.set(OPENED, false).then(() => openAndRecord($)))
}

// The pane opened for the alert is recorded as mod state, so the band can read it; a pane that did not seat records nothing.
async function openAndRecord($: EngineInterface) {
  const placed = (await openPane($)) as { isPlaced?: boolean } | undefined
  if (placed?.isPlaced) await $.state.set(OPENED, true)
}

// The mod-store key of the seen record for a project.
export function seenKey(root: string) {
  return `alert-seen:${root}`
}

const KINDS = ['stop', 'needsHuman'] as const

type Seen = { run: string; stop: number | null; needsHuman: number | null }

// The ledger's own runId; ledgers without one fall back to the plan and task.
function runOf(ledger: NonNullable<Ledger>) {
  return ledger.runId ?? `${ledger.plan?.path ?? ''}|${ledger.task ?? ''}`
}

// What the ledger shows now: the run and the seq of each standing event.
function standing(ledger: NonNullable<Ledger>): Seen {
  return { run: runOf(ledger), stop: ledger.stop?.seq ?? null, needsHuman: ledger.needsHuman?.seq ?? null }
}

// An event is new when it stands now and the seen record is of another run or holds another seq for it.
function hasNew(now: Seen, seen: Seen | undefined) {
  return KINDS.some((kind) => now[kind] !== null && (seen?.run !== now.run || seen[kind] !== now[kind]))
}

// One record per project, overwritten as events arrive, in the mod's store so it survives a reload. A store that fails reads as unseen, so the alert still fires.
async function anyUnseen($: EngineInterface, ledger: NonNullable<Ledger>) {
  const now = standing(ledger)
  if (KINDS.every((kind) => now[kind] === null)) return false
  try {
    const key = seenKey(await $.session.root())
    const unseen = hasNew(now, (await $.store.get(key)) as Seen | undefined)
    if (unseen) await $.store.set(key, now)
    return unseen
  } catch {
    return true
  }
}

function statusWords(ledger: Ledger) {
  if (ledger.stop) return stopLine(ledger.stop)
  const gate = ledger.needsHuman?.gate
  return gate ? needsYouLine(gate) : null
}

// The status line words the stop as the pane and band do.
function setStatus($: EngineInterface, ledger: Ledger) {
  const words = statusWords(ledger)
  if (words) return $.ui.status(`Pairing Buddy ${words}`)
}
