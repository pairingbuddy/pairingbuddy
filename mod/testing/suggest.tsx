import { expect } from 'claude-code/testing'
import { POLL_MS } from '../poll'
import { buildLabel } from '../../shared-node/labels.mjs'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, start } from './band'
import { recordOther, recordWrite } from './refuse'
import { findOnPane, PANE, paneTexts, setupReplay } from './replay'

// Shared by the suggest-input tests. It lives outside the `*.test.tsx` pattern, so `claude plugin test` does not run it.

// The pane's suggest input is found by this key, as the report button is found by 'report'.
export const SUGGEST_KEY = 'suggest'

// The label the input carries: the key hint, then the action (R5-1).
export const SUGGEST_LABEL = 'suggest'

// Looks up the suggest input on the terminal pane. The label is undefined when the input draws none.
export async function suggestInput($: any): Promise<{ label: string | undefined } | undefined> {
  const input = await findOnPane($, { type: 'Input', key: SUGGEST_KEY })
  return input === undefined ? undefined : { label: input.props?.label as string | undefined }
}

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

// Serves a running ledger (or the given one) and the given guidance file (guidance: null serves none, so fs.read gets ENOENT; guidanceText serves that raw text; unreadable makes the read throw EACCES; unwritable makes the write throw EACCES), starts the engine and lets it poll once.
// Returns the write recorder ({ writes, touched }), so a test keeps only its own assertions.
export async function startRunningPane($: any, on: Function, { guidance = EXISTING_GUIDANCE, guidanceText, unreadable = false, unwritable = false, ledger = SNAPSHOT_RUNNING }: { guidance?: unknown | null; guidanceText?: string; unreadable?: boolean; unwritable?: boolean; ledger?: unknown }) {
  const rig = setupReplay(on)
  rig.served.set(`${ROOT}/${LEDGER}`, JSON.stringify(ledger))
  if (guidanceText !== undefined) rig.served.set(GUIDANCE_PATH, guidanceText)
  else if (guidance !== null) rig.served.set(GUIDANCE_PATH, JSON.stringify(guidance))
  if (unreadable) rig.unreadable.add(GUIDANCE_PATH)
  const recorder = recordWrites(on, { unwritable })
  await start($)
  await rig.clock.advance(POLL_MS)
  return recorder
}

// Mounts the terminal pane, types text into the suggest input and unmounts.
export async function typeIntoPane($: any, text: string) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.input({ key: SUGGEST_KEY, text })
  await pane.unmount()
}

// Starts a running pane, then types text into the suggest input. Returns the write recorder.
export async function typeSuggestion($: any, on: Function, { text, guidance = EXISTING_GUIDANCE, guidanceText, unreadable, unwritable }: { text: string; guidance?: unknown | null; guidanceText?: string; unreadable?: boolean; unwritable?: boolean }) {
  const recorder = await startRunningPane($, on, { guidance, guidanceText, unreadable, unwritable })
  await typeIntoPane($, text)
  return recorder
}

// Asserts the mod made exactly one write, to the guidance file, then returns that file's parsed content.
export function writtenGuidance(writes: { path: string; text: string }[]) {
  expect(writes.map((w) => w.path), 'one write, to <root>/.pairingbuddy/human-guidance.json').toEqual([GUIDANCE_PATH])
  return JSON.parse(writes[0].text)
}

// The suggestion text the delivery tests type into the pane.
export const SUGGESTION_TEXT = 'Keep the signature, fix the formula'

// The pane line shown while a suggestion waits for the next agent spawn.
export const PENDING_PHRASE = 'applies at the next agent spawn'

// Spawns an agent the way a workflow does: the name is a real label and the subagent type follows the role.
export async function spawnStageAgent($: any, { stage, role }: { stage: string; role: string }) {
  const name = buildLabel({ stage, phase: null, role, item: null, round: 1 })
  return $.agent.spawn({ prompt: 'p', description: 'd', name, subagentType: `pairingbuddy:${role}` })
}

// Asserts the pane shows the plain-words note that the suggestion was not saved.
export async function expectNotSavedNote($: any) {
  const texts = await paneTexts($)
  const note = texts.find((text) => /not saved/i.test(text))
  expect(note, 'the pane says the suggestion was not saved').toBeDefined()
  expect(note, 'the note is plain words, with no path, id or number').not.toMatch(/[\/\\\d_]/)
}
