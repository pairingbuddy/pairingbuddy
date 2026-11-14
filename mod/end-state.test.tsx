// Scenario end-state: once the unit's work is finished the pane leads with DONE, GOAL and PR, built from what the run recorded
// (docs/design/progress-mod/DIRECTION.md, "The end state answers ..."). The rows are always drawn; before the end they read a dash.
import { expect, test } from 'claude-code/testing'
import { paneLines, setupReplay, type Rig } from './testing/replay'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'
import { publishedOf } from './published'

test('published-reads-only-what-pb-publish-printed', () => {
  const ran = (stdout: string) => ({ result: { stdout, stderr: '' } })
  const opened = ran('pushing...\n{"ok":true,"result":"published","url":"https://github.com/o/r/pull/7","warnings":[]}\n')

  expect(publishedOf('node "/p/cli/pb.mjs" publish', opened), 'a publish names the pull request it opened').toEqual({ result: 'published', url: 'https://github.com/o/r/pull/7' })
  expect(publishedOf('pb publish', ran('{"ok":true,"result":"kept-local","reason":"spike"}')), 'a publish that opened nothing says why').toEqual({ result: 'kept-local' })
  expect(publishedOf('pb pr lint', opened), 'any other pb command is not a publish').toBeNull()
  expect(publishedOf('echo pb publish-notes', opened), 'a word that only starts with publish is not one').toBeNull()
  expect(publishedOf('pb publish', ran('pb: not published: the PR could not be checked')), 'a refusal records nothing').toBeNull()
  expect(publishedOf('pb publish', { deny: 'no' }), 'a denied call records nothing').toBeNull()
})

const LABEL_WIDTH = 9
const rowOf = (lines: string[], label: string) => lines.find(line => line.startsWith(label.padEnd(LABEL_WIDTH)))
const UNIT = '.pairingbuddy/run/unit.json'
const CHANGED = '.pairingbuddy/run/changed.json'
const TASK = 'Add order_total to cart.py. It sums the line totals.'
const SAFETY_NET_START = '2026-11-14T10:02:00.000Z'
const unitFile = { unit: null, plan: null, tracer: null, branch: 'feat/order-total', base: 'main', baseSha: 'abc', tasks: [], commits: [] }
const done = (name: string, startedAt: string) => ({ name, status: 'done', attempt: 1, startedAt, spend: { agents: 1, tokens: 0, tokensKnown: false } })
const codeRun = (gates: Record<string, unknown>, status = 'done') => ({
  ...SNAPSHOT_RUNNING,
  kind: 'code',
  taskType: 'new_feature',
  runId: 'code-run',
  task: TASK,
  stage: { name: 'code-safety-net', status, runId: null, attempt: 1, startedAt: SAFETY_NET_START },
  stages: [done('intake', '2026-11-14T10:00:00.000Z'), done('code-scenarios', '2026-11-14T10:00:10.000Z'), done('code-tdd', '2026-11-14T10:00:30.000Z'), ...(status === 'done' ? [done('code-safety-net', SAFETY_NET_START)] : [])],
  gates,
  tests: { perTest: { 'order-total-sums-lines': { green: { passed: true } } } },
  fixes: { rollbacks: [] },
})
const publishRun = {
  ...SNAPSHOT_RUNNING,
  kind: 'publish',
  taskType: 'publish',
  runId: 'publish-run',
  task: TASK,
  stage: { name: 'pr-draft', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-14T10:05:00.000Z' },
  stages: [],
  gates: {},
}

function serve(rig: Rig, files: Record<string, unknown>) {
  rig.served.clear()
  for (const [path, value] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, typeof value === 'string' ? value : JSON.stringify(value))
}

async function lensReturn($: any, lens: string, findings: unknown[]) {
  const spawned = await $.agent.spawn({ prompt: 'p', description: `pb1 code-safety-net - lens ${lens} r1`, subagentType: 'pairingbuddy:lens', workflow: { runId: 'wf_1', agentIndex: 1 } })
  await $.tool.call({ tool: 'StructuredOutput', tool_use_id: `tu-${lens}`, pb_key: `code-safety-net.lens.${lens}.r1.a1`, ambiguity: null, findings, agentId: spawned.agentId })
}

test('end-rows-are-drawn-first-and-read-a-dash-until-the-task-is-done', async ($, on) => {
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: codeRun({}, 'active'), [UNIT]: unitFile })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  const lines = await paneLines($)

  expect(lines.slice(0, 4), `the end rows lead, then NOW: ${JSON.stringify(lines)}`).toEqual(['DONE     —', 'GOAL     —', 'PR       —', 'NOW      safety-net review'])
})

test('end-state-from-the-code-runs-end-through-the-publish', async ($, on) => {
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: codeRun({ 'G:task-end': { source: 'human-cli', answer: 'approve' } }), [UNIT]: unitFile, [CHANGED]: [{ path: 'cart.py', status: 'M' }, { path: 'tests/test_cart.py', status: 'A' }] })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await lensReturn($, 'code', [{ rule: '', severity: 'low', kind: 'drift', title: 'Name says total, sums subtotals', claim: 'order_total sums subtotals. The name suggests tax is in.', where: 'cart.py:3' }])
  await lensReturn($, 'corpus-misalignment', [])
  await rig.clock.advance(POLL_MS * 2)

  // The code run is over and the task is signed off; nothing is published yet.
  const signedOff = await paneLines($)
  expect(signedOff.slice(0, 3), `after the task-end gate: ${JSON.stringify(signedOff)}`).toEqual([
    'DONE     cart.py, tests/test_cart.py · 1 test passing',
    'GOAL     met · Add order_total to cart.py.',
    'PR       —',
  ])
  const review = signedOff.slice(signedOff.findIndex(line => line.startsWith('REVIEW')))
  expect(review.slice(0, 2), `the review is one summary line, then the titles: ${JSON.stringify(signedOff)}`).toEqual(['REVIEW   review: 1 issue, all left as is', '           left as is · Name says total, sums subtotals · cart.py:3'])

  // The publish run drafts the pull request: the end rows stay.
  serve(rig, { [LEDGER]: publishRun, [UNIT]: unitFile, [CHANGED]: [{ path: 'cart.py', status: 'M' }, { path: 'tests/test_cart.py', status: 'A' }] })
  await rig.clock.advance(Date.parse('2026-11-14T10:05:10.000Z') - Date.parse('2026-11-14T10:02:32.000Z'))
  const draft = await $.agent.spawn({ prompt: 'p', description: 'pb1 pr-draft - draft-pull-request - r1', subagentType: 'pairingbuddy:draft-pull-request', workflow: { runId: 'wf_2', agentIndex: 1 } })
  await $.tool.call({ tool: 'StructuredOutput', tool_use_id: 'tu-draft', pb_key: 'pr-draft.draft-pull-request.-.r1.a1', title: 'feat: add order_total', body: 'b', agentId: draft.agentId })
  await rig.clock.advance(POLL_MS)
  const drafting = await paneLines($)
  expect(drafting.slice(0, 4), `while the pull request is drafted: ${JSON.stringify(drafting)}`).toEqual([
    'DONE     cart.py, tests/test_cart.py · 1 test passing',
    'GOAL     met · Add order_total to cart.py.',
    'PR       —',
    'NOW      write the pull request',
  ])

  // pb publish opens the pull request and closes the unit: the ledger and unit.json go.
  rig.toolResults.set('Bash', { stdout: '{"ok":true,"result":"published","url":"https://github.com/o/r/pull/7","warnings":[]}\n', stderr: '' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-publish', command: 'node /plugin/cli/pb.mjs publish' })
  serve(rig, { [CHANGED]: [{ path: 'cart.py', status: 'M' }, { path: 'tests/test_cart.py', status: 'A' }] })
  await rig.clock.advance(POLL_MS * 2)
  const published = await paneLines($)
  expect(published.slice(0, 3), `after the publish: ${JSON.stringify(published)}`).toEqual([
    'DONE     cart.py, tests/test_cart.py · 1 test passing',
    'GOAL     met · Add order_total to cart.py.',
    'PR       opened · #7 feat: add order_total',
  ])
  expect(rowOf(published, 'REVIEW'), 'the end review is the work\'s, not the pull request draft\'s').toBe('REVIEW   review: 1 issue, all left as is')
})
