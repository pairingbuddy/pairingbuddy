// Scenario band-separator-above-text (Finding 22): the band is visually separated from the transcript above it.
import { expect, test } from 'claude-code/testing'
import { glance } from '../shared-node/glance.mjs'
import { BAND, engine, isSeparatorRule, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'

test('band-draws-dim-separator-above-band-text', async ($, on) => {
  engine(on)
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const nodes = await band.findAll({})
  await band.unmount()

  const isRule = (node: any) => node.type === 'Text' && node.props.dimColor === true && /^[─━═\-_—]{3,}$/.test(node.text.trim())
  const isDimBorder = (node: any) => node.type === 'Box' && Boolean(node.props.borderStyle) && node.props.borderDimColor === true
  const separator = nodes.findIndex((node: any) => isRule(node) || isDimBorder(node))
  const bandText = nodes.findIndex((node: any) => node.type === 'Text' && node.text.includes('write scenarios'))
  const shown = JSON.stringify(nodes.map((node: any) => ({ type: node.type, text: node.text, props: node.props })))
  expect(separator, `a dim separator (a dim-bordered Box or a dim rule Text) is drawn: ${shown}`).toBeGreaterThanOrEqual(0)
  expect(bandText, `the band text is drawn: ${shown}`).toBeGreaterThanOrEqual(0)
  expect(separator, `the separator comes before the band text: ${shown}`).toBeLessThan(bandText)
  expect(JSON.stringify(nodes[separator].props), 'the separator uses no raw colour value').not.toMatch(/#|rgb|ansi/i)
})

test('band-separator-keeps-existing-texts-and-single-content-line', async ($, on) => {
  const waiting = { ...SNAPSHOT_RUNNING, needsHuman: { gate: 'G:scenarios', reason: 'the human decides', seq: 6 } }
  const run = engine(on, null)
  await start($)
  const drawn: Record<string, { rules: any[]; content: string[] }> = {}
  const draw = async (name: string, columns: number) => {
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns }, surface: 'terminal' })
    const found = await band.findAll({ type: 'Text' })
    await band.unmount()
    drawn[name] = { rules: found.filter((node: any) => isSeparatorRule(node)), content: found.filter((node: any) => !isSeparatorRule(node)).map((node: any) => node.text as string) }
  }

  await draw('idle', 200)
  run.serve(SNAPSHOT_RUNNING)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  await draw('running', 200)
  await draw('running-narrow', 30)
  run.serve(waiting)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  await draw('needs-you', 200)

  const expected = (ledger: any) => glance({ ledger, spawns: [], tests: [], now: 0 }).band.map((segment: any) => segment.text as string)
  const shown = JSON.stringify(drawn)
  expect(drawn.idle.content.join(''), `idle keeps its one text: ${shown}`).toBe('Pairing Buddy \u00b7 idle \u00b7 /pb for details')
  for (const segment of expected(SNAPSHOT_RUNNING)) expect(drawn.running.content.join(' '), `running keeps "${segment}": ${shown}`).toContain(segment)
  for (const segment of [...expected(SNAPSHOT_RUNNING).slice(0, -1), 'needs you \u00b7 opened details']) expect(drawn['needs-you'].content.join(' '), `needs-you keeps "${segment}": ${shown}`).toContain(segment)
  const widths: Record<string, number> = { 'running-narrow': 30 }
  for (const [name, one] of Object.entries(drawn)) {
    expect(one.rules.length, `${name} draws exactly one separator rule: ${shown}`).toBe(1)
    expect(one.rules[0].text.length, `${name} rule is never wider than the region: ${shown}`).toBeLessThanOrEqual(widths[name] ?? 200)
    expect(one.content.some(text => /[\u2500\u2501\u2550]{3,}/.test(text)), `${name} content texts carry no rule: ${shown}`).toBe(false)
  }
})
