import { plainName } from '../shared-node/plain-names.mjs'
import { lensLines } from '../shared-node/lens-round.mjs'
import { fitProgress, fitTries } from '../shared-node/now-building.mjs'
import type { PaneTags, RowTones, View } from './view'

// Every row is always drawn, in this order, its label in a column this wide; a row with nothing to show reads EMPTY.
const LABEL_WIDTH = 9
const EMPTY = '—'
const label = (name: string) => name.padEnd(LABEL_WIDTH)
const BLANK = label('')

// Fixed colours, not theme keys, so a theme that maps "success" to blue cannot turn GREEN blue; readable on dark and light.
export const PHASE_COLOURS: Record<string, string> = { RED: '#e5534b', GREEN: '#3fb950', REFACTOR: '#4c8dff' }

export type Suggestion = { state: 'pending'; nextAgent?: string } | { state: 'delivered'; to: string }

type Props = Record<string, unknown>
type Part = { text: string; props?: Props }

const toneProps = (tone?: string): Props => (tone === 'dim' ? { dimColor: true } : tone ? { color: tone } : {})
const stepProps = (line: string): Props => (line.startsWith('▸') ? { color: 'claude', bold: true } : line.startsWith('✓') ? { color: 'success' } : {})
const emptyLine = (): Part[] => [{ text: EMPTY, props: { dimColor: true } }]

// One row: its label on the first line, a blank label column on the rest; a row with no lines reads EMPTY.
function rowLines(name: string, lines: Part[][]): { label: string; parts: Part[] }[] {
  return (lines.length ? lines : [emptyLine()]).map((parts, i) => ({ label: i === 0 ? label(name) : BLANK, parts }))
}

const cells = (text: string) => [...text].length

// Text cut to fit the room, ending in an ellipsis; no room given cuts nothing.
function cutName(name: string, room: number) {
  if (!(room > 0) || cells(name) <= room) return name
  return room > 1 ? `${[...name].slice(0, room - 1).join('')}…` : '…'
}

function testParts(test: View['test'], width: number): Part[][] {
  if (!test) return []
  const marker = test.marker.steps.flatMap((step, i): Part[] => [
    ...(i > 0 ? [{ text: ' ' }] : []),
    { text: `${step.mark}${step.name}`, props: step.lit ? { color: PHASE_COLOURS[step.name], bold: true } : { dimColor: true } },
  ])
  const age = test.age ? [{ text: `  ${test.age}` }] : []
  // The test's name gives way first, so the cycle marker and the step age always fit the width.
  const rest = [...marker, ...age].reduce((sum, part) => sum + cells(part.text), 0)
  const GAP = '  '
  const name = test.current ? [{ text: `${cutName(test.current, width > 0 ? width - rest - GAP.length : 0)}${GAP}`, props: { bold: true } }] : []
  return [[...name, ...marker, ...age]]
}

function paneRows(view: View, columns: number) {
  const { rows, rowTones = {} as RowTones } = view
  const width = columns > 0 ? columns - LABEL_WIDTH : 0
  const one = (text: string, props: Props = {}): Part[][] => [[{ text, props: text === EMPTY ? { dimColor: true } : props }]]
  const nowProps = { ...toneProps(rowTones.now), ...(rowTones.now === 'warning' ? { bold: true } : {}) }
  const tries = view.tries?.length ? [[{ text: fitTries(view.tries, width).trimStart(), props: { dimColor: true } }]] : []
  return [
    ...rowLines('NOW', one(rows.now, nowProps)),
    ...rowLines('SPENT', one(rows.spent, toneProps(rowTones.spent))),
    ...rowLines('LOOPING', [...one(rows.looping, toneProps(rowTones.looping)), ...tries]),
    ...rowLines('STEPS', view.steps.map(line => [{ text: line, props: stepProps(line) }])),
    // Folding keeps the current test whole, so a name still too long is cut.
    ...rowLines('TESTS', view.progress ? [[{ text: cutName(fitProgress(view.progress, width), width) }]] : []),
    ...rowLines('TEST', testParts(view.test, width)),
    ...rowLines('REVIEW', lensLines(view.lensRound, width).map((line: { text: string; tone?: string }) => [{ text: line.text, props: toneProps(line.tone) }])),
  ]
}

export function Pane({ Box, Text, Button, Input, view, columns = 0, unknownLabels, note = null, suggestion, onDismiss, onReport = () => {}, onSuggest = () => {} }: PaneTags & {
  view: View
  columns?: number
  unknownLabels: string[]
  note?: string | null
  suggestion?: Suggestion
  onDismiss: () => unknown
  onReport?: () => unknown
  onSuggest?: (text: string) => unknown
}) {
  const { ledger, ended = false } = view
  return (
    <Box flexDirection="column">
      {paneRows(view, columns).map(({ label: name, parts }, row) => (
        <Box key={`row-${row}`}>
          <Text key="label" wrap="truncate-end">{name}</Text>
          {parts.map((part, i) => <Text key={`part-${i}`} wrap="truncate-end" {...part.props}>{part.text}</Text>)}
        </Box>
      ))}
      {unknownLabels.map((raw, i) => <Text key={`unknown-${i}`}>{raw}</Text>)}
      {unknownLabels.length > 0 && <Text dimColor>{`${unknownLabels.length} label${unknownLabels.length === 1 ? '' : 's'} unknown`}</Text>}
      <Text key="gap"> </Text>
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
