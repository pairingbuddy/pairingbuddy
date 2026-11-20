import type { AgentSpawnInput, EngineInterface } from 'claude-code'
import { isStandingScenarios, isStandingTests, newestKeyAmong, scenarioRows } from '../shared-node/standing-scenarios.mjs'
import { withPermissionAsk } from '../shared-node/permission-wait.mjs'

const TESTS = '.pairingbuddy/tests.json'
const LEDGER = '.pairingbuddy/run/task/ledger.json'
const UNIT = '.pairingbuddy/run/unit.json'
const CHANGED = '.pairingbuddy/run/changed.json'
const ARTIFACTS = '.pairingbuddy/run/task/artifacts'

// seconds: how long the agent's turn took, from its turn.complete; absent until it finishes.
export type Spawn = { kind: 'Agent' | 'workflow_agent'; name: string; subagentType?: string; startedAt?: string; agentId?: string; finished?: boolean; seconds?: number }
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
// task: what the runs pb kept say of the whole task once it has ended (endedTaskFacts in shared-node/task-runs.mjs).
// waited: the seconds its runs waited on the human, which SPENT leaves out.
export type TaskFacts = { spend: Spend; startedAt: string | null; endedAt: string; waited?: number; calls: Call[]; prUrl: string | null }
export type Inputs = { task?: TaskFacts | null; unitOpen?: boolean; ledger: Ledger; spawns: Spawn[]; calls?: Call[]; tests: string[]; testsComplete: boolean; now: number | undefined; unit?: Unit | null; since?: string; waited?: number; changed?: string[] | null; codeRun?: CodeRun | null; prUrl?: string | null; published?: Published | null }

// Never throws: an absent, empty, truncated or unreadable file reads as undefined.
async function readJson($: EngineInterface, relative: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(`${await $.session.root()}/${relative}`))
  } catch {
    return undefined
  }
}

// The test ids a test list holds, in its order: the placeholders return, or the legacy tests.json (same `tests[].test_id` shape).
function listedTests(file: unknown): string[] {
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
  return readInputsAndTests($, spawns)
}

// The newest standing return of a role in the task's artifacts, or undefined when none reads. Never throws.
async function readStandingReturn($: EngineInterface, ledger: Ledger, match: (ledger: unknown) => (key: unknown) => boolean): Promise<unknown> {
  try {
    const entries = await $.fs.list(`${await $.session.root()}/${ARTIFACTS}`)
    const key = newestKeyAmong(entries.filter(entry => entry.kind === 'file').map(entry => entry.name), match(ledger))
    if (key === null) return undefined
    const artifact = (await readJson($, `${ARTIFACTS}/${key}.json`)) as { pb_key?: unknown } | undefined
    return artifact?.pb_key === key ? artifact : undefined
  } catch {
    return undefined
  }
}

// The inputs, with the test list from the placeholders return a stage wrote (a new-path run writes no tests.json), else
// the legacy tests.json.
// Claude Code's permission prompt, while it stands, reads as the question waiting on the human (withPermissionAsk), so STATUS,
// the band and the alert treat it as any NEEDS YOU.
async function readInputsAndTests($: EngineInterface, spawns: Spawn[]): Promise<Inputs> {
  const [read, legacyFile, now] = await Promise.all([readJson($, LEDGER) as Promise<Ledger>, readJson($, TESTS), readClock($)])
  const ledger = withPermissionAsk(read) as Ledger
  const testsFile = (await readStandingReturn($, ledger, isStandingTests)) ?? legacyFile
  return inputsOf({ ledger, testsFile, now, spawns })
}

function inputsOf({ ledger, testsFile, now, spawns }: { ledger: Ledger; testsFile: unknown; now: number | undefined; spawns: Spawn[] }): Inputs {
  const listed = listedTests(testsFile)
  const seen = seenTests(ledger)
  if (seen.length === 0) return { ledger, spawns, tests: listed, testsComplete: true, now }
  // A test list that holds every seen test is the whole planned list; otherwise the seen tests alone, with no invented total.
  const planned = plannedTests(listed, seen)
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

export type Polled = { ledger: Ledger | null; tests: string[]; testsComplete: boolean; now: number | null; unit: Unit | null; changed: string[] | null; since?: string | null; codeRun?: CodeRun | null; prUrl?: string | null; task?: TaskFacts | null }

// The pieces the poller reads; spawns are the mod's own, so render takes them from memory.
export async function pollInputs($: EngineInterface): Promise<Polled> {
  const [{ ledger, tests, testsComplete, now }, unitFile, changedFile] = await Promise.all([readInputsAndTests($, []), readJson($, UNIT), readJson($, CHANGED)])
  return { ledger: ledger ?? null, tests, testsComplete, now: now ?? null, unit: unitOf(unitFile), changed: changedOf(changedFile) }
}

type PolledState = { ledger: unknown; tests: string[]; testsComplete?: boolean; now: number | null; unit?: Unit | null; since?: string | null; changed?: string[] | null; codeRun?: CodeRun | null; prUrl?: string | null; task?: TaskFacts | null } | null

// The one place the atom's loosely typed ledger is narrowed; null until the first poll, which reads as idle.
export function fromPolled(polled: PolledState, spawns: Spawn[], calls: Call[] = [], published: Published | null = null): Inputs {
  return {
    ledger: (polled?.ledger ?? undefined) as Ledger, spawns, calls, tests: polled?.tests ?? [], testsComplete: polled?.testsComplete ?? false, now: polled?.now ?? undefined,
    unit: polled?.unit ?? null, since: polled?.since ?? undefined,
    changed: polled?.changed ?? null, codeRun: polled?.codeRun ?? null, prUrl: polled?.prUrl ?? null, published, task: polled?.task ?? null,
  }
}

export type ScenarioRow = { description: string; tests: string[] }

// The scenarios that stand, by the rule pb gate eval reads them with for the scenarios question, or undefined when they do not read.
async function readScenarios($: EngineInterface, ledger: Ledger): Promise<ScenarioRow[] | undefined> {
  const artifact = (await readStandingReturn($, ledger, isStandingScenarios)) as { scenarios?: unknown } | undefined
  return artifact ? scenarioRows(artifact.scenarios) : undefined
}

// Where pb keeps each ended run (keepRun in shared-node/unit-files.mjs): reports/runs/<runId>/ with its ledger, its returns
// and kept.json, which names its unit, when it ended and the pull request a publish opened.
const KEPT_RUNS = '.pairingbuddy/reports/runs'

// A kept run as the report reads it: its returns stand in for the session's calls, so a review outlives the session.
export type KeptRun = { ledger: Ledger; unit: string | null; endedAt?: string; prUrl?: string; calls: Call[]; scenarios?: ScenarioRow[] }

// One kept run, or null when its ledger does not read. A return whose pb_key is not its file's name is left out.
async function readKeptRun($: EngineInterface, dir: string): Promise<KeptRun | null> {
  const [kept, ledger] = await Promise.all([readJson($, `${dir}/kept.json`), readJson($, `${dir}/ledger.json`)]) as [{ unit?: unknown; endedAt?: unknown; prUrl?: unknown } | undefined, Ledger]
  if (!ledger || typeof ledger !== 'object') return null
  let names: string[] = []
  try {
    names = (await $.fs.list(`${await $.session.root()}/${dir}/artifacts`)).filter(entry => entry.kind === 'file').map(entry => entry.name)
  } catch {
    // A run with no returns kept still reports its ledger.
  }
  const returns = await Promise.all(names.filter(name => name.endsWith('.json') && !name.startsWith('.')).map(async name => ({ key: name.slice(0, -'.json'.length), input: await readJson($, `${dir}/artifacts/${name}`) as Record<string, unknown> | undefined })))
  const calls = returns.filter(({ key, input }) => input?.pb_key === key).map(({ input }) => ({ input: input as Record<string, unknown> }))
  const scenariosKey = newestKeyAmong(names, isStandingScenarios(ledger))
  const scenarios = scenariosKey === null ? undefined : scenarioRows(calls.find(call => call.input.pb_key === scenariosKey)?.input.scenarios)
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)
  return { ledger, unit: text(kept?.unit) ?? null, endedAt: text(kept?.endedAt), prUrl: text(kept?.prUrl), calls, scenarios }
}

// Every run pb kept, in no order. Never throws: a folder that does not list is no runs, and a run that does not read is left out.
// cache: the runs read before, by folder. pb writes a run's kept.json last and never changes it after, so a run read with its
// end is read once; one read before its end is read again.
export async function readKeptRuns($: EngineInterface, cache?: Map<string, KeptRun>): Promise<KeptRun[]> {
  try {
    const entries = await $.fs.list(`${await $.session.root()}/${KEPT_RUNS}`)
    const read = async (name: string) => {
      const known = cache?.get(name)
      if (known) return known
      const run = await readKeptRun($, `${KEPT_RUNS}/${name}`)
      if (run?.endedAt) cache?.set(name, run)
      return run
    }
    const runs = await Promise.all(entries.filter(entry => entry.kind === 'dir').map(entry => read(entry.name)))
    return runs.filter((run): run is KeptRun => run !== null)
  } catch {
    return []
  }
}

// What the report lists in full where a gate question folds: the standing scenarios and every changed file. Never throws.
export async function readReportLists($: EngineInterface, ledger: Ledger): Promise<{ scenarios?: ScenarioRow[]; changed: string[] | null }> {
  const [scenarios, changedFile] = await Promise.all([readScenarios($, ledger), readJson($, CHANGED)])
  return { scenarios, changed: changedOf(changedFile) }
}
