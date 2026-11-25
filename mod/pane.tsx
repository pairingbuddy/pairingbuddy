import { cutAtWord, lensLines, lensSummaryLines } from '../shared-node/lens-round.mjs'
import { endReviewLines, endReviewSummaryLines, goalLines, wrapAtParts } from '../shared-node/end-state.mjs'
import { commitRows, firstUnticked, gapWords, humanWords, OPEN_COMMIT_ROWS, planFocus, PLAN_ROWS, problemRows, SHORT_COMMIT_ROWS, STATE_SEPARATOR, taskMark, unitWords, windowRows } from '../shared-node/plan-window.mjs'
import { hiddenRows, moreRowsLine, paneBudget, PLAN_TARGET } from '../shared-node/pane-height.mjs'
import { resolveOpenUnit } from './view'
import type { RowTones, Status, StatusState, Tags, View } from './view'

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
// What marks a cut title or name.
const ELLIPSIS = '…'

// A test line stays one line, so a long name is cut at the last word that fits and marked by …, as plan and REVIEW titles are
// (the report's SCENARIOS holds it whole); no room given cuts nothing.
const cutName = (name: string, room: number) => (!(room > 0) || cells(name) <= room ? name : `${cutAtWord(name, room - ELLIPSIS.length)}${ELLIPSIS}`)

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
// short, for a short pane: the counts and the current test only.
function testsParts({ progress, test }: Pick<View, 'progress' | 'test'>, width: number, short = false): Part[][] {
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
  // Once the build is over a covered test passes too: its `◌` read as not started beside `✓ n of n passing`.
  const settled = progress?.count?.settled === true
  const entryText = ({ mark, name }: { mark: keyof typeof MARKS; name: string }) => (settled && mark === 'covered' ? `${MARKS.done} ${name} · covered` : `${MARKS[mark]} ${name}`)
  for (const entry of entries) {
    if (entry.mark === 'current') lines.push(currentLine(entry.name))
    else if (!short) lines.push([{ text: cutName(entryText(entry), width) }])
  }
  // A current test the list does not hold still gets its line.
  if (test?.current && !entries.some(entry => entry.mark === 'current')) lines.push(currentLine(test.current))
  // With the total not known yet, the count is of the tests seen so far.
  if (progress?.more && !short) lines.push([{ text: `+${progress.more} more${progress.known ? '' : ' so far'}`, props: { dimColor: true } }])
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
  const lines: Part[][] = wrapAtParts(text, width).map((line: string, i: number) => {
    if (i > 0 || !line.startsWith(look.head)) return [{ text: line, props: look.whatProps }]
    const rest = line.slice(look.head.length)
    return [{ text: look.head, props: look.headProps }, ...(rest ? [{ text: rest, props: look.whatProps }] : [])]
  })
  // The fix is a command to type, so it has its own line, plain, wrapped at words only.
  return status.fix ? [...lines, ...wrapAtParts(status.fix, width).map((line: string) => [{ text: line }])] : lines
}

// The first glance: GOAL, then STATUS, which answers "am I needed now?".
function topRows(view: View, columns: number) {
  const width = columns > 0 ? columns - LABEL_WIDTH : 0
  return [...goalRows(view, columns), ...rowLines('STATUS', statusLines(view.status, width), FIRST_GLANCE_LABEL)]
}

// The plan as a tree: each tracer, its units nested under it, each unit's tasks under that, in plan order.
const NEST = '  '
const SHORT_SHA = 7
// The open unit's branch, base and commits, each on its own line; a unit of many commits shows its latest (commitRows), at
// most commitMost rows of them.
function openUnitLines(open: NonNullable<View['planOpen']>, indent: string, commitMost = OPEN_COMMIT_ROWS): Part[][] {
  const facts = [
    ...(open.branch ? [`branch ${open.branch}`] : []),
    ...(open.base ? [`base ${open.base}`] : []),
    ...commitRows(open.commits ?? [], commitMost).map((row: { sha?: string; earlier?: number }) => (row.sha ? `commit ${row.sha.slice(0, SHORT_SHA)}` : `${ELLIPSIS} ${row.earlier} earlier commits`)),
  ]
  return facts.map(text => [{ text: `${indent}${text}` }])
}

// A unit's PR link as a row, or none.
function prRows(pr: string | undefined, indent: string): Part[][] {
  return pr ? [[{ text: `${indent}PR ${pr}` }]] : []
}

// With no plan, the open unit alone: its facts and its PR link.
function unitOnlyLines(open: NonNullable<View['planOpen']>, pr?: string): Part[][] {
  return [...openUnitLines(open, ''), ...prRows(pr, '')]
}

type PlanUnit = NonNullable<View['plan']>['units'][number]
type Gap = { tasks: number; done: number; first: number; last: number; edge?: 'above' | 'below' }

// A tree row too wide for the room cuts its title, at a word and marked by …, never its lead (indent and mark) or the state
// words after it. No room given cuts nothing.
function titleRow(lead: string, title: string, tail: string, width: number): string {
  const whole = `${lead}${title}${tail}`
  if (!(width > 0) || cells(whole) <= width) return whole
  const room = width - cells(lead) - cells(tail) - ELLIPSIS.length
  const cut = room > 0 ? cutAtWord(title, room) : ''
  return `${lead}${cut === title ? cut : `${cut}${ELLIPSIS}`}${tail}`
}

// A tree row with what the window needs of it: the rows it needs shown beside it (a task its tracer, unit and facts), and its
// task's tick and its unit's position (group) when it is a task, and its indent, which an ellipsis row standing for it takes.
type TreeRow = { parts: Part[]; needs: number[]; indent: string; task?: { checked: boolean }; group?: number }

// One unit's rows: its name and state, then what it is based on, the open unit's facts, its PR and its tasks, each a row of
// the tree at `rows`' end. building: the title of the task the live run builds; publishing: a live publish run writes the
// open unit's pull request; width: the room each row has. The focus task's row is noted in `focus`.
function unitRows(rows: TreeRow[], unit: PlanUnit, group: number, state: string | undefined, open: View['planOpen'], indent: string, context: number[], focus: PlanFocus, building?: string, width = 0, publishing = false, commitMost = OPEN_COMMIT_ROWS) {
  const contentIndent = indent + NEST
  const isOpen = Boolean(open && open.unit === unit.unit)
  const words = unitWords(state, isOpen, publishing)
  const push = (parts: Part[], needs: number[], task?: TreeRow['task'], at = contentIndent) => rows.push({ parts, needs, indent: at, ...(task ? { task, group } : {}) }) - 1
  const unitRow = push([{ text: titleRow(indent, unit.unit, words ? `${STATE_SEPARATOR}${words}` : '', width) }], context, undefined, indent)
  const header = [...context, unitRow]
  const facts = [
    ...(unit.dependsOn ? [[{ text: `${contentIndent}based on ${unit.dependsOn}` }]] : []),
    ...(open && isOpen ? openUnitLines(open, contentIndent, commitMost) : []),
    ...prRows(unit.pr, contentIndent),
  ].map(parts => push(parts, header))
  for (const task of unit.tasks) {
    const inProgress = !task.checked && task.title === building
    const human = inProgress ? '' : humanWords(task, focus.reached)
    const props = inProgress ? LIT : human ? NEEDS_PERSON_PROPS : undefined
    const row = push([{ text: taskRow(task, inProgress, human, contentIndent, width), ...(props ? { props } : {}) }], [...header, ...facts], { checked: task.checked })
    if (task === focus.task) focus.row = row
  }
}

// A task's mark and title: ▸ for the one being built, as STEPS marks its running step, then an unticked [HUMAN] task's words
// (humanWords), kept whole while the title gives way.
function taskRow(task: PlanUnit['tasks'][number], inProgress: boolean, human: string, indent: string, width: number): string {
  return titleRow(`${indent}${taskMark(task, inProgress)} `, task.title, human ? `${STATE_SEPARATOR}${human}` : '', width)
}

// An unticked [HUMAN] task's row, in the colour NEEDS YOU's words take, so every person's task ahead stands out.
const NEEDS_PERSON_PROPS: Props = { color: 'warning', bold: true }

// The PLAN block's focus task and its row once drawn, and the plan's first unticked task (firstUnticked), which a [HUMAN]
// task waits on a person at.
type PlanFocus = { task?: PlanUnit['tasks'][number]; row?: number; reached: PlanUnit['tasks'][number] | null }

// Consecutive units of one tracer form a group; a unit under no tracer is its own group, unindented.
type TracerGroup = { tracer: string | null | undefined; units: { unit: PlanUnit; index: number }[] }

function tracerGroups(units: PlanUnit[]): TracerGroup[] {
  const groups: TracerGroup[] = []
  for (const [index, unit] of units.entries()) {
    const last = groups.at(-1)
    if (last && unit.tracer && last.tracer === unit.tracer) last.units.push({ unit, index })
    else groups.push({ tracer: unit.tracer, units: [{ unit, index }] })
  }
  return groups
}

// How to see the whole plan, named on an ellipsis row: in full, else its short form, else not at all, as fits the room.
const PLAN_HINTS = [' · /pb-plan shows all', ' · /pb-plan']
const withPlanHint = (text: string, width: number) => [...PLAN_HINTS.map(hint => `${text}${hint}`), text].find(line => !(width > 0) || cells(line) <= width) ?? text

// The PLAN block: the tree, in at most `room` rows (PLAN_ROWS, fewer in a short pane) with the plan's problems under it. A
// tree too long for its room is a window around its focus (planFocus, windowRows), each cut a dim row that counts what it hides.
function planLines(plan: NonNullable<View['plan']>, states: string[] = [], rawOpen?: View['planOpen'], building?: string, width = 0, publishing = false, room = PLAN_ROWS): Part[][] {
  // The same unit the states resolved: a record naming only its tracer shows its facts under that tracer's first unit.
  const open = rawOpen && resolveOpenUnit(plan.units, rawOpen)
  // The open unit whose pull request is being written, or is not opened yet, is the focus while it waits on that.
  const openIndex = open ? plan.units.findIndex(unit => unit.unit === open.unit) : -1
  const awaitingPr = openIndex !== -1 && (publishing || states[openIndex] === 'unpublished') ? openIndex : undefined
  const at = planFocus(plan.units, building, awaitingPr)
  const focus: PlanFocus = { task: at ? plan.units[at.unit].tasks[at.task] : undefined, reached: firstUnticked(plan.units) }
  // A block short of its target keeps the open unit's commits to fewer rows, so its tasks still fit.
  const commitMost = room < PLAN_TARGET ? SHORT_COMMIT_ROWS : OPEN_COMMIT_ROWS
  const rows: TreeRow[] = []
  for (const { tracer, units } of tracerGroups(plan.units)) {
    const context = tracer ? [rows.push({ parts: [{ text: titleRow('', tracer, '', width) }], needs: [], indent: '' }) - 1] : []
    for (const { unit, index } of units) unitRows(rows, unit, index, states[index], open, tracer ? NEST : '', context, focus, building, width, publishing, commitMost)
  }
  // The problems are told first, so the tree has the room they leave.
  const problems = problemRows(plan.problems ?? [])
  const shown = windowRows(rows, { focus: focus.row ?? rows.length - 1, room: room - problems.length })
  // An ellipsis row is indented as the shallowest row it hides.
  const gapIndent = ({ first, last }: Gap) => rows.slice(first, last + 1).reduce((least, row) => (row.indent.length < least.length ? row.indent : least), rows[first].indent)
  // The hint sits on the cut at the tree's end, else the one at its start: a cut between shown rows hides only a little.
  const gaps = shown.flatMap((entry: { row: number } | { gap: Gap }) => ('gap' in entry ? [entry.gap] : []))
  const hinted = gaps.find(gap => gap.edge === 'below') ?? gaps.find(gap => gap.edge === 'above')
  const gapRow = (gap: Gap) => {
    const text = `${gapIndent(gap)}${gapWords(gap)}`
    return [{ text: gap === hinted ? withPlanHint(text, width) : text, props: { dimColor: true } }]
  }
  const tree = shown.map((entry: { row: number } | { gap: Gap }) => ('row' in entry ? rows[entry.row].parts : gapRow(entry.gap)))
  return [...tree, ...problems.map((problem: string) => [{ text: problem }])]
}

// A step to come, as STEPS marks it.
const STEP_TO_COME = '○'

// STEPS on one line, for a short pane: how many are done, the running step, and how many are to come.
function stepsFolded(steps: string[]): Part[][] {
  const count = (mark: string) => steps.filter(line => line.startsWith(mark)).length
  const current = steps.find(line => line.startsWith(MARKS.current))
  const parts: Part[] = [
    ...(count(MARKS.done) ? [{ text: `${MARKS.done} ${count(MARKS.done)} done` }] : []),
    ...(current ? [{ text: current, props: LIT }] : []),
    ...(count(STEP_TO_COME) ? [{ text: `${count(STEP_TO_COME)} to come` }] : []),
  ]
  return parts.length ? [parts.flatMap((part, i) => (i > 0 ? [{ text: STATE_SEPARATOR }, part] : [part]))] : []
}

type Rows = ReturnType<typeof rowLines>

// The details under the rule, read after the first glance. room: the rows the pane's body shows at once, when the platform
// says; fixed: the rows drawn above and below these that never fold. A short room folds STEPS, then TESTS, then REVIEW (REVIEW
// first once the work is finished), and gives the PLAN block what is left (paneBudget).
function paneRows(view: View, columns: number, room?: number, fixed = 0): Rows {
  const { rows, rowTones = {} as RowTones } = view
  const width = columns > 0 ? columns - LABEL_WIDTH : 0
  const review = view.endRound ? endReviewLines(view.endRound, width) : lensLines(view.lensRound, width)
  const reviewSummary = view.endRound ? endReviewSummaryLines(view.endRound, width) : lensSummaryLines(view.lensRound, width)
  const reviewRow = (lines: { text: string; tone?: string }[]) => rowLines('REVIEW', lines.map(line => [{ text: line.text, props: toneProps(line.tone) }]))
  const head = [
    ...rowLines('PR', wrapped(view.end.pr, width)),
    ...rowLines('BUILT', wrapped(view.end.done, width)),
    ...rowLines('SPENT', one(rows.spent, toneProps(rowTones.spent))),
  ]
  const steps = { full: rowLines('STEPS', view.steps.map(line => [{ text: line, props: stepProps(line) }])), folded: rowLines('STEPS', stepsFolded(view.steps)) }
  // While the build runs its tests are what to watch: TESTS folds then only for the plan's floor.
  const tests = { full: rowLines('TESTS', testsParts(view, width)), folded: rowLines('TESTS', testsParts(view, width, true)), forTarget: view.progress?.count?.settled === true }
  const reviewed = { full: reviewRow(review), folded: reviewRow(reviewSummary) }
  // Once the work is finished the report holds the review's findings, so REVIEW folds first.
  const order = view.endRound ? [reviewed, steps, tests] : [steps, tests, reviewed]
  const plan = (planRoom: number): Rows => [
    ...(view.plan ? rowLines('PLAN', planLines(view.plan, view.planStates, view.planOpen, view.planBuilding, width, view.planPublishing === true, planRoom)) : []),
    ...(!view.plan && view.planOpen ? rowLines('PLAN', unitOnlyLines(view.planOpen, view.planOpenPr)) : []),
  ]
  const tallest = plan(PLAN_ROWS)
  const budget = paneBudget({
    room,
    fixed: fixed + head.length,
    sections: order.map(({ full, folded, forTarget }: { full: Rows; folded: Rows; forTarget?: boolean }) => ({ full: full.length, folded: folded.length, forTarget })),
    plan: tallest.length,
  })
  return [
    ...head,
    ...[steps, tests, reviewed].flatMap(section => (budget.fold[order.indexOf(section)] ? section.folded : section.full)),
    ...(budget.planRoom < PLAN_ROWS ? plan(budget.planRoom) : tallest),
  ]
}

// The most raw labels pb could not read that the pane lists, the latest ones; the count under them counts all of them.
const UNKNOWN_LABEL_ROWS = 3
const shownLabels = (unknownLabels: string[]) => unknownLabels.slice(-UNKNOWN_LABEL_ROWS)

export function Pane({ Box, Text, view, columns = 0, room, offset = 0, focused = false, unknownLabels, note = null }: Tags & {
  view: View
  columns?: number
  // The rows the pane's body shows at once (its scroll's bodyRows); unknown keeps the layout drawn for a tall room.
  room?: number
  // The first row the body's window shows, and whether the pane has the keys.
  offset?: number
  focused?: boolean
  unknownLabels: string[]
  note?: string | null
}) {
  const top = topRows(view, columns)
  // Under the details: the raw labels pb could not read and their count, the gap, and the note.
  const tail = [
    ...shownLabels(unknownLabels).map((raw, i) => <Text key={`unknown-${i}`}>{raw}</Text>),
    ...(unknownLabels.length > 0 ? [<Text key="unknown-count" dimColor>{`${unknownLabels.length} label${unknownLabels.length === 1 ? '' : 's'} unknown`}</Text>] : []),
    <Text key="gap"> </Text>,
    ...(note ? [<Text key="note">{note}</Text>] : []),
  ]
  // The top rows, the rule and the tail never fold.
  const rows = paneRows(view, columns, room, top.length + 1 + tail.length)
  // One labelled row: its label, then its parts, each a Text cut at the body's edge.
  const labelled = (prefix: string) => ({ label: name, labelProps, parts }: Rows[number], row: number) => (
    <Box key={`${prefix}-${row}`}>
      <Text key="label" wrap="truncate-end" {...labelProps}>{name}</Text>
      {parts.map((part, i) => <Text key={`part-${i}`} wrap="truncate-end" {...part.props}>{part.text}</Text>)}
    </Box>
  )
  const drawn = [...top.map(labelled('top')), <Text key="top-rule" dimColor wrap="truncate-end">{goalRule(columns)}</Text>, ...rows.map(labelled('row')), ...tail]
  // The platform draws no "more" hint, so while the window is at the top its last row counts the rows below it.
  const hidden = offset > 0 ? 0 : hiddenRows(drawn.length, room)
  if (hidden > 0 && room !== undefined) drawn.splice(room - 1, 0, <Text key="more" dimColor wrap="truncate-end">{moreRowsLine(hidden, focused)}</Text>)
  return <Box flexDirection="column">{drawn}</Box>
}
