// Shared by the mod's tests. It lives outside the `*.test.tsx` pattern, so `claude plugin test` does
// not run it, and outside register.tsx's imports, so it is not part of the mod itself.

// The band as the engine mounts it, minus the surface each test picks.
export const BAND = {
  plugin: 'pairingbuddy',
  component: 'AbovePrompt',
  requestId: 'pairingbuddy-band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

export const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

// The live ledger: one JSON document. `tests/smoke/recordings/<run>/ledger.jsonl` is the recorder's
// list of snapshots of it, not a live file.
export const LEDGER = '.pairingbuddy/run/task/ledger.json'

// Seq 1 of tests/smoke/recordings/covered-default/ledger.jsonl: a run that has started and has no
// current stage yet (stage.name is empty).
export const SNAPSHOT_NO_STAGE = {
  v: 1,
  seq: 1,
  sha: 'c55a9ca27983571eceeb690afc2bb25376578511b25ffca5017a6f9773a33380',
  kind: 'code',
  taskType: 'bug_fix',
  owner: { sessionId: null, lastSeen: null },
  task: 'Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. One regression test for exactly that case is the whole scope',
  plan: { path: '', title: '' },
  configHash: '7f0e44e3b566f99a7f833786814dd84e0df93b5f018ef8b1b74f0681cec6d54d',
  policy: { mode: '', source: '' },
  stage: { name: '', status: '', runId: null, attempt: 0, startedAt: null },
  stages: [],
  gates: {},
  tests: {},
  commits: [],
  retries: {},
  spend: { agents: 0, tokens: 0 },
  stop: null,
  needsHuman: null,
}

// Seq 2 of the same recording: the run has an owner and the code-scenarios stage is active.
export const SNAPSHOT_RUNNING = {
  ...SNAPSHOT_NO_STAGE,
  seq: 2,
  owner: { sessionId: 'db177364-f9ad-4bfb-91f4-075852602fbb', lastSeen: '2026-11-03T06:36:08.971Z' },
  policy: { mode: 'auto', source: 'permission_mode' },
  stage: { name: 'code-scenarios', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-03T06:36:08.972Z' },
}

export function without(document: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const copy = { ...document }
  for (const key of keys) delete copy[key]
  return copy
}

// What the engine's fs answers for one ledger, and which paths the mod asked about. The handlers must
// be registered before the test first touches `$`, so they read the ledger from a holder the test
// changes between mounts. An undefined ledger is absent: read and stat deny with ENOENT, as the
// engine does for a missing file.
export type Served = { ledger: string | undefined; asked: string[] }

export const ROOT = '/work/project'
export const LEDGER_PATH = `${ROOT}/${LEDGER}`

// Starts an interactive session, which is when the mod begins polling; until then its band draws idle.
export const start = ($: any) => $.session.start({ cwd: ROOT, surface: null, isInteractive: true })

export function serveLedger(on: Function, served: Served): void {
  // The session root is fixed and absolute; the ledger exists only at exactly <root>/<LEDGER>, so a read
  // relative to the working directory, or one anchored elsewhere, finds nothing. Paths are recorded as received.
  const has = (path: string) => path === LEDGER_PATH && served.ledger !== undefined
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    served.asked.push(e.path)
    return has(e.path) ? { value: served.ledger } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => {
    served.asked.push(e.path)
    return { value: has(e.path) }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_: unknown, e: { path: string }) => {
    served.asked.push(e.path)
    return has(e.path)
      ? { value: { kind: 'file', size: served.ledger!.length, mtimeMs: 0, isLink: false } }
      : { deny: `ENOENT ${e.path}` }
  })
}

// What the engine beneath the mod answers, and what the mod asked of it. Registered before `$` is first touched.
// The kit allows one handler per action in `on`, and a second registration of the same action throws, so a
// test cannot stack its own failing handler on the rig's. The rig registers `ui.open` once and takes the
// answer as `open`, a responder given the request; it defaults to a placed pane.
export const PLACED = () => ({ value: { isPlaced: true } })

export function engine(on: Function, ledger: unknown = SNAPSHOT_RUNNING, open: (request: any) => unknown = PLACED) {
  const served: Served = { ledger: JSON.stringify(ledger), asked: [] }
  // Serves the document the ledger shows from now on; null is an absent ledger.
  const serve = (document: unknown) => {
    served.ledger = document === null ? undefined : JSON.stringify(document)
  }
  // Serves the text as it is, for a ledger that is not valid JSON.
  const serveRaw = (text: string) => {
    served.ledger = text
  }
  const calls = { opened: [] as any[], closed: [] as any[], registered: [] as any[] }
  serveLedger(on, served)
  on('session.start', () => ({ cwd: ROOT }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('command.run', () => ({ text: 'unanswered by the test' }))
  on('command.register', (_: unknown, e: any) => {
    calls.registered.push(e)
    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: any) => {
    calls.opened.push(e)
    return open(e)
  })
  on('ui.close', (_: unknown, e: any) => {
    calls.closed.push(e)
    return { value: undefined }
  })
  return { served, serve, serveRaw, calls }
}

// The text of every Text node on a mounted surface, in order.
export const texts = async (surface: any) => (await surface.findAll({ type: 'Text' })).map((node: any) => node.text as string)

// The terminal band as drawn now: mounts it, collects its texts and unmounts it.
// Optional props merge into the band's props, for example { bodyColumns: 200 } for a wide terminal.
export async function bandTexts($: any, props: Record<string, unknown> = {}): Promise<string[]> {
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, ...props }, surface: 'terminal' })
  const shown = await texts(band)
  await band.unmount()
  return shown
}

// What the band reads once an alert has run and the pane is placed.
export const NEEDS_YOU_OPENED = 'needs you · opened details'

// Whether any line of the band's texts includes the wording.
export function bandSays(shown: string[], wording: string): boolean {
  return shown.some(text => text.includes(wording))
}
