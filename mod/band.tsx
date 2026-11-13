import { fitBand, SEPARATOR } from '../shared-node/glance.mjs'
import type { Segment, Tags } from './view'

const HINT = '/pb for details'
const SHORT_HINT = '/pb'
const IDLE_SEPARATOR = ' · '
const IDLE = `Pairing Buddy · idle${IDLE_SEPARATOR}${HINT}`
const ENDED = `Pairing Buddy · last run finished${IDLE_SEPARATOR}${HINT}`
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

// While a stage is active, only the segments that fit beside the details button; otherwise one dim "idle".
export function Band({ Box, Text, Button, band, columns, running, waiting, opened, ended, between, onDetails }: Tags & {
  band: Segment[]
  columns: number
  running: boolean
  waiting?: boolean
  opened?: boolean
  ended?: boolean
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
    : ended ? ENDED : IDLE

  return (
    <Box flexDirection="column">
    <Text key="rule" dimColor>{rule(columns)}</Text>
    <Box flexShrink={1}>
      {shown
        ? shown.flatMap((segment: Segment, i: number) => [
            ...(i > 0 ? [<Text key={`sep-${segment.id}`} wrap="truncate-end">{SEPARATOR}</Text>] : []),
            <Text key={segment.id} color={segment.tone === 'dim' ? undefined : segment.tone} bold={segment.bold} dimColor={segment.tone === 'dim' ? true : undefined} wrap="truncate-end">{segment.text}</Text>,
          ])
        : <Box marginRight={1}><Text dimColor wrap="truncate-end">{idleText}</Text></Box>}
      {shown && <Text key="gap"> </Text>}
      <Button key="details" label={DETAILS} onPress={onDetails}>{shown && <Text>{DETAILS}</Text>}</Button>
      {shown && hint && <Text key="hint" wrap="truncate-end">{`${SEPARATOR}${hint} `}</Text>}
    </Box>
    </Box>
  )
}
