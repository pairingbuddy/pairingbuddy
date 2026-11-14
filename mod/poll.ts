import type { EngineInterface, PluginOptions } from 'claude-code'
import { pollInputs, type Polled } from './inputs'
import { alertOn } from './alert'
import { runStart } from '../shared-node/glance.mjs'

export const POLL_MS = 1000
const INPUTS = { plugin: 'pairingbuddy', key: 'inputs' } as const
// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The same key is written in four copies, PANE_NOTE in ./poll, ./report and ./suggest and noteAtom in register.tsx; keep all four in step.
const PANE_NOTE = { plugin: 'pairingbuddy', key: 'pane-note' } as const

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The last-run snapshot key is written in two copies, LAST_RUN in ./poll and lastRunAtom in register.tsx, and read from a third, LAST_RUN in ./report; keep all three in step.
const LAST_RUN = { plugin: 'pairingbuddy', key: 'last-run' } as const

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The run-end key is written in two copies, ENDED_AT in ./poll and endedAtAtom in register.tsx, and read from a third, ENDED_AT in ./report; keep all three in step.
const ENDED_AT = { plugin: 'pairingbuddy', key: 'ended-at' } as const

const parsed = (time: unknown) => (typeof time === 'string' ? Date.parse(time) : NaN)

// When the open unit's first run began this session, by the unit it belongs to (the open unit.json's branch and base, else the
// run itself). A session forgets it, as it forgets its agents, so SPENT's time and agents count the same span.
export type UnitStart = { key: string | null; startedAt: string } | null

// The unit's start: the earliest run start seen for the same unit, so the publish run's time counts on from the code run's.
// A new unit starts over. No ledger leaves it as it was.
function unitStart(state: PollerState, polled: Polled): string | null {
  const ledger = polled.ledger as Parameters<typeof runStart>[0] | null
  if (!ledger) return null
  const start = runStart(ledger) as string | null | undefined
  const key = polled.unit?.key ?? (ledger as { runId?: string }).runId ?? null
  const kept = state.unit
  const keepsKept = kept != null && kept.key === key && !(parsed(start) < parsed(kept.startedAt))
  const startedAt = keepsKept ? kept.startedAt : Number.isNaN(parsed(start)) ? null : (start as string)
  if (startedAt) state.unit = { key, startedAt }
  return startedAt
}

export type PollerState = { started: boolean; polling: boolean; unit: UnitStart }
export const newPollerState = (): PollerState => ({ started: false, polling: false, unit: null })

// One poller per register: the poll exists so the band redraws and the alert fires every second, since a render may not wait on files.
// A start while one runs only reads once, a tick is skipped while a poll is in flight, and a failed poll is dropped.
export async function startPoller($: EngineInterface, state: PollerState, options: PluginOptions = {}) {
  const poll = async () => {
    if (state.polling) {
      return
    }
    state.polling = true
    try {
      const read = await pollInputs($)
      const polled = { ...read, since: unitStart(state, read) }
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
