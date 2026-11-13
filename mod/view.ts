import type { ElementTable } from 'claude-code'
import { currentStep, glance, needsYouLine } from '../shared-node/glance.mjs'
import { isStageActive, stageNamesFor } from '../shared-node/stage-graph.mjs'
import contract from '../shared-node/stages-contract.mjs'
import { lensRound } from '../shared-node/lens-round.mjs'
import type { LensRound } from '../shared-node/lens-round.mjs'
import { plainName } from '../shared-node/plain-names.mjs'
import { activeAgents, unknownAgents, cycleMarker, loopingTries, nameOf, progressRow, stepAge } from '../shared-node/now-building.mjs'
import type { Inputs, Ledger } from './inputs'

export type Tone = 'error' | 'warning' | 'dim'
export type Segment = { id: string; text: string; standing?: boolean; tone?: Tone; bold?: boolean }
export type Rows = Record<'now' | 'spent' | 'left' | 'looping' | 'offTrack', string>
export type RowTones = Partial<Record<keyof Rows, Tone>>
// The kit's own types for the elements a render hook draws with.
export type Tags = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
// The Pane alone also draws the suggest Input.
export type PaneTags = Tags & Pick<ElementTable, 'Input'>

export type NowBuilding = {
  progress: { known?: boolean; folded?: number; more?: number; entries: { id: string; name: string; mark: 'done' | 'current' | 'waiting' }[] }
  current?: string
  marker: { steps: { name: string; lit: boolean; mark: string }[] }
  age?: string
  tries?: { step: string; number: number; result: string }[]
  active: number
  unknown: number
}

export type View = { nowBuilding?: NowBuilding; lensRound?: LensRound; ledger: Ledger; ended?: boolean; between?: string; running: boolean; rows: Rows; band: Segment[]; unknownLabels: string[]; rowTones?: RowTones; waiting?: boolean }

const NO_RUN_ROWS: Rows = { now: 'no run', spent: '-', left: '-', looping: '-', offTrack: '-' }

const isUnknown = (text: string) => text === '-' || /unknown$/.test(text)

function bandTone(segment: Segment, ledger: NonNullable<Ledger>): Pick<Segment, 'tone' | 'bold'> {
  if (segment.id === 'needsYou') {
    if (!segment.standing) return {}
    return ledger.needsHuman?.gate ? { tone: 'warning', bold: true } : { tone: 'error' }
  }
  if (segment.id === 'spent' || isUnknown(segment.text)) return { tone: 'dim' }
  return {}
}

const waitingGate = (ledger: NonNullable<Ledger>) => (ledger.stop ? undefined : ledger.needsHuman?.gate || undefined)

function rowTones(rows: Rows, ledger: NonNullable<Ledger>): RowTones {
  const tones: RowTones = {}
  if (ledger.stop) tones.now = 'error'
  else if (waitingGate(ledger)) tones.now = 'warning'
  for (const key of ['spent', 'left', 'looping', 'offTrack'] as const) if (key === 'spent' || isUnknown(rows[key])) tones[key] = 'dim'
  return tones
}

function toned(view: View): View {
  const { ledger } = view
  if (!ledger) return view
  return { ...view, band: view.band.map(segment => ({ ...segment, ...bandTone(segment, ledger) })), rowTones: rowTones(view.rows, ledger) }
}

// What the band and the pane show for what was read.
export function buildView(inputs: Inputs): View {
  const view = toned(buildPlainView(inputs))
  return inputs.ledger ? { ...view, nowBuilding: buildNowBuilding(inputs), lensRound: lensRound({ ledger: inputs.ledger, calls: inputs.calls, spawns: inputs.spawns, contract }) } : view
}

// The now-building block, folded from the same inputs as the rows; only a run that has a test or a step shows one.
function buildNowBuilding({ ledger, spawns, tests, testsComplete, now, names }: Inputs): NowBuilding | undefined {
  const perTest = ledger?.tests?.perTest
  const progress = progressRow({ tests: tests.map(id => ({ test_id: id })), perTest, spawns, testsComplete })
  const step = currentStep(spawns)
  const hasProgress = progress.entries.length > 0 || progress.folded || progress.coveredFolded
  if (!hasProgress && !step) return undefined
  const named = progress.entries.map((entry: { id: string; mark: NowBuilding['progress']['entries'][number]['mark'] }) => ({ ...entry, name: nameOf(names, entry.id) }))
  const age = step ? stepAge({ spawns, now }) : undefined
  return {
    progress: { ...progress, known: testsComplete, entries: named },
    current: step ? nameOf(names, step.item) : undefined,
    marker: cycleMarker({ spawns, ledger }),
    age,
    tries: loopingTries({ spawns, perTest }),
    unknown: unknownAgents({ spawns }),
    active: activeAgents({ spawns }),
  }
}

function buildPlainView({ ledger, spawns, tests, testsComplete, now }: Inputs): View {
  if (!ledger) return { ledger, running: false, rows: NO_RUN_ROWS, band: [], unknownLabels: [] }
  const running = isStageActive(ledger)
  const shown = glance({ ledger, spawns, tests, now, testsComplete })
  const gate = waitingGate(ledger)
  if (gate) {
    const needs = needsYouLine(gate)
    const band = running ? shown.band : shown.band.filter((segment: Segment) => segment.id === 'needsYou')
    return { ledger, running, waiting: true, ...shown, band, rows: { ...shown.rows, now: needs } }
  }
  if (running) return { ledger, running, ...shown }
  // A live run with no active stage is between steps, never idle.
  const between = betweenText(ledger)
  return { ledger, running, between, ...shown, rows: ledger.stop ? shown.rows : { ...shown.rows, now: between } }
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

// A run that is over, shown from its last snapshot: the steps stay, nothing is running, and the NOW row says so.
export function buildEndedView(inputs: Inputs): View {
  return toned(buildPlainEndedView(inputs))
}

function buildPlainEndedView({ ledger, spawns, tests, testsComplete, now }: Inputs): View {
  const { rows, unknownLabels } = glance({ ledger, spawns, tests, now, testsComplete })
  return { ledger, ended: true, running: false, rows: { ...rows, now: 'last run finished' }, band: [], unknownLabels }
}
