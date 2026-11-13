import type { EngineInterface } from 'claude-code'
import { readInputs, type Spawn } from './inputs'
import { suggestionEntry } from '../shared-node/suggestion.mjs'
import { readLabel } from '../shared-node/labels.mjs'

// The pending suggestion, as mod state: when it was saved, until an agent spawns and reads it.
const PENDING = { plugin: 'pairingbuddy', key: 'pending-suggestion' }

// The pane's one note line, as mod state: what failed, in plain words. Shared with the report press (PANE_NOTE in ./report).
// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The same key is written in four copies, PANE_NOTE in ./poll, ./report and ./suggest and noteAtom in register.tsx; keep all four in step.
const PANE_NOTE = { plugin: 'pairingbuddy', key: 'pane-note' }

// The pane note shown on every failed save, written once so the two failure paths cannot drift apart.
const NOT_SAVED_NOTE = 'suggestion not saved'

export type PendingSuggestion = { savedAt: string; deliveredTo?: string }

export const GUIDANCE = '.pairingbuddy/human-guidance.json'

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
// Appends the typed note to human-guidance.json as a task-scoped entry, which curate-guidance drops at the next task. Never throws.
export async function submitSuggestion($: EngineInterface, spawns: Spawn[], text: string): Promise<void> {
  if (text.trim() === '') return
  try {
    const path = `${await $.session.root()}/${GUIDANCE}`
    const { ledger, now } = await readInputs($, spawns)
    const context = ledger?.task ?? ledger?.stage?.name ?? 'current task'
    const timestamp = new Date(now ?? Date.now()).toISOString()
    const entry = suggestionEntry({ timestamp, context, feedback: text })
    // Known limit: the read-then-write is not atomic (the mod API has no append primitive), so an agent append landing
    // between the two is overwritten. The read sits right next to the write to keep that window as small as possible.
    const existing = await readGuidance($, path)
    if (existing === null) {
      await $.state.set(PANE_NOTE, NOT_SAVED_NOTE)
      return
    }
    await $.fs.write(path, JSON.stringify({ guidance: [...existing, entry] }, null, 2) + '\n')
    await $.state.set(PENDING, { savedAt: timestamp })
    await $.state.set(PANE_NOTE, null)
  } catch {
    // The submit never throws; a failed write shows the plain "suggestion not saved" note and leaves the suggestion not pending.
    await $.state.set(PANE_NOTE, NOT_SAVED_NOTE).catch(() => {})
  }
}

// Only a missing file counts as empty guidance. Anything else unreadable or unusable gives null, so the file is never replaced.
async function readGuidance($: EngineInterface, path: string): Promise<unknown[] | null> {
  let text: string
  try {
    text = await $.fs.read(path)
  } catch (error) {
    return isMissing(error) ? [] : null
  }
  try {
    const file = JSON.parse(text)
    return Array.isArray(file?.guidance) ? file.guidance : null
  } catch {
    return null
  }
}

function isMissing(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown }
  return e?.code === 'ENOENT' || String(e?.message ?? error).includes('ENOENT')
}

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
// A pending suggestion that has not been delivered yet reaches the agent that spawns now; mod state only.
export async function recordDelivery($: EngineInterface, pending: PendingSuggestion | null, name: string | undefined): Promise<void> {
  const label = readLabel(name ?? '')
  if (pending == null || pending.deliveredTo != null || label.unknown) return
  await $.state.set(PENDING, { ...pending, deliveredTo: label.role })
}
