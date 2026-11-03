import { BAND, LEDGER, ROOT } from './band'

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

// Steps through the recording in time order. A ledger snapshot is served as <ROOT>/<LEDGER>; every other
// file in `files` is served at <ROOT>/<path>; any other read is ENOENT. After each step the surface is
// mounted, searched and unmounted. Handlers are registered on the first call, before `$` is touched.
// Spawn steps only redraw: feeding agent.spawn events to hooks arrives with Task 57, test-first.
export async function* replay(
  $: any,
  on: Function,
  recording: Recording,
  { mount = { ...BAND, surface: 'terminal' }, files = {}, find = { type: 'Text' } }: ReplayOptions = {},
): AsyncGenerator<Step> {
  const served = new Map<string, string>(Object.entries(files).map(([path, text]) => [`${ROOT}/${path}`, text]))
  const ledgerPath = `${ROOT}/${LEDGER}`

  on('session.root', () => ({ value: ROOT }))
  on('fs.read', (_: unknown, e: { path: string }) =>
    served.has(e.path) ? { value: served.get(e.path) } : { deny: `ENOENT ${e.path}` })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: served.has(e.path) }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_: unknown, e: { path: string }) =>
    served.has(e.path)
      ? { value: { kind: 'file', size: served.get(e.path)!.length, mtimeMs: 0, isLink: false } }
      : { deny: `ENOENT ${e.path}` })

  const events = [
    ...recording.ledger.map(recorded => ({ kind: 'ledger' as const, recorded })),
    ...recording.spawns.map(recorded => ({ kind: 'spawn' as const, recorded })),
  ].sort((a, b) => a.recorded.t - b.recorded.t)

  for (const { kind, recorded } of events) {
    if (kind === 'ledger') {
      served.set(ledgerPath, JSON.stringify(recorded.ledger))
    }

    const ui = await $.ui.mount(mount)
    const nodes = await ui.find(find)
    await ui.unmount()

    yield { t: recorded.t, kind, recorded, nodes }
  }
}
