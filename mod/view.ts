import type { ElementTable } from 'claude-code'
import { glance } from '../shared-node/glance.mjs'
import { isStageActive } from '../shared-node/stage-graph.mjs'
import type { Inputs, Ledger } from './inputs'

export type Segment = { id: string; text: string; standing?: boolean }
export type Rows = Record<'now' | 'spent' | 'left' | 'looping' | 'offTrack', string>
// The kit's own types for the elements a render hook draws with.
export type Tags = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
// The Pane alone also draws the suggest Input.
export type PaneTags = Tags & Pick<ElementTable, 'Input'>

export type View = { ledger: Ledger; ended?: boolean; running: boolean; rows: Rows; band: Segment[]; unknownLabels: string[] }

const NO_RUN_ROWS: Rows = { now: 'no run', spent: '-', left: '-', looping: '-', offTrack: '-' }

// What the band and the pane show for what was read.
export function buildView({ ledger, spawns, tests, now }: Inputs): View {
  if (!ledger) return { ledger, running: false, rows: NO_RUN_ROWS, band: [], unknownLabels: [] }
  return { ledger, running: isStageActive(ledger), ...glance({ ledger, spawns, tests, now }) }
}

// A run that is over, shown from its last snapshot: the steps stay, nothing is running, and the NOW row says so.
export function buildEndedView({ ledger, spawns, tests, now }: Inputs): View {
  const { rows, unknownLabels } = glance({ ledger, spawns, tests, now })
  return { ledger, ended: true, running: false, rows: { ...rows, now: 'last run finished' }, band: [], unknownLabels }
}
