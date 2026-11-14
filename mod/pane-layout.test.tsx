// Scenario pane-layout: the pane keeps one layout for the whole unit (docs/design/progress-mod/DIRECTION.md, "Fixed layout").
import { expect, test } from 'claude-code/testing'
import { paneLines, setupReplay, type Rig } from './testing/replay'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'

const ROWS = ['NOW', 'SPENT', 'LOOPING', 'STEPS', 'TESTS', 'TEST', 'REVIEW']
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
  expect(rowOf(lines, 'NOW'), 'NOW names the active step').toBe('NOW      write scenarios')
  for (const label of ['TESTS', 'TEST', 'REVIEW']) expect(rowOf(lines, label), `${label} has nothing to show yet, so it reads a dash`).toBe(`${label.padEnd(LABEL_WIDTH)}—`)
  expect(rowOf(lines, 'LOOPING'), 'no step is looping').toBe('LOOPING  no')
  expect(lines.some(line => /^(LEFT|OFF TRACK)\b/.test(line)), 'LEFT and OFF TRACK are gone').toBe(false)
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

  expect(stepsOf(await paneLines($)), 'the whole unit: the bug fix steps, then the pull request').toEqual(['○ work out the task type', '▸ write scenarios', '○ build test by test', '○ safety-net review', '○ write the pull request'])
})

test('a-spike-unit-has-no-publish-step-since-it-closes-kept-local', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: { ...SNAPSHOT_RUNNING, taskType: 'spike', stage: { ...SNAPSHOT_RUNNING.stage, name: 'code-spike-unit' } }, [UNIT]: unitFile() })

  expect(stepsOf(await paneLines($)), 'the spike steps alone').toEqual(['○ work out the task type', '▸ try one experiment', '○ write up the findings'])
})

test('the-publish-run-lists-the-unit-tasks-steps-as-done-before-the-publish-step', async ($, on) => {
  const rig = setupReplay(on)
  // The code run's tests.json is still on disk; its tests are not the publish run's to list as to do.
  await serve($, rig, { [LEDGER]: PUBLISH_RUN, [UNIT]: unitFile([{ stages: BUG_FIX_STEPS }]), '.pairingbuddy/tests.json': { tests: [{ test_id: 'order-total' }] } }, '2026-11-14T10:03:10.000Z')
  const lines = await paneLines($)

  expect(stepsOf(lines), 'the code steps stay, done').toEqual(['✓ work out the task type', '✓ write scenarios', '✓ build test by test', '✓ safety-net review', '▸ write the pull request'])
  expect(rowOf(lines, 'NOW'), 'NOW names the publish step').toBe('NOW      write the pull request')
  expect(rowOf(lines, 'TESTS'), 'the publish run has no tests of its own').toBe('TESTS    —')
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

  expect(rowOf(lines, 'NOW'), 'the run is over').toBe('NOW      last run finished')
  expect(rowOf(lines, 'LOOPING'), 'after the run LOOPING reads a dash').toBe('LOOPING  —')
  expect(rowOf(lines, 'TEST'), 'after the run no test is current').toBe('TEST     —')
  expect(rowOf(lines, 'REVIEW'), 'the last review round stays').toBe('REVIEW   the code 1')
  expect(lines, 'its open finding was left as is').toContain('           left as is · one · a.py:1')
})
