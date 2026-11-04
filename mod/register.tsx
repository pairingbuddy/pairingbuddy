import { atom, read, type EngineInterface, type PluginOptions, type Register, type RenderElement, type RenderInput } from 'claude-code'
import { fromPolled, spawnOf, type Spawn } from './inputs'
import { newPollerState, startPoller, type PollerState } from './poll'
import { nextAgent } from '../shared-node/stage-graph.mjs'
import contract from '../shared-node/stages-contract.mjs'
import { Band } from './band'
import { Pane, type Suggestion } from './pane'
import { openReport } from './report'
import { recordDelivery, submitSuggestion, type PendingSuggestion } from './suggest'
import { PANE_ID, openPane } from './pane-open'
import { buildView, type PaneTags, type View } from './view'

// The same key the poller writes (INPUTS in ./poll); the kit's scan reads the atom's literals from this file.
const inputsAtom = atom({ plugin: 'pairingbuddy', key: 'inputs' }, null)

// The same key the alert writes (OPENED in ./alert); the kit's scan reads the atom's literals from this file.
const openedAtom = atom({ plugin: 'pairingbuddy', key: 'opened' }, null)

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
  draw: (tags: PaneTags, view: View, opened: boolean, note: string | null, pending: PendingSuggestion | null) => RenderElement,
) {
  if ((e.props as { hasSurvey?: boolean }).hasSurvey) {
    return next(e)
  }

  const tags = $.ui.resolve(e)

  // Until the first poll lands there is nothing to draw from, so the view is the idle one.
  return Promise.all([read($, inputsAtom), read($, openedAtom), read($, noteAtom), read($, pendingAtom)]).then(([polled, opened, note, pending]) => {
    const view = buildView(fromPolled(polled, spawns))
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
  const poller = newPollerState()

  // A new session starts with no agents; a count carried over would overstate the run's.
  on('session.start', ($, e, next) => {
    spawns.length = 0
    if (!e.isInteractive) {
      return next(e)
    }

    return startWatching($, poller, options).then(() => next(e))
  })

  // A /clear ends the session but the process carries on, so its agents are forgotten; the poll keeps running.
  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') {
      spawns.length = 0
    }
    return next(e)
  })

  on('command.run', ($, e, next) => {
    return e.command === 'pb' ? openPane($).then(() => next({ ...e, args: e.args ?? '' })) : next(e)
  })

  on('agent.spawn', ($, e, next) => {
    spawns.push(spawnOf(e))
    // Fire and forget: a mod-state write that stalls or fails must never hold or change the spawn result.
    read($, pendingAtom).then((pending) => recordDelivery($, pending as PendingSuggestion | null, e.name)).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => drawGlance($, e, next, spawns, ({ Box, Text, Button }, { band, running }, opened) => (
    <Band Box={Box} Text={Text} Button={Button} band={band} running={running} opened={opened} columns={e.props.bodyColumns} onDetails={() => { openPane($).catch(() => {}) }} />
  )))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => drawGlance($, e, next, spawns, ({ Box, Text, Button, Input }, { rows, ledger, unknownLabels }, _opened, note, pending) => (
    <Pane
      Box={Box}
      Text={Text}
      Button={Button}
      Input={Input}
      rows={rows}
      ledger={ledger}
      unknownLabels={unknownLabels}
      note={note}
      suggestion={suggestionView(pending, () => nextAgent(contract, ledger, spawns))}
      onReport={() => openReport($, spawns)}
      onSuggest={(text) => submitSuggestion($, spawns, text)}
      onDismiss={() => closePane($)}
    />
  )))
}
