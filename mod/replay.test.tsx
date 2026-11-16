import { expect, test } from 'claude-code/testing'
import { BAND, LEDGER, ROOT, isGoalRow, isStatusHead, joinSegments } from './testing/band'
import { PANE, paneLines, replay, setupReplay, type Rig, type Step } from './testing/replay'
import gOpen1 from './fixtures/replay/g-open-1'
import probe2 from './fixtures/replay/probe-2'
import s4Rollback from './fixtures/replay/s4-rollback'
import { bandColumns } from './band'
import { namedWhere, statusFirst } from './view'
import { ACCENT_COLOUR, PHASE_COLOURS } from './pane'
import { POLL_MS } from './poll'
import { fitBand, glance, runStart } from '../shared-node/glance.mjs'
import { MAX_FIX_UNDOS } from '../shared-node/limits.mjs'
import { PHASES, ROLES } from '../shared-node/labels.mjs'
import { plainName } from '../shared-node/plain-names.mjs'

// The task's tests in order, as .pairingbuddy/tests.json lists them; a label's item is the test_id.
// g-open-1's are the keys of its final ledger's tests.perTest; probe-2's are the items its labels name.
const TESTS = {
  'g-open-1': ['ten-percent-off-100-returns-90'],
  'probe-2': ['ten-percent-off-hundred', 'zero-percent-keeps-full-price'],
}
const testsFile = (ids: string[]) => ({
  '.pairingbuddy/tests.json': JSON.stringify({ tests: ids.map(test_id => ({ test_id })) }),
})

const IDLE_TEXT = 'Pairing Buddy · idle · /pb for details'
// Without an active stage the band is one text: idle, or "last run finished" once a run has ended ("✓ DONE · ready for your next
// task" when it left nothing to do).
// Between steps the run is at work, so its quiet line leads with the working mark.
const quietBand = (shown: string[]) => (shown.length === 1 && /^(Pairing Buddy · (idle|last run finished)|● (run open|all steps done|between steps · next: [^·]+)|✓ DONE · ready for your next task) ?(· \/pb( for details)?)?$/.test(shown[0]) ? shown : [IDLE_TEXT])
const DRAWN_AROUND_SEGMENTS = (text: string) => text === ' │ ' || text === ' ' || text === '▸ details' || text.startsWith(' │ /pb')
// The band's segment texts: what is drawn without the separators, the gap, the details button text and the hint.
// The goal row above them is left out; colour-means-one-thing-in-the-band reads every node.
const texts = (step: Step) => joinSegments(step.texts.filter(node => !isGoalRow(node))).map(node => node.text).filter(text => !DRAWN_AROUND_SEGMENTS(text))
const paneTexts = (step: { pane: Step['texts'] }) => step.pane.map(node => node.text)
// The unit's start as the poller keeps it: the earliest run start the ledgers served so far gave.
function sinceTracker() {
  let since: string | undefined
  return (ledger: unknown) => {
    const start = runStart(ledger)
    if (!Number.isNaN(Date.parse(start)) && (since === undefined || Date.parse(start) < Date.parse(since))) since = start
    return since
  }
}
function at<T extends { t: number }>(steps: T[], t: number): T {
  const found = steps.find(step => step.t === t)
  if (!found) throw new Error(`no step at t=${t}`)
  return found
}

async function mountPane($: any): Promise<{ text: string; props: Record<string, unknown> }[]> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const found = await pane.findAll({ type: 'Text' })
  await pane.unmount()
  return found
}

async function drawn($: any, rig: Rig, recording: any, ids: string[], mount: Record<string, unknown> = BAND, files: Record<string, string> = {}) {
  const steps: (Step & { band: string[]; pane: Step['texts']; lines: string[] })[] = []
  for await (const step of replay($, rig, recording, { files: { ...testsFile(ids), ...files }, mount: { ...mount, surface: 'terminal' } })) {
    const paneTexts = await mountPane($)
    steps.push({ ...step, band: texts(step), pane: paneTexts.map((node: any) => ({ text: node.text, props: node.props })), lines: await paneLines($) })
  }
  return steps
}

// The band's segments for a replayed step, as the view builds and fits them: glance's, the current test named, the status first.
function fittedBand(step: Step, tests: string[], since: string | undefined, bodyColumns: number) {
  const { band } = glance({ ledger: step.ledger, spawns: step.fed, tests, now: step.now, since, testsComplete: true })
  return fitBand(statusFirst(namedWhere(band, { ledger: step.ledger as any, spawns: step.fed as any, tests, testsComplete: true }), step.ledger as any), bandColumns(bodyColumns))
}

// mod/fixtures/replay/g-open-1/ is a trimmed committed copy of one bug_fix run recorded in
// tests/smoke/recordings/g-open-1/ (gitignored, so the test never reads from it).

test("band at each recorded step, in time order, shows the design's segments while a stage is active and one dim idle text otherwise", async ($, on) => {
  const rig = setupReplay(on)
  const shown: [number, string[]][] = []
  const sinceOf = sinceTracker()
  for await (const step of replay($, rig, gOpen1, { files: testsFile(TESTS['g-open-1']) })) {
    const active = (step.ledger as any)?.stage?.status === 'active'
    const since = sinceOf(step.ledger)
    const expected = active
      ? fittedBand(step, TESTS['g-open-1'], since, 80).map((segment: { text: string }) => segment.text)
      : quietBand(texts(step))

    shown.push([step.t, texts(step)])

    expect(texts(step), `band at t=${step.t}`).toEqual(expected)
    // The quiet line is dim behind its mark; only the done line is not, its call to action at full strength.
    const quiet = step.texts.filter(node => !isGoalRow(node) && !isStatusHead(node))
    if (!active && !texts(step)[0].startsWith('✓ DONE')) expect(quiet[0].props.dimColor, `idle text at t=${step.t} is dim`).toBe(true)
  }

  expect(shown.length, 'the recording was replayed').toBeGreaterThan(10)
  expect(shown.some(([, segments]) => segments[0] === IDLE_TEXT), 'some steps are idle').toBe(true)
  expect(shown.some(([, segments]) => segments[0] !== IDLE_TEXT), 'some steps are active').toBe(true)
})

test('at 139, 80 and 50 columns the band draws exactly the fitted glance segments at every step of both recordings', async ($, on) => {
  const rig = setupReplay(on)
  // While a stage is active the band's segments are what glance computes for the step's ledger and spawns, fitted to
  // bodyColumns; otherwise it is the one idle text.
  for (const [name, recording] of [['g-open-1', gOpen1], ['probe-2', probe2]] as const) {
    for (const bodyColumns of [139, 80, 50]) {
      const mount = { ...BAND, props: { ...BAND.props, bodyColumns } }
      const steps: Step[] = []
      for await (const step of replay($, rig, recording, { files: testsFile(TESTS[name]), mount: { ...mount, surface: 'terminal' } })) {
        steps.push(step)
      }

      const sinceOf = sinceTracker()
      for (const step of steps) {
        const active = (step.ledger as any)?.stage?.status === 'active'
        const since = sinceOf(step.ledger)
        const expected = active
          ? fittedBand(step, TESTS[name], since, bodyColumns).map((segment: { text: string }) => segment.text)
          : quietBand(texts(step))

        expect(texts(step), `${name} band at t=${step.t}, ${bodyColumns} columns`).toEqual(expected)
      }
    }
  }
})

test('with the pane open, every row in order, the step list in plain names with done/current/to-do marks, and no footer render from the same replay', async ($, on) => {
  const rig = setupReplay(on)
  const steps = await drawn($, rig, gOpen1, TESTS['g-open-1'])

  const all = at(steps, 148.104).lines
  expect(all.slice(0, 5), `the goal leads, then STATUS, and PR and BUILT read a dash before the task is done: ${JSON.stringify(all)}`).toEqual([
    'GOAL     Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it',
    '         should return 90.',
    'STATUS   ● working · safety-net review',
    'PR       —',
    'BUILT    —',
  ])
  const review = all.slice(5)
  expect(review[0], 'SPENT leaves out what is not measured').toMatch(/^SPENT {4}6 agents · \d+:\d\d$/)
  expect(review[1], 'nothing is looping').toBe('LOOPING  no')
  expect(review.filter(line => /^(LEFT|OFF TRACK|NOW|DONE)\b/.test(line)), 'LEFT, OFF TRACK, NOW and DONE are gone').toEqual([])
  expect(review.slice(2, 6), 'steps done, then current, in plain names').toEqual(['STEPS    ○ work out the task type', '         ✓ write test scenarios', '         ✓ build test by test', '         ▸ safety-net review'])
  expect(review, 'the tests stay listed, and no test is current in the review').toEqual(expect.arrayContaining(['TESTS    ✓ 1 done   ◌ 3 covered']))

  const building = at(steps, 49.891).lines
  expect(building, 'steps at tdd: done, current, to come').toEqual(expect.arrayContaining(['         ✓ write test scenarios', '         ▸ build test by test', '         ○ safety-net review']))

  const lastPane = at(steps, 148.104).pane.map(text => String(text.props.children ?? ''))
  expect(lastPane.some(text => /only watches/.test(text)), 'no "only watches" footer').toBe(false)
})

test('replaying probe-2 shows LOOPING naming the step and its 3rd try, and the 3rd-try STATUS sentence', async ($, on) => {
  const rig = setupReplay(on)
  const steps = await drawn($, rig, probe2, TESTS['probe-2'])

  const third = at(steps, 125.887)
  const second = at(steps, 121.827)
  const pane = third.lines
  // At 80 columns the test's name and place take the room "looping: yes" had; the pane's LOOPING row says it.
  expect(third.band, 'band at the 3rd RED try').toEqual(expect.arrayContaining(['● RED · zero percent keeps full price · 2/2']))
  expect(pane, `pane LOOPING row in ${JSON.stringify(pane)}`).toContain('LOOPING  writing a failing test · try 3 of 3')
  expect(pane, `pane STATUS row in ${JSON.stringify(pane)}`).toEqual(expect.arrayContaining(['STATUS   ● working · writing a failing test for zero percent keeps full price', '         test 2 of 2, 3rd try']))
  expect(second.band, 'band at the 2nd try is not looping yet').not.toContain('looping: yes')
  expect(second.lines, 'the 2nd try names the step and its try').toContain('LOOPING  writing a failing test · try 2 of 3')
  expect(steps.flatMap(step => step.lines).some(line => line.includes('try 1 of')), 'a first try is never spelled out').toBe(false)
})

test('across band and pane text for the replayed recordings, no rendered string contains a gate id, stage id or agent id', async ($, on) => {
  const rig = setupReplay(on)
  // Ids from the same sources as tests/js/plain-names.test.mjs, without its fs (the kit has none): the
  // recordings' own stages, gates, agent types and stop codes, and the task types.
  const recordings = [['g-open-1', gOpen1], ['probe-2', probe2]] as const
  const ids = new Set<string>(['pb1', 'bug_fix', 'new_feature', 'config_change', 'refactoring', 'spike'])
  for (const [, recording] of recordings) {
    for (const { ledger } of recording.ledger as any[]) {
      ids.add(ledger.stage.name)
      ledger.stages.forEach((stage: any) => ids.add(stage.name))
      Object.keys(ledger.gates).forEach(gate => ids.add(gate))
      ids.add(ledger.taskType)
      if (ledger.stop?.reason) ids.add(ledger.stop.reason.split(':')[0].trim())
    }
    for (const spawn of recording.spawns as any[]) {
      if (spawn.agentType) ids.add(spawn.agentType.replace(/^pairingbuddy:/, ''))
      if (spawn.kind === 'Agent') ids.add(String(spawn.name).replace(/^pairingbuddy:/, ''))
    }
  }
  const forbidden = [...ids].filter(id => id !== '' && !PHASES.includes(id) && !ROLES.includes(id))
  expect(forbidden.length, 'the id list is built from the recordings').toBeGreaterThan(10)
  expect(forbidden, 'stage ids from the recordings are in the list').toContain('code-tdd')
  expect(forbidden, 'gate ids from the recordings are in the list').toContain('G:scenarios')
  expect(forbidden, 'agent ids from the recordings are in the list').toContain('implement-tests')
  expect(plainName('code-tdd'), 'the shared-node plain names are importable in the kit').toBe('build test by test')

  const containsId = (text: string, id: string) =>
    new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(text)

  let strings = 0
  for (const [name, recording] of recordings) {
    const steps = await drawn($, rig, recording, TESTS[name])
    for (const step of steps) {
      for (const surface of [step.band, paneTexts(step)]) {
        expect(surface.length, `${name} t=${step.t}: the band and the pane each drew text`).toBeGreaterThan(0)
        for (const text of surface) {
          strings++
          const leaked = forbidden.filter(id => containsId(text, id))
          expect(leaked, `${name} t=${step.t}: "${text}" holds ids`).toEqual([])
        }
      }
    }
  }
  expect(strings, 'the band and pane drew text to check').toBeGreaterThan(100)
})

// Colour means one thing: the TDD phase (its fixed colour), where the run is now (the accent, on the current step and test),
// "needs you" (warning) and a stop (error). Nothing else is coloured.
const MEANING_COLOURS = ['warning', 'error']
const isLitNow = (node: { text: string; props: Record<string, unknown> }) => node.text.startsWith('▸ ') && node.props.color === ACCENT_COLOUR && node.props.bold === true
// The pane's nodes under the first glance's rule: the detail rows.
const details = <T extends { text: string; props: Record<string, unknown> }>(pane: T[]) => pane.slice(pane.findIndex(node => node.props.dimColor === true && /^─{3,}$/.test(node.text)) + 1)
// STATUS's working head: the run is at work, so its mark is in the accent too, calm (not bold).
const isWorkingHead = (node: { text: string; props: Record<string, unknown> }) => node.text === '● working' && node.props.color === ACCENT_COLOUR && node.props.bold === undefined

// The band is held to the same code by its own test below (colour-means-one-thing-in-the-band).
test('colour-means-one-thing: across every drawn Text in the pane over the replay recordings, only the lit phase, the current step and test, needs-you and a stop are coloured', async ($, on) => {
  const rig = setupReplay(on)
  const colours = new Set<string>()
  let nodes = 0
  for (const [name, recording] of [['g-open-1', gOpen1], ['probe-2', probe2]] as const) {
    for (const step of await drawn($, rig, recording, TESTS[name])) {
      for (const node of step.pane) {
        nodes++
        const color = node.props.color
        if (color === undefined) continue
        colours.add(String(color))
        const phase = /^[●](RED|GREEN|REFACTOR)$/.exec(node.text)?.[1]
        if (phase) expect(color, `${name} t=${step.t}: the lit ${phase} has its fixed colour`).toBe(PHASE_COLOURS[phase])
        else if (color === ACCENT_COLOUR) expect(isLitNow(node) || isWorkingHead(node), `${name} t=${step.t}: only a current line or the working head is in the accent: "${node.text}"`).toBe(true)
        else expect(MEANING_COLOURS, `${name} t=${step.t}: "${node.text}" is coloured ${JSON.stringify(color)}`).toContain(color)
      }
    }
  }

  expect(nodes, 'the pane drew text to check').toBeGreaterThan(100)
  expect([...colours], 'the recordings drew the phases and the accent').toEqual(expect.arrayContaining([PHASE_COLOURS.RED, PHASE_COLOURS.GREEN, ACCENT_COLOUR]))
})

// STATUS draws the eye in proportion to urgency: a block (inverse) only for needs-you (yellow) and a stop (red), what follows it
// in the same colour but no block; done bold and uncoloured; working in the accent, calm; a quiet state behind a dim ○. Yellow
// and red appear nowhere but STATUS.
const STATUS_HEADS: Record<string, Record<string, unknown>> = {
  '▲ NEEDS YOU': { color: 'warning', inverse: true, bold: true },
  '✕ STOPPED': { color: 'error', inverse: true, bold: true },
  '✓ DONE': { color: undefined, inverse: undefined, bold: true },
  '● working': { color: ACCENT_COLOUR, inverse: undefined, bold: undefined },
  '○': { color: undefined, inverse: undefined, dimColor: true },
}
const statusRow = <T extends { text: string }>(pane: T[]) => pane.slice(pane.findIndex(node => node.text === 'STATUS   ') + 1, pane.findIndex(node => /^─{3,}$/.test(node.text)))

// Checks one drawn pane's STATUS against STATUS_HEADS and returns the head it led with.
function checkStatus(pane: Step['texts'], at: string): string {
  const row = statusRow(pane)
  const [head, ...rest] = row.filter(node => node.text.trim() !== '')
  const look = STATUS_HEADS[head.text]
  expect(look, `${at}: STATUS leads with one of the five heads, not "${head.text}"`).toBeDefined()
  for (const [prop, value] of Object.entries(look)) expect(head.props[prop], `${at}: "${head.text}" ${prop}`).toBe(value)
  for (const node of rest) {
    expect(node.props.inverse, `${at}: only the head is a block: "${node.text}"`).toBeUndefined()
    expect(node.props.color, `${at}: what follows "${head.text}" is in its colour`).toBe(look.inverse ? look.color : undefined)
  }
  const elsewhere = pane.filter(node => !row.includes(node))
  expect(elsewhere.filter(node => node.props.inverse !== undefined || MEANING_COLOURS.includes(String(node.props.color))).map(node => node.text), `${at}: no block, yellow or red outside STATUS`).toEqual([])
  return head.text
}

test('colour-means-one-thing-in-status: a block only for a stop, working calm in the accent, over g-open-1 and probe-2', async ($, on) => {
  const rig = setupReplay(on)
  const heads = new Set<string>()
  for (const [name, recording] of [['g-open-1', gOpen1], ['probe-2', probe2]] as const) {
    for (const step of await drawn($, rig, recording, TESTS[name], PANE)) heads.add(checkStatus(step.pane, `${name} t=${step.t}`))
  }

  expect([...heads], 'the recordings drew a stop and working').toEqual(expect.arrayContaining(['✕ STOPPED', '● working']))
})

test('colour-means-one-thing-in-status: a block for needs-you, over s4-rollback', async ($, on) => {
  const rig = setupReplay(on)
  const heads = new Set((await drawn($, rig, s4Rollback, S4_TEST_IDS, PANE)).map(step => checkStatus(step.pane, `s4-rollback t=${step.t}`)))

  expect([...heads], 'the recording drew needs-you and working').toEqual(expect.arrayContaining(['▲ NEEDS YOU', '● working']))
})

// The band uses the pane's code, so it trains the eye: where the run is now in the accent with bold, the TDD phase word in its
// phase colour, needs-you in yellow with bold, a stop in red. Nothing else in the band is coloured.
test('colour-means-one-thing-in-the-band: the step in the accent, the phase word in its colour, needs-you and a stop, nothing else', async ($, on) => {
  const rig = setupReplay(on)
  const seen = { phase: new Set<string>(), accent: 0, mark: 0, block: 0 }
  for (const [name, recording] of [['g-open-1', gOpen1], ['probe-2', probe2]] as const) {
    for await (const step of replay($, rig, recording, { files: testsFile(TESTS[name]) })) {
      const active = (step.ledger as any)?.stage?.status === 'active'
      // The step the band names, behind its working mark.
      const where = active ? fittedBand(step, TESTS[name], undefined, 80).find((segment: { id: string }) => segment.id === 'where')?.text.replace(/^● /, '') : undefined
      for (const node of step.texts) {
        const { color, bold } = node.props
        if (color === undefined) continue
        const at = `${name} t=${step.t}: "${node.text}"`
        if (node.text === '● ') {
          expect([color, bold], `${at} the working mark is in the accent, calm, as STATUS draws it`).toEqual([ACCENT_COLOUR, undefined])
          seen.mark++
        } else if (PHASES.includes(node.text)) {
          expect(color, `${at} is its phase's colour`).toBe(PHASE_COLOURS[node.text])
          expect(bold, `${at} is bold, as the pane's lit phase`).toBe(true)
          expect(where?.startsWith(node.text), `${at} is the phase of the step the band names`).toBe(true)
          seen.phase.add(node.text)
        } else if (color === ACCENT_COLOUR) {
          expect(bold, `${at} in the accent is bold`).toBe(true)
          expect(where !== undefined && where.endsWith(node.text), `${at} is the step the band names (${where})`).toBe(true)
          seen.accent++
        } else if (/^(▲ NEEDS YOU|✕ STOPPED)$/.test(node.text)) {
          expect([color, node.props.inverse, bold], `${at} leads the band in its block, as STATUS draws it`).toEqual([node.text.startsWith('▲') ? 'warning' : 'error', true, true])
          seen.block++
        } else {
          expect(node.text.startsWith(' · '), `${at} is coloured ${JSON.stringify(color)}: only what follows a needs-you or stop block may be`).toBe(true)
          expect(MEANING_COLOURS, `${at} is needs-you or a stop`).toContain(color)
          expect(node.props.inverse, `${at} is no block`).toBeUndefined()
        }
      }
      // A question or a stop leads instead, and the step behind it is a detail: nothing else draws the eye.
      const standing = Boolean((step.ledger as any)?.stop || (step.ledger as any)?.needsHuman?.gate)
      if (where) expect(step.texts.some(node => node.props.color === ACCENT_COLOUR), `${name} t=${step.t}: the step "${where}" is lit unless a question or stop leads`).toBe(!standing)
    }
  }

  expect([...seen.phase], 'the band drew phase words').toEqual(expect.arrayContaining(['RED', 'GREEN']))
  expect(seen.accent, 'the band drew the step in the accent').toBeGreaterThan(0)
  expect(seen.mark, 'the band led with the working mark').toBeGreaterThan(0)
  expect(seen.block, 'the band led with a stop block (probe-2 stops)').toBeGreaterThan(0)
})

test('colour-means-one-thing-in-a-review: over the s4-rollback replay, a lens that has finished but not yet returned is not drawn in a colour', async ($, on) => {
  const rig = setupReplay(on)
  const steps = await drawn($, rig, s4Rollback, S4_TEST_IDS, PANE)
  // STATUS is held to its own code by colour-means-one-thing; here, only the rows under it.
  const coloured = steps.flatMap(step => details(step.pane).filter(node => node.props.color !== undefined && !/^●(RED|GREEN|REFACTOR)$/.test(node.text) && !isLitNow(node)).map(node => `t=${step.t} ${node.props.color}: ${node.text}`))
  expect(coloured, 'under the first glance, only the lit phase and the current step and test are coloured').toEqual([])
})

// mod/fixtures/replay/s4-rollback/ is one S4 bug_fix run with a rolled-back fix, recorded in tests/smoke/recordings/s4-t85-run4/.
const S4_TEST_IDS = ['apply-discount-10-percent-on-100-returns-90']

const isSafetyNetActive = (step: { ledger: unknown }) => (step.ledger as any)?.stage?.name === 'code-safety-net' && (step.ledger as any)?.stage?.status === 'active'

// The last step drawn while the code-safety-net stage was active; fails with a clear message when the recording has none.
function lastSafetyNetStep<T extends { ledger: unknown; t: number }>(steps: T[]): T {
  const safetyNet = steps.filter(isSafetyNetActive)
  expect(safetyNet.length, 'the s4-rollback recording has active code-safety-net steps').toBeGreaterThan(0)
  return safetyNet[safetyNet.length - 1]
}

const rollbacksIn = (snapshot: { ledger: unknown }): any[] => (snapshot.ledger as any)?.fixes?.rollbacks ?? []
// Each ledger snapshot carries the rollbacks so far, so the full list is the longest one.
const recordedRollbacks = () => s4Rollback.ledger.map(rollbacksIn).reduce((most, list) => (list.length > most.length ? list : most), [])

test('replay-counts-match-recorded-lens-record', async ($, on) => {
  const rig = setupReplay(on)
  const steps = await drawn($, rig, s4Rollback, S4_TEST_IDS, PANE)
  const last = lastSafetyNetStep(steps)
  const recorded = s4Rollback.ledger.find(snapshot => snapshot.t > last.t && (snapshot.ledger as any)?.lenses?.['safety-net'])
  expect(recorded, `the recording holds a safety-net lens record after t=${last.t}`).toBeDefined()
  const record = (recorded!.ledger as any).lenses['safety-net']
  expect([record.survivors, record.refuted, record.unrefuted], 'the recorded lens record: survivors, refuted, unrefuted').toEqual([3, 0, 0])
  expect(record.uncovered, 'the recorded lens record has no uncovered lens').toEqual([])

  const shown = last.lines
  const review = shown.slice(shown.findIndex(line => line.startsWith('REVIEW')))

  // The three survivors are upheld after the refuters; a kept fix answered each one's lens, so all read fixed.
  expect(review.slice(0, 2), `the pane's REVIEW row at t=${last.t}: ${JSON.stringify(shown)}`).toEqual(['REVIEW   checked: the code, the tests, docs and plan', '         3 issues found · 3 fixed'])
  expect(review.some(line => /\b(checking|to fix|fixing)\b/.test(line)), 'nothing is still open at the end of the stage').toBe(false)
  expect(review.some(line => line.includes('could not check')), 'no lens is left uncovered').toBe(false)
})

test('replay-fixes-match-recorded-rollbacks-and-verdicts', async ($, on) => {
  const rig = setupReplay(on)
  const steps = await drawn($, rig, s4Rollback, S4_TEST_IDS, PANE)
  const last = lastSafetyNetStep(steps)
  const rollbacks = recordedRollbacks()
  expect(rollbacks.length, 'the recording holds exactly one rollback').toBe(1)
  expect(rollbacks[0].kind, 'the recorded rollback was a red one').toBe('red')
  const rolledAt = s4Rollback.ledger.find(snapshot => rollbacksIn(snapshot).length > 0)!.t

  const review = (lines: string[]) => lines.slice(lines.findIndex(line => line.startsWith('REVIEW')))
  const atRollback = review(at(steps, rolledAt).lines)
  // The first fix went red and was undone, so its finding is to fix again; the other groups' fixes have not started.
  expect(atRollback[1], `at the rollback's own step t=${rolledAt}: ${JSON.stringify(atRollback)}`).toBe('         3 issues found · 3 to fix')
  expect(review(last.lines)[1], `at the end of the stage the retried fix was kept: ${JSON.stringify(last.lines)}`).toBe('         3 issues found · 3 fixed')
  expect(last.lines.some(line => /^ {2}fix \d+ |^fixes {2}/.test(line.trim() === line ? line : line.slice(9))), 'no fix block: the finding words say what happened').toBe(false)
})

// s4-rollback runs on through G:task-end and the publish run's pr-draft; pb publish then opens the PR and closes the unit.
const S4_CHANGED = { '.pairingbuddy/run/changed.json': JSON.stringify([{ path: 'README.md', status: 'M' }, { path: 'discount.py', status: 'M' }, { path: 'tests/test_discount.py', status: 'M' }]) }

test('replay-end-state-after-the-publish-says-done-goal-and-pr', async ($, on) => {
  const rig = setupReplay(on)
  const steps = await drawn($, rig, s4Rollback, S4_TEST_IDS, PANE, S4_CHANGED)
  const publishing = steps.at(-1)!.lines
  expect(publishing.slice(2, 5), `while the publish run waits on G:publish: ${JSON.stringify(publishing)}`).toEqual([
    'STATUS   ● working · all steps done',
    'PR       —',
    'BUILT    README.md, discount.py, tests/test_discount.py · 1 test passing',
  ])

  rig.toolResults.set('Bash', { stdout: '{"ok":true,"result":"published","url":"https://github.com/o/r/pull/12","warnings":[]}\n', stderr: '' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-publish', command: 'node <plugin>/cli/pb.mjs publish' })
  rig.served.delete(`${ROOT}/${LEDGER}`)
  await rig.clock.advance(POLL_MS * 2)
  const ended = await paneLines($)

  expect(ended.slice(0, 6), `after the publish: ${JSON.stringify(ended)}`).toEqual([
    'GOAL     Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it',
    '         should return 90.',
    'STATUS   ✓ DONE · goal met · PR #12 opened · ready for your next task',
    'PR       opened · #12 fix: apply_discount returns price after discount',
    'BUILT    README.md, discount.py, tests/test_discount.py · 1 test passing',
    expect.stringMatching(/^SPENT /),
  ])
  const review = ended.slice(ended.findIndex(line => line.startsWith('REVIEW')))
  expect(review[0], 'the review is the work\'s, in one summary line').toBe('REVIEW   review: 3 issues, all fixed')
  expect(review.slice(1).every(line => !line.includes('…')), `no finding is cut with an ellipsis: ${JSON.stringify(review)}`).toBe(true)
})
