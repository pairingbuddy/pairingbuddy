// Scenario band-one-line-narrow (Finding 24): the band stays one line when its region is narrower than the fitted budget.
// Placeholders: each fails until implemented.
import { expect, test } from 'claude-code/testing'
import { DETAILS } from './band'
import { BAND, engine, isSeparatorRule, start } from './testing/band'

// The region the live band gets is narrower than bodyColumns: the pane's [-] control sits beside it.
const CONTROL_WIDTH = 4

// The kit never paints, so wrapping is read from what the engine would lay out: the width of every
// non-rule Text and Button in the band's row. A row wider than its region is what splits 'write / scenarios'.
test('band-renders-single-row-at-55-66-columns', async ($, on) => {
  engine(on)
  await start($)
  const drawn: Record<number, { widths: number; shown: string[] }> = {}

  for (const columns of [55, 66]) {
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns }, surface: 'terminal' })
    const found = await band.findAll({})
    await band.unmount()
    // A Button reports its label as its text and again through its child Text: count the button once, by its label.
    const leaves = found.filter((node: any) => !isSeparatorRule(node) && (node.type === 'Button' || (node.type === 'Text' && node.text !== '' && node.text !== DETAILS)))
    const shown = leaves.map((node: any) => (node.type === 'Button' ? DETAILS : node.text) as string)
    drawn[columns] = { widths: shown.reduce((sum: number, text: string) => sum + [...text].length, 0), shown }
  }

  for (const columns of [55, 66]) {
    const { widths, shown } = drawn[columns]
    expect(widths, `at ${columns} columns the band row (${widths} cells) fits the region beside the [-] control (${columns - CONTROL_WIDTH}), so no segment wraps onto a second row: ${JSON.stringify(shown)}`).toBeLessThanOrEqual(columns - CONTROL_WIDTH)
  }
})

test('band-drops-whole-segments-not-truncates', async ($, on) => {
  engine(on)
  await start($)
  const fragments: Record<number, string[]> = {}

  for (const columns of [55, 66]) {
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns }, surface: 'terminal' })
    const found = await band.findAll({})
    await band.unmount()
    // The segments are the band's Text leaves; the rule, the separators, the gap and the details button are not segments.
    const segments = found
      .filter((node: any) => node.type === 'Text' && !isSeparatorRule(node) && node.text !== DETAILS)
      .map((node: any) => node.text as string)
      .filter((text: string) => text.trim() !== '' && text.trim() !== '·' && !text.trim().startsWith('/pb'))
    fragments[columns] = segments.filter((text: string) => text.includes('…'))
  }

  for (const columns of [55, 66]) {
    expect(fragments[columns], `at ${columns} columns segments that do not fit are dropped whole by priority; none is cut with '…' or left as a bare '…'`).toEqual([])
  }
})

test('band-segments-never-wrap-onto-a-second-row', async ($, on) => {
  engine(on)
  await start($)
  const wrapping: Record<number, string[]> = {}

  for (const columns of [55, 66]) {
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns }, surface: 'terminal' })
    const found = await band.findAll({ type: 'Text' })
    await band.unmount()
    // fitBand drops whole segments by priority; wrap="truncate-end" is the safety net so a misjudged width
    // can never split a segment across rows ('write / scenarios'). The kit's default 'wrap' would do exactly that.
    // The ' │ ' separators and the '/pb' hint are Texts too and can wrap onto a second row, so they are asserted as well.
    const segments = found.filter((node: any) => !isSeparatorRule(node) && node.text.trim() !== '' && node.text !== DETAILS)
    wrapping[columns] = segments.filter((node: any) => !String(node.props.wrap ?? 'wrap').startsWith('truncate')).map((node: any) => `${node.text} (wrap=${node.props.wrap ?? 'default'})`)
  }

  for (const columns of [55, 66]) {
    expect(wrapping[columns], `at ${columns} columns every segment Text uses a non-wrapping mode (truncate-*), so none can split onto a second row`).toEqual([])
  }
})
