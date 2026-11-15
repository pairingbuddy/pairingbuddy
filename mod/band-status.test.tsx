// Scenario band-status (hierarchy): under the goal, the band's row leads with the run's status, drawn with the pane's STATUS
// mark and colour, so a glance at the band answers "am I needed now?" before any detail.
import { expect, test } from 'claude-code/testing'
import { BAND, SNAPSHOT_RUNNING, engine, isGoalRow, isSeparatorRule, start } from './testing/band'
import { ACCENT_COLOUR } from './pane'

// The band's step row as drawn: its Texts in order, the rule and the goal row aside.
async function rowNodes($: any, bodyColumns = 120) {
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'terminal' })
  const found = (await band.findAll({ type: 'Text' })).filter((node: any) => !isSeparatorRule(node) && !isGoalRow(node))
  await band.unmount()
  return found as { text: string; props: Record<string, unknown> }[]
}

test('a-working-band-leads-with-the-accent-dot-and-says-nothing-of-needs-you', async ($, on) => {
  engine(on, SNAPSHOT_RUNNING)
  await start($)

  const nodes = await rowNodes($)

  expect([nodes[0].text, nodes[0].props.color, nodes[0].props.bold], 'the working mark leads, in the accent, calm as in STATUS').toEqual(['● ', ACCENT_COLOUR, undefined])
  expect([nodes[1].text, nodes[1].props.color], 'the step follows it, lit as before').toEqual(['write test scenarios', ACCENT_COLOUR])
  expect(nodes.some(node => node.text.includes('needs you')), `the status mark says it; no "needs you: no": ${JSON.stringify(nodes.map(node => node.text))}`).toBe(false)
})
