import { plainName } from '../shared-node/plain-names.mjs'
import { stageNamesFor } from '../shared-node/stage-graph.mjs'
import contract from '../shared-node/stages-contract.mjs'
import type { Ledger } from './inputs'
import type { PaneTags, RowTones, Rows } from './view'

const ROWS: [keyof Rows, string][] = [
  ['now', 'NOW'], ['spent', 'SPENT'], ['left', 'LEFT'], ['looping', 'LOOPING'], ['offTrack', 'OFF TRACK'],
]

export function stepLines(ledger: Ledger, ended = false): string[] {
  if (!ledger) return []
  const done = new Set((ledger?.stages ?? []).filter(stage => stage.status === 'done').map(stage => stage.name))
  const current = !ended && ledger?.stage?.status === 'active' ? ledger.stage.name : undefined
  return stageNamesFor(contract, ledger).map(name => {
    const mark = name === current ? '▸' : done.has(name) ? '✓' : '○'
    return `${mark} ${plainName(name) ?? name}`
  })
}

export type Suggestion = { state: 'pending'; nextAgent?: string } | { state: 'delivered'; to: string }

const toneProps = (tone?: string) => (tone === 'dim' ? { dimColor: true } : tone ? { color: tone } : {})
const stepProps = (line: string) => (line.startsWith('▸') ? { color: 'claude', bold: true } : line.startsWith('✓') ? { color: 'success' } : {})

export function Pane({ Box, Text, Button, Input, rows, rowTones = {}, ledger, ended = false, unknownLabels, note = null, suggestion, onDismiss, onReport = () => {}, onSuggest = () => {} }: PaneTags & {
  rows: Rows
  rowTones?: RowTones
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
      {ROWS.map(([key, label]) => <Text key={key} {...toneProps(rowTones[key])} {...(key === 'now' && rowTones.now === 'warning' ? { bold: true } : {})}>{`${label}  ${rows[key]}`}</Text>)}
      {stepLines(ledger, ended).map(line => <Text key={line} {...stepProps(line)}>{line}</Text>)}
      {unknownLabels.map((raw, i) => <Text key={`unknown-${i}`}>{raw}</Text>)}
      {unknownLabels.length > 0 && <Text dimColor>{`${unknownLabels.length} label${unknownLabels.length === 1 ? '' : 's'} unknown`}</Text>}
      <Text dimColor>Pairing Buddy only watches; it never changes your run</Text>
      {note && <Text>{note}</Text>}
      {suggestion?.state === 'pending' && <Text>{`applies at the next agent spawn: ${suggestion.nextAgent ? (plainName(suggestion.nextAgent) ?? suggestion.nextAgent) : 'the next agent'}`}</Text>}
      {suggestion?.state === 'delivered' && <Text>{`delivered to ${plainName(suggestion.to) ?? suggestion.to}`}</Text>}
      {ledger && (
        <>
          <Button key="report" label="r open report" hotkey="r" onPress={onReport} />
          {!ended && <Input key="suggest" label="suggest" onSubmit={onSuggest} />}
        </>
      )}
      <Button key="dismiss" label="dismiss" role="dismiss" onPress={onDismiss} />
    </Box>
  )
}
