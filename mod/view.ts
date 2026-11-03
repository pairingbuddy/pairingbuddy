import type { ElementTable } from 'claude-code'
import { glance } from '../shared-node/glance.mjs'
import { isStageActive } from '../shared-node/stage-graph.mjs'
import type { Inputs, Ledger } from './inputs'

export type Segment = { id: string; text: string }
export type Rows = Record<'now' | 'spent' | 'left' | 'looping' | 'offTrack', string>
// The kit's own types for the elements a render hook draws with.
export type Tags = Pick<ElementTable, 'Box' | 'Text' | 'Button'>

export type View = { ledger: Ledger; running: boolean; rows: Rows; band: Segment[]; unknownLabels: string[] }

// What the band and the pane show for what was read.
export function buildView({ ledger, spawns, tests, now }: Inputs): View {
  return { ledger, running: isStageActive(ledger), ...glance({ ledger, spawns, tests, now }) }
}
