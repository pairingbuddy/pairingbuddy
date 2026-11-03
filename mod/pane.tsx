import { plainName } from '../shared-node/plain-names.mjs'
import { graphFor } from '../shared-node/stage-graph.mjs'
import contract from './stages-contract'
import type { Ledger } from './inputs'
import type { Rows, Tags } from './view'

const ROWS: [keyof Rows, string][] = [
  ['now', 'NOW'], ['spent', 'SPENT'], ['left', 'LEFT'], ['looping', 'LOOPING'], ['offTrack', 'OFF TRACK'],
]

// The task type's stages from the contract, else only those the ledger has recorded.
function stageNames(ledger: Ledger): string[] {
  try {
    return graphFor(contract, ledger?.taskType).stages
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('no stage graph')) {
      throw error
    }
    return (ledger?.stages ?? []).map(stage => stage.name)
  }
}

export function stepLines(ledger: Ledger): string[] {
  const done = new Set((ledger?.stages ?? []).filter(stage => stage.status === 'done').map(stage => stage.name))
  const current = ledger?.stage?.status === 'active' ? ledger.stage.name : undefined
  return stageNames(ledger).map(name => {
    const mark = name === current ? '▸' : done.has(name) ? '✓' : '○'
    return `${mark} ${plainName(name) ?? name}`
  })
}

export function Pane({ Box, Text, Button, rows, ledger, unknownLabels, onDismiss }: Tags & {
  rows: Rows
  ledger: Ledger
  unknownLabels: string[]
  onDismiss: () => unknown
}) {
  return (
    <Box flexDirection="column">
      {ROWS.map(([key, label]) => <Text key={key}>{`${label}  ${rows[key]}`}</Text>)}
      {stepLines(ledger).map(line => <Text key={line}>{line}</Text>)}
      {unknownLabels.map((raw, i) => <Text key={`unknown-${i}`}>{raw}</Text>)}
      {unknownLabels.length > 0 && <Text dimColor>{`${unknownLabels.length} label${unknownLabels.length === 1 ? '' : 's'} unknown`}</Text>}
      <Text dimColor>Pairing Buddy only watches; it never changes your run</Text>
      <Button key="dismiss" label="dismiss" role="dismiss" onPress={onDismiss} />
    </Box>
  )
}
