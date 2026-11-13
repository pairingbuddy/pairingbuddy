import type { AgentSpawnInput, EngineInterface } from 'claude-code'

const TESTS = '.pairingbuddy/tests.json'
const LEDGER = '.pairingbuddy/run/task/ledger.json'

export type Spawn = { kind: 'Agent' | 'workflow_agent'; name: string; subagentType?: string }
type Spend = { agents: number; tokens: number; tokensKnown: boolean }
type StageEntry = { name: string; status?: string; attempt?: number; startedAt?: string; spend?: Spend }
// The ledger as the mod reads it: every field is optional, since the file may be partial.
export type Ledger = {
  runId?: string
  taskType?: string | null
  stage?: { name?: string; status?: string; runId?: string | null; attempt?: number; startedAt?: string | null }
  stages?: StageEntry[]
  spend?: Spend
  task?: string
  commits?: string[]
  plan?: { path?: string }
  stop?: { reason?: string; seq?: number }
  needsHuman?: { gate?: string | null; seq?: number }
} | undefined

export type Inputs = { ledger: Ledger; spawns: Spawn[]; tests: string[]; testsComplete: boolean; now: number | undefined }

// Never throws: an absent, empty, truncated or unreadable file reads as undefined.
async function readJson($: EngineInterface, relative: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(`${await $.session.root()}/${relative}`))
  } catch {
    return undefined
  }
}

// LEGACY fallback, only when the ledger has no perTest yet (old-path runs): the old tests.json, never the source of truth for a new-path run.
async function legacyTests($: EngineInterface): Promise<string[]> {
  const file = (await readJson($, TESTS)) as { tests?: { test_id?: unknown }[] } | undefined
  return (Array.isArray(file?.tests) ? file.tests : []).map(test => test?.test_id).filter((id): id is string => typeof id === 'string' && id !== '')
}

// The tests seen so far: a test enters ledger.tests.perTest when its RED starts, so these are not the planned total.
function seenTests(ledger: Ledger): string[] {
  const perTest = (ledger as { tests?: { perTest?: unknown } } | undefined)?.tests?.perTest
  return perTest && typeof perTest === 'object' ? Object.keys(perTest) : []
}

// The clock may be absent or fail; glance then shows the elapsed time as unknown.
async function readClock($: EngineInterface): Promise<number | undefined> {
  try {
    return await $.clock.now()
  } catch {
    return undefined
  }
}

// What an agent.spawn event says about the agent: a named one is a workflow agent, any other a subagent.
export function spawnOf(e: Pick<AgentSpawnInput, 'name' | 'subagentType' | 'description'>): Spawn {
  return e.name
    ? { kind: 'workflow_agent', name: e.name, subagentType: e.subagentType }
    : { kind: 'Agent', name: e.subagentType ?? e.description ?? '', subagentType: e.subagentType }
}

export async function readInputs($: EngineInterface, spawns: Spawn[]): Promise<Inputs> {
  const [ledger, legacy, now] = await Promise.all([readJson($, LEDGER) as Promise<Ledger>, legacyTests($), readClock($)])
  const seen = seenTests(ledger)
  // Seen-only lists are incomplete; only the legacy tests.json is a whole planned list.
  return seen.length > 0 ? { ledger, spawns, tests: seen, testsComplete: false, now } : { ledger, spawns, tests: legacy, testsComplete: true, now }
}

// The pieces the poller reads; spawns are the mod's own, so render takes them from memory.
export async function pollInputs($: EngineInterface): Promise<{ ledger: Ledger | null; tests: string[]; testsComplete: boolean; now: number | null }> {
  const { ledger, tests, testsComplete, now } = await readInputs($, [])
  return { ledger: ledger ?? null, tests, testsComplete, now: now ?? null }
}

type Polled = { ledger: unknown; tests: string[]; testsComplete?: boolean; now: number | null } | null

// The one place the atom's loosely typed ledger is narrowed; null until the first poll, which reads as idle.
export function fromPolled(polled: Polled, spawns: Spawn[]): Inputs {
  return { ledger: (polled?.ledger ?? undefined) as Ledger, spawns, tests: polled?.tests ?? [], testsComplete: polled?.testsComplete ?? true, now: polled?.now ?? undefined }
}
