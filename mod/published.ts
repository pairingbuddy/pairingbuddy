import type { EngineInterface } from 'claude-code'
import type { Published } from './inputs'

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The published key is written here and read by publishedAtom in register.tsx; keep both in step.
const PUBLISHED = { plugin: 'pairingbuddy', key: 'published' } as const
// The same key the poller writes (INPUTS in ./poll), read here for the code run the publish belongs to.
const INPUTS = { plugin: 'pairingbuddy', key: 'inputs' } as const

// A shell command that runs pb publish (`pb publish`, `node .../pb.mjs publish`, with or without quotes).
const PUBLISH_COMMAND = /(^|[\s/"'])pb(\.mjs)?["']?\s+publish(\s|$)/

// What pb publish printed, from its last JSON line: the url it opened, or its result when it opened none. Null for anything else.
export function publishedOf(command: unknown, ran: unknown): Published | null {
  if (typeof command !== 'string' || !PUBLISH_COMMAND.test(command)) return null
  const stdout = (ran as { result?: { stdout?: unknown } } | null)?.result?.stdout
  if (typeof stdout !== 'string') return null
  for (const line of stdout.trim().split('\n').reverse()) {
    try {
      const out = JSON.parse(line) as { result?: unknown; url?: unknown }
      if (typeof out?.result !== 'string') continue
      return { result: out.result, ...(typeof out.url === 'string' && out.url !== '' ? { url: out.url } : {}) }
    } catch {
      // Not a JSON line; try the one before.
    }
  }
  return null
}

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
// Records what a pb publish call opened, with the code run it published; any other call, or a failure, records nothing.
export async function recordPublished($: EngineInterface, command: unknown, ran: unknown): Promise<void> {
  const published = publishedOf(command, ran)
  if (!published) return
  const polled = (await $.state.get(INPUTS)).value as { codeRun?: { runId?: string } | null } | null | undefined
  await $.state.set(PUBLISHED, { ...published, codeRunId: polled?.codeRun?.runId ?? null })
}
