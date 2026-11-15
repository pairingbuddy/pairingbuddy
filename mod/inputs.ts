import type { AgentSpawnInput, EngineInterface } from 'claude-code'
import { testNames } from '../shared-node/now-building.mjs'
import { isStandingScenarios, newestKeyAmong, scenarioRows } from '../shared-node/standing-scenarios.mjs'

const TESTS = '.pairingbuddy/tests.json'
const SCENARIOS = '.pairingbuddy/scenarios.json'
const LEDGER = '.pairingbuddy/run/task/ledger.json'
const UNIT = '.pairingbuddy/run/unit.json'
const CHANGED = '.pairingbuddy/run/changed.json'
const ARTIFACTS = '.pairingbuddy/run/task/artifacts'

export type Spawn = { kind: 'Agent' | 'workflow_agent'; name: string; subagentType?: string; startedAt?: string; agentId?: string; finished?: boolean }
type Spend = { agents: number; tokens: number; tokensKnown: boolean }
type StageEntry = { name: string; status?: string; attempt?: number; startedAt?: string; spend?: Spend }
// The ledger as the mod reads it: every field is optional, since the file may be partial.
export type Ledger = {
  runId?: string
  kind?: string
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
export type Call = { agentId?: unknown; at?: string; input: Record<string, unknown> }
// unit: the open unit, by its identity (branch and base) and its last ended task's steps; since: when the unit's first run began.
// prUrl: the pull request the unit record names, once pb publish has opened it.
export type Unit = { key: string; taskStages: string[]; prUrl?: string }
// What the pane keeps of the unit's last code run (shared-node/end-state.mjs codeRunOf), so the end state outlives its ledger.
export type CodeRun = { runId?: string; task?: string; taskEndPassed: boolean; testsPassing: number; perTest?: Record<string, { green?: { passed: boolean }; covered?: { done: boolean } }>; safetyNet: { attempt?: number; startedAt?: string } | null; rollbacks: unknown[] }
// What the last pb publish printed: the url it opened, or the result when it opened none; codeRunId ties it to the code run it published.
export type Published = { url?: string; result?: string; codeRunId?: string | null }
// changed: the paths run/changed.json lists (null when it does not read); prUrl: the unit's pull request as the poller last saw it.
// unitOpen: whether a unit is open now, for a finished run drawn from its snapshot (whose unit is the one it last saw).
export type Inputs = { unitOpen?: boolean; ledger: Ledger; spawns: Spawn[]; calls?: Call[]; tests: string[]; testsComplete: boolean; now: number | undefined; names?: Record<string, string>; unit?: Unit | null; since?: string; changed?: string[] | null; codeRun?: CodeRun | null; prUrl?: string | null; published?: Published | null }

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

// What an agent.spawn event says about the agent. A workflow script's agent() label arrives as the spawn's description, with
// `workflow` set and no name; a named spawn is read as a workflow agent too. Any other is a subagent.
export function spawnOf(e: Partial<Pick<AgentSpawnInput, 'name' | 'subagentType' | 'description' | 'workflow'>>): Spawn {
  if (e.workflow) return { kind: 'workflow_agent', name: e.name ?? e.description ?? '', subagentType: e.subagentType }
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

// The open unit from run/unit.json, or null when none is open or the file does not read; its last task's steps, each once.
export function unitOf(file: unknown): Unit | null {
  const { branch, baseSha, tasks } = (file ?? {}) as { branch?: unknown; baseSha?: unknown; tasks?: unknown }
  if (typeof branch !== 'string' || !Array.isArray(tasks)) return null
  const last = tasks.at(-1) as { stages?: unknown } | undefined
  const stages = Array.isArray(last?.stages) ? last.stages.filter((name): name is string => typeof name === 'string') : []
  const url = ((file as { pr?: { url?: unknown } }).pr)?.url
  return { key: `${branch} ${String(baseSha)}`, taskStages: [...new Set(stages)], ...(typeof url === 'string' && url !== '' ? { prUrl: url } : {}) }
}

// The paths run/changed.json lists ({ path, status } entries), or null when it is absent or does not read.
export function changedOf(file: unknown): string[] | null {
  if (!Array.isArray(file)) return null
  return file.map(entry => (entry as { path?: unknown })?.path).filter((path): path is string => typeof path === 'string' && path !== '')
}

export type Polled = { ledger: Ledger | null; tests: string[]; testsComplete: boolean; now: number | null; names: Record<string, string>; unit: Unit | null; changed: string[] | null; since?: string | null; codeRun?: CodeRun | null; prUrl?: string | null }

// The pieces the poller reads; spawns are the mod's own, so render takes them from memory.
export async function pollInputs($: EngineInterface): Promise<Polled> {
  const [{ inputs: { ledger, tests, testsComplete, now }, testsFile }, scenarios, unitFile, changedFile] = await Promise.all([readInputsAndTests($, []), readJson($, SCENARIOS), readJson($, UNIT), readJson($, CHANGED)])
  const names = testNames({ tests: testsFile, scenarios })
  return { ledger: ledger ?? null, tests, testsComplete, now: now ?? null, names, unit: unitOf(unitFile), changed: changedOf(changedFile) }
}

type PolledState = { ledger: unknown; tests: string[]; testsComplete?: boolean; now: number | null; names?: Record<string, string>; unit?: Unit | null; since?: string | null; changed?: string[] | null; codeRun?: CodeRun | null; prUrl?: string | null } | null

// The one place the atom's loosely typed ledger is narrowed; null until the first poll, which reads as idle.
export function fromPolled(polled: PolledState, spawns: Spawn[], calls: Call[] = [], published: Published | null = null): Inputs {
  return {
    ledger: (polled?.ledger ?? undefined) as Ledger, spawns, calls, tests: polled?.tests ?? [], testsComplete: polled?.testsComplete ?? false, now: polled?.now ?? undefined,
    names: polled?.names ?? undefined, unit: polled?.unit ?? null, since: polled?.since ?? undefined,
    changed: polled?.changed ?? null, codeRun: polled?.codeRun ?? null, prUrl: polled?.prUrl ?? null, published,
  }
}

export type ScenarioRow = { description: string; tests: string[] }

// The scenarios that stand, by the rule pb gate eval reads them with for the scenarios question, or undefined when they do not read.
async function readScenarios($: EngineInterface, ledger: Ledger): Promise<ScenarioRow[] | undefined> {
  try {
    const entries = await $.fs.list(`${await $.session.root()}/${ARTIFACTS}`)
    const key = newestKeyAmong(entries.filter(entry => entry.kind === 'file').map(entry => entry.name), isStandingScenarios(ledger))
    if (key === null) return undefined
    const artifact = (await readJson($, `${ARTIFACTS}/${key}.json`)) as { pb_key?: unknown; scenarios?: unknown } | undefined
    return artifact?.pb_key === key ? scenarioRows(artifact.scenarios) : undefined
  } catch {
    return undefined
  }
}

// What the report lists in full where a gate question folds: the standing scenarios and every changed file. Never throws.
export async function readReportLists($: EngineInterface, ledger: Ledger): Promise<{ scenarios?: ScenarioRow[]; changed: string[] | null }> {
  const [scenarios, changedFile] = await Promise.all([readScenarios($, ledger), readJson($, CHANGED)])
  return { scenarios, changed: changedOf(changedFile) }
}
