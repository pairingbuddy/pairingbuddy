// Scenario end-state: once the unit's work is finished the pane leads with DONE, GOAL and PR, built from what the run recorded
// (docs/design/progress-mod/DIRECTION.md, "The end state answers ..."). The rows are always drawn; before the end they read a dash.
import { expect, test } from 'claude-code/testing'
import { PANE, paneLines, setupReplay, type Rig } from './testing/replay'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, bandTexts, start } from './testing/band'
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

test('published-reads-a-pretty-printed-publish-before-the-exit-line', () => {
  const printed = JSON.stringify({ ok: true, result: 'published', url: 'https://github.com/o/r/pull/8', warnings: ['the plan has no PR: line'], pendingComment: { body: 'x' } }, null, 2)
  const ran = { result: { stdout: `pushing...\n${printed}\nexit=0\n`, stderr: '' } }

  expect(publishedOf('node "/p/cli/pb.mjs" publish; echo "exit=$?"', ran)).toEqual({ result: 'published', url: 'https://github.com/o/r/pull/8' })
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

test('goal-leads-and-the-end-rows-read-a-dash-until-the-task-is-done', async ($, on) => {
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: codeRun({}, 'active'), [UNIT]: unitFile })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  const lines = await paneLines($)

  expect(lines.slice(0, 4), `the goal leads, then STATUS, PR and BUILT: ${JSON.stringify(lines)}`).toEqual(['GOAL     Add order_total to cart.py.', 'STATUS   ● working · safety-net review', 'PR       —', 'BUILT    —'])
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
  expect(signedOff.slice(0, 4), `after the task-end gate: ${JSON.stringify(signedOff)}`).toEqual([
    'GOAL     Add order_total to cart.py.',
    'STATUS   ● working · next: write the pull request',
    'PR       —',
    'BUILT    cart.py, tests/test_cart.py · 1 test passing',
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
    'GOAL     Add order_total to cart.py.',
    'STATUS   ● working · write the pull request',
    'PR       —',
    'BUILT    cart.py, tests/test_cart.py · 1 test passing',
  ])

  // pb publish opens the pull request and closes the unit: the ledger and unit.json go.
  rig.toolResults.set('Bash', { stdout: '{"ok":true,"result":"published","url":"https://github.com/o/r/pull/7","warnings":[]}\n', stderr: '' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-publish', command: 'node /plugin/cli/pb.mjs publish' })
  serve(rig, { [CHANGED]: [{ path: 'cart.py', status: 'M' }, { path: 'tests/test_cart.py', status: 'A' }] })
  await rig.clock.advance(POLL_MS * 2)
  const published = await paneLines($)
  expect(published.slice(0, 4), `after the publish: ${JSON.stringify(published)}`).toEqual([
    'GOAL     Add order_total to cart.py.',
    'STATUS   ✓ DONE · goal met · PR #7 opened · ready for your next task',
    'PR       opened · #7 feat: add order_total',
    'BUILT    cart.py, tests/test_cart.py · 1 test passing',
  ])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const head = (await pane.findAll({ type: 'Text' })).find((node: any) => node.text === '✓ DONE')
  await pane.unmount()
  expect([head?.props.bold, head?.props.color, head?.props.inverse], 'done is bold and uncoloured: a call to action, not an alarm').toEqual([true, undefined, undefined])
  expect(rowOf(published, 'REVIEW'), 'the end review is the work\'s, not the pull request draft\'s').toBe('REVIEW   review: 1 issue, all left as is')
})

test('goal-row-wraps-onto-two-lines-and-only-past-them-cuts-at-a-clause', async ($, on) => {
  const rig = setupReplay(on)
  const task = 'Add order_total to cart.py so it sums price times quantity over every line, so the checkout can show one total. Then document it.'
  serve(rig, { [LEDGER]: { ...codeRun({ 'G:task-end': { source: 'human-cli', answer: 'approve' } }), task }, [UNIT]: unitFile })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await lensReturn($, 'corpus-misalignment', [])
  await rig.clock.advance(POLL_MS * 2)

  const wide = await paneLines($, { bodyColumns: 100 })
  const narrow = await paneLines($, { bodyColumns: 60 })

  expect(wide.slice(0, 2), 'two lines hold the whole first sentence').toEqual([
    'GOAL     Add order_total to cart.py so it sums price times quantity over every line, so the checkout',
    '         can show one total.',
  ])
  expect(narrow.slice(0, 2), 'past two lines, the second is cut at the clause that fits').toEqual([
    'GOAL     Add order_total to cart.py so it sums price times',
    '         quantity over every line',
  ])
})

test('tests-row-keeps-the-code-runs-tests-through-the-publish', async ($, on) => {
  const rig = setupReplay(on)
  const perTest = Object.fromEntries(['t1', 't2', 't3', 't4', 't5'].map(id => [id, { red: { done: true }, green: { passed: true, done: true } }]))
  const signedOffRun = { ...codeRun({ 'G:task-end': { source: 'human-cli', answer: 'approve' } }), tests: { perTest } }
  serve(rig, { [LEDGER]: signedOffRun, [UNIT]: unitFile })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  const atCodeEnd = rowOf(await paneLines($), 'TESTS')
  expect(atCodeEnd, 'the build is over, so every test it ran is the total: a settled count').toBe('TESTS    ✓ 5 of 5 passing')

  serve(rig, { [LEDGER]: publishRun, [UNIT]: unitFile })
  await rig.clock.advance(POLL_MS * 2)
  expect(rowOf(await paneLines($), 'TESTS'), 'while the publish run drafts the pull request').toBe(atCodeEnd)

  serve(rig, {})
  await rig.clock.advance(POLL_MS * 2)
  expect(rowOf(await paneLines($), 'TESTS'), 'once the publish run is over').toBe(atCodeEnd)
})

const PLAN = 'docs/plans/cart.md'
const planText = (humanBox: ' ' | 'x') => [
  '# Cart', '', '## T1: Order total', '',
  '- [x] **Task 1: Add order_total**', '', '**Goal:** Sum the lines.', '',
  `- [${humanBox}] **Task 2: [HUMAN] Try the checkout**`, '', '**Goal:** Judge it by hand.', '',
  '## T2: Tax', '', '- [ ] **Task 3: [HUMAN] Ask about tax**', '',
].join('\n')
const planUnit = { ...unitFile, unit: 'T1: Order total', plan: PLAN, tracer: 'T1: Order total' }

// Live Task 107 run: the code run ended with the plan's next task a [HUMAN] one, and STATUS read
// "between runs · next: write the pull request", though pb publishes nothing until a person ticks that task.
test('between runs, a person-only task left in the unit is next, not the pull request', async ($, on) => {
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: codeRun({ 'G:task-end': { source: 'human-cli', answer: 'approve' } }), [UNIT]: planUnit, [PLAN]: planText(' ') })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await lensReturn($, 'corpus-misalignment', [])
  await rig.clock.advance(POLL_MS * 2)
  // pb task end removes the code run's ledger; the unit stays open.
  serve(rig, { [UNIT]: planUnit, [PLAN]: planText(' ') })
  await rig.clock.advance(POLL_MS * 2)

  expect(rowOf(await paneLines($), 'STATUS')).toBe('STATUS   ○ between runs · next: you do Task 2 and tick its box')
})

test('once every step is done, a person-only task left in the unit is next, not the pull request', async ($, on) => {
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: codeRun({ 'G:task-end': { source: 'human-cli', answer: 'approve' } }), [UNIT]: planUnit, [PLAN]: planText(' ') })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await lensReturn($, 'corpus-misalignment', [])
  await rig.clock.advance(POLL_MS * 2)

  expect(rowOf(await paneLines($), 'STATUS')).toBe('STATUS   ● working · next: you do Task 2 and tick its box')
})

test('a plan the unit record names outside the repo is never read', async ($, on) => {
  const rig = setupReplay(on)
  const outside = { ...planUnit, plan: '../elsewhere/cart.md' }
  serve(rig, { [LEDGER]: codeRun({ 'G:task-end': { source: 'human-cli', answer: 'approve' } }), [UNIT]: outside })
  // The engine resolves the ".." before the read reaches the file.
  const resolved = `${ROOT.slice(0, ROOT.lastIndexOf('/'))}/elsewhere/cart.md`
  rig.served.set(resolved, planText(' '))
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await lensReturn($, 'corpus-misalignment', [])
  await rig.clock.advance(POLL_MS * 2)

  expect(rig.reads.has(resolved), 'the plan outside the repo is not read').toBe(false)
  expect(rowOf(await paneLines($), 'STATUS')).toBe('STATUS   ● working · next: write the pull request')
})

test('once a person ticks the unit\'s last [HUMAN] task, the pull request is next', async ($, on) => {
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: codeRun({ 'G:task-end': { source: 'human-cli', answer: 'approve' } }), [UNIT]: planUnit, [PLAN]: planText('x') })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await lensReturn($, 'corpus-misalignment', [])
  await rig.clock.advance(POLL_MS * 2)

  expect(rowOf(await paneLines($), 'STATUS'), "another unit's [HUMAN] task is not this unit's").toBe('STATUS   ● working · next: write the pull request')
})

// Scenario S6 frame 04: once unit A's PR opened, STATUS read "ready for your next task" while unit B was still to do in the
// plan. With a unit left in the plan, STATUS names it as what comes next.
const TWO_UNITS = [
  '# Cart', '', '## Tasks', '', '### T1: Cart', '',
  '#### PR: Order total', '', '- [x] **Task 1: Add order_total**', '',
  '#### PR: Tax', '', '- [ ] **Task 2: Add tax**', '',
].join('\n')

test('done with a unit left in the plan, STATUS names that unit as next', async ($, on) => {
  const rig = setupReplay(on)
  const signedOff = { ...codeRun({ 'G:task-end': { source: 'human-cli', answer: 'approve' } }), plan: { path: PLAN, title: 'Task 1: Add order_total' } }
  serve(rig, { [LEDGER]: signedOff, [UNIT]: { ...planUnit, unit: 'Order total', tracer: 'T1: Cart' }, [PLAN]: TWO_UNITS })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await lensReturn($, 'corpus-misalignment', [])
  await rig.clock.advance(POLL_MS * 2)
  // pb publish opens the pull request and closes the unit; the code run is kept, naming the plan.
  rig.toolResults.set('Bash', { stdout: '{"ok":true,"result":"published","url":"https://github.com/o/r/pull/7","warnings":[]}\n', stderr: '' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-publish', command: 'node /plugin/cli/pb.mjs publish' })
  const kept = '.pairingbuddy/reports/runs/code-run'
  serve(rig, { [PLAN]: TWO_UNITS, [`${kept}/ledger.json`]: signedOff, [`${kept}/kept.json`]: { unit: 'feat/order-total abc', endedAt: '2026-11-14T10:02:31.000Z' } })
  await rig.clock.advance(POLL_MS * 2)

  expect(rowOf(await paneLines($), 'STATUS')).toBe('STATUS   ✓ DONE · PR #7 opened · next in the plan: Tax')
})

// Scenario S6 frame 04: the band's done line and the done notice still read "ready for your next task" while STATUS named
// unit B. They name the plan's next unit too.
test('done with a unit left in the plan, the band and the done notice name that unit as next', async ($, on) => {
  const rig = setupReplay(on)
  const notices: string[] = []
  on('ui.notify', (_: unknown, e: { text: string }) => { notices.push(e.text); return { value: undefined } })
  const signedOff = { ...codeRun({ 'G:task-end': { source: 'human-cli', answer: 'approve' } }), plan: { path: PLAN, title: 'Task 1: Add order_total' } }
  serve(rig, { [LEDGER]: signedOff, [UNIT]: { ...planUnit, unit: 'Order total', tracer: 'T1: Cart' }, [PLAN]: TWO_UNITS })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await lensReturn($, 'corpus-misalignment', [])
  await rig.clock.advance(POLL_MS * 2)
  rig.toolResults.set('Bash', { stdout: '{"ok":true,"result":"published","url":"https://github.com/o/r/pull/7","warnings":[]}\n', stderr: '' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-publish', command: 'node /plugin/cli/pb.mjs publish' })
  const kept = '.pairingbuddy/reports/runs/code-run'
  serve(rig, { [PLAN]: TWO_UNITS, [`${kept}/ledger.json`]: signedOff, [`${kept}/kept.json`]: { unit: 'feat/order-total abc', endedAt: '2026-11-14T10:02:31.000Z' } })
  await rig.clock.advance(POLL_MS * 2)

  expect((await bandTexts($, { bodyColumns: 120 })).join(''), 'the band names the next unit').toContain('✓ DONE · next in the plan: Tax')
  // This rig keeps no store, so the once-per-run record does not hold: only the wording is checked here.
  expect([...new Set(notices)], 'the done notice names it too').toEqual(['done · next in the plan: Tax'])
})
