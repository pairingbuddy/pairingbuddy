import { plainName } from '../shared-node/plain-names.mjs'
import { lensLines } from '../shared-node/lens-round.mjs'
import type { LensRound } from '../shared-node/lens-round.mjs'
import { fitLegend, fitProgress, fitTries } from '../shared-node/now-building.mjs'
import { stageNamesFor } from '../shared-node/stage-graph.mjs'
import contract from '../shared-node/stages-contract.mjs'
import type { Ledger } from './inputs'
import type { NowBuilding, PaneTags, RowTones, Rows } from './view'

const ROWS: [keyof Rows, string][] = [
  ['now', 'NOW'], ['spent', 'SPENT'], ['left', 'LEFT'], ['looping', 'LOOPING'], ['offTrack', 'OFF TRACK'],
]

// A row whose whole value is unknown says nothing, so it is not drawn; NOW always is.
const UNKNOWN = 'unknown'
const isShown = (key: keyof Rows, value: string) => key === 'now' || value !== UNKNOWN

export function stepLines(ledger: Ledger, ended = false): string[] {
  if (!ledger) return []
  const done = new Set((ledger?.stages ?? []).filter(stage => stage.status === 'done').map(stage => stage.name))
  const current = !ended && ledger?.stage?.status === 'active' ? ledger.stage.name : undefined
  return stageNamesFor(contract, ledger).map(name => {
    const mark = name === current ? '▸' : done.has(name) ? '✓' : '○'
    return `${mark} ${plainName(name) ?? name}`
  })
}

// The lit step is coloured by its phase through theme keys; the others are dim.
const PHASE_COLOURS: Record<string, string> = { RED: 'error', GREEN: 'success', REFACTOR: 'suggestion' }
function NowBuildingBlock({ Box, Text, block, columns }: Pick<PaneTags, 'Box' | 'Text'> & { block: NowBuilding; columns: number }) {
  const row = fitProgress(block.progress, columns)
  const legend = fitLegend(columns, row)
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">now building</Text>
      <Text wrap="truncate-end">{row}</Text>
      <Box>
        {block.current && <Text bold wrap="truncate-end">{`${block.current}  `}</Text>}
        {block.marker.steps.flatMap((step, i) => [
          ...(i > 0 ? [<Text key={`gap-${step.name}`} wrap="truncate-end">{' '}</Text>] : []),
          <Text key={step.name} wrap="truncate-end" {...(step.lit ? { color: PHASE_COLOURS[step.name], bold: true } : { dimColor: true })}>{`${step.mark}${step.name}`}</Text>,
        ])}
        {block.age && <Text wrap="truncate-end">{`  ${block.age}`}</Text>}
      </Box>
      {legend && <Text dimColor wrap="truncate-end">{legend}</Text>}
      <Text dimColor wrap="truncate-end">{block.unknown > 0 ? `${block.active} active · ${block.unknown} unknown` : `${block.active} active`}</Text>
    </Box>
  )
}

export type Suggestion = { state: 'pending'; nextAgent?: string } | { state: 'delivered'; to: string }

const toneProps = (tone?: string) => (tone === 'dim' ? { dimColor: true } : tone ? { color: tone } : {})
const stepProps = (line: string) => (line.startsWith('▸') ? { color: 'claude', bold: true } : line.startsWith('✓') ? { color: 'success' } : {})

export function Pane({ Box, Text, Button, Input, rows, rowTones = {}, columns = 0, nowBuilding, lensRound, ledger, ended = false, unknownLabels, note = null, suggestion, onDismiss, onReport = () => {}, onSuggest = () => {} }: PaneTags & {
  rows: Rows
  rowTones?: RowTones
  columns?: number
  nowBuilding?: NowBuilding
  lensRound?: LensRound
  ledger: Ledger
  ended?: boolean
  unknownLabels: string[]
  note?: string | null
  suggestion?: Suggestion
  onDismiss: () => unknown
  onReport?: () => unknown
  onSuggest?: (text: string) => unknown
}) {
  return (
    <Box flexDirection="column">
      {ROWS.flatMap(([key, label]) => [
        ...(isShown(key, rows[key]) ? [<Text key={key} {...toneProps(rowTones[key])} {...(key === 'now' && rowTones.now === 'warning' ? { bold: true } : {})}>{`${label}  ${rows[key]}`}</Text>] : []),
        ...(key === 'looping' && nowBuilding?.tries?.length ? [<Text key="tries" dimColor wrap="truncate-end">{fitTries(nowBuilding.tries, columns)}</Text>] : []),
      ])}
      {stepLines(ledger, ended).map(line => <Text key={line} {...stepProps(line)}>{line}</Text>)}
      {nowBuilding && <NowBuildingBlock Box={Box} Text={Text} block={nowBuilding} columns={columns} />}
      {lensLines(lensRound, columns).map((line: { text: string; tone?: string }, i: number) => <Text key={`lens-${i}`} wrap="truncate-end" {...toneProps(line.tone)}>{line.text}</Text>)}
      {unknownLabels.map((raw, i) => <Text key={`unknown-${i}`}>{raw}</Text>)}
      {unknownLabels.length > 0 && <Text dimColor>{`${unknownLabels.length} label${unknownLabels.length === 1 ? '' : 's'} unknown`}</Text>}
      <Text dimColor>Pairing Buddy only watches; it never changes your run</Text>
      {note && <Text>{note}</Text>}
      {suggestion?.state === 'pending' && <Text>{`applies at the next agent spawn: ${suggestion.nextAgent ? (plainName(suggestion.nextAgent) ?? suggestion.nextAgent) : 'the next agent'}`}</Text>}
      {suggestion?.state === 'delivered' && <Text>{`delivered to ${plainName(suggestion.to) ?? suggestion.to}`}</Text>}
      {ledger && (
        <>
          <Button key="report" label="r open report" hotkey="r" onPress={onReport} />
          {!ended && <Input key="suggest" label="suggest" placeholder="a note for the next agent" onSubmit={onSuggest} />}
        </>
      )}
      <Button key="dismiss" label="dismiss" role="dismiss" onPress={onDismiss} />
    </Box>
  )
}
