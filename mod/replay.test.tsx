import { expect, test } from 'claude-code/testing'
import { BAND } from './testing/band'
import { PANE, replay, setupReplay, type Rig, type Step } from './testing/replay'
import gOpen1 from './fixtures/replay/g-open-1'
import probe2 from './fixtures/replay/probe-2'
import { bandColumns } from './band'
import { fitBand, glance } from '../shared-node/glance.mjs'
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
// Without an active stage the band is one text: idle, or "last run finished" once a run has ended.
const quietBand = (shown: string[]) => (shown.length === 1 && /^Pairing Buddy · (idle|last run finished|run open|between steps · next: [^·]+) ?(· \/pb( for details)?)?$/.test(shown[0]) ? shown : [IDLE_TEXT])
const DRAWN_AROUND_SEGMENTS = (text: string) => text === ' │ ' || text === ' ' || text === '▸ details' || text.startsWith(' │ /pb')
// The band's segment texts: what is drawn without the separators, the gap, the details button text and the hint.
const texts = (step: Step) => step.texts.map(node => node.text).filter(text => !DRAWN_AROUND_SEGMENTS(text))
const paneTexts = (step: { pane: Step['texts'] }) => step.pane.map(node => node.text)
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

async function drawn($: any, rig: Rig, recording: any, ids: string[], mount: Record<string, unknown> = BAND) {
  const steps: (Step & { band: string[]; pane: Step['texts'] })[] = []
  for await (const step of replay($, rig, recording, { files: testsFile(ids), mount: { ...mount, surface: 'terminal' } })) {
    const paneTexts = await mountPane($)
    steps.push({ ...step, band: texts(step), pane: paneTexts.map((node: any) => ({ text: node.text, props: node.props })) })
  }
  return steps
}

// mod/fixtures/replay/g-open-1/ is a trimmed committed copy of one bug_fix run recorded in
// tests/smoke/recordings/g-open-1/ (gitignored, so the test never reads from it).

test("band at each recorded step, in time order, shows the design's segments while a stage is active and one dim idle text otherwise", async ($, on) => {
  const rig = setupReplay(on)
  const shown: [number, string[]][] = []
  for await (const step of replay($, rig, gOpen1, { files: testsFile(TESTS['g-open-1']) })) {
    const active = (step.ledger as any)?.stage?.status === 'active'
    const expected = active
      ? fitBand(glance({ ledger: step.ledger, spawns: step.fed, tests: TESTS['g-open-1'], now: step.now }).band, bandColumns(80))
          .map((segment: { text: string }) => segment.text)
      : quietBand(texts(step))

    shown.push([step.t, texts(step)])

    expect(texts(step), `band at t=${step.t}`).toEqual(expected)
    if (!active) expect(step.texts[0].props.dimColor, `idle text at t=${step.t} is dim`).toBe(true)
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

      for (const step of steps) {
        const active = (step.ledger as any)?.stage?.status === 'active'
        const expected = active
          ? fitBand(glance({ ledger: step.ledger, spawns: step.fed, tests: TESTS[name], now: step.now }).band, bandColumns(bodyColumns))
              .map((segment: { text: string }) => segment.text)
          : quietBand(texts(step))

        expect(texts(step), `${name} band at t=${step.t}, ${bodyColumns} columns`).toEqual(expected)
      }
    }
  }
})

test('with the pane open, the five glance rows, the step list in plain names with done/current/to-do marks, and the dim footer render from the same replay', async ($, on) => {
  const rig = setupReplay(on)
  const steps = await drawn($, rig, gOpen1, TESTS['g-open-1'])

  const review = paneTexts(at(steps, 148.104))
  const rows = { NOW: 'safety-net review', SPENT: '6 agents · time unknown · tokens unknown · % of plan unknown', LEFT: 'unknown', LOOPING: 'unknown', 'OFF TRACK': 'unknown' }
  for (const [label, value] of Object.entries(rows)) {
    expect(review.some(text => text.startsWith(label) && text.includes(value)), `a ${label} row reading "${value}" in ${JSON.stringify(review)}`).toBe(true)
  }
  expect(review, 'steps done, then current, in plain names').toEqual(expect.arrayContaining(['✓ write scenarios', '✓ build test by test', '▸ safety-net review']))

  const building = paneTexts(at(steps, 49.891))
  expect(building, 'steps at tdd: done, current, to come').toEqual(expect.arrayContaining(['✓ write scenarios', '▸ build test by test', '○ safety-net review']))

  const footer = at(steps, 148.104).pane.at(-1)!
  expect(footer.props.dimColor, 'the last thing drawn is the dim footer').toBe(true)
})

test('replaying probe-2 shows LOOPING "yes: 3 tries" and the 3rd-try NOW sentence', async ($, on) => {
  const rig = setupReplay(on)
  const steps = await drawn($, rig, probe2, TESTS['probe-2'])

  const third = at(steps, 125.887)
  const second = at(steps, 121.827)
  const pane = paneTexts(third)
  expect(third.band, 'band at the 3rd RED try').toEqual(expect.arrayContaining(['RED · test 2 of 2', 'looping: yes']))
  expect(pane.some(text => text.startsWith('LOOPING') && text.includes('yes: 3 tries at the same step')), `pane LOOPING row in ${JSON.stringify(pane)}`).toBe(true)
  expect(
    pane.some(text => text.startsWith('NOW') && text.includes('writing a failing test for zero percent keeps full price · test 2 of 2, 3rd try')),
    `pane NOW row in ${JSON.stringify(pane)}`,
  ).toBe(true)
  expect(second.band, 'band at the 2nd try is not looping yet').toContain('looping: no')
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

// ThemeKey, from types/claude-code.d.ts in the bundled plugin-authoring reference.
const THEME_KEYS = [
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude',
  'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide', 'diffAdded', 'diffRemoved', 'diffAddedDimmed',
  'diffRemovedDimmed', 'diffAddedWord', 'diffRemovedWord',
]

test('every-color-prop-is-a-theme-key: across every drawn Text in band and pane over the replay recordings, each color prop is a ThemeKey value and no hex, rgb or ANSI name', async ($, on) => {
  const rig = setupReplay(on)
  const colours = new Set<string>()
  let nodes = 0
  for (const [name, recording] of [['g-open-1', gOpen1], ['probe-2', probe2]] as const) {
    for (const step of await drawn($, rig, recording, TESTS[name])) {
      for (const node of [...step.texts, ...step.pane]) {
        nodes++
        const color = node.props.color
        if (color === undefined) continue
        colours.add(String(color))
        expect(THEME_KEYS, `${name} t=${step.t}: "${node.text}" is coloured ${JSON.stringify(color)}`).toContain(color)
      }
    }
  }

  expect(nodes, 'the band and pane drew text to check').toBeGreaterThan(100)
  expect([...colours], 'the recordings drew some colour at all').toEqual(expect.arrayContaining(['claude', 'success']))
})
