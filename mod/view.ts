import type { ElementTable } from 'claude-code'
import { currentStep, glance, needsYouLine, stageOf } from '../shared-node/glance.mjs'
import { isStageActive, stageNamesFor } from '../shared-node/stage-graph.mjs'
import contract from '../shared-node/stages-contract.mjs'
import { lensRound } from '../shared-node/lens-round.mjs'
import type { LensRound } from '../shared-node/lens-round.mjs'
import { plainName } from '../shared-node/plain-names.mjs'
import { cycleMarker, loopingTries, nameOf, progressRow, stepAge } from '../shared-node/now-building.mjs'
import type { Inputs, Ledger } from './inputs'

export type Tone = 'error' | 'warning' | 'dim'
export type Segment = { id: string; text: string; standing?: boolean; tone?: Tone; bold?: boolean }
export type Rows = Record<'now' | 'spent' | 'looping', string>
export type RowTones = Partial<Record<keyof Rows, Tone>>
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
}

const EMPTY = '—'
const UNKNOWN = 'unknown'
const NO_RUN_ROWS: Rows = { now: 'no run', spent: EMPTY, looping: EMPTY }

const isUnknown = (text: string) => text === '-' || text === EMPTY || /unknown$/.test(text)

function bandTone(segment: Segment, ledger: NonNullable<Ledger>): Pick<Segment, 'tone' | 'bold'> {
  if (segment.id === 'needsYou') {
    if (!segment.standing) return {}
    return ledger.needsHuman?.gate ? { tone: 'warning', bold: true } : { tone: 'error' }
  }
  if (segment.id === 'spent' || isUnknown(segment.text)) return { tone: 'dim' }
  return {}
}

const waitingGate = (ledger: NonNullable<Ledger>) => (ledger.stop ? undefined : ledger.needsHuman?.gate || undefined)

function rowTones(ledger: NonNullable<Ledger>): RowTones {
  const tones: RowTones = { spent: 'dim' }
  if (ledger.stop) tones.now = 'error'
  else if (waitingGate(ledger)) tones.now = 'warning'
  return tones
}

function toned(view: View): View {
  const { ledger } = view
  if (!ledger) return view
  return { ...view, band: view.band.map(segment => ({ ...segment, ...bandTone(segment, ledger) })), rowTones: rowTones(ledger) }
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
  const publishes = unit && !KEPT_LOCAL_TYPES.includes(ledger?.taskType ?? '')
  return publishes ? [...own, `○ ${plainName(PUBLISH_STEP)}`] : own
}

// The TESTS, TEST and LOOPING-tries parts, folded from the same inputs as the rows. Only the active stage's spawns count, so outside
// "build test by test" no test is current and TEST reads as a dash. A publish run has no tests of its own, though the code run's
// tests.json is still on disk.
function buildTestRows({ ledger, spawns, tests, testsComplete, now, names }: Inputs, ended: boolean): Pick<View, 'progress' | 'test' | 'tries'> {
  if (isPublishRun(ledger)) return {}
  const stage = stageOf(ledger)
  const perTest = ledger?.tests?.perTest
  const row = progressRow({ tests: tests.map(id => ({ test_id: id })), perTest, spawns, testsComplete, stage })
  const named = row.entries.map((entry: { id: string; mark: Progress['entries'][number]['mark'] }) => ({ ...entry, name: nameOf(names, entry.id) }))
  const progress = named.length > 0 || row.folded || row.coveredFolded ? { ...row, known: testsComplete, entries: named } : undefined
  const step = ended ? undefined : currentStep(spawns, stage)
  if (!step) return { progress }
  const test = { current: nameOf(names, step.item), marker: cycleMarker({ spawns, ledger }), age: stepAge({ spawns, now, stage }) }
  return { progress, test, tries: loopingTries({ spawns, perTest, stage }) }
}

// What the band and the pane show for what was read.
export function buildView(inputs: Inputs): View {
  const view = toned(buildPlainView(inputs))
  if (!inputs.ledger) return view
  return { ...view, ...buildTestRows(inputs, false), steps: unitSteps(inputs, false), lensRound: lensRound({ ledger: inputs.ledger, calls: inputs.calls, spawns: inputs.spawns }) }
}

const glanceOf = ({ ledger, spawns, tests, testsComplete, now, since }: Inputs) => glance({ ledger, spawns, tests, now, since, testsComplete, leaveOutUnknown: true })

// LOOPING reads "no" while no step on a test is on a later try.
const looping = (text: string) => (text === UNKNOWN ? 'no' : text)

function buildPlainView(inputs: Inputs): View {
  const { ledger } = inputs
  if (!ledger) return { ledger, running: false, rows: NO_RUN_ROWS, band: [], unknownLabels: [], steps: [] }
  const running = isStageActive(ledger)
  const shown = glanceOf(inputs)
  const rows = { now: shown.rows.now, spent: shown.rows.spent, looping: looping(shown.rows.looping) }
  const base = { ledger, running, band: shown.band, unknownLabels: shown.unknownLabels, steps: [] }
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
  const view: View = {
    ledger,
    ended: true,
    running: false,
    rows: { now: 'last run finished', spent: rows.spent, looping: EMPTY },
    band: [],
    unknownLabels,
    steps: unitSteps(inputs, true),
    ...buildTestRows(inputs, true),
    lensRound: ledger ? lensRound({ ledger, calls: inputs.calls, spawns: inputs.spawns, ended: true }) : undefined,
  }
  return toned(view)
}
