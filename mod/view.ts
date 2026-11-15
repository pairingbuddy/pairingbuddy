import type { ElementTable } from 'claude-code'
import { currentStep, gateLine, glance, needsYouLine, stageOf, stopName } from '../shared-node/glance.mjs'
import { isStageActive, stageNamesFor } from '../shared-node/stage-graph.mjs'
import contract from '../shared-node/stages-contract.mjs'
import { lensRound } from '../shared-node/lens-round.mjs'
import type { LensRound } from '../shared-node/lens-round.mjs'
import { plainName } from '../shared-node/plain-names.mjs'
import { cycleMarker, loopingTries, nameOf, progressRow, stepAge } from '../shared-node/now-building.mjs'
import { doneStatus, endRows, goalOf, isUnitDone, prTitleOf, safetyNetRound } from '../shared-node/end-state.mjs'
import type { Inputs, Ledger } from './inputs'
import { STATUS_LOOKS } from './pane'

export type Tone = 'error' | 'warning' | 'dim'
// lit: where the run is now, drawn as the pane draws its current step (the accent with bold, the phase word in its colour).
// state: the segment leads the band with the run's status; its text opens with that state's band head.
export type Segment = { id: string; text: string; standing?: boolean; tone?: Tone; bold?: boolean; lit?: boolean; state?: StatusState }
export type Rows = Record<'now' | 'spent' | 'looping', string>
export type RowTones = Partial<Record<keyof Rows, Tone>>
// What STATUS says, so the human cycling sessions sees at once whether they are needed: the run's state, then what it is about
// (the step, the question, why it stopped, the verdict). quiet: nothing runs and nothing waits on the human.
export type StatusState = 'needsYou' | 'stopped' | 'done' | 'working' | 'quiet'
export type Status = { state: StatusState; what?: string }
// The kit's own types for the elements a render hook draws with.
export type Tags = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
// The Pane alone also draws the suggest Input.
export type PaneTags = Tags & Pick<ElementTable, 'Input'>

export type Progress = { known?: boolean; folded?: number; coveredFolded?: number; more?: number; entries: { id: string; name: string; mark: 'done' | 'current' | 'waiting' | 'covered' }[] }
export type TestLine = { current?: string; marker: { steps: { name: string; lit: boolean; mark: string }[] }; age?: string }
export type Tries = { step: string; number: number; result: string }[]

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
  tries?: Tries
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
}

export type EndRows = Record<'done' | 'pr', string>
const NO_END: EndRows = { done: '—', pr: '—' }

const EMPTY = '—'
const UNKNOWN = 'unknown'
const NO_RUN_ROWS: Rows = { now: 'no run', spent: EMPTY, looping: EMPTY }

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

// The band leads with the run's status, as STATUS does. While nothing waits on the human, the step leads behind the working
// mark, and the calm "needs you: no" is left out: the mark already says it.
export function statusFirst(band: Segment[]): Segment[] {
  if (band.some(segment => segment.id === 'needsYou' && segment.standing)) return band
  const working = STATUS_LOOKS.working.bandHead
  return band.filter(segment => segment.id !== 'needsYou').map(segment => (segment.id === 'where' ? { ...segment, text: `${working} ${segment.text}`, state: 'working' as const } : segment))
}

function toned(view: View): View {
  const { ledger } = view
  if (!ledger) return view
  return { ...view, band: statusFirst(view.band.map(segment => ({ ...segment, ...bandTone(segment, ledger) }))), rowTones: { spent: 'dim' } }
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

// The TESTS row's progress: each test by its mark, named, or undefined when there is no test to show.
function progressOf({ tests, perTest, spawns, testsComplete, stage, names }: { tests: string[]; perTest: unknown; spawns: Inputs['spawns']; testsComplete: boolean; stage: unknown; names: Inputs['names'] }) {
  const row = progressRow({ tests: tests.map(id => ({ test_id: id })), perTest, spawns, testsComplete, stage })
  const named = row.entries.map((entry: { id: string; mark: Progress['entries'][number]['mark'] }) => ({ ...entry, name: nameOf(names, entry.id) }))
  return named.length > 0 || row.folded || row.coveredFolded ? { ...row, known: testsComplete, entries: named } : undefined
}

// A publish run has no tests of its own, so TESTS keeps the finished code run's: tests.json's order when it lists every one the
// code run recorded, else the recorded ones. No test is current. With no code run seen, tests.json alone shows nothing.
function codeRunProgress({ codeRun, tests, names }: Inputs): Pick<View, 'progress'> {
  const perTest = codeRun?.perTest ?? {}
  const recorded = Object.keys(perTest)
  if (recorded.length === 0) return {}
  const planned = tests.length > 0 && recorded.every(id => tests.includes(id))
  return { progress: progressOf({ tests: planned ? tests : recorded, perTest, spawns: [], testsComplete: planned, stage: undefined, names }) }
}

// The TESTS, TEST and LOOPING-tries parts, folded from the same inputs as the rows. Only the active stage's spawns count, so outside
// "build test by test" no test is current and TEST reads as a dash.
function buildTestRows(inputs: Inputs, ended: boolean): Pick<View, 'progress' | 'test' | 'tries'> {
  const { ledger, spawns, tests, testsComplete, now, names } = inputs
  if (isPublishRun(ledger)) return codeRunProgress(inputs)
  const stage = stageOf(ledger)
  const perTest = ledger?.tests?.perTest
  const progress = progressOf({ tests, perTest, spawns, testsComplete, stage, names })
  const step = ended ? undefined : currentStep(spawns, stage)
  if (!step) return { progress }
  const test = { current: nameOf(names, step.item), marker: cycleMarker({ spawns, ledger }), age: stepAge({ spawns, now, stage }) }
  return { progress, test, tries: loopingTries({ spawns, perTest, stage }) }
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

// What state a live run is in: stopped, needs you, or working on its step (or between steps).
function liveStatus(view: View, ledger: NonNullable<Ledger>, publishes: boolean): Status {
  if (ledger.stop) return { state: 'stopped', what: stopName(ledger.stop) }
  const gate = waitingGate(ledger)
  if (gate) return { state: 'needsYou', what: gateLine(gate) }
  if (view.between === ALL_DONE && publishes && !isPublishRun(ledger)) return { state: 'working', what: NEXT_PUBLISH }
  return { state: 'working', what: view.rows.now }
}

// A run that is over: done, waiting on the publish run, or ended without the sign-off.
function endedStatus(inputs: Inputs, end: { doneStatus?: string }): Status {
  if (end.doneStatus) return { state: 'done', what: end.doneStatus }
  if (inputs.codeRun?.taskEndPassed === true) return { state: 'quiet', what: `between runs${STATUS_PART}${NEXT_PUBLISH}` }
  return { state: 'quiet', what: `ended${STATUS_PART}not signed off` }
}

// What the band and the pane show for what was read.
export function buildView(inputs: Inputs): View {
  const view = toned(buildPlainView(inputs))
  const { ledger } = inputs
  if (!ledger) return view
  const { doneStatus: _done, ...end } = endState(inputs, view.running, true)
  const status = liveStatus(view, ledger, publishesAfter(inputs))
  return { ...view, goal: goalText(inputs), status, ...buildTestRows(inputs, false), steps: unitSteps(inputs, false), lensRound: lensRound({ ledger, calls: inputs.calls, spawns: inputs.spawns }), ...end }
}

const glanceOf = ({ ledger, spawns, tests, testsComplete, now, since }: Inputs) => glance({ ledger, spawns, tests, now, since, testsComplete, leaveOutUnknown: true })

// LOOPING reads "no" while no step on a test is on a later try.
const looping = (text: string) => (text === UNKNOWN ? 'no' : text)

function buildPlainView(inputs: Inputs): View {
  const { ledger } = inputs
  if (!ledger) return { ledger, running: false, rows: NO_RUN_ROWS, band: [], unknownLabels: [], steps: [], goal: EMPTY, status: { state: 'quiet', what: NO_RUN_ROWS.now }, end: NO_END }
  const running = isStageActive(ledger)
  const shown = glanceOf(inputs)
  const rows = { now: shown.rows.now, spent: shown.rows.spent, looping: looping(shown.rows.looping) }
  const base = { ledger, running, band: shown.band, unknownLabels: shown.unknownLabels, steps: [], goal: EMPTY, status: { state: 'quiet' as const, what: EMPTY }, end: NO_END }
  const gate = waitingGate(ledger)
  if (gate) {
    const band = running ? shown.band : shown.band.filter((segment: Segment) => segment.id === 'needsYou')
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

// A run that is over, shown from its last snapshot: the same rows, nothing running, the NOW row says so and LOOPING reads a dash.
export function buildEndedView(inputs: Inputs): View {
  const { ledger } = inputs
  const { rows, unknownLabels } = glanceOf(inputs)
  const { doneStatus: finished, ...end } = endState(inputs, false, false)
  const view: View = {
    ledger,
    ended: true,
    running: false,
    rows: { now: 'last run finished', spent: rows.spent, looping: EMPTY },
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
