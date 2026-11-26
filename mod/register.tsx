import { atom, read, type EngineInterface, type PluginOptions, type Register, type RenderElement, type RenderInput } from 'claude-code'
import { fromPolled, spawnOf, startedAtOf, type Call, type Published, type Spawn } from './inputs'
import { recordPublished } from './published'
import { newPollerState, startPoller, type PollerState } from './poll'
import { Band } from './band'
import { Pane } from './pane'
import { openReport, reportLine } from './report'
import { openPlan, planLine } from './plan-page'
import { runQuestions } from './pb-questions'
import { PANE_ID, type PbToggle, togglePane } from './pane-open'
import { buildEndedView, buildView, type Tags, type View } from './view'

// The same key the poller writes (INPUTS in ./poll); the kit's scan reads the atom's literals from this file.
const inputsAtom = atom({ plugin: 'pairingbuddy', key: 'inputs' }, null)

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The last-run snapshot key is written in two copies, LAST_RUN in ./poll and lastRunAtom in register.tsx, and read from a third, LAST_RUN in ./report; keep all three in step.
// Repeated on purpose: see ENDED_AT in ./poll; keep the copies in step.
const endedAtAtom = atom({ plugin: 'pairingbuddy', key: 'ended-at' }, null)
const lastRunAtom = atom({ plugin: 'pairingbuddy', key: 'last-run' }, null)

// The same key the alert writes (OPENED in ./alert); the kit's scan reads the atom's literals from this file.
const openedAtom = atom({ plugin: 'pairingbuddy', key: 'opened' }, null)

// The same key the alert writes (STATUS_SET in ./alert); the kit's scan reads the atom's literals from this file.
const statusSetAtom = atom({ plugin: 'pairingbuddy', key: 'status-set' }, null)

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The same key is written in three copies, PANE_NOTE in ./poll and ./report and noteAtom in register.tsx; keep all three in step. /pb-report and the poller write it.
const noteAtom = atom({ plugin: 'pairingbuddy', key: 'pane-note' }, null)

// What the last pb publish printed, written by the Bash hook below.
const publishedAtom = atom({ plugin: 'pairingbuddy', key: 'published' }, null)

async function startWatching($: EngineInterface, poller: PollerState, options: PluginOptions) {
  await $.command.register({ name: 'pb', description: 'Open or close the Pairing Buddy pane', immediate: true })
  await $.command.register({ name: 'pb-report', description: 'Write the Pairing Buddy run report and open it', immediate: true })
  await $.command.register({ name: 'pb-plan', description: 'Write the whole Pairing Buddy plan as a page and open it', immediate: true })
  await $.command.register({ name: 'pb-questions', description: 'See or answer the questions Pairing Buddy set aside for you', immediate: true })
  await startPoller($, poller, options)
}

// The prelude both surfaces share: leave a survey to the next hook, else draw the view read now.
function drawGlance(
  $: EngineInterface,
  e: RenderInput,
  next: (e: RenderInput) => Promise<RenderElement>,
  spawns: Spawn[],
  calls: Call[],
  draw: (tags: Tags, view: View, opened: boolean, note: string | null) => RenderElement,
) {
  if ((e.props as { hasSurvey?: boolean }).hasSurvey) {
    return next(e)
  }

  const tags = $.ui.resolve(e)

  return viewNow($, spawns, calls).then(({ view, opened, note }) => draw(tags, view, opened, note))
}

// The view the band and the pane draw now, from what the poller last read, and what the pane's note and opened state say.
// planPath: where the plan the view holds is.
function viewNow($: EngineInterface, spawns: Spawn[], calls: Call[]): Promise<{ view: View; opened: boolean; note: string | null; planPath: string | null }> {
  // Until the first poll lands there is nothing to draw from, so the view is the idle one.
  return Promise.all([read($, inputsAtom), read($, openedAtom), read($, noteAtom), read($, lastRunAtom), read($, endedAtAtom), read($, publishedAtom)]).then(([polled, opened, note, lastRun, endedAt, published]) => {
    const live = fromPolled(polled, spawns, calls, published as Published | null)
    // With no live ledger the last polled one is shown as a finished run.
    const snapshot = fromPolled(lastRun as Parameters<typeof fromPolled>[0], spawns, calls, published as Published | null)
    // The ended view measures to the moment the run ended, the same end time the report uses.
    const endedMs = typeof endedAt === 'string' ? Date.parse(endedAt) : NaN
    // Whether a unit is still open is read now: pb publish closes it after the snapshot was taken.
    // Once the task has ended, what the runs pb kept say of it is read now too: the snapshot's poll may not have seen them.
    // The plan tree is read now too: a person ticks a box, and pb publish writes its PR: line, after the run has ended.
    const ended = { ...snapshot, unitOpen: live.unit !== null, task: live.task, plan: live.plan, planPath: live.planPath, planUnit: live.unit, ...(Number.isNaN(endedMs) ? {} : { now: endedMs }) }
    const view = live.ledger || !snapshot.ledger ? buildView(live) : buildEndedView(ended)
    return { view, opened: opened === true, note: typeof note === 'string' ? note : null, planPath: live.planPath ?? null }
  })
}

export const register: Register = (on, options) => {
  const spawns: Spawn[] = []
  const calls: Call[] = []
  const poller = newPollerState(spawns)

  // A new session starts with no agents; a count carried over would overstate the run's.
  on('session.start', ($, e, next) => {
    spawns.length = 0
    calls.length = 0
    poller.unit = null
    poller.record = null
    if (!e.isInteractive) {
      return next(e)
    }

    return startWatching($, poller, options).then(() => next(e))
  })

  // A /clear ends the session but the process carries on, so its agents are forgotten; the poll keeps running.
  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') {
      spawns.length = 0
      calls.length = 0
    }
    return next(e)
  })

  // A StructuredOutput call is recorded with its own arguments; never held, denied or changed.
  on('tool.call', { tool: 'StructuredOutput' }, ($, e, next) => {
    const { tool, tool_use_id, agentId, requestMeta, consent, ...input } = e as Record<string, unknown>
    const call: Call = { agentId, input }
    calls.push(call)
    // The stamp follows without holding the call; a failed clock leaves the call unstamped.
    startedAtOf($).then((at) => { if (at) call.at = at }).catch(() => {})
    return next(e)
  })

  // A pb publish call is read for what it opened once it has run; never held, denied or changed.
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const result = next(e)
    Promise.resolve(result).then((ran) => recordPublished($, e.command, ran)).catch(() => {})
    return result
  })

  // What the last /pb did, so the next one does the other.
  const pbToggle: PbToggle = { last: null }
  on('command.run', ($, e, next) => {
    if (e.command === 'pb') return togglePane($, pbToggle).then(done => ({ text: `Pairing Buddy pane ${done}` }))
    if (e.command === 'pb-report') return openReport($, spawns, calls).then(outcome => ({ text: reportLine(outcome) }))
    if (e.command === 'pb-plan') return Promise.all([viewNow($, spawns, calls), $.clock.now()]).then(([{ view, planPath }, now]) => openPlan($, view, planPath, now)).then(outcome => ({ text: planLine(outcome) }))
    if (e.command === 'pb-questions') return runQuestions($).then(text => ({ text }))
    return next(e)
  })

  on('agent.spawn', ($, e, next) => {
    const spawn = spawnOf(e)
    spawns.push(spawn)
    // The stamp follows without holding the spawn; a failed clock leaves the spawn unstamped.
    startedAtOf($).then((startedAt) => { if (startedAt) spawn.startedAt = startedAt }).catch(() => {})
    // next(e) runs first and synchronously; the agent's id is read off its result when that lands.
    const result = next(e)
    Promise.resolve(result).then((spawned) => { spawn.agentId = spawned?.agentId }).catch(() => {})
    return result
  })

  // An agent's turn ended: mark its latest spawn finished (a resume adds a new, unfinished spawn) with how long the turn
  // took, which the report times each try by; never held or changed.
  on('turn.complete', ($, e, next) => {
    const latest = spawns.findLast(spawn => spawn.agentId !== undefined && spawn.agentId === e.agentId)
    if (latest) {
      latest.finished = true
      if (Number.isFinite(e.durationMs) && e.durationMs >= 0) latest.seconds = e.durationMs / 1000
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => drawGlance($, e, next, spawns, calls, ({ Box, Text }, { band, goal, running, waiting, ended, done, between, planNext }) => (
    <Band Box={Box} Text={Text} band={band} goal={goal} running={running} waiting={waiting} ended={ended} done={done} between={between} next={planNext} columns={e.props.bodyColumns} />
  )))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => drawGlance($, e, next, spawns, calls, ({ Box, Text }, view, _opened, note) => (
    <Pane
      Box={Box}
      Text={Text}
      view={view}
      columns={e.props.bodyColumns}
      room={e.props.scroll?.bodyRows}
      offset={e.props.scroll?.offset}
      focused={e.props.isFocused}
      unknownLabels={view.unknownLabels}
      note={note}
    />
  )))
}
