import { fitBand, SEPARATOR } from '../shared-node/glance.mjs'
import { goalGist, nextWords } from '../shared-node/end-state.mjs'
import { PHASES } from '../shared-node/labels.mjs'
import { ACCENT_COLOUR, PHASE_COLOURS, STATUS_LOOKS } from './pane'
import type { Segment, Tags } from './view'

const IDLE_SEPARATOR = ' · '

// The band names commands, not a button: the classic renderer has no mouse, and a band button is reached only by ctrl+x tab.
// Each command follows its label ("details: /pb"), so no word reads as an argument to type ("/pb details" did, live 2026-11-25).
const COMMANDS = [['details', '/pb'], ['report', '/pb-report'], ['plan', '/pb-plan']] as const
// Every form the hint takes, longest first: a narrow band drops whole commands from the right, never one cut mid-word.
export const HINTS = COMMANDS.map((_, i) => COMMANDS.slice(0, COMMANDS.length - i).map(([label, command]) => `${label}: ${command}`).join(IDLE_SEPARATOR))
export const HINT = HINTS[0]
const IDLE = 'Pairing Buddy · idle'
const ENDED = 'Pairing Buddy · last run finished'
const RULE_FALLBACK_WIDTH = 40
// The pane's [-] control sits beside the band row, so the row gets this many fewer cells than bodyColumns.
const CONTROL_WIDTH = 4

// A dim rule above the band text; columns is 0 before the first layout, so a fixed width stands in, never wider than the region.
const rule = (columns: number) => '─'.repeat(columns > 0 ? columns : RULE_FALLBACK_WIDTH)

// A hint (its separator and a trailing space) is reserved only when one is given.
export const bandColumns = (columns: number, hint: string = '') => columns - CONTROL_WIDTH - (hint ? SEPARATOR.length + hint.length + 1 : 0)

// The goal's gist for the band's first row: the whole goal when it fits beside the [-] control, else cut at the last clause
// break, else the last word, that fits (never with "…"); undefined while no run names its goal. No room known cuts nothing.
export function bandGoal(goal: string | undefined, columns: number) {
  if (!goal || goal === '—') return undefined
  return goalGist(goal.trim().replace(/\s+/g, ' '), columns > 0 ? columns - CONTROL_WIDTH : 0)
}

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

// The band's one quiet line, when no step shows: its head, the words after it, and whether they are dim.
// Between steps the run is still at work: the working mark leads, then the dim line; the goal row above names the session, so
// it needs no "Pairing Buddy" label. Done leads with STATUS's done head, then the call to action, plain and not dim: the plan's
// next unit (next) when it has one left, as STATUS says it.
function quietLine({ between, ended, done, next }: { between?: string; ended?: boolean; done?: boolean; next?: string }): { head?: string; headProps?: Record<string, unknown>; words: string; dim: boolean } {
  const { working, done: finished } = STATUS_LOOKS
  if (between) return { head: `${working.bandHead} `, headProps: working.headProps, words: between, dim: true }
  if (ended && done) return { head: finished.bandHead, headProps: finished.headProps, words: `${finished.sep}${nextWords(next)}`, dim: false }
  return { words: ended ? ENDED : IDLE, dim: true }
}

// While a stage is active or a question waits, only the segments that fit; otherwise the quiet line. The commands hint follows.
export function Band({ Box, Text, band, goal, columns, running, waiting, ended, done, between, next }: Pick<Tags, 'Box' | 'Text'> & {
  band: Segment[]
  goal?: string
  columns: number
  running: boolean
  waiting?: boolean
  ended?: boolean
  done?: boolean
  between?: string
  next?: string
}) {
  // A question or a stop leads with what it needs or why, also once the alert opened the pane: the band is what a human
  // cycling sessions reads, and "opened details" told them nothing (live check, 2026-11-22).
  const source = band
  // The hint is the lowest priority: it gives way to its short form, then to nothing, before any segment is cut.
  const content = running || waiting ? fitBand(source, bandColumns(columns)) : undefined
  const hint = content && HINTS.find(candidate => JSON.stringify(fitBand(source, bandColumns(columns, candidate))) === JSON.stringify(content))
  const shown = content
  const quiet = quietLine({ between, ended, done, next })
  // The hint gives way first when the width is short; with no width known yet it stays.
  const room = columns > 0 ? columns - CONTROL_WIDTH - (quiet.head?.length ?? 0) : Infinity
  const quietText = [...HINTS.map(form => `${quiet.words}${IDLE_SEPARATOR}${form}`), quiet.words].find(text => text.length <= room) ?? quiet.words
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
        : <Box>{quiet.head && <Text key="head" wrap="truncate-end" {...quiet.headProps}>{quiet.head}</Text>}<Text key="quiet" dimColor={quiet.dim || undefined} wrap="truncate-end">{quietText}</Text></Box>}
      {shown && hint && <Text key="hint" wrap="truncate-end">{`${SEPARATOR}${hint} `}</Text>}
    </Box>
    </Box>
  )
}
