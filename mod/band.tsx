import { fitBand, SEPARATOR } from '../shared-node/glance.mjs'
import { DONE_WORDS } from '../shared-node/end-state.mjs'
import { PHASES } from '../shared-node/labels.mjs'
import { ACCENT_COLOUR, PHASE_COLOURS } from './pane'
import type { Segment, Tags } from './view'

const HINT = '/pb for details'
const SHORT_HINT = '/pb'
const IDLE_SEPARATOR = ' · '
const IDLE = `Pairing Buddy · idle${IDLE_SEPARATOR}${HINT}`
const ENDED = `Pairing Buddy · last run finished${IDLE_SEPARATOR}${HINT}`
// The unit is done with nothing left to do: said plainly and not dim, as the alert says it.
const DONE = `Pairing Buddy · ${DONE_WORDS}${IDLE_SEPARATOR}${HINT}`
export const DETAILS = '▸ details'
const RULE_FALLBACK_WIDTH = 40
// The pane's [-] control sits beside the band row, so the row gets this many fewer cells than bodyColumns.
const CONTROL_WIDTH = 4

// A dim rule above the band text; columns is 0 before the first layout, so a fixed width stands in, never wider than the region.
const rule = (columns: number) => '─'.repeat(columns > 0 ? columns : RULE_FALLBACK_WIDTH)

// The button and the space before it are always reserved; a hint (its separator and a trailing space) only when one is given.
export const bandColumns = (columns: number, hint: string = '') => columns - CONTROL_WIDTH - DETAILS.length - 1 - (hint ? SEPARATOR.length + hint.length + 1 : 0)

export const OPENED_DETAILS = 'needs you · opened details'

// Once the alert opened the pane, the needs-you segment reads as opened; fitBand keeps it whole.
const asOpened = (band: Segment[]): Segment[] => band.map(segment => (segment.id === 'needsYou' && segment.standing ? { ...segment, text: OPENED_DETAILS } : segment))

const LIT = { color: ACCENT_COLOUR, bold: true }

// A lit segment as the pane draws where the run is now: its leading phase word in the phase's colour, the rest in the accent.
function litParts(text: string): { text: string; props: Record<string, unknown> }[] {
  const phase = PHASES.find((name: string) => text === name || text.startsWith(`${name} `))
  if (!phase) return [{ text, props: LIT }]
  const rest = text.slice(phase.length)
  return [{ text: phase, props: { color: PHASE_COLOURS[phase], bold: true } }, ...(rest ? [{ text: rest, props: LIT }] : [])]
}

// One segment's Texts: lit, else in its tone.
function segmentTexts(Text: Tags['Text'], segment: Segment) {
  if (segment.lit) return litParts(segment.text).map((part, i) => <Text key={`${segment.id}-${i}`} wrap="truncate-end" {...part.props}>{part.text}</Text>)
  return [<Text key={segment.id} color={segment.tone === 'dim' ? undefined : segment.tone} bold={segment.bold} dimColor={segment.tone === 'dim' ? true : undefined} wrap="truncate-end">{segment.text}</Text>]
}

// While a stage is active, only the segments that fit beside the details button; otherwise one dim "idle".
export function Band({ Box, Text, Button, band, columns, running, waiting, opened, ended, done, between, onDetails }: Tags & {
  band: Segment[]
  columns: number
  running: boolean
  waiting?: boolean
  opened?: boolean
  ended?: boolean
  done?: boolean
  between?: string
  onDetails: () => void
}) {
  const source = opened && running ? asOpened(band) : band
  // The hint is the lowest priority: "/pb for details" gives way to "/pb", then to nothing, before any segment is cut.
  const content = running || waiting ? fitBand(source, bandColumns(columns)) : undefined
  const hint = [HINT, SHORT_HINT].find(candidate => JSON.stringify(fitBand(source, bandColumns(columns, candidate))) === JSON.stringify(content))
  const shown = content
  // Between steps the text is the same dim line; its hint gives way first when the width is short.
  const room = columns - CONTROL_WIDTH - DETAILS.length - 1
  const labelled = between ? `Pairing Buddy · ${between}` : undefined
  const idleText = labelled
    ? [`${labelled}${IDLE_SEPARATOR}${HINT}`, `${labelled}${IDLE_SEPARATOR}${SHORT_HINT}`, labelled].find(text => text.length <= room) ?? labelled
    : ended ? (done ? DONE : ENDED) : IDLE

  return (
    <Box flexDirection="column">
    <Text key="rule" dimColor>{rule(columns)}</Text>
    <Box flexShrink={1}>
      {shown
        ? shown.flatMap((segment: Segment, i: number) => [
            ...(i > 0 ? [<Text key={`sep-${segment.id}`} wrap="truncate-end">{SEPARATOR}</Text>] : []),
            ...segmentTexts(Text, segment),
          ])
        : <Box marginRight={1}><Text dimColor={!(ended && done)} bold={ended && done ? true : undefined} wrap="truncate-end">{idleText}</Text></Box>}
      {shown && <Text key="gap"> </Text>}
      <Button key="details" label={DETAILS} onPress={onDetails}>{shown && <Text>{DETAILS}</Text>}</Button>
      {shown && hint && <Text key="hint" wrap="truncate-end">{`${SEPARATOR}${hint} `}</Text>}
    </Box>
    </Box>
  )
}
