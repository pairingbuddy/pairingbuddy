import type { EngineInterface, PluginOptions } from 'claude-code'
import { pollInputs } from './inputs'
import { alertOn } from './alert'

export const POLL_MS = 1000
const INPUTS = { plugin: 'pairingbuddy', key: 'inputs' } as const
// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The same key is written in four copies, PANE_NOTE in ./poll, ./report and ./suggest and noteAtom in register.tsx; keep all four in step.
const PANE_NOTE = { plugin: 'pairingbuddy', key: 'pane-note' } as const

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The last-run snapshot key is written in two copies, LAST_RUN in ./poll and lastRunAtom in register.tsx, and read from a third, LAST_RUN in ./report; keep all three in step.
const LAST_RUN = { plugin: 'pairingbuddy', key: 'last-run' } as const

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The run-end key is written in two copies, ENDED_AT in ./poll and endedAtAtom in register.tsx, and read from a third, ENDED_AT in ./report; keep all three in step.
const ENDED_AT = { plugin: 'pairingbuddy', key: 'ended-at' } as const

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
      // Before the snapshot bookkeeping below, so a failure there never keeps the alert from seeing the ledger go.
      await alertOn($, polled.ledger, options)
      // The last ledger read is kept as the snapshot; a new one overwrites it, and a gone ledger leaves it.
      if (polled.ledger) {
        await $.state.set(LAST_RUN, polled)
        await $.state.set(ENDED_AT, null)
      } else {
        await $.state.set(PANE_NOTE, null)
        // The first poll that sees the ledger gone while a snapshot exists is when the run ended.
        const snapshot = (await $.state.get(LAST_RUN)).value
        const ended = (await $.state.get(ENDED_AT)).value
        if (snapshot && !ended) await $.state.set(ENDED_AT, new Date(await $.clock.now()).toISOString())
      }
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
