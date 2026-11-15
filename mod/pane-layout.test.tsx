// Scenario pane-layout: the pane keeps one layout for the whole unit (docs/design/progress-mod/DIRECTION.md, "Fixed layout").
import { expect, test } from 'claude-code/testing'
import { PANE, paneLines, setupReplay, type Rig } from './testing/replay'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'
import { ACCENT_COLOUR } from './pane'

const ROWS = ['GOAL', 'STATUS', 'PR', 'BUILT', 'SPENT', 'LOOPING', 'STEPS', 'TESTS', 'REVIEW']
const LABEL_WIDTH = 9

// The rows the pane starts with a label, in order.
const labelsOf = (lines: string[]) => lines.map(line => line.slice(0, LABEL_WIDTH).trim()).filter(label => label !== '')
const rowOf = (lines: string[], label: string) => lines.find(line => line.startsWith(label.padEnd(LABEL_WIDTH)))

async function serve($: any, rig: Rig, files: Record<string, unknown>, at = '2026-11-14T10:00:00.000Z') {
  rig.served.clear()
  for (const [path, value] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, typeof value === 'string' ? value : JSON.stringify(value))
  await rig.clock.set(Date.parse(at))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
}

test('every-row-is-drawn-in-order-with-a-fixed-label-width-and-a-dash-when-empty', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: SNAPSHOT_RUNNING })

  const lines = await paneLines($)

  expect(labelsOf(lines), `the rows, in order: ${JSON.stringify(lines)}`).toEqual(ROWS)
  for (const label of ROWS) expect(rowOf(lines, label), `${label} sits in a ${LABEL_WIDTH}-wide label column: ${JSON.stringify(lines)}`).toBeDefined()
  expect(rowOf(lines, 'STATUS'), 'STATUS says the run is working, on the active step').toBe('STATUS   ● working · write test scenarios')
  for (const label of ['PR', 'BUILT', 'TESTS', 'REVIEW']) expect(rowOf(lines, label), `${label} has nothing to show yet, so it reads a dash`).toBe(`${label.padEnd(LABEL_WIDTH)}—`)
  expect(rowOf(lines, 'LOOPING'), 'no step is looping').toBe('LOOPING  no')
  expect(lines.some(line => /^(LEFT|OFF TRACK|NOW|DONE)\b/.test(line)), 'LEFT, OFF TRACK, NOW and DONE are gone').toBe(false)
})

test('goal-leads-the-pane-from-the-task-bold-wrapped-onto-two-lines', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: SNAPSHOT_RUNNING })

  const lines = await paneLines($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = await pane.findAll({ type: 'Text' })
  await pane.unmount()

  expect(lines.slice(0, 2), `the task's first sentence leads, wrapped, never cut: ${JSON.stringify(lines)}`).toEqual([
    'GOAL     Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it',
    '         should return 90.',
  ])
  const goal = drawn.filter((node: any) => ['Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it', 'should return 90.'].includes(node.text))
  expect(goal.map((node: any) => node.props.bold), 'the goal is bold').toEqual([true, true])
})

// The pane's Texts as drawn on the terminal, in order.
async function paneNodes($: any): Promise<{ text: string; props: Record<string, unknown> }[]> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = await pane.findAll({ type: 'Text' })
  await pane.unmount()
  return drawn
}
const isRule = (node: { text: string; props: Record<string, unknown> }) => node.props.dimColor === true && /^─{3,}$/.test(node.text)

test('the-first-glance-is-goal-then-status-with-the-rule-under-them', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: SNAPSHOT_RUNNING })

  const drawn = await paneNodes($)
  const rule = drawn.findIndex(isRule)
  const labels = drawn.map(node => node.text.trim()).filter(text => ROWS.includes(text))

  expect(labels.slice(0, 2), 'GOAL then STATUS lead').toEqual(['GOAL', 'STATUS'])
  expect(drawn.findIndex(node => node.text.trim() === 'STATUS'), `STATUS sits above the rule: ${JSON.stringify(drawn.map(node => node.text))}`).toBeLessThan(rule)
  expect(drawn.findIndex(node => node.text.trim() === 'PR'), 'the details start under the rule').toBeGreaterThan(rule)
  expect(drawn.filter(isRule).length, 'one rule').toBe(1)
})

test('the-first-glance-labels-are-bold-and-the-detail-labels-dim-with-their-values-at-full-strength', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: SNAPSHOT_RUNNING })

  const drawn = await paneNodes($)
  const labelOf = (name: string) => drawn.find(node => node.text === name.padEnd(LABEL_WIDTH))!

  for (const name of ['GOAL', 'STATUS']) {
    expect(labelOf(name).props.bold, `${name} is in the first glance: bold`).toBe(true)
    expect(labelOf(name).props.dimColor, `${name} is not dim`).toBeUndefined()
  }
  for (const name of ROWS.slice(2)) expect(labelOf(name).props.dimColor, `${name} is a detail: its label is dim`).toBe(true)
  const looping = drawn[drawn.indexOf(labelOf('LOOPING')) + 1]
  expect([looping.text, looping.props.dimColor], 'a detail value stays readable, not dim').toEqual(['no', undefined])
})

// STATUS's head (its mark and state word) as drawn, and what follows it on the row.
function statusOf(drawn: { text: string; props: Record<string, unknown> }[]) {
  const at = drawn.findIndex(node => node.text === 'STATUS'.padEnd(LABEL_WIDTH))
  return { head: drawn[at + 1], rest: drawn[at + 2] }
}

test('status-working-leads-with-a-calm-mark-in-the-accent', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: SNAPSHOT_RUNNING })

  const lines = await paneLines($)
  const { head, rest } = statusOf(await paneNodes($))

  expect(rowOf(lines, 'STATUS'), 'a dot, the state, then the step').toBe('STATUS   ● working · write test scenarios')
  expect([head.text, head.props.color, head.props.bold, head.props.inverse], 'the mark and state in the accent, calm: not bold, no block').toEqual(['● working', ACCENT_COLOUR, undefined, undefined])
  expect([rest.text, rest.props.color], 'the step after it is plain').toEqual([' · write test scenarios', undefined])
})

const UNIT = '.pairingbuddy/run/unit.json'
const BUG_FIX_STEPS = ['intake', 'code-scenarios', 'code-tdd', 'code-safety-net']
const unitFile = (tasks: { stages: string[] }[] = []) => ({ unit: null, plan: null, tracer: null, branch: 'fix/order-total', base: 'main', baseSha: 'abc', tasks, commits: [] })
const stepsOf = (lines: string[]) => {
  const from = lines.findIndex(line => line.startsWith('STEPS'))
  const to = lines.findIndex(line => line.startsWith('TESTS'))
  return lines.slice(from, to).map(line => line.slice(LABEL_WIDTH))
}
const PUBLISH_RUN = {
  ...SNAPSHOT_RUNNING,
  kind: 'publish',
  taskType: 'publish',
  stage: { name: 'pr-draft', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-14T10:03:00.000Z' },
  stages: [],
}

test('in-a-unit-the-code-run-lists-its-steps-then-the-publish-step', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: SNAPSHOT_RUNNING, [UNIT]: unitFile() })

  expect(stepsOf(await paneLines($)), 'the whole unit: the bug fix steps, then the pull request').toEqual(['○ work out the task type', '▸ write test scenarios', '○ build test by test', '○ safety-net review', '○ write the pull request'])
})

test('a-spike-unit-has-no-publish-step-since-it-closes-kept-local', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: { ...SNAPSHOT_RUNNING, taskType: 'spike', stage: { ...SNAPSHOT_RUNNING.stage, name: 'code-spike-unit' } }, [UNIT]: unitFile() })

  expect(stepsOf(await paneLines($)), 'the spike steps alone').toEqual(['○ work out the task type', '▸ try one experiment', '○ write up the findings'])
})

test('the-publish-run-lists-the-unit-tasks-steps-as-done-before-the-publish-step', async ($, on) => {
  const rig = setupReplay(on)
  // The code run's tests.json is still on disk, but no code run was seen: TESTS shows only a seen code run's tests.
  await serve($, rig, { [LEDGER]: PUBLISH_RUN, [UNIT]: unitFile([{ stages: BUG_FIX_STEPS }]), '.pairingbuddy/tests.json': { tests: [{ test_id: 'order-total' }] } }, '2026-11-14T10:03:10.000Z')
  const lines = await paneLines($)

  expect(stepsOf(lines), 'the code steps stay, done').toEqual(['✓ work out the task type', '✓ write test scenarios', '✓ build test by test', '✓ safety-net review', '▸ write the pull request'])
  expect(rowOf(lines, 'STATUS'), 'STATUS names the publish step').toBe('STATUS   ● working · write the pull request')
  expect(rowOf(lines, 'TESTS'), 'with no code run seen, the publish run lists none of tests.json as to do').toBe('TESTS    —')
})

test('the-publish-run-shows-one-done-line-when-the-unit-does-not-say-its-steps', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: PUBLISH_RUN, [UNIT]: unitFile() }, '2026-11-14T10:03:10.000Z')

  expect(stepsOf(await paneLines($)), 'one done line stands for the code steps').toEqual(['✓ build the change', '▸ write the pull request'])
})

test('spent-counts-the-whole-unit-when-the-publish-run-starts', async ($, on) => {
  const rig = setupReplay(on)
  const CODE_RUN = { ...SNAPSHOT_RUNNING, runId: 'code-run', stage: { ...SNAPSHOT_RUNNING.stage, startedAt: '2026-11-14T10:00:00.000Z' } }
  await serve($, rig, { [LEDGER]: CODE_RUN, [UNIT]: unitFile() }, '2026-11-14T10:00:30.000Z')
  await $.agent.spawn({ prompt: 'p', description: 'pb1 code-scenarios - enumerate-scenarios-and-test-cases - r1', subagentType: 'pairingbuddy:enumerate-scenarios-and-test-cases', workflow: { runId: 'wf_1', agentIndex: 1 } })

  rig.served.set(`${ROOT}/${LEDGER}`, JSON.stringify({ ...PUBLISH_RUN, runId: 'publish-run' }))
  rig.served.set(`${ROOT}/${UNIT}`, JSON.stringify(unitFile([{ stages: BUG_FIX_STEPS }])))
  await rig.clock.advance(Date.parse('2026-11-14T10:03:35.000Z') - Date.parse('2026-11-14T10:00:32.000Z'))
  await $.agent.spawn({ prompt: 'p', description: 'pb1 pr-draft - draft-pull-request - r1', subagentType: 'pairingbuddy:draft-pull-request', workflow: { runId: 'wf_2', agentIndex: 1 } })

  expect(rowOf(await paneLines($), 'SPENT'), 'agents and time both count from the code run on').toBe('SPENT    2 agents · 3:35')
})

test('after-the-run-looping-and-test-read-a-dash-and-the-last-review-stays', async ($, on) => {
  const rig = setupReplay(on)
  const REVIEW = { ...SNAPSHOT_RUNNING, stage: { name: 'code-safety-net', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-14T09:59:00.000Z' } }
  await serve($, rig, { [LEDGER]: REVIEW })
  await $.agent.spawn({ prompt: 'p', description: 'pb1 code-tdd RED implement-tests t1 r2', subagentType: 'pairingbuddy:implement-tests', workflow: { runId: 'wf_1', agentIndex: 1 } })
  const lens = await $.agent.spawn({ prompt: 'p', description: 'pb1 code-safety-net - lens code r1', subagentType: 'pairingbuddy:lens', workflow: { runId: 'wf_1', agentIndex: 2 } })
  await $.tool.call({ tool: 'StructuredOutput', tool_use_id: 'tu1', pb_key: 'code-safety-net.lens.code.r1.a1', findings: [{ where: 'a.py:1', claim: 'one' }], agentId: lens.agentId })
  await rig.clock.advance(POLL_MS)

  rig.served.delete(`${ROOT}/${LEDGER}`)
  await rig.clock.advance(POLL_MS * 2)
  const lines = await paneLines($)

  expect(rowOf(lines, 'STATUS'), 'the run is over, without the sign-off').toBe('STATUS   ended · not signed off')
  expect(rowOf(lines, 'LOOPING'), 'after the run LOOPING reads a dash').toBe('LOOPING  —')
  expect(lines.some(line => /^\s+▸ .*\d:\d\d$/.test(line)), 'after the run no test is current').toBe(false)
  expect(rowOf(lines, 'REVIEW'), 'the last review round stays').toBe('REVIEW   checked: the code')
  expect(lines, 'its open finding was left as is').toContain('           left as is · one · a.py:1')
})
