import { fitBand, SEPARATOR } from '../shared-node/glance.mjs'
import { READY, goalGist } from '../shared-node/end-state.mjs'
import { PHASES } from '../shared-node/labels.mjs'
import { ACCENT_COLOUR, PHASE_COLOURS, STATUS_LOOKS } from './pane'
import type { Segment, Tags } from './view'

const HINT = '/pb for details'
const SHORT_HINT = '/pb'
const IDLE_SEPARATOR = ' · '
const IDLE = `Pairing Buddy · idle${IDLE_SEPARATOR}${HINT}`
const ENDED = `Pairing Buddy · last run finished${IDLE_SEPARATOR}${HINT}`
// The unit is done with nothing left to do: STATUS's done head leads, then the call to action, plain and not dim.
const DONE_REST = `${STATUS_LOOKS.done.sep}${READY}${IDLE_SEPARATOR}${HINT}`
export const DETAILS = '▸ details'
const RULE_FALLBACK_WIDTH = 40
// The pane's [-] control sits beside the band row, so the row gets this many fewer cells than bodyColumns.
const CONTROL_WIDTH = 4

// A dim rule above the band text; columns is 0 before the first layout, so a fixed width stands in, never wider than the region.
const rule = (columns: number) => '─'.repeat(columns > 0 ? columns : RULE_FALLBACK_WIDTH)

// The button and the space before it are always reserved; a hint (its separator and a trailing space) only when one is given.
export const bandColumns = (columns: number, hint: string = '') => columns - CONTROL_WIDTH - DETAILS.length - 1 - (hint ? SEPARATOR.length + hint.length + 1 : 0)

// The goal's gist for the band's first row: the whole goal when it fits beside the [-] control, else cut at the last clause
// break, else the last word, that fits (never with "…"); undefined while no run names its goal. No room known cuts nothing.
export function bandGoal(goal: string | undefined, columns: number) {
  if (!goal || goal === '—') return undefined
  return goalGist(goal.trim().replace(/\s+/g, ' '), columns > 0 ? columns - CONTROL_WIDTH : 0)
}

const OPENED_DETAILS = 'opened details'

// Once the alert opened the pane, the question or stop that leads the band reads as opened, behind its head; fitBand keeps it whole.
const asOpened = (band: Segment[]): Segment[] =>
  band.map(segment => {
    if (segment.id !== 'needsYou' || !segment.standing || !segment.state) return segment
    const look = STATUS_LOOKS[segment.state]
    return { ...segment, text: `${look.bandHead}${look.sep}${OPENED_DETAILS}`, short: `${look.mark} ${OPENED_DETAILS}` }
  })

const LIT = { color: ACCENT_COLOUR, bold: true }

// A lit segment as the pane draws where the run is now: its leading phase word in the phase's colour, the rest in the accent.
function litParts(text: string): { text: string; props: Record<string, unknown> }[] {
  const phase = PHASES.find((name: string) => text === name || text.startsWith(`${name} `))
  if (!phase) return [{ text, props: LIT }]
  const rest = text.slice(phase.length)
  return [{ text: phase, props: { color: PHASE_COLOURS[phase], bold: true } }, ...(rest ? [{ text: rest, props: LIT }] : [])]
}

// A segment that leads with the run's status: its head as STATUS draws it, then the rest, lit or in the state's tone. A lit
// rest keeps the space after the head in the head's Text, so its phase word stands alone.
function statusParts(segment: Segment & { state: NonNullable<Segment['state']> }): { text: string; props: Record<string, unknown> }[] {
  const look = STATUS_LOOKS[segment.state]
  // The short form leads with the mark alone.
  const head = segment.text.startsWith(look.bandHead) ? look.bandHead : look.mark
  const rest = segment.text.slice(head.length)
  if (!segment.lit) return [{ text: head, props: look.headProps }, ...(rest ? [{ text: rest, props: look.whatProps }] : [])]
  const gap = rest.length - rest.trimStart().length
  return [{ text: `${head}${rest.slice(0, gap)}`, props: look.headProps }, ...litParts(rest.slice(gap))]
}

// One segment's Texts: its status head first when it leads, else lit, else in its tone.
function segmentTexts(Text: Tags['Text'], segment: Segment) {
  const parts = segment.state ? statusParts(segment as Segment & { state: NonNullable<Segment['state']> }) : segment.lit ? litParts(segment.text) : undefined
  if (parts) return parts.map((part, i) => <Text key={`${segment.id}-${i}`} wrap="truncate-end" {...part.props}>{part.text}</Text>)
  return [<Text key={segment.id} color={segment.tone === 'dim' ? undefined : segment.tone} bold={segment.bold} dimColor={segment.tone === 'dim' ? true : undefined} wrap="truncate-end">{segment.text}</Text>]
}

// While a stage is active, only the segments that fit beside the details button; otherwise one dim "idle".
export function Band({ Box, Text, Button, band, goal, columns, running, waiting, opened, ended, done, between, onDetails }: Tags & {
  band: Segment[]
  goal?: string
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
    : ended ? ENDED : IDLE
  const finished = ended && done && !labelled
  // The goal leads on its own row, so the step below it stays where the eye learnt to find it: two rows at most.
  const gist = bandGoal(goal, columns)

  return (
    <Box flexDirection="column">
    <Text key="rule" dimColor>{rule(columns)}</Text>
    {gist && <Text key="goal" bold wrap="truncate-end">{gist}</Text>}
    <Box flexShrink={1}>
      {shown
        ? shown.flatMap((segment: Segment, i: number) => [
            ...(i > 0 ? [<Text key={`sep-${segment.id}`} wrap="truncate-end">{SEPARATOR}</Text>] : []),
            ...segmentTexts(Text, segment),
          ])
        : finished
          ? <Box marginRight={1}><Text key="done" wrap="truncate-end" {...STATUS_LOOKS.done.headProps}>{STATUS_LOOKS.done.bandHead}</Text><Text key="done-rest" wrap="truncate-end">{DONE_REST}</Text></Box>
          : <Box marginRight={1}><Text dimColor wrap="truncate-end">{idleText}</Text></Box>}
      {shown && <Text key="gap"> </Text>}
      <Button key="details" label={DETAILS} onPress={onDetails}>{shown && <Text>{DETAILS}</Text>}</Button>
      {shown && hint && <Text key="hint" wrap="truncate-end">{`${SEPARATOR}${hint} `}</Text>}
    </Box>
    </Box>
  )
}
