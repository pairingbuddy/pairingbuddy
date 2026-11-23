import type { ElementTable } from 'claude-code'
import { currentStep, gateLine, glance, needsYouLine, pausedAtOf, stageOf, stopName } from '../shared-node/glance.mjs'
import { isStageActive, stageNamesFor } from '../shared-node/stage-graph.mjs'
import contract from '../shared-node/stages-contract.mjs'
import { lensRound } from '../shared-node/lens-round.mjs'
import type { LensRound } from '../shared-node/lens-round.mjs'
import { unitStates } from '../shared-node/plan.mjs'
import { plainName } from '../shared-node/plain-names.mjs'
import { cycleMarker, progressRow, shortName, stepAge, testCounts } from '../shared-node/now-building.mjs'
import { doneStatus, endRows, goalOf, isUnitDone, prTitleOf, safetyNetRound } from '../shared-node/end-state.mjs'
import type { Inputs, Ledger, OpenUnit } from './inputs'
import { STATUS_LOOKS } from './pane'

export type Tone = 'error' | 'warning' | 'dim'
// lit: where the run is now, drawn as the pane draws its current step (the accent with bold, the phase word in its colour).
// state: the segment leads the band with the run's status; its text opens with that state's band head (or, in its short form,
// the mark alone). short: the text fitBand takes when the room is short. shorter: the texts, longest first, a lead segment
// left alone takes before it is cut.
export type Segment = { id: string; text: string; short?: string; shorter?: string[]; standing?: boolean; tone?: Tone; bold?: boolean; lit?: boolean; state?: StatusState }
export type Rows = Record<'now' | 'spent', string>
export type RowTones = Partial<Record<keyof Rows, Tone>>
// What STATUS says, so the human cycling sessions sees at once whether they are needed: the run's state, then what it is about
// (the step, the question, why it stopped, the verdict). quiet: nothing runs and nothing waits on the human.
export type StatusState = 'needsYou' | 'stopped' | 'done' | 'working' | 'quiet'
// fix: the one line that puts it right, when the state has one (the safety checks are off), drawn on its own line.
export type Status = { state: StatusState; what?: string; fix?: string }
// The kit's own types for the elements a render hook draws with: text only, as neither the band nor the pane has a control.
export type Tags = Pick<ElementTable, 'Box' | 'Text'>

// count: how many of the planned tests are done (or covered), once the total is known; settled once the build step is over.
export type Progress = { known?: boolean; count?: { total: number; done: number; covered: number; settled: boolean }; folded?: number; coveredFolded?: number; more?: number; entries: { id: string; name: string; mark: 'done' | 'current' | 'waiting' | 'covered' }[] }
export type TestLine = { current?: string; marker: { steps: { name: string; lit: boolean; mark: string }[] }; age?: string }

export type View = {
  ledger: Ledger
  ended?: boolean
  between?: string
  running: boolean
  rows: Rows
  band: Segment[]
  unknownLabels: string[]
  rowTones?: RowTones
  waiting?: boolean
  // The pane's STEPS, TESTS, TEST and REVIEW rows; an absent one reads as a dash.
  steps: string[]
  progress?: Progress
  test?: TestLine
  lensRound?: LensRound
  // The GOAL row: the task's first sentence from the moment the run knows its task, else a dash.
  goal: string
  // The STATUS row: what state the run is in (working, needs you, stopped, done, or quiet) and what about.
  status: Status
  // The unit's work is over with nothing left to run: the done alert fires on it.
  done?: boolean
  // The BUILT (done) and PR rows, each a dash until the task is done; endRound, once the work is finished, is the review the REVIEW row sums up.
  end: EndRows
  endRound?: LensRound
  // The plan the ledger names, parsed, for the PLAN tree; absent when there is none.
  plan?: Inputs['plan']
  // The state of each plan unit, by position (shared-node/plan.mjs unitStates).
  planStates?: string[]
  // The open unit's record, whose branch, base and commits the PLAN tree shows under the plan unit it names.
  planOpen?: OpenUnit
  // The open unit's PR link, shown with it when there is no plan.
  planOpenPr?: string
}

type PlannedUnits = NonNullable<Inputs['plan']>['units']

// A unit shows a PR or a [HUMAN] task: something for its state to say even with no unit record.
function hasStateToTell(units: PlannedUnits): boolean {
  return units.some(planned => planned.pr || planned.tasks.some(task => task.human))
}

// A record names its unit, or only its tracer: then it is the first plan unit under that tracer.
export function resolveOpenUnit(units: PlannedUnits, open: NonNullable<NonNullable<Inputs['unit']>['open']>) {
  const isPlanned = units.some(planned => planned.unit === open.unit)
  const underTracer = isPlanned || !open.tracer ? undefined : units.find(planned => planned.tracer === open.tracer)
  return underTracer ? { ...open, unit: underTracer.unit } : open
}

// Each plan unit's state, in plan order, once a unit record stands to read it against; else none.
function planStatesOf(inputs: Inputs): string[] | undefined {
  const { plan, unit, ledger } = inputs
  if (!plan) return undefined
  const open = unit?.open
  const planPath = inputs.planPath ?? ledger?.plan?.path
  if (open) return unitStates(plan.units, { plan: planPath, openUnit: resolveOpenUnit(plan.units, open) })
  return hasStateToTell(plan.units) ? unitStates(plan.units, { plan: planPath, openUnit: undefined }) : undefined
}

// What the PLAN tree reads: the plan, each unit's state, and the open unit with its PR link.
function planFields(inputs: Inputs): Pick<View, 'plan' | 'planStates' | 'planOpen' | 'planOpenPr'> {
  return { plan: inputs.plan, planStates: planStatesOf(inputs), planOpen: inputs.unit?.open, planOpenPr: inputs.unit?.prUrl }
}

export type EndRows = Record<'done' | 'pr', string>
const NO_END: EndRows = { done: '—', pr: '—' }

const EMPTY = '—'
const NO_RUN_ROWS: Rows = { now: 'no run', spent: EMPTY }

const isUnknown = (text: string) => text === '-' || text === EMPTY || /unknown$/.test(text)

function bandTone(segment: Segment, ledger: NonNullable<Ledger>): Pick<Segment, 'tone' | 'bold' | 'lit'> {
  if (segment.id === 'needsYou') {
    if (!segment.standing) return {}
    return ledger.needsHuman?.gate ? { tone: 'warning', bold: true } : { tone: 'error' }
  }
  if (segment.id === 'spent' || isUnknown(segment.text)) return { tone: 'dim' }
  return segment.id === 'where' ? { lit: true } : {}
}

const waitingGate = (ledger: NonNullable<Ledger>) => (ledger.stop ? undefined : ledger.needsHuman?.gate || undefined)

// The band leads with the run's status, as STATUS does. A question or a stop leads in its block, with what it needs or why,
// and the step behind it is a detail, no longer lit. While nothing waits on the human, the step leads behind the working mark,
// and the calm "needs you: no" is left out: the mark already says it.
export function statusFirst(band: Segment[], ledger?: Ledger): Segment[] {
  const standing = band.find(segment => segment.id === 'needsYou' && segment.standing)
  if (standing) {
    const status: Status = ledger?.stop ? { state: 'stopped', what: stopName(ledger.stop) } : { state: 'needsYou', what: gateLine(ledger?.needsHuman?.gate) }
    const look = STATUS_LOOKS[status.state]
    const lead = { ...standing, state: status.state, text: [look.bandHead, status.what].filter(Boolean).join(look.sep), short: [look.mark, status.what].filter(Boolean).join(' ') }
    return [lead, ...band.filter(segment => segment !== standing).map(segment => ({ ...segment, lit: undefined }))]
  }
  const working = STATUS_LOOKS.working.bandHead
  const led = (text: string) => `${working} ${text}`
  return band
    .filter(segment => segment.id !== 'needsYou')
    .map(segment => (segment.id === 'where' ? { ...segment, text: led(segment.text), ...(segment.shorter && { shorter: segment.shorter.map(led) }), state: 'working' as const } : segment))
}

// The band names the test the run is on after its phase, as TESTS does, then its place once the total is known:
// `GREEN · <name> · 3/12`. Short of room the place gives way first, then the name is cut at a word, then the test's number
// stands in (glance's `GREEN · test 3 of 12`).
export function namedWhere(band: Segment[], { ledger, spawns, tests, testsComplete }: Pick<Inputs, 'ledger' | 'spawns' | 'tests' | 'testsComplete'>): Segment[] {
  const step = currentStep(spawns, stageOf(ledger))
  if (!step || !tests.includes(step.item)) return band
  const words = shortName(step.item).split(' ')
  const as = (count: number) => `${step.phase} · ${words.slice(0, count).join(' ')}`
  const cuts = Array.from({ length: words.length - 1 }, (_, i) => as(words.length - 1 - i))
  const whole = as(words.length)
  const placed = testsComplete ? [`${whole} · ${tests.indexOf(step.item) + 1}/${tests.length}`] : []
  return band.map(segment => {
    if (segment.id !== 'where') return segment
    const [text, ...shorter] = [...placed, whole, ...cuts, segment.text]
    return { ...segment, text, shorter }
  })
}

function toned(view: View): View {
  const { ledger } = view
  if (!ledger) return view
  return { ...view, band: statusFirst(view.band.map(segment => ({ ...segment, ...bandTone(segment, ledger) })), ledger), rowTones: { spent: 'dim' } }
}

// The run's own steps for its task type, each marked done, current or to come.
export function stepLines(ledger: Ledger, ended = false): string[] {
  if (!ledger) return []
  const done = new Set((ledger?.stages ?? []).filter(stage => stage.status === 'done').map(stage => stage.name))
  const current = !ended && ledger?.stage?.status === 'active' ? ledger.stage.name : undefined
  return stageNamesFor(contract, ledger).map((name: string) => {
    const mark = name === current ? '▸' : done.has(name) ? '✓' : '○'
    return `${mark} ${plainName(name) ?? name}`
  })
}

const PUBLISH_STEP = 'pr-draft'
const BUILT = '✓ build the change'
const isPublishRun = (ledger: Ledger) => ledger?.kind === 'publish'
// A spike closes its unit kept local at its sign-off, so it has no publish step.
const KEPT_LOCAL_TYPES = ['spike']

// STEPS is the whole unit: the code steps for the task type, then the publish step (none for a spike). In the publish run the code steps are the
// unit's last task's, all done; when the unit does not say which they were, one done line stands for them.
function unitSteps({ ledger, unit }: Inputs, ended: boolean): string[] {
  const own = stepLines(ledger, ended)
  if (isPublishRun(ledger)) {
    const code = unit?.taskStages?.length ? unit.taskStages.map(name => `✓ ${plainName(name) ?? name}`) : [BUILT]
    return [...code, ...own]
  }
  return publishesAfter({ ledger, unit }) ? [...own, `○ ${plainName(PUBLISH_STEP)}`] : own
}

// A code run in an open unit is followed by the publish run, unless its type closes kept local.
const publishesAfter = ({ ledger, unit }: Pick<Inputs, 'ledger' | 'unit'>) => Boolean(unit) && !KEPT_LOCAL_TYPES.includes(ledger?.taskType ?? '')

// The TESTS row's progress: each test by its mark and short name, or undefined when there is no test to show.
function progressOf({ tests, perTest, spawns, testsComplete, stage, settled }: { tests: string[]; perTest: unknown; spawns: Inputs['spawns']; testsComplete: boolean; stage: unknown; settled: boolean }) {
  const rows = tests.map(id => ({ test_id: id }))
  const row = progressRow({ tests: rows, perTest, spawns, testsComplete, stage, settled: settled && testsComplete })
  const named = row.entries.map((entry: { id: string; mark: Progress['entries'][number]['mark'] }) => ({ ...entry, name: shortName(entry.id) }))
  const count = testsComplete && rows.length > 0 ? { count: { ...testCounts({ tests: rows, perTest }), settled } } : {}
  return named.length > 0 || row.folded || row.coveredFolded ? { ...row, known: testsComplete, ...count, entries: named } : undefined
}

// A publish run has no tests of its own, so TESTS keeps the finished code run's: the test list's order when it holds every one
// the code run recorded, else the recorded ones, which are the whole list once the code run was signed off. No test is current.
// With no code run seen, the test list alone shows nothing.
function codeRunProgress({ codeRun, tests }: Inputs): Pick<View, 'progress'> {
  const perTest = codeRun?.perTest ?? {}
  const recorded = Object.keys(perTest)
  if (recorded.length === 0) return {}
  const planned = tests.length > 0 && recorded.every(id => tests.includes(id))
  return { progress: progressOf({ tests: planned ? tests : recorded, perTest, spawns: [], testsComplete: planned || codeRun?.taskEndPassed === true, stage: undefined, settled: true }) }
}

const BUILD_STEP = 'code-tdd'
// The build step is running: tests are still being written and made to pass.
const isBuilding = (ledger: Ledger) => ledger?.stage?.name === BUILD_STEP && ledger.stage.status === 'active'
const buildDone = (ledger: Ledger) => (Array.isArray(ledger?.stages) ? ledger.stages : []).some(stage => stage?.name === BUILD_STEP && stage.status === 'done')

// The TESTS and TEST parts, folded from the same inputs as the rows. Only the active stage's spawns count, so outside
// "build test by test" no test is current and TEST reads as a dash. A retry is STATUS's to tell.
function buildTestRows(inputs: Inputs, ended: boolean): Pick<View, 'progress' | 'test'> {
  const { ledger, spawns, tests, testsComplete, now } = inputs
  if (isPublishRun(ledger)) return codeRunProgress(inputs)
  const stage = stageOf(ledger)
  const perTest = ledger?.tests?.perTest
  // An ended run has no current step, so its last test reads done, not current.
  const settled = ended || !isBuilding(ledger)
  // Once the build step is done, every test it ran is in the ledger: the seen tests are the whole list.
  const complete = testsComplete || (settled && buildDone(ledger))
  const progress = progressOf({ tests, perTest, spawns: ended ? [] : spawns, testsComplete: complete, stage, settled })
  const step = ended ? undefined : currentStep(spawns, stage)
  if (!step) return { progress }
  const test = { current: shortName(step.item), marker: cycleMarker({ spawns, ledger }), age: stepAge({ spawns, now, stage, pausedAt: pausedAtOf(ledger), ledger }) }
  return { progress, test }
}

// The pull request as far as it is known: what pb publish printed for this code run, else the url the unit record names.
function prOf({ published, prUrl, codeRun, calls = [] }: Inputs) {
  const title = prTitleOf(calls)
  const ours = published && (published.codeRunId == null || published.codeRunId === codeRun?.runId) ? published : null
  if (ours?.url || ours?.result) return { ...ours, title }
  return prUrl ? { url: prUrl, title } : undefined
}

// The goal: the code run's task (kept through the publish run), else the run's own; a dash while neither names one.
const goalText = ({ codeRun, ledger }: Inputs) => goalOf(codeRun?.task ?? ledger?.task) || EMPTY

// The end rows once the task is done; while no stage runs, the work is finished and its review is told as one summary.
// live: a run's ledger is read now. Done, STATUS says so with the goal's verdict and the pull request.
function endState(inputs: Inputs, running: boolean, live: boolean): Pick<View, 'end' | 'endRound' | 'done'> & { doneStatus?: string } {
  const round = safetyNetRound({ codeRun: inputs.codeRun, calls: inputs.calls, spawns: inputs.spawns })
  const pr = prOf(inputs)
  const end = endRows({ codeRun: inputs.codeRun, changed: inputs.changed, pr }) as EndRows
  const finished = inputs.codeRun?.taskEndPassed === true && !running && round !== undefined
  const unitOpen = inputs.unitOpen ?? Boolean(inputs.unit)
  const done = isUnitDone({ live, codeRun: inputs.codeRun, unitOpen, pr })
  return { end, ...(finished ? { endRound: round } : {}), done, ...(done ? { doneStatus: doneStatus({ codeRun: inputs.codeRun, round, pr }) } : {}) }
}

const STATUS_PART = ' · '
const NEXT_PUBLISH = `next: ${plainName(PUBLISH_STEP)}`

// What comes once the code run is signed off: a [HUMAN] task the unit's plan still has unticked, by its "Task <id>" when it
// has one, since pb publishes nothing until a person does it and ticks its box; else the pull request.
function nextAfterCode(unit: Inputs['unit']): string {
  const human = unit?.humanLeft?.[0]
  if (human === undefined) return NEXT_PUBLISH
  const task = /^Task\s+[^:\s]+(?=:)/.exec(human)?.[0] ?? human.replace(/\[HUMAN\]\s*/, '')
  return `next: you do ${task} and tick its box`
}

// What state a live run is in: stopped, needs you, or working on its step (or between steps).
function liveStatus(view: View, ledger: NonNullable<Ledger>, publishes: boolean, unit: Inputs['unit']): Status {
  if (ledger.stop) return { state: 'stopped', what: stopName(ledger.stop), ...(ledger.stop.fix ? { fix: ledger.stop.fix } : {}) }
  const gate = waitingGate(ledger)
  if (gate) return { state: 'needsYou', what: gateLine(gate), ...(ledger.needsHuman?.fix ? { fix: ledger.needsHuman.fix } : {}) }
  if (view.between === ALL_DONE && publishes && !isPublishRun(ledger)) return { state: 'working', what: nextAfterCode(unit) }
  return { state: 'working', what: view.rows.now }
}

// A run that is over: done, waiting on the publish run, or ended without the sign-off.
function endedStatus(inputs: Inputs, end: { doneStatus?: string }): Status {
  if (end.doneStatus) return { state: 'done', what: end.doneStatus }
  if (inputs.codeRun?.taskEndPassed === true) return { state: 'quiet', what: `between runs${STATUS_PART}${nextAfterCode(inputs.unit)}` }
  return { state: 'quiet', what: `ended${STATUS_PART}not signed off` }
}

// What the band and the pane show for what was read.
export function buildView(inputs: Inputs): View {
  const view = { ...toned(buildPlainView(inputs)), ...planFields(inputs) }
  const { ledger } = inputs
  if (!ledger) return view
  const { doneStatus: _done, ...end } = endState(inputs, view.running, true)
  const status = liveStatus(view, ledger, publishesAfter(inputs), inputs.unit)
  return { ...view, goal: goalText(inputs), status, ...buildTestRows(inputs, false), steps: unitSteps(inputs, false), lensRound: lensRound({ ledger, calls: inputs.calls, spawns: inputs.spawns }), ...end }
}

// agents: the count the task's kept runs recorded, once it has ended; else the live ledger's, its running attempt's spawns and,
// for a live run, its task's earlier kept runs (earlierAgents).
// waited: what an ended task's runs waited on the human; else glance reads the live ledger's own waits.
// live: a run read now, whose clock stops while it waits on the human or is stopped (pausedAtOf); an ended run's never runs on.
const glanceOf = ({ ledger, spawns, tests, testsComplete, now, since, waited, earlierAgents }: Inputs, agents?: number, live = false) => glance({ ledger, spawns, agents, tests, now, since, waited, testsComplete, leaveOutUnknown: true, ...(live ? { pausedAt: pausedAtOf(ledger), earlierAgents } : {}) })

// An ended task as its kept runs tell it: the agents and tokens they recorded, from the first run's start to the last run's
// end less what they waited on the human, their returns in place of the session's, which a reload empties, and the pull request when nothing else named it.
// Without them, the inputs as they are.
function keptTask(inputs: Inputs): Inputs {
  const { task } = inputs
  if (!task) return inputs
  const end = Date.parse(task.endedAt)
  return { ...inputs, ledger: inputs.ledger && { ...inputs.ledger, spend: task.spend }, spawns: [], calls: task.calls, since: task.startedAt ?? inputs.since, waited: task.waited, prUrl: inputs.prUrl ?? task.prUrl, ...(Number.isNaN(end) ? {} : { now: end }) }
}

function buildPlainView(inputs: Inputs): View {
  const { ledger } = inputs
  if (!ledger) return { ledger, running: false, rows: NO_RUN_ROWS, band: [], unknownLabels: [], steps: [], goal: EMPTY, status: { state: 'quiet', what: NO_RUN_ROWS.now }, end: NO_END }
  const running = isStageActive(ledger)
  const shown = glanceOf(inputs, undefined, true)
  const rows = { now: shown.rows.now, spent: shown.rows.spent }
  const named = namedWhere(shown.band, inputs)
  const base = { ledger, running, band: named, unknownLabels: shown.unknownLabels, steps: [], goal: EMPTY, status: { state: 'quiet' as const, what: EMPTY }, end: NO_END }
  const gate = waitingGate(ledger)
  if (gate) {
    const band = running ? named : named.filter((segment: Segment) => segment.id === 'needsYou')
    return { ...base, waiting: true, band, rows: { ...rows, now: needsYouLine(gate) } }
  }
  if (running) return { ...base, rows }
  // A live run with no active stage is between steps, never idle.
  const between = betweenText(ledger)
  return { ...base, between, rows: ledger.stop ? rows : { ...rows, now: between } }
}

const ALL_DONE = 'all steps done'
const RUN_OPEN = 'run open'

// The next stage is the first of the task type's stages not yet done; unknown when none can be named.
function betweenText(ledger: NonNullable<Ledger>): string {
  if (typeof ledger.stage?.status !== 'string') return RUN_OPEN
  const done = new Set((Array.isArray(ledger.stages) ? ledger.stages : []).filter(s => s?.status === 'done').map(s => s.name))
  const next = stageNamesFor(contract, ledger).find((name: string) => !done.has(name))
  if (next === undefined) return ALL_DONE
  const name = plainName(next)
  return name ? `between steps · next: ${name}` : RUN_OPEN
}

// A run that is over, shown from its last snapshot: the same rows, nothing running, and the NOW row says so.
export function buildEndedView(given: Inputs): View {
  // Once the task has ended, its kept runs say what it spent and what its review found.
  const inputs = keptTask(given)
  const { ledger } = given
  const { rows, unknownLabels } = glanceOf(inputs, given.task?.spend.agents)
  const { doneStatus: finished, ...end } = endState(inputs, false, false)
  const view: View = {
    ledger,
    ended: true,
    running: false,
    rows: { now: 'last run finished', spent: rows.spent },
    band: [],
    unknownLabels,
    steps: unitSteps(inputs, true),
    goal: goalText(inputs),
    ...buildTestRows(inputs, true),
    lensRound: ledger ? lensRound({ ledger, calls: inputs.calls, spawns: inputs.spawns, ended: true }) : undefined,
    ...end,
    status: endedStatus(inputs, { doneStatus: finished }),
  }
  // The run is gone, so a stop or a question its last snapshot held colours nothing.
  return { ...toned(view), rowTones: { spent: 'dim' } }
}
