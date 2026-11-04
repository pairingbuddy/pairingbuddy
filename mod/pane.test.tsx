import { expect, mock, test } from 'claude-code/testing'
import { plainName } from '../shared-node/plain-names.mjs'
import { BAND, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, ROOT, engine, serveLedger, start, texts, type Served } from './testing/band'
import { PANE, dismissPane } from './testing/replay'
import { PANE_ID } from './pane-open'
import { POLL_MS } from './poll'

const IDLE = 'Pairing Buddy · idle'

test('pressing the band\'s details button opens the pane, closeable by esc', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const details = await band.find({ type: 'Button', key: 'details' })
  expect(details?.text, 'the band holds a details button').toBe('▸ details')
  await band.press({ key: 'details' })
  await band.unmount()

  expect(calls.opened.map(open => open.id), 'the button opens the pane under its id').toEqual([PANE_ID])
  // Esc itself belongs to the engine; the mod's part is to ask for it.
  expect(calls.opened[0].closeOnEscape, 'the pane is opened closeable by esc').toBe(true)
})

test('the mod registers /pb at session start, and running it opens the same pane closeable by esc', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  await $.command.run({ command: 'pb' })

  expect(calls.registered.map(command => command.name), 'the mod registers /pb at session start').toEqual(['pb'])
  expect(calls.opened.map(open => open.id), '/pb opens the pane under its id').toEqual([PANE_ID])
  expect(calls.opened[0].closeOnEscape, '/pb opens it closeable by esc too').toBe(true)
})

test('the dismiss button closes the pane by its id', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  await dismissPane($)

  expect(calls.closed.map(close => close.id), 'the dismiss button closes the pane').toEqual([PANE_ID])
})

test('the band\'s width budget subtracts the details button', async ($, on) => {
  engine(on)
  await start($)

  const fitted = async (bodyColumns: number) => {
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'terminal' })
    const segments = await texts(band)
    const button = (await band.find({ type: 'Button', key: 'details' }))!.text!
    await band.unmount()
    return { segments, button }
  }
  const narrow = await fitted(40)
  const wide = await fitted(200)

  const drawn = [...narrow.segments, narrow.button].join(' ').length
  expect(narrow.segments.length, 'the narrow band still draws segments').toBeGreaterThan(0)
  expect(narrow.segments.length, 'the 40 columns force segments to be cut').toBeLessThan(wide.segments.length)
  expect(drawn, `the segments and the button (${drawn}) fit the 40 columns`).toBeLessThanOrEqual(40)
})

test('a spawn with an unparseable label shows the raw label text in the pane and is counted as unknown, without throwing', async ($, on) => {
  engine(on)
  await start($)
  const raw = 'not a pb1 label at all'
  await $.agent.spawn({ prompt: 'p', description: 'd', name: raw, subagentType: 'pairingbuddy:implement-tests' })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = await texts(pane)
  await pane.unmount()

  expect(shown.some(text => text.includes(raw)), `the raw label is in the pane: ${JSON.stringify(shown)}`).toBe(true)
  expect(shown.some(text => /1 label unknown/.test(text)), 'the footer counts it: "1 label unknown"').toBe(true)
})

test('in the pane the unknown-label count sits straight after the raw labels, and the "only watches" footer is last', async ($, on) => {
  engine(on)
  await start($)
  const raws = ['not a pb1 label at all', 'neither is this one']
  for (const name of raws) {
    await $.agent.spawn({ prompt: 'p', description: 'd', name, subagentType: 'pairingbuddy:implement-tests' })
  }

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = await texts(pane)
  await pane.unmount()

  const lastRaw = shown.lastIndexOf(raws[1])
  expect(shown.slice(lastRaw - 1, lastRaw + 2), `the labels, then their count, in ${JSON.stringify(shown)}`).toEqual([raws[0], raws[1], '2 labels unknown'])
  expect(shown.at(-1), 'the footer is the last text').toMatch(/only watches/)
})

test('with the band mounted, a ledger that goes from idle to an active stage changes what it draws only when the poll interval has passed, with no new mount', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { served } = engine(on, SNAPSHOT_NO_STAGE)
  await start($)

  // The one mount: `band` is the same handle before and after, so the redraw needs no remount.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(band), 'with no active stage the band is the dim idle text').toEqual([IDLE])

  served.ledger = JSON.stringify(SNAPSHOT_RUNNING)
  expect(await texts(band), 'a changed ledger is not read by the render itself').toEqual([IDLE])
  await clock.advance(POLL_MS - 1)
  expect(await texts(band), 'one ms before the interval the band is still idle').toEqual([IDLE])

  await clock.advance(1)
  const after = await texts(band)
  expect(after.some(text => text.includes(plainName('code-scenarios'))), `the poll reads the new ledger and the band redraws: ${JSON.stringify(after)}`).toBe(true)
  await band.unmount()
})
