import { plainName } from '../shared-node/plain-names.mjs'
import { cutAtWord, lensLines } from '../shared-node/lens-round.mjs'
import { endReviewLines, goalLines, wrapAtParts } from '../shared-node/end-state.mjs'
import { fitTries } from '../shared-node/now-building.mjs'
import type { PaneTags, RowTones, View } from './view'

// Every row is always drawn, in this order, its label in a column this wide; a row with nothing to show reads EMPTY.
const LABEL_WIDTH = 9
const EMPTY = '—'
const label = (name: string) => name.padEnd(LABEL_WIDTH)
const BLANK = label('')

// Fixed colours, not theme keys, so a theme that maps "success" to blue cannot turn GREEN blue; readable on dark and light.
export const PHASE_COLOURS: Record<string, string> = { RED: '#e5534b', GREEN: '#3fb950', REFACTOR: '#4c8dff' }
// Where the run is now: the current step and the current test. Fixed for the same reason, and readable on dark and light.
export const ACCENT_COLOUR = '#39c5cf'
const LIT: Props = { color: ACCENT_COLOUR, bold: true }

export type Suggestion = { state: 'pending'; nextAgent?: string } | { state: 'delivered'; to: string }

type Props = Record<string, unknown>
type Part = { text: string; props?: Props }

const toneProps = (tone?: string): Props => (tone === 'dim' ? { dimColor: true } : tone ? { color: tone } : {})
// Steps read by their marks; the active one is also lit, so it stands out in a glance.
const stepProps = (line: string): Props => (line.startsWith('▸') ? LIT : {})
const emptyLine = (): Part[] => [{ text: EMPTY, props: { dimColor: true } }]

// One row: its label on the first line, a blank label column on the rest; a row with no lines reads EMPTY.
function rowLines(name: string, lines: Part[][]): { label: string; parts: Part[] }[] {
  return (lines.length ? lines : [emptyLine()]).map((parts, i) => ({ label: i === 0 ? label(name) : BLANK, parts }))
}

const cells = (text: string) => [...text].length

// A test line stays one line, so a long name is cut at the last word that fits, never with an ellipsis (the report's SCENARIOS
// holds it whole); no room given cuts nothing.
const cutName = (name: string, room: number) => cutAtWord(name, room)

// The current test's cycle marker and step age, as parts.
function cycleParts(test: NonNullable<View['test']>): Part[] {
  const marker = test.marker.steps.flatMap((step, i): Part[] => [
    ...(i > 0 ? [{ text: ' ' }] : []),
    { text: `${step.mark}${step.name}`, props: step.lit ? { color: PHASE_COLOURS[step.name], bold: true } : { dimColor: true } },
  ])
  return [...marker, ...(test.age ? [{ text: `  ${test.age}` }] : [])]
}

const MARKS = { done: '✓', current: '▸', waiting: '·', covered: '◌' } as const
const GAP = '  '

// One TESTS row, a line per test: the folded counts first, then each test by its mark, the current one with its cycle marker and
// step age, then "+n more" ("+n more so far" while the total is unknown). The current test's name gives way first, so its marker and age always fit the width.
function testsParts({ progress, test }: Pick<View, 'progress' | 'test'>, width: number): Part[][] {
  const folded = [progress?.folded ? `${MARKS.done} ${progress.folded} done` : '', progress?.coveredFolded ? `${MARKS.covered} ${progress.coveredFolded} covered` : ''].filter(Boolean)
  const lines: Part[][] = folded.length ? [[{ text: folded.join('   ') }]] : []
  const entries = progress?.entries ?? []
  const currentLine = (name: string): Part[] => {
    const cycle = test ? cycleParts(test) : []
    const rest = cycle.reduce((sum, part) => sum + cells(part.text), 0)
    const room = width > 0 ? width - rest - (cycle.length ? GAP.length : 0) : 0
    return [{ text: `${cutName(`${MARKS.current} ${name}`, room)}${cycle.length ? GAP : ''}`, props: LIT }, ...cycle]
  }
  for (const entry of entries) {
    lines.push(entry.mark === 'current' ? currentLine(entry.name) : [{ text: cutName(`${MARKS[entry.mark]} ${entry.name}`, width) }])
  }
  // A current test the list does not hold still gets its line.
  if (test?.current && !entries.some(entry => entry.mark === 'current')) lines.push(currentLine(test.current))
  // With the total not known yet, the count is of the tests seen so far.
  if (progress?.more) lines.push([{ text: `+${progress.more} more${progress.known ? '' : ' so far'}`, props: { dimColor: true } }])
  return lines
}

// The GOAL row leads, bold, on up to two lines; a dash until the run names its task.
function goalRows(view: View, columns: number) {
  const width = columns > 0 ? columns - LABEL_WIDTH : 0
  const goal = view.goal ?? EMPTY
  const lines = goal === EMPTY ? [emptyLine()] : goalLines(goal, width).map((text: string) => [{ text, props: { bold: true } }])
  return rowLines('GOAL', lines)
}

// The thin rule under the goal: the pane's width, or a fixed one before the first layout.
const RULE_FALLBACK_WIDTH = 40
const goalRule = (columns: number) => '─'.repeat(columns > 0 ? columns : RULE_FALLBACK_WIDTH)

function paneRows(view: View, columns: number) {
  const { rows, rowTones = {} as RowTones } = view
  const width = columns > 0 ? columns - LABEL_WIDTH : 0
  const one = (text: string, props: Props = {}): Part[][] => [[{ text, props: text === EMPTY ? { dimColor: true } : props }]]
  // A row that wraps at its parts, then words, onto as many lines as it needs, never cut.
  const wrapped = (text: string, room: number, props: Props = {}): Part[][] => (text === EMPTY ? one(text) : wrapAtParts(text, room).map((line: string) => [{ text: line, props }]))
  const statusProps = { ...toneProps(rowTones.status), ...(rowTones.status === 'warning' ? { bold: true } : {}) }
  // The tries fold to fit where they can (fitTries); what still overflows wraps, never cut.
  const tries = view.tries?.length ? wrapped(fitTries(view.tries, width).trimStart(), width, { dimColor: true }) : []
  const review = view.endRound ? endReviewLines(view.endRound, width) : lensLines(view.lensRound, width)
  return [
    ...rowLines('STATUS', wrapped(view.status ?? rows.now, width, statusProps)),
    ...rowLines('PR', wrapped(view.end.pr, width)),
    ...rowLines('BUILT', wrapped(view.end.done, width)),
    ...rowLines('SPENT', one(rows.spent, toneProps(rowTones.spent))),
    ...rowLines('LOOPING', [...one(rows.looping, toneProps(rowTones.looping)), ...tries]),
    ...rowLines('STEPS', view.steps.map(line => [{ text: line, props: stepProps(line) }])),
    ...rowLines('TESTS', testsParts(view, width)),
    ...rowLines('REVIEW', review.map((line: { text: string; tone?: string }) => [{ text: line.text, props: toneProps(line.tone) }])),
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
      {goalRows(view, columns).map(({ label: name, parts }, row) => (
        <Box key={`goal-${row}`}>
          <Text key="label" wrap="truncate-end">{name}</Text>
          {parts.map((part, i) => <Text key={`part-${i}`} wrap="truncate-end" {...part.props}>{part.text}</Text>)}
        </Box>
      ))}
      <Text key="goal-rule" dimColor wrap="truncate-end">{goalRule(columns)}</Text>
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
