import type { EngineInterface } from 'claude-code'
import { readInputs, type Spawn } from './inputs'
import { readsNotes, suggestionEntry } from '../shared-node/suggestion.mjs'
import { readLabel } from '../shared-node/labels.mjs'

// The pending suggestion, as mod state: when it was saved, until an agent spawns and reads it.
const PENDING = { plugin: 'pairingbuddy', key: 'pending-suggestion' }

export type PendingSuggestion = { savedAt: string; deliveredTo?: string }

export const GUIDANCE = '.pairingbuddy/human-guidance.json'

// What /pb-note answers, one plain line each.
export const NOTE_SAVED = `Note saved to ${GUIDANCE}. The next agent will read it.`
export const NOTE_NOT_SAVED = `Note not saved: ${GUIDANCE} could not be read or written, so it was left as it was.`
export const NOTE_BLANK = 'Nothing saved: type the note after the command, as in /pb-note keep the signature.'
export const NOTE_NO_RUN = 'Note not saved: no Pairing Buddy task is running, so no agent would read it.'

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
// /pb-note: appends the typed note to human-guidance.json as a task-scoped entry, which curate-guidance drops at the next task,
// and returns the one line the command answers with. Never throws.
export async function saveNote($: EngineInterface, spawns: Spawn[], text: string): Promise<string> {
  if (text.trim() === '') return NOTE_BLANK
  try {
    const path = `${await $.session.root()}/${GUIDANCE}`
    const { ledger, now } = await readInputs($, spawns)
    if (!ledger) return NOTE_NO_RUN
    const context = ledger.task ?? ledger.stage?.name ?? 'current task'
    const timestamp = new Date(now ?? Date.now()).toISOString()
    const entry = suggestionEntry({ timestamp, context, feedback: text.trim() })
    // Known limit: the read-then-write is not atomic (the mod API has no append primitive), so an agent append landing
    // between the two is overwritten. The read sits right next to the write to keep that window as small as possible.
    const existing = await readGuidance($, path)
    if (existing === null) return NOTE_NOT_SAVED
    await $.fs.write(path, JSON.stringify({ guidance: [...existing, entry] }, null, 2) + '\n')
    await $.state.set(PENDING, { savedAt: timestamp })
    return NOTE_SAVED
  } catch {
    // A failed write leaves the note not pending.
    return NOTE_NOT_SAVED
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
// A pending suggestion that has not been delivered yet reaches the agent that spawns now, when it is one that reads the
// guidance file; a runner, a lens or a refuter leaves it pending. Mod state only.
export async function recordDelivery($: EngineInterface, pending: PendingSuggestion | null, name: string | undefined): Promise<void> {
  const label = readLabel(name ?? '')
  if (pending == null || pending.deliveredTo != null || label.unknown || !readsNotes(label.role)) return
  await $.state.set(PENDING, { ...pending, deliveredTo: label.role })
}
