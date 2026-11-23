import type { EngineInterface, PluginOptions } from 'claude-code'
import { pollInputs, readKeptRuns, type KeptRun, type Polled, type TaskFacts } from './inputs'
import { endedTaskFacts, taskRuns, taskSpend } from '../shared-node/task-runs.mjs'
import { alertOn, openOnRunStart } from './alert'
import { runStart } from '../shared-node/glance.mjs'
import { codeRunOf, isUnitDone } from '../shared-node/end-state.mjs'
import type { CodeRun, Spawn } from './inputs'

export const POLL_MS = 1000
const INPUTS = { plugin: 'pairingbuddy', key: 'inputs' } as const
// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The same key is written in three copies, PANE_NOTE in ./poll and ./report and noteAtom in register.tsx; keep all three in step.
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

// The unit's last code run and its pull request, kept while the unit is the same, so the end state outlives the code run's ledger
// (the publish run replaces it) and unit.json (pb publish closes it). A code ledger read replaces the code run; a different open
// unit drops both. With no unit open, as after pb publish, they are kept.
export type UnitRecord = { key: string | null; codeRun: CodeRun | null; prUrl: string | null } | null

// A session forgets the code run it saw, and one that starts after the code run ended never saw it: the unit's runs pb kept
// then stand in, the last code run of the unit for its code run and the last PR a run of it opened.
async function unitRecord($: EngineInterface, state: PollerState, polled: Polled): Promise<{ codeRun: CodeRun | null; prUrl: string | null }> {
  const key = polled.unit?.key ?? null
  const kept = state.record !== null && (key === null || state.record.key === null || state.record.key === key) ? state.record : null
  const read = codeRunOf(polled.ledger) as CodeRun | null
  const unitKey = key ?? kept?.key ?? null
  let codeRun = read ?? kept?.codeRun ?? null
  let prUrl = polled.unit?.prUrl ?? kept?.prUrl ?? null
  if (unitKey !== null && (codeRun === null || prUrl === null)) {
    const runs = (await readKeptRuns($, state.kept)).filter(run => run.unit === unitKey).sort((a, b) => (Date.parse(a.endedAt ?? '') || 0) - (Date.parse(b.endedAt ?? '') || 0))
    codeRun ??= (runs.map(run => codeRunOf(run.ledger) as CodeRun | null).findLast(run => run !== null) ?? null)
    prUrl ??= runs.findLast(run => run.prUrl)?.prUrl ?? null
  }
  state.record = { key: unitKey, codeRun, prUrl }
  return { codeRun, prUrl }
}

// The code run whose end left nothing to do, by its id, or null: no run is live, its task was signed off, and no unit is open
// that would still publish (pb publish closes it). The done alert fires on it once.
function doneRunOf(polled: Polled & { codeRun: CodeRun | null; prUrl: string | null }): string | null {
  const { ledger, codeRun, unit, prUrl } = polled
  const done = isUnitDone({ live: Boolean(ledger), codeRun, unitOpen: unit !== null, pr: prUrl ? { url: prUrl } : undefined })
  return done ? (codeRun?.runId ?? codeRun?.task ?? 'done') : null
}

// spawns: the session's own, which register.tsx keeps; the poll reads them so a stage they still run is not stranded.
export type PollerState = { started: boolean; polling: boolean; unit: UnitStart; record: UnitRecord; kept: Map<string, KeptRun>; spawns: Spawn[] }
export const newPollerState = (spawns: Spawn[] = []): PollerState => ({ started: false, polling: false, unit: null, record: null, kept: new Map(), spawns })

type Snapshot = { ledger?: unknown; unit?: { key?: string } | null } | null

// With no run live, what the runs pb kept say of the task the last snapshot was in, once every run of it has ended; else null.
async function endedTask($: EngineInterface, state: PollerState, polled: Polled): Promise<TaskFacts | null> {
  if (polled.ledger) return null
  const snapshot = (await $.state.get(LAST_RUN)).value as Snapshot
  const runs = taskRuns({ ledger: snapshot?.ledger ?? undefined, kept: await readKeptRuns($, state.kept), unitKey: snapshot?.unit?.key ?? null })
  return endedTaskFacts(runs) as TaskFacts | null
}

// What the live run's task spent in agents before it: the runs of its unit pb kept, which a reload does not empty. 0 with no run live.
async function earlierAgents($: EngineInterface, state: PollerState, polled: Polled): Promise<number> {
  const ledger = polled.ledger as { runId?: string } | null
  if (!ledger) return 0
  const runs = taskRuns({ ledger, kept: await readKeptRuns($, state.kept), unitKey: polled.unit?.key ?? null })
  return taskSpend(runs.filter(run => run.ledger !== ledger && run.ledger?.runId !== ledger.runId)).agents
}

// One poller per register: the poll exists so the band redraws and the alert fires every second, since a render may not wait on files.
// A start while one runs only reads once, a tick is skipped while a poll is in flight, and a failed poll is dropped.
export async function startPoller($: EngineInterface, state: PollerState, options: PluginOptions = {}) {
  const poll = async () => {
    if (state.polling) {
      return
    }
    state.polling = true
    try {
      const read = await pollInputs($, state.spawns, state.kept)
      const polled = { ...read, since: unitStart(state, read), ...(await unitRecord($, state, read)), task: await endedTask($, state, read), earlierAgents: await earlierAgents($, state, read) }
      await $.state.set(INPUTS, polled)
      // Before the snapshot bookkeeping below, so a failure there never keeps the alert from seeing the ledger go.
      await alertOn($, polled.ledger, options, doneRunOf(polled))
      await openOnRunStart($, polled.ledger)
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
