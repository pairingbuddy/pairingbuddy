import { atom, read, type EngineInterface, type PluginOptions, type Register, type RenderElement, type RenderInput } from 'claude-code'
import { fromPolled, spawnOf, startedAtOf, type Call, type Spawn } from './inputs'
import { newPollerState, startPoller, type PollerState } from './poll'
import { nextAgent } from '../shared-node/stage-graph.mjs'
import contract from '../shared-node/stages-contract.mjs'
import { Band } from './band'
import { Pane, type Suggestion } from './pane'
import { openReport } from './report'
import { recordDelivery, submitSuggestion, type PendingSuggestion } from './suggest'
import { PANE_ID, openPane } from './pane-open'
import { buildEndedView, buildView, type PaneTags, type View } from './view'

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

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The same key is written in four copies, PANE_NOTE in ./poll, ./report and ./suggest and noteAtom in register.tsx; keep all four in step. The report press, the suggest submit and the poller all write it.
const noteAtom = atom({ plugin: 'pairingbuddy', key: 'pane-note' }, null)

// The same key the suggest submit writes (PENDING in ./suggest); the kit's scan reads the atom's literals from this file.
const pendingAtom = atom({ plugin: 'pairingbuddy', key: 'pending-suggestion' }, null)

async function startWatching($: EngineInterface, poller: PollerState, options: PluginOptions) {
  await $.command.register({ name: 'pb', description: 'Open the Pairing Buddy pane' })
  await startPoller($, poller, options)
}

// The prelude both surfaces share: leave a survey to the next hook, else draw the view read now.
function drawGlance(
  $: EngineInterface,
  e: RenderInput,
  next: (e: RenderInput) => Promise<RenderElement>,
  spawns: Spawn[],
  calls: Call[],
  draw: (tags: PaneTags, view: View, opened: boolean, note: string | null, pending: PendingSuggestion | null) => RenderElement,
) {
  if ((e.props as { hasSurvey?: boolean }).hasSurvey) {
    return next(e)
  }

  const tags = $.ui.resolve(e)

  // Until the first poll lands there is nothing to draw from, so the view is the idle one.
  return Promise.all([read($, inputsAtom), read($, openedAtom), read($, noteAtom), read($, pendingAtom), read($, lastRunAtom), read($, endedAtAtom)]).then(([polled, opened, note, pending, lastRun, endedAt]) => {
    const live = fromPolled(polled, spawns, calls)
    // With no live ledger the last polled one is shown as a finished run.
    const snapshot = fromPolled(lastRun as Parameters<typeof fromPolled>[0], spawns)
    // The ended view measures to the moment the run ended, the same end time the report uses.
    const endedMs = typeof endedAt === 'string' ? Date.parse(endedAt) : NaN
    const view = live.ledger || !snapshot.ledger ? buildView(live) : buildEndedView(Number.isNaN(endedMs) ? snapshot : { ...snapshot, now: endedMs })
    const reportNote = typeof note === 'string' ? note : null
    return draw(tags, view, opened === true, reportNote, pending as PendingSuggestion | null)
  })
}

function suggestionView(pending: PendingSuggestion | null, upcoming: () => string | undefined): Suggestion | undefined {
  if (pending == null) {
    return undefined
  }

  return pending.deliveredTo ? { state: 'delivered', to: pending.deliveredTo } : { state: 'pending', nextAgent: upcoming() }
}

async function closePane($: EngineInterface) {
  try { await $.ui.close({ id: PANE_ID }) } catch {}
}

export const register: Register = (on, options) => {
  const spawns: Spawn[] = []
  const calls: Call[] = []
  const poller = newPollerState()

  // A new session starts with no agents; a count carried over would overstate the run's.
  on('session.start', ($, e, next) => {
    spawns.length = 0
    calls.length = 0
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

  on('command.run', ($, e, next) => {
    return e.command === 'pb' ? openPane($, true).then(() => ({ text: 'Pairing Buddy pane opened' })) : next(e)
  })

  on('agent.spawn', ($, e, next) => {
    const spawn = spawnOf(e)
    spawns.push(spawn)
    // Fire and forget: a mod-state write that stalls or fails must never hold or change the spawn result.
    read($, pendingAtom).then((pending) => recordDelivery($, pending as PendingSuggestion | null, e.name)).catch(() => {})
    // The stamp follows without holding the spawn; a failed clock leaves the spawn unstamped.
    startedAtOf($).then((startedAt) => { if (startedAt) spawn.startedAt = startedAt }).catch(() => {})
    // next(e) runs first and synchronously; the agent's id is read off its result when that lands.
    const result = next(e)
    Promise.resolve(result).then((spawned) => { spawn.agentId = spawned?.agentId }).catch(() => {})
    return result
  })

  // An agent's turn ended: mark its latest spawn finished (a resume adds a new, unfinished spawn); never held or changed.
  on('turn.complete', ($, e, next) => {
    const latest = spawns.findLast(spawn => spawn.agentId !== undefined && spawn.agentId === e.agentId)
    if (latest) latest.finished = true
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => drawGlance($, e, next, spawns, calls, ({ Box, Text, Button }, { band, running, waiting, ended, between }, opened) => (
    <Band Box={Box} Text={Text} Button={Button} band={band} running={running} waiting={waiting} ended={ended} between={between} opened={opened} columns={e.props.bodyColumns} onDetails={() => { openPane($, true).catch(() => {}) }} />
  )))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => drawGlance($, e, next, spawns, calls, ({ Box, Text, Button, Input }, { rows, rowTones, ledger, ended, unknownLabels, nowBuilding, lensRound }, _opened, note, pending) => (
    <Pane
      Box={Box}
      Text={Text}
      Button={Button}
      Input={Input}
      lensRound={lensRound}
      rows={rows}
      rowTones={rowTones}
      columns={e.props.bodyColumns}
      ledger={ledger}
      ended={ended}
      unknownLabels={unknownLabels}
      nowBuilding={nowBuilding}
      note={note}
      suggestion={suggestionView(pending, () => nextAgent(contract, ledger, spawns))}
      onReport={() => openReport($, spawns)}
      onSuggest={(text) => submitSuggestion($, spawns, text)}
      onDismiss={() => closePane($)}
    />
  )))
}
