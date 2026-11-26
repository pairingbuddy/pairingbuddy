import type { AgentSpawnInput, EngineInterface } from 'claude-code'
import { isStandingScenarios, isStandingTests, newestKeyAmong, scenarioRows } from '../shared-node/standing-scenarios.mjs'
import { withPermissionAsk } from '../shared-node/permission-wait.mjs'
import { standingGateOff, withGateOff } from '../shared-node/gate-off.mjs'
import { withStranded } from '../shared-node/stranded.mjs'
import { readLabel } from '../shared-node/labels.mjs'
import { boxesUnder, humanTasksLeft } from '../shared-node/plan-text.mjs'
import { parsePlan } from '../shared-node/plan.mjs'
import { openQuestions } from '../shared-node/questions.mjs'

const TESTS = '.pairingbuddy/tests.json'
const LEDGER = '.pairingbuddy/run/task/ledger.json'
const UNIT = '.pairingbuddy/run/unit.json'
const CHANGED = '.pairingbuddy/run/changed.json'
const ARTIFACTS = '.pairingbuddy/run/task/artifacts'
const GATE_OFF = '.pairingbuddy/run/gate-off.json'
// The project's shim for pb (shared-node/verbs.mjs SHIM), which the take-over line names.
const SHIM = '.pairingbuddy/bin/pb'

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
  plan?: { path?: string; title?: string }
  stop?: { code?: string; reason?: string; seq?: number; fix?: string }
  needsHuman?: { gate?: string | null; seq?: number; fix?: string; askedAt?: string }
  // When the run stopped working, which SPENT's clock stops at (glance's pausedAtOf); set by the mod, never by pb.
  pausedAt?: number
} | undefined

export type Call = { agentId?: unknown; at?: string; input: Record<string, unknown> }
// unit: the open unit, by its identity (branch and base) and its last ended task's steps; since: when the unit's first run began.
// prUrl: the pull request the unit record names, once pb publish has opened it.
// humanLeft: the unit's [HUMAN] tasks its plan still has unticked, which a person does before pb publishes the unit.
// open: the unit record as unitStates reads it, to tell each plan unit's state.
export type OpenUnit = { unit?: string; plan?: string; tracer?: string; tasks: { title: string; headSha?: string }[]; branch?: string; base?: string; commits?: string[]; questions?: unknown[]; questionsMore?: number }
// questions: how many doubts auto passes set aside for the human, waiting on the unit until G:publish asks them.
// asked: every question the unit was ever given, answered or not, with the text of those kept in full, for the quiet notice.
export type Unit = { key: string; taskStages: string[]; prUrl?: string; humanLeft?: string[]; open?: OpenUnit; questions?: number; asked?: { count: number; texts: string[] } }
// What the pane keeps of the unit's last code run (shared-node/end-state.mjs codeRunOf), so the end state outlives its ledger.
export type CodeRun = { runId?: string; task?: string; taskEndPassed: boolean; testsPassing: number; perTest?: Record<string, { green?: { passed: boolean }; covered?: { done: boolean } }>; safetyNet: { attempt?: number; startedAt?: string } | null; rollbacks: unknown[] }
// What the last pb publish printed: the url it opened, or the result when it opened none; codeRunId ties it to the code run it
// published, and unitKey to the unit that was open, for a publish whose code run the pane did not know.
export type Published = { url?: string; result?: string; codeRunId?: string | null; unitKey?: string | null }
// changed: the paths run/changed.json lists (null when it does not read); prUrl: the unit's pull request as the poller last saw it.
// unitOpen: whether a unit is open now, for a finished run drawn from its snapshot (whose unit is the one it last saw).
// task: what the runs pb kept say of the whole task once it has ended (endedTaskFacts in shared-node/task-runs.mjs).
// ran: the seconds its runs ran, each from its own start to its end, so the time between runs is left out (NaN when unknown).
// waited: the seconds its runs waited on the human, which SPENT leaves out.
export type TaskFacts = { spend: Spend; startedAt: string | null; endedAt: string; ran?: number; waited?: number; calls: Call[]; prUrl: string | null }
// earlierAgents: what the live run's task spent in agents in its earlier runs, the ones pb kept; earlier: all they spent.
// planUnit: the open unit the PLAN tree reads, when it is not `unit` (an ended run's view keeps the unit it last saw, the tree the one open now).
// What a live run's task spent in its earlier runs pb kept: agents and tokens summed, when the first began, the seconds they
// ran (each its own span, NaN when unknown), their waits, and the returns they kept.
export type EarlierSpend = { agents: number; tokens: number; tokensKnown: boolean; startedAt: string | null; ran?: number; waited: number; calls: Call[] }
export type Inputs = { earlierAgents?: number; earlier?: EarlierSpend | null; plan?: PlanRead | null; planPath?: string | null; planUnit?: Unit | null; task?: TaskFacts | null; unitOpen?: boolean; ledger: Ledger; spawns: Spawn[]; calls?: Call[]; tests: string[]; testsComplete: boolean; now: number | undefined; unit?: Unit | null; since?: string; ranFor?: number; waited?: number; changed?: string[] | null; codeRun?: CodeRun | null; prUrl?: string | null; published?: Published | null }

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

// A stop or a question with no time of its own (a stop carries none) stops SPENT's clock at the ledger's last write, which
// is the one that raised it, since nothing runs after it.
function pausedAtLastWrite(ledger: Ledger, writtenMs: number | undefined): Ledger {
  if (!ledger || !(ledger.stop || ledger.needsHuman) || ledger.pausedAt !== undefined || ledger.needsHuman?.askedAt || writtenMs === undefined) return ledger
  return { ...ledger, pausedAt: writtenMs }
}

// Whether a file under the root is there. Never throws.
async function exists($: EngineInterface, relative: string): Promise<boolean> {
  try {
    return await $.fs.exists(`${await $.session.root()}/${relative}`)
  } catch {
    return false
  }
}

// When a file under the root was last written, or undefined when it does not stat. Never throws.
async function writtenMs($: EngineInterface, relative: string): Promise<number | undefined> {
  try {
    return (await $.fs.stat(`${await $.session.root()}/${relative}`)).mtimeMs
  } catch {
    return undefined
  }
}

// The gate-watch marker while it stands (shared-node/gate-off.mjs), else null. gate-boot.mjs is stat'd so a restored file
// clears it at once, before any hook runs again; a stat that fails leaves it standing. Never throws.
async function readGateOff($: EngineInterface): Promise<unknown> {
  const marker = (await readJson($, GATE_OFF)) as { path?: unknown } | undefined
  if (!marker || typeof marker.path !== 'string') return null
  let stat: { mtimeMs: number; size: number } | null = null
  try {
    stat = await $.fs.stat(marker.path)
  } catch {
    // Out of reach or gone: the marker stands.
  }
  return standingGateOff(marker, stat)
}

// The inputs, with the test list from the placeholders return a stage wrote (a new-path run writes no tests.json), else
// the legacy tests.json.
// Claude Code's permission prompt, while it stands, reads as the question waiting on the human (withPermissionAsk), so STATUS,
// the band and the alert treat it as any NEEDS YOU.
async function readInputsAndTests($: EngineInterface, spawns: Spawn[]): Promise<Inputs> {
  const [read, legacyFile, now, gateOff, ledgerWrittenMs, shim] = await Promise.all([readJson($, LEDGER) as Promise<Ledger>, readJson($, TESTS), readClock($), readGateOff($), writtenMs($, LEDGER), exists($, SHIM)])
  const last = spawns.at(-1)
  const stageRanHere = spawns.some(spawn => readLabel(spawn.name).stage === read?.stage?.name)
  const seen = { now, ledgerWrittenMs, spawnAt: last?.startedAt, spawnRunning: spawns.some(spawn => !spawn.finished), shim, stageRanHere }
  const ledger = pausedAtLastWrite(withGateOff(withStranded(withPermissionAsk(read), seen), gateOff) as Ledger, ledgerWrittenMs)
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
  const { unit, plan, tracer, base, commits } = file as { unit?: unknown; plan?: unknown; tracer?: unknown; base?: unknown; commits?: unknown }
  // Each task's title, with the last commit pb recorded for it, which tells the plan page whose commits are whose.
  const named = tasks
    .map(task => task as { title?: unknown; headSha?: unknown })
    .filter((task): task is { title: string; headSha?: unknown } => typeof task?.title === 'string')
    .map(({ title, headSha }) => (typeof headSha === 'string' ? { title, headSha } : { title }))
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  const open: OpenUnit = {
    unit: text(unit), plan: text(plan), tracer: text(tracer), tasks: named,
    branch, base: text(base), commits: Array.isArray(commits) ? commits.filter((sha): sha is string => typeof sha === 'string') : [],
  }
  const { kept, more, count } = openQuestions(file)
  // The questions ride on the open unit too, so the /pb-plan page lists them under it (bounded by QUESTIONS_KEPT).
  if (count > 0) Object.assign(open, { questions: kept, ...(more > 0 ? { questionsMore: more } : {}) })
  const listed = Array.isArray((file as { questions?: unknown }).questions) ? ((file as { questions: { ambiguity?: unknown }[] }).questions) : []
  const asked = { count: listed.length + more, texts: listed.map(question => String(question?.ambiguity ?? '')) }
  return { key: `${branch} ${String(baseSha)}`, taskStages: [...new Set(stages)], ...(typeof url === 'string' && url !== '' ? { prUrl: url } : {}), open, ...(count > 0 ? { questions: count } : {}), ...(asked.count > 0 ? { asked } : {}) }
}

// A plan path the unit record names is read only inside the repo: relative, with no ".." part.
const inRepo = (path: unknown): path is string => typeof path === 'string' && path !== '' && !path.startsWith('/') && !path.split(/[\\/]/).includes('..')

// The unit with the [HUMAN] tasks its plan still has unticked under its heading, as pb publish reads them. A unit with no
// plan, or a plan that does not read, has none. Never throws.
async function withHumanLeft($: EngineInterface, unit: Unit | null, file: unknown): Promise<Unit | null> {
  const { plan, unit: name } = (file ?? {}) as { plan?: unknown; unit?: unknown }
  if (!unit || !inRepo(plan) || typeof name !== 'string' || name === '') return unit
  try {
    const text = await $.fs.read(`${await $.session.root()}/${plan}`)
    const left = humanTasksLeft(boxesUnder(text, name))
    return left.length > 0 ? { ...unit, humanLeft: left } : unit
  } catch {
    return unit
  }
}

// The paths run/changed.json lists ({ path, status } entries), or null when it is absent or does not read.
export function changedOf(file: unknown): string[] | null {
  if (!Array.isArray(file)) return null
  return file.map(entry => (entry as { path?: unknown })?.path).filter((path): path is string => typeof path === 'string' && path !== '')
}

export type PlanRead = ReturnType<typeof parsePlan>

// Where the plan is: the path the ledger names, else the one the open unit's unit.json names, else the one the last run pb
// kept names. A publish run's ledger names none, and with no run going there is no ledger and, once published, no unit.
// Only a path inside the repo counts.
async function planPathOf($: EngineInterface, ledger: Ledger | null, unitFile: unknown, cache?: Map<string, KeptRun>): Promise<string | null> {
  const named = [ledger?.plan?.path, (unitFile as { plan?: unknown } | undefined)?.plan].find(inRepo)
  if (named) return named
  const newestFirst = (await readKeptRuns($, cache)).sort((a, b) => (Date.parse(b.endedAt ?? '') || 0) - (Date.parse(a.endedAt ?? '') || 0))
  return newestFirst.map(run => run.ledger?.plan?.path).find(inRepo) ?? null
}

// The plan MD at `path`, parsed, or null when there is no path or the file is missing, empty or unreadable. Never throws.
async function readPlan($: EngineInterface, path: string | null): Promise<PlanRead | null> {
  if (path === null) return null
  try {
    const text = await $.fs.read(`${await $.session.root()}/${path}`)
    return text.trim() === '' ? null : parsePlan(text)
  } catch {
    return null
  }
}

export type Polled = { ledger: Ledger | null; tests: string[]; testsComplete: boolean; now: number | null; unit: Unit | null; changed: string[] | null; plan?: PlanRead | null; planPath?: string | null; since?: string | null; codeRun?: CodeRun | null; prUrl?: string | null; task?: TaskFacts | null; earlierAgents?: number; earlier?: EarlierSpend | null }

// The pieces the poller reads; spawns are the mod's own, so render takes them from memory.
// spawns: this session's, so a stage its own agents are still running never reads as stranded.
// kept: the kept runs read before, by folder (readKeptRuns).
export async function pollInputs($: EngineInterface, spawns: Spawn[] = [], kept?: Map<string, KeptRun>): Promise<Polled> {
  const { ledger, tests, testsComplete, now } = await readInputsAndTests($, spawns)
  const [unitFile, changedFile] = await Promise.all([readJson($, UNIT), readJson($, CHANGED)])
  // The plan is named by the ledger, the unit record or a kept run, so it is read once they are.
  const planPath = await planPathOf($, ledger ?? null, unitFile, kept)
  const plan = await readPlan($, planPath)
  return { ledger: ledger ?? null, tests, testsComplete, now: now ?? null, unit: await withHumanLeft($, unitOf(unitFile), unitFile), changed: changedOf(changedFile), plan, planPath: plan ? planPath : null }
}

type PolledState = { plan?: PlanRead | null; planPath?: string | null; ledger: unknown; tests: string[]; testsComplete?: boolean; now: number | null; unit?: Unit | null; since?: string | null; changed?: string[] | null; codeRun?: CodeRun | null; prUrl?: string | null; task?: TaskFacts | null; earlierAgents?: number; earlier?: EarlierSpend | null } | null

// The one place the atom's loosely typed ledger is narrowed; null until the first poll, which reads as idle.
export function fromPolled(polled: PolledState, spawns: Spawn[], calls: Call[] = [], published: Published | null = null): Inputs {
  return {
    ledger: (polled?.ledger ?? undefined) as Ledger, spawns, calls, tests: polled?.tests ?? [], testsComplete: polled?.testsComplete ?? false, now: polled?.now ?? undefined,
    unit: polled?.unit ?? null, since: polled?.since ?? undefined,
    plan: polled?.plan ?? null, planPath: polled?.planPath ?? null, changed: polled?.changed ?? null, codeRun: polled?.codeRun ?? null, prUrl: polled?.prUrl ?? null, published, task: polled?.task ?? null, earlierAgents: polled?.earlierAgents ?? 0, earlier: polled?.earlier ?? null,
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
