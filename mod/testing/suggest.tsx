import { expect } from 'claude-code/testing'
import { POLL_MS } from '../poll'
import { buildLabel } from '../../shared-node/labels.mjs'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, start } from './band'
import { recordOther, recordWrite } from './refuse'
import { setupReplay } from './replay'

// Shared by the /pb-note tests. It lives outside the `*.test.tsx` pattern, so `claude plugin test` does not run it.

// The human-guidance.json the mod writes to, under the project root.
export const GUIDANCE_PATH = `${ROOT}/.pairingbuddy/human-guidance.json`

// A guidance file that already holds one entry, so a test can tell an append from an overwrite.
export const EXISTING_GUIDANCE = {
  guidance: [{ agent: 'orchestrator', timestamp: '2026-11-01T11:00:00Z', context: 'test language', feedback: 'Use node:test only.', persistent: true }],
}

// Registers fs.write, process.run and process.spawn and records what they were asked.
// Every write lands in `writes`. An allowed write lands in `files` and answers success; a refused one lands in `touched` and throws. Every other world-changing call lands in `touched`. With `unwritable`, every write throws EACCES before it reaches `files`.
export function recordWrites(on: Function, { unwritable = false }: { unwritable?: boolean } = {}) {
  const writes: { path: string; text: string }[] = []
  const touched: string[] = []
  const files = new Map<string, string>()
  on('fs.write', async (_: unknown, e: { path: string; text: string }) => {
    writes.push(e)
    if (unwritable) throw Object.assign(new Error(`EACCES ${e.path}`), { code: 'EACCES' })
    if (!recordWrite(files, touched, '', e.path, e.text)) throw new Error('the mod is read-only')
    return { value: undefined }
  })
  on('process.run', async (_: unknown, e: { argv: string[] }) => {
    recordOther(touched, '', `process.run ${e.argv.join(' ')}`)
    return { value: { stdout: '', stderr: '', exitCode: 0 } }
  })
  on('process.spawn', async function* (_: unknown, e: { argv: string[] }) {
    recordOther(touched, '', `process.spawn ${e.argv.join(' ')}`)
    return { value: undefined } as never
  })
  return { writes, touched, files }
}

// Serves a running ledger (or the given one; null serves none) and the given guidance file (guidance: null serves none, so fs.read gets ENOENT; guidanceText serves that raw text; unreadable makes the read throw EACCES; unwritable makes the write throw EACCES), starts the engine and lets it poll once.
// Returns the write recorder ({ writes, touched }), so a test keeps only its own assertions.
export async function startRunningPane($: any, on: Function, { guidance = EXISTING_GUIDANCE, guidanceText, unreadable = false, unwritable = false, ledger = SNAPSHOT_RUNNING }: { guidance?: unknown | null; guidanceText?: string; unreadable?: boolean; unwritable?: boolean; ledger?: unknown }) {
  const rig = setupReplay(on)
  if (ledger !== null) rig.served.set(`${ROOT}/${LEDGER}`, JSON.stringify(ledger))
  if (guidanceText !== undefined) rig.served.set(GUIDANCE_PATH, guidanceText)
  else if (guidance !== null) rig.served.set(GUIDANCE_PATH, JSON.stringify(guidance))
  if (unreadable) rig.unreadable.add(GUIDANCE_PATH)
  const recorder = recordWrites(on, { unwritable })
  await start($)
  await rig.clock.advance(POLL_MS)
  return recorder
}

// Runs /pb-note with the text and returns its one-line answer.
export async function runPbNote($: any, text: string): Promise<string> {
  const result: any = await $.command.run({ command: 'pb-note', args: text })
  return result?.text
}

// Starts a running pane, then runs /pb-note with the text. Returns the write recorder and the command's answer.
export async function leaveNote($: any, on: Function, { text, guidance = EXISTING_GUIDANCE, guidanceText, unreadable, unwritable, ledger }: { text: string; guidance?: unknown | null; guidanceText?: string; unreadable?: boolean; unwritable?: boolean; ledger?: unknown }) {
  const recorder = await startRunningPane($, on, { guidance, guidanceText, unreadable, unwritable, ledger })
  const answer = await runPbNote($, text)
  return { ...recorder, answer }
}

// Asserts the mod made exactly one write, to the guidance file, then returns that file's parsed content.
export function writtenGuidance(writes: { path: string; text: string }[]) {
  expect(writes.map((w) => w.path), 'one write, to <root>/.pairingbuddy/human-guidance.json').toEqual([GUIDANCE_PATH])
  return JSON.parse(writes[0].text)
}

// The note text the delivery tests leave with /pb-note.
export const SUGGESTION_TEXT = 'Keep the signature, fix the formula'

// The pane line's head: the note as typed, quoted.
export const NOTE_HEAD = `your note "${SUGGESTION_TEXT}"`

// The pane line shown while a note waits for an agent that reads it.
export const WAITING_LINE = `${NOTE_HEAD} · waiting for the next agent`

// Spawns an agent the way a workflow does: the name is a real label and the subagent type follows the role.
export async function spawnStageAgent($: any, { stage, role }: { stage: string; role: string }) {
  const name = buildLabel({ stage, phase: null, role, item: null, round: 1 })
  return $.agent.spawn({ prompt: 'p', description: 'd', name, subagentType: `pairingbuddy:${role}` })
}
