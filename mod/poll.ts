import type { EngineInterface, PluginOptions } from 'claude-code'
import { pollInputs } from './inputs'
import { alertOn } from './alert'

export const POLL_MS = 1000
const INPUTS = { plugin: 'pairingbuddy', key: 'inputs' } as const

export type PollerState = { started: boolean; polling: boolean }
export const newPollerState = (): PollerState => ({ started: false, polling: false })

// One poller per register: the poll exists so the band redraws and the alert fires every second, since a render may not wait on files.
// A start while one runs only reads once, a tick is skipped while a poll is in flight, and a failed poll is dropped.
export async function startPoller($: EngineInterface, state: PollerState, options: PluginOptions = {}) {
  const poll = async () => {
    if (state.polling) {
      return
    }
    state.polling = true
    try {
      const polled = await pollInputs($)
      await $.state.set(INPUTS, polled)
      await alertOn($, polled.ledger, options)
    } catch {
      // A failed tick is dropped; the next one tries again.
    } finally {
      state.polling = false
    }
  }

  // Every session.start reads once, so a session that begins reads at once; only the first starts the timer.
  await poll()
  if (state.started) {
    return
  }
  state.started = true
  try {
    $.clock.every(POLL_MS, () => { void poll() })
  } catch {
    // No clock to poll on: the band stays idle.
  }
}
