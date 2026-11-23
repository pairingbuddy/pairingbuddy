import type { EngineInterface } from 'claude-code'
import type { Published } from './inputs'

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The published key is written here and read by publishedAtom in register.tsx; keep both in step.
const PUBLISHED = { plugin: 'pairingbuddy', key: 'published' } as const
// The same key the poller writes (INPUTS in ./poll), read here for the code run the publish belongs to.
const INPUTS = { plugin: 'pairingbuddy', key: 'inputs' } as const

// A shell command that runs pb publish (`pb publish`, `node .../pb.mjs publish`, with or without quotes, alone or followed
// by another command such as `; echo "exit=$?"`).
const PUBLISH_COMMAND = /(^|[\s/"'])pb(\.mjs)?["']?\s+publish(?=$|[\s;&|)])/

// What pb publish printed, from the last JSON object in its stdout (one line or pretty-printed; lines after it, such as
// an `echo "exit=$?"`, are skipped): the url it opened, or its result when it opened none. Null for anything else.
export function publishedOf(command: unknown, ran: unknown): Published | null {
  if (typeof command !== 'string' || !PUBLISH_COMMAND.test(command)) return null
  const stdout = (ran as { result?: { stdout?: unknown } } | null)?.result?.stdout
  if (typeof stdout !== 'string') return null
  const out = lastObject(stdout.split('\n'))
  if (typeof out?.result !== 'string') return null
  return { result: out.result, ...(typeof out.url === 'string' && out.url !== '' ? { url: out.url } : {}) }
}

// The last top-level JSON object in the lines: it opens on a line starting with `{` and closes on the first later line
// that makes it parse. Lines that are not JSON, before or after it, are skipped.
function lastObject(lines: string[]): { result?: unknown; url?: unknown } | null {
  for (let start = lines.length - 1; start >= 0; start--) {
    if (!lines[start].startsWith('{')) continue
    for (let end = start; end < lines.length; end++) {
      if (!lines[end].trimEnd().endsWith('}')) continue
      try {
        const out = JSON.parse(lines.slice(start, end + 1).join('\n'))
        if (out !== null && typeof out === 'object' && !Array.isArray(out)) return out
      } catch {
        // Not a whole object yet; try a later closing line.
      }
    }
  }
  return null
}

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
// Records what a pb publish call opened, with the code run it published; any other call, or a failure, records nothing.
export async function recordPublished($: EngineInterface, command: unknown, ran: unknown): Promise<void> {
  const published = publishedOf(command, ran)
  if (!published) return
  const polled = (await $.state.get(INPUTS)).value as { codeRun?: { runId?: string } | null; unit?: { key?: string } | null } | null | undefined
  await $.state.set(PUBLISHED, { ...published, codeRunId: polled?.codeRun?.runId ?? null, unitKey: polled?.unit?.key ?? null })
}
