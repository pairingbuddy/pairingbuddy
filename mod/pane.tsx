import { plainName } from '../shared-node/plain-names.mjs'
import { cutAtWord, lensLines } from '../shared-node/lens-round.mjs'
import { endReviewLines, goalLines, wrapAtParts } from '../shared-node/end-state.mjs'
import type { PaneTags, RowTones, Status, StatusState, View } from './view'

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

// Beside the report button: the command that needs no pane focus (the classic renderer has no mouse).
const REPORT_COMMAND = 'or /pb-report, no focus needed'

export type Suggestion = { state: 'pending'; nextAgent?: string } | { state: 'delivered'; to: string }

type Props = Record<string, unknown>
type Part = { text: string; props?: Props }

const toneProps = (tone?: string): Props => (tone === 'dim' ? { dimColor: true } : tone ? { color: tone } : {})
// Steps read by their marks; the active one is also lit, so it stands out in a glance.
const stepProps = (line: string): Props => (line.startsWith('▸') ? LIT : {})
const emptyLine = (): Part[] => [{ text: EMPTY, props: { dimColor: true } }]

// The first glance's labels are bold; a detail's label is dim, its value at full strength so it stays readable.
const FIRST_GLANCE_LABEL: Props = { bold: true }
const DETAIL_LABEL: Props = { dimColor: true }

// One row: its label on the first line, a blank label column on the rest; a row with no lines reads EMPTY.
function rowLines(name: string, lines: Part[][], labelProps: Props = DETAIL_LABEL): { label: string; labelProps: Props; parts: Part[] }[] {
  return (lines.length ? lines : [emptyLine()]).map((parts, i) => ({ label: i === 0 ? label(name) : BLANK, labelProps, parts }))
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

// The TESTS row's first line once the total is known: `3 of 12 done` while the build runs, then a settled `✓ 12 of 12 passing`
// (a covered test passes too), with how many were already covered.
function countLine({ total, done, covered, settled }: NonNullable<NonNullable<View['progress']>['count']>) {
  const coveredPart = covered ? ` · ${covered} covered` : ''
  if (!settled) return `${done} of ${total} done${coveredPart}`
  const passing = done + covered
  return `${passing === total ? `${MARKS.done} ` : ''}${passing} of ${total} passing${coveredPart}`
}

// One TESTS row, a line per test: the folded counts first, then each test by its mark, the current one with its cycle marker and
// step age, then "+n more" ("+n more so far" while the total is unknown). The current test's name gives way first, so its marker and age always fit the width.
function testsParts({ progress, test }: Pick<View, 'progress' | 'test'>, width: number): Part[][] {
  const folded = [progress?.folded ? `${MARKS.done} ${progress.folded} done` : '', progress?.coveredFolded ? `${MARKS.covered} ${progress.coveredFolded} covered` : ''].filter(Boolean)
  // Once the total is known its count leads, always on the first line, and stands for the folded tests too.
  const head = progress?.count ? [countLine(progress.count)] : folded.length ? [folded.join('   ')] : []
  const lines: Part[][] = head.map(text => [{ text }])
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
  return rowLines('GOAL', lines, FIRST_GLANCE_LABEL)
}

// The thin rule under the first glance: the pane's width, or a fixed one before the first layout.
const RULE_FALLBACK_WIDTH = 40
const goalRule = (columns: number) => '─'.repeat(columns > 0 ? columns : RULE_FALLBACK_WIDTH)

const one = (text: string, props: Props = {}): Part[][] => [[{ text, props: text === EMPTY ? { dimColor: true } : props }]]
// A row that wraps at its parts, then words, onto as many lines as it needs, never cut.
const wrapped = (text: string, room: number, props: Props = {}): Part[][] => (text === EMPTY ? one(text) : wrapAtParts(text, room).map((line: string) => [{ text: line, props }]))

// How each state leads STATUS: its head (its mark and the state's word) and how the head and what follows it are drawn.
// sep joins the head to what follows. The band leads its row with bandHead: the same head, but a working run's mark alone,
// since the band's room goes to the step; a narrow band shortens a question or a stop to its mark alone.
type Look = { mark: string; head: string; bandHead: string; sep: string; headProps: Props; whatProps: Props }
export const STATUS_LOOKS: Record<StatusState, Look> = {
  needsYou: { mark: '▲', head: '▲ NEEDS YOU', bandHead: '▲ NEEDS YOU', sep: ' · ', headProps: { color: 'warning', inverse: true, bold: true }, whatProps: { color: 'warning', bold: true } },
  stopped: { mark: '✕', head: '✕ STOPPED', bandHead: '✕ STOPPED', sep: ' · ', headProps: { color: 'error', inverse: true, bold: true }, whatProps: { color: 'error' } },
  done: { mark: '✓', head: '✓ DONE', bandHead: '✓ DONE', sep: ' · ', headProps: { bold: true }, whatProps: {} },
  working: { mark: '●', head: '● working', bandHead: '●', sep: ' · ', headProps: { color: ACCENT_COLOUR }, whatProps: {} },
  quiet: { mark: '○', head: '○', bandHead: '○', sep: ' ', headProps: { dimColor: true }, whatProps: {} },
}

// STATUS as lines: the head, then what follows it, wrapping at its parts, then words; never cut.
function statusLines(status: Status, width: number): Part[][] {
  const look = STATUS_LOOKS[status.state]
  const text = [look.head, status.what].filter(Boolean).join(look.sep)
  return wrapAtParts(text, width).map((line: string, i: number) => {
    if (i > 0 || !line.startsWith(look.head)) return [{ text: line, props: look.whatProps }]
    const rest = line.slice(look.head.length)
    return [{ text: look.head, props: look.headProps }, ...(rest ? [{ text: rest, props: look.whatProps }] : [])]
  })
}

// The first glance: GOAL, then STATUS, which answers "am I needed now?".
function topRows(view: View, columns: number) {
  const width = columns > 0 ? columns - LABEL_WIDTH : 0
  return [...goalRows(view, columns), ...rowLines('STATUS', statusLines(view.status, width), FIRST_GLANCE_LABEL)]
}

// The details under the rule, read after the first glance.
function paneRows(view: View, columns: number) {
  const { rows, rowTones = {} as RowTones } = view
  const width = columns > 0 ? columns - LABEL_WIDTH : 0
  const review = view.endRound ? endReviewLines(view.endRound, width) : lensLines(view.lensRound, width)
  return [
    ...rowLines('PR', wrapped(view.end.pr, width)),
    ...rowLines('BUILT', wrapped(view.end.done, width)),
    ...rowLines('SPENT', one(rows.spent, toneProps(rowTones.spent))),
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
      {topRows(view, columns).map(({ label: name, labelProps, parts }, row) => (
        <Box key={`top-${row}`}>
          <Text key="label" wrap="truncate-end" {...labelProps}>{name}</Text>
          {parts.map((part, i) => <Text key={`part-${i}`} wrap="truncate-end" {...part.props}>{part.text}</Text>)}
        </Box>
      ))}
      <Text key="top-rule" dimColor wrap="truncate-end">{goalRule(columns)}</Text>
      {paneRows(view, columns).map(({ label: name, labelProps, parts }, row) => (
        <Box key={`row-${row}`}>
          <Text key="label" wrap="truncate-end" {...labelProps}>{name}</Text>
          {parts.map((part, i) => <Text key={`part-${i}`} wrap="truncate-end" {...part.props}>{part.text}</Text>)}
        </Box>
      ))}
      {unknownLabels.map((raw, i) => <Text key={`unknown-${i}`}>{raw}</Text>)}
      {unknownLabels.length > 0 && <Text dimColor>{`${unknownLabels.length} label${unknownLabels.length === 1 ? '' : 's'} unknown`}</Text>}
      <Text key="gap"> </Text>
      {note && <Text>{note}</Text>}
      {suggestion?.state === 'pending' && <Text>{`applies at the next agent spawn: ${suggestion.nextAgent ? (plainName(suggestion.nextAgent) ?? suggestion.nextAgent) : 'the next agent'}`}</Text>}
      {suggestion?.state === 'delivered' && <Text>{`delivered to ${plainName(suggestion.to) ?? suggestion.to}`}</Text>}
      {ledger && (
        <>
          {/* r works while the pane has focus; /pb-report writes the same report from the prompt, also mid-turn. */}
          <Box key="report-row">
            <Button key="report" label="r open report" hotkey="r" onPress={onReport} />
            <Text key="report-gap">  </Text>
            <Text key="report-command" dimColor wrap="truncate-end">{REPORT_COMMAND}</Text>
          </Box>
          {!ended && <Input key="suggest" label="suggest" placeholder="a note for the next agent" onSubmit={onSuggest} />}
        </>
      )}
      <Button key="dismiss" label="dismiss" role="dismiss" onPress={onDismiss} />
    </Box>
  )
}
