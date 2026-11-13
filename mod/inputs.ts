import type { AgentSpawnInput, EngineInterface } from 'claude-code'
import { testNames } from '../shared-node/now-building.mjs'

const TESTS = '.pairingbuddy/tests.json'
const SCENARIOS = '.pairingbuddy/scenarios.json'
const LEDGER = '.pairingbuddy/run/task/ledger.json'

export type Spawn = { kind: 'Agent' | 'workflow_agent'; name: string; subagentType?: string; startedAt?: string; agentId?: string; finished?: boolean }
type Spend = { agents: number; tokens: number; tokensKnown: boolean }
type StageEntry = { name: string; status?: string; attempt?: number; startedAt?: string; spend?: Spend }
// The ledger as the mod reads it: every field is optional, since the file may be partial.
export type Ledger = {
  runId?: string
  taskType?: string | null
  stage?: { name?: string; status?: string; runId?: string | null; attempt?: number; startedAt?: string | null }
  stages?: StageEntry[]
  spend?: Spend
  tests?: { perTest?: Record<string, unknown> }
  task?: string
  commits?: string[]
  plan?: { path?: string }
  stop?: { reason?: string; seq?: number }
  needsHuman?: { gate?: string | null; seq?: number }
} | undefined

// names: test id to description, narrowed from tests.json and scenarios.json by the poller; absent means no names known.
export type Inputs = { ledger: Ledger; spawns: Spawn[]; tests: string[]; testsComplete: boolean; now: number | undefined; names?: Record<string, string> }

// Never throws: an absent, empty, truncated or unreadable file reads as undefined.
async function readJson($: EngineInterface, relative: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(`${await $.session.root()}/${relative}`))
  } catch {
    return undefined
  }
}

// LEGACY fallback, only when the ledger has no perTest yet (old-path runs): the old tests.json, never the source of truth for a new-path run.
function legacyTests(file: unknown): string[] {
  const { tests } = (file ?? {}) as { tests?: { test_id?: unknown }[] }
  return (Array.isArray(tests) ? tests : []).map(test => test?.test_id).filter((id): id is string => typeof id === 'string' && id !== '')
}

// The tests seen so far: a test enters ledger.tests.perTest when its RED starts, so these are not the planned total.
function seenTests(ledger: Ledger): string[] {
  const perTest = (ledger as { tests?: { perTest?: unknown } } | undefined)?.tests?.perTest
  return perTest && typeof perTest === 'object' ? Object.keys(perTest) : []
}

// tests.json's order, as the test list, once it lists every test the ledger has seen; otherwise undefined.
function plannedTests(planned: string[], seen: string[]): string[] | undefined {
  return planned.length > 0 && seen.every(id => planned.includes(id)) ? planned : undefined
}

// The clock may be absent or fail; glance then shows the elapsed time as unknown.
async function readClock($: EngineInterface): Promise<number | undefined> {
  try {
    return await $.clock.now()
  } catch {
    return undefined
  }
}

// When a spawn began, from the clock; undefined when the clock is absent or fails, so a spawn is never lost for want of a time.
export async function startedAtOf($: EngineInterface): Promise<string | undefined> {
  try {
    return new Date(await $.clock.now()).toISOString()
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
  return (await readInputsAndTests($, spawns)).inputs
}

// The inputs plus the tests.json they were read with, so the poller reads that file once per tick.
async function readInputsAndTests($: EngineInterface, spawns: Spawn[]): Promise<{ inputs: Inputs; testsFile: unknown }> {
  const [ledger, testsFile, now] = await Promise.all([readJson($, LEDGER) as Promise<Ledger>, readJson($, TESTS), readClock($)])
  return { inputs: inputsOf({ ledger, testsFile, now, spawns }), testsFile }
}

function inputsOf({ ledger, testsFile, now, spawns }: { ledger: Ledger; testsFile: unknown; now: number | undefined; spawns: Spawn[] }): Inputs {
  const legacy = legacyTests(testsFile)
  const seen = seenTests(ledger)
  if (seen.length === 0) return { ledger, spawns, tests: legacy, testsComplete: true, now }
  // A tests.json that lists every seen test is the whole planned list; otherwise the seen tests alone, with no invented total.
  const planned = plannedTests(legacy, seen)
  return planned ? { ledger, spawns, tests: planned, testsComplete: true, now } : { ledger, spawns, tests: seen, testsComplete: false, now }
}

// The pieces the poller reads; spawns are the mod's own, so render takes them from memory.
export async function pollInputs($: EngineInterface): Promise<{ ledger: Ledger | null; tests: string[]; testsComplete: boolean; now: number | null; names: Record<string, string> }> {
  const [{ inputs: { ledger, tests, testsComplete, now }, testsFile }, scenarios] = await Promise.all([readInputsAndTests($, []), readJson($, SCENARIOS)])
  const names = testNames({ tests: testsFile, scenarios })
  return { ledger: ledger ?? null, tests, testsComplete, now: now ?? null, names }
}

type Polled = { ledger: unknown; tests: string[]; testsComplete?: boolean; now: number | null; names?: Record<string, string> } | null

// The one place the atom's loosely typed ledger is narrowed; null until the first poll, which reads as idle.
export function fromPolled(polled: Polled, spawns: Spawn[]): Inputs {
  return { ledger: (polled?.ledger ?? undefined) as Ledger, spawns, tests: polled?.tests ?? [], testsComplete: polled?.testsComplete ?? true, now: polled?.now ?? undefined, names: polled?.names ?? undefined }
}
