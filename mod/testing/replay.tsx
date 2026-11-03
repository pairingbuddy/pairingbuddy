import { mock } from 'claude-code/testing'
import { BAND, LEDGER, ROOT } from './band'
import { POLL_MS } from '../poll'

// Replays a recorded run against the mod. A recording is a directory under mod/fixtures/replay/ whose
// index.ts exports `{ ledger, spawns, timing }`: `{t, ledger}` snapshots of the live ledger, `{t, kind,
// name, ...}` agent and workflow events, and the recorder's timing. The test imports it and passes it in,
// so the rig keeps no registry. Like band.tsx, this is test code: outside the `*.test.tsx` pattern and
// outside register.tsx's imports.

type Recorded = { t: number; [key: string]: unknown }

export type Recording = { ledger: Recorded[]; spawns: Recorded[]; timing: unknown }

export type Step = {
  t: number
  kind: 'ledger' | 'spawn'
  // The snapshot served at this step (ledger steps) or the recorded spawn (spawn steps).
  recorded: Recorded
  // The mocked clock at this step, and the time the poll reads: epoch + `t`, or one poll interval after the previous
  // step if that is later, rounded up to a whole interval from the epoch so the poll is due exactly then.
  // In bursts, elapsed times can run up to a few seconds ahead of the recording, and every snapshot is drawn
  // even where the live poller would coalesce two.
  now: number
  // The ledger in force after this step (undefined before the first snapshot) and every spawn fed so far.
  ledger: Record<string, unknown> | undefined
  fed: Recorded[]
  // Every Text the mounted surface drew, in order (`find` matches the first node only).
  texts: { text: string; props: Record<string, unknown> }[]
  // The nodes the mounted surface drew after the step, found by `find`.
  nodes: unknown
}

export type ReplayOptions = {
  // What to mount: BAND or a pane, with its surface and props.
  mount?: Record<string, unknown>
  // Other run files, keyed by path relative to ROOT (for example '.pairingbuddy/run/task/scenarios.json').
  files?: Record<string, string>
  // What to look for in the mounted surface.
  find?: Record<string, unknown>
}

// What the registered handlers answer from; each replay() call points it at its own recording and files.
export type Rig = {
  served: Map<string, string>
  // The mocked clock: it fires the mod's poll timer as it advances, and never runs backwards.
  clock: { advance: (ms: number) => Promise<void>; set: (ms: number) => Promise<void> }
  // Where the clock stands, in ms. Each recording is replayed from here on, shifted forward, so a later one
  // starting at an earlier wall time still moves the clock forwards.
  now: number
  spawned: number
  // How many times each path has been read, so a step can wait for its poll to arrive.
  reads: Map<string, number>
}

// Registers the handlers once per test, before `$` is first touched (the engine allows one handler per
// event, so a second registration throws). Every replay() in the test reuses the returned rig.
export function setupReplay(on: Function): Rig {
  const rig: Rig = { served: new Map(), clock: mock.clock(on, { now: 0 }) as Rig['clock'], now: 0, spawned: 0, reads: new Map() }
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('agent.spawn', () => ({ model: 'recorded', agentId: `recorded-${++rig.spawned}` }))
  on('session.root', () => ({ value: ROOT }))
  on('session.start', () => ({ cwd: ROOT }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    rig.reads.set(e.path, (rig.reads.get(e.path) ?? 0) + 1)
    return rig.served.has(e.path) ? { value: rig.served.get(e.path) } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: rig.served.has(e.path) }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_: unknown, e: { path: string }) =>
    rig.served.has(e.path)
      ? { value: { kind: 'file', size: rig.served.get(e.path)!.length, mtimeMs: 0, isLink: false } }
      : { deny: `ENOENT ${e.path}` })
  return rig
}

// Steps through the recording in time order. A ledger snapshot is served as <ROOT>/<LEDGER>; every other
// file in `files` is served at <ROOT>/<path>; any other read is ENOENT. After each step the surface is
// mounted, searched and unmounted. The handlers come from setupReplay, called once before `$` is touched.
// A spawn step raises `agent.spawn` through the engine's `$`, so the mod under test (the instance the kit
// mounted) sees it. An `Agent` record is a subagent of that type; a `workflow_agent` carries its label as
// the spawn's `name`. A `Workflow` record is no agent, so it is not raised. Every step then redraws.
// The mocked clock reads the recording's wall time: the first active stage's `startedAt` is at its `t`.
export async function* replay(
  $: any,
  rig: Rig,
  recording: Recording,
  { mount = { ...BAND, surface: 'terminal' }, files = {}, find = { type: 'Text' } }: ReplayOptions = {},
): AsyncGenerator<Step> {
  rig.served.clear()
  // The recording's own epoch, and the shift that moves it to where the clock stands now.
  const shift = Math.max(0, rig.now + POLL_MS - firstActiveEpoch(recording))
  const epoch = firstActiveEpoch(recording) + shift
  // Jumping to the recording's start is a set, not an advance: an advance that long would fire the poll millions of times.
  await rig.clock.set(epoch)
  rig.now = epoch
  // Each recording is a new session, so the mod starts it with no agents.
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  for (const [path, text] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, text)
  const served = rig.served
  const ledgerPath = `${ROOT}/${LEDGER}`


  const events = [
    ...recording.ledger.map(recorded => ({ kind: 'ledger' as const, recorded })),
    ...recording.spawns.map(recorded => ({ kind: 'spawn' as const, recorded })),
  ].sort((a, b) => a.recorded.t - b.recorded.t)

  let ledger: Record<string, unknown> | undefined
  const fed: Recorded[] = []

  for (const { kind, recorded } of events) {
    if (kind === 'ledger') {
      ledger = shifted(recorded.ledger, shift) as Record<string, unknown>
      served.set(ledgerPath, JSON.stringify(ledger))
    } else {
      fed.push(recorded)
      await feed($, recorded)
    }

    // Past the poll interval at every step, so the drawn state comes from the atoms the poller wrote.
    // The poll timer was started at the epoch, so it is due at whole intervals from there; landing the step on one
    // makes the poll read the clock at exactly `now`, as the oracle does, and not up to an interval earlier.
    const due = Math.max(epoch + recorded.t * 1000, rig.now + POLL_MS)
    const now = epoch + Math.ceil((due - epoch) / POLL_MS) * POLL_MS
    const polled = pollMarks(rig)
    await rig.clock.advance(now - rig.now)
    rig.now = now
    await settle(rig, polled)

    const ui = await $.ui.mount(mount)
    const nodes = await ui.find(find)
    const texts = (await ui.findAll({ type: 'Text' })).map((node: any) => ({ text: node.text, props: node.props }))
    await ui.unmount()

    yield { t: recorded.t, kind, recorded, now, ledger, fed: [...fed], texts, nodes }
  }
}

// The same document with every ISO timestamp moved by `ms`, so elapsed times stay the recorded ones.
function shifted(value: unknown, ms: number): unknown {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value)) return new Date(Date.parse(value) + ms).toISOString()
  if (Array.isArray(value)) return value.map(item => shifted(item, ms))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shifted(item, ms)]))
  return value
}

// What a poll reads, by path: the ledger and tests.json. The poll has reached the end of its reads once both are read again.
const pollPaths = (): string[] => [`${ROOT}/${LEDGER}`, `${ROOT}/.pairingbuddy/tests.json`]
const pollMarks = (rig: Rig): number[] => pollPaths().map(path => rig.reads.get(path) ?? 0)
const TURN_LIMIT = 1000

// Waits for the poll the clock fired (a promise chain the mod does not return): until both of its reads have
// arrived after `before`, then a few turns for its state write to land. Throws if it never starts.
async function settle(rig: Rig, before: number[]): Promise<void> {
  const turn = () => new Promise(resolve => setTimeout(resolve, 0))
  for (let i = 0; pollMarks(rig).some((count, n) => count <= before[n]); i++) {
    if (i >= TURN_LIMIT) {
      throw new Error(`the mod's poll never read ${pollPaths().join(' and ')} after the clock advanced; is POLL_MS (${POLL_MS} ms) still the mod's interval?`)
    }
    await turn()
  }
  for (let i = 0; i < 5; i++) await turn()
}

// The ms at t=0 of the recording, from the first snapshot with an active stage (its startedAt is at its t).
function firstActiveEpoch(recording: Recording): number {
  const active = recording.ledger.find(step => (step.ledger as any)?.stage?.startedAt)
  return active ? Date.parse((active.ledger as any).stage.startedAt) - active.t * 1000 : 0
}

async function feed($: any, recorded: Recorded): Promise<void> {
  if (recorded.kind === 'Agent') {
    await $.agent.spawn({ prompt: 'recorded', description: String(recorded.name), subagentType: String(recorded.name) })
  } else if (recorded.kind === 'workflow_agent') {
    await $.agent.spawn({
      prompt: 'recorded',
      description: String(recorded.phase),
      name: String(recorded.name),
      subagentType: String(recorded.agentType),
    })
  }
}

// The pane as the engine mounts it, minus the surface; the id is the one the mod opens it under.
export const PANE = {
  plugin: 'pairingbuddy',
  component: 'Pane',
  requestId: 'pairingbuddy',
  props: {
    title: 'Pairing Buddy',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const
