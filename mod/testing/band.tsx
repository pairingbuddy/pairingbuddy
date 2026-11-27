import { PHASES } from '../../shared-node/labels.mjs'
import { ACCENT_COLOUR, PHASE_COLOURS, STATUS_LOOKS } from '../pane'

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

// The ledger with its owner seen at `at`, so a run read long after its stage started still reads as live, not stranded
// (shared-node/stranded.mjs).
export const seenAt = <T extends { owner: unknown }>(ledger: T, at: string): T => ({ ...ledger, owner: { sessionId: SNAPSHOT_RUNNING.owner.sessionId, lastSeen: at } })

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
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('command.register', (_: unknown, e: any) => {
    calls.registered.push(e)
    return { value: { command: e.name } }
  })
  // The panes the engine shows: a placed open adds one, a close removes it, as $.ui.panes() lists them.
  const shown = new Set<string>()
  on('ui.open', (_: unknown, e: any) => {
    calls.opened.push(e)
    const answer = open(e) as { value?: { isPlaced?: boolean } } | undefined
    if (answer?.value?.isPlaced) shown.add(e.id)
    return answer
  })
  on('ui.close', (_: unknown, e: any) => {
    calls.closed.push(e)
    shown.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...shown].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  return { served, serve, serveRaw, calls, shown }
}

// The dim rule the band draws above its content line. It is chrome, not band content, so the helpers below leave it out.
export const isSeparatorRule = (node: { text?: string; props?: Record<string, unknown> }): boolean =>
  node.props?.dimColor === true && /^[─━═\-_—]{3,}$/.test((node.text ?? '').trim())

// A status head the band leads its row with ('● ', '⏸ WAITING FOR YOU', '✗ STOPPED', '✓ DONE', or a narrow band's mark alone), as
// drawn: in its state's head props.
export const isStatusHead = (node: { text: string; props: Record<string, unknown> }): boolean =>
  Object.values(STATUS_LOOKS).some(look => [look.bandHead, look.mark].includes(node.text.trimEnd()) && node.props.color === (look.headProps as Record<string, unknown>).color && node.props.inverse === (look.headProps as Record<string, unknown>).inverse)
// What ends a segment on the band's row: a separator, or the commands hint.
const endsSegment = (text: string) => text === ' │ ' || text.startsWith(' │ details: /pb')

// The band draws its lit step in two Texts, the phase word in its colour then the rest in the accent ('RED', ' · test 1 of 2');
// read as text, they are the one segment they are. Nodes in drawing order; anything else is left as it is.
export function joinLit<T extends { text: string; props: Record<string, unknown> }>(nodes: T[]): T[] {
  return join(nodes, false)
}

// The band's row draws a segment in several Texts: a status head then the rest ('● ', 'write test scenarios'), and the lit
// phase word then the rest. Read as text, each segment is one. Only for the band's row: the pane draws a head per row too.
export function joinSegments<T extends { text: string; props: Record<string, unknown> }>(nodes: T[]): T[] {
  return join(nodes, true)
}

function join<T extends { text: string; props: Record<string, unknown> }>(nodes: T[], heads: boolean): T[] {
  const joined: T[] = []
  let open = false
  for (const node of nodes) {
    const last = joined.at(-1)
    const afterPhase = last && PHASES.includes(last.text) && last.props.color === PHASE_COLOURS[last.text] && node.props.color === ACCENT_COLOUR
    if (last && (afterPhase || (open && !endsSegment(node.text)))) joined[joined.length - 1] = { ...last, text: `${last.text}${node.text}` }
    else {
      joined.push(node)
      // A loud state's bar is a row of its own, whole in one Text: it joins nothing after it.
      open = heads && isStatusHead(node) && node.props.inverse !== true
    }
  }
  return joined
}

// The band's first row, the goal's gist: bold and uncoloured, as the pane's GOAL (the done text is bold too, but names Pairing
// Buddy). The helpers that read the band's step row leave it out; a test of the goal reads it on its own.
export const isGoalRow = (node: { type?: string; text?: string; props?: Record<string, unknown> }): boolean =>
  (node.type === undefined || node.type === 'Text') && node.props?.bold === true && node.props?.color === undefined && node.props?.dimColor !== true && !(node.text ?? '').startsWith('Pairing Buddy') && !isStatusHead({ text: node.text ?? '', props: node.props ?? {} })

// The padding that carries a loud state's bar to the band's edge: spaces alone, in reverse colours. Read as text it says nothing.
export const isBarPad = (node: { text?: string; props?: Record<string, unknown> }): boolean => node.props?.inverse === true && /^ +$/.test(node.text ?? '')

// The text of every Text node on a mounted surface, in order, without the band's separator rule and the bar's padding.
export const texts = async (surface: any) =>
  joinLit((await surface.findAll({ type: 'Text' })).filter((node: any) => !isSeparatorRule(node) && !isBarPad(node))).map((node: any) => node.text as string)

// The band's step row on a mounted surface: its texts, without the rule and the goal row above it; a loud state's bar
// (without its padding) leads, then the details under it.
export const bandRowTexts = async (surface: any) =>
  joinSegments((await surface.findAll({ type: 'Text' })).filter((node: any) => !isSeparatorRule(node) && !isGoalRow(node) && !isBarPad(node))).map((node: any) => node.text as string)

// The terminal band's step row as drawn now: mounts it, collects its texts and unmounts it. The goal row is left out.
// Optional props merge into the band's props, for example { bodyColumns: 200 } for a wide terminal.
export async function bandTexts($: any, props: Record<string, unknown> = {}): Promise<string[]> {
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, ...props }, surface: 'terminal' })
  const shown = await bandRowTexts(band)
  await band.unmount()
  return shown
}

// What the band leads with for the default question (needingHuman, G:task-end) and stop (stopped, step-failed): what it needs
// or why, also once the alert opened the pane, as the pane's STATUS does.
export const NEEDS_YOU_LEAD = '⏸ WAITING FOR YOU · your sign-off at the end'
export const STOPPED_LEAD = '✗ STOPPED · a step kept failing'

// Whether any line of the band's texts includes the wording.
export function bandSays(shown: string[], wording: string): boolean {
  return shown.some(text => text.includes(wording))
}
