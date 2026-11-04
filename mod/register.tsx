import { atom, read, type EngineInterface, type PluginOptions, type Register, type RenderElement, type RenderInput } from 'claude-code'
import { fromPolled, spawnOf, type Spawn } from './inputs'
import { newPollerState, startPoller, type PollerState } from './poll'
import { Band } from './band'
import { Pane } from './pane'
import { PANE_ID, openPane } from './pane-open'
import { buildView, type Tags, type View } from './view'

// The same key the poller writes (INPUTS in ./poll); the kit's scan reads the atom's literals from this file.
const inputsAtom = atom({ plugin: 'pairingbuddy', key: 'inputs' }, null)

// The same key the alert writes (OPENED in ./alert); the kit's scan reads the atom's literals from this file.
const openedAtom = atom({ plugin: 'pairingbuddy', key: 'opened' }, null)

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
  draw: (tags: Tags, view: View, opened: boolean) => RenderElement,
) {
  if ((e.props as { hasSurvey?: boolean }).hasSurvey) {
    return next(e)
  }

  const tags = $.ui.resolve(e)

  // Until the first poll lands there is nothing to draw from, so the view is the idle one.
  return Promise.all([read($, inputsAtom), read($, openedAtom)]).then(([polled, opened]) => draw(tags, buildView(fromPolled(polled, spawns)), opened === true))
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
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => drawGlance($, e, next, spawns, ({ Box, Text, Button }, { band, running }, opened) => (
    <Band Box={Box} Text={Text} Button={Button} band={band} running={running} opened={opened} columns={e.props.bodyColumns} onDetails={() => { openPane($).catch(() => {}) }} />
  )))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => drawGlance($, e, next, spawns, ({ Box, Text, Button }, { rows, ledger, unknownLabels }) => (
    <Pane Box={Box} Text={Text} Button={Button} rows={rows} ledger={ledger} unknownLabels={unknownLabels} onDismiss={async () => { try { await $.ui.close({ id: PANE_ID }) } catch {} }} />
  )))
}
