// Scenario report-of-an-ended-run: once the run's ledger is gone, 'r open report' still writes the report from the last polled ledger and opens it.
// Runs under `claude plugin test .` with recorded fs.write and process.run.
import { expect, test } from 'claude-code/testing'
import { PANE, setupReplay, type Rig } from './testing/replay'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'
import { recordReportCalls, REPORT_KEY, reportConfirmation, writtenFileName } from './testing/report'

const UNIT = '.pairingbuddy/run/unit.json'
const CHANGED = '.pairingbuddy/run/changed.json'
const TASK = 'Add order_total to cart.py. It sums the line totals.'
const unitFile = { unit: null, plan: null, tracer: null, branch: 'feat/order-total', base: 'main', baseSha: 'abc', tasks: [], commits: [] }
const done = (name: string, startedAt: string) => ({ name, status: 'done', attempt: 1, startedAt, spend: { agents: 1, tokens: 0, tokensKnown: false } })
const changed = [{ path: 'cart.py', status: 'M' }, { path: 'tests/test_cart.py', status: 'A' }]

// A finished new_feature code run: every step done, the task-end question asked over one open doubt, two commits.
const doneRun = {
  ...SNAPSHOT_RUNNING,
  taskType: 'new_feature',
  runId: 'code-run',
  task: TASK,
  stage: { name: 'code-safety-net', status: 'done', runId: null, attempt: 1, startedAt: '2026-11-14T10:02:00.000Z' },
  stages: [done('intake', '2026-11-14T10:00:00.000Z'), done('code-scenarios', '2026-11-14T10:00:10.000Z'), done('code-tdd', '2026-11-14T10:00:30.000Z'), done('code-safety-net', '2026-11-14T10:02:00.000Z')],
  gates: { 'G:task-end': { source: 'human-cli', answer: 'approve' } },
  tests: { perTest: { 'order-total-sums-lines': { red: { done: true, passed: true, exitCodes: [1] }, green: { done: true, passed: true, exitCodes: [0] } } } },
  commits: ['1111111111111111111111111111111111111111', '2222222222222222222222222222222222222222'],
  needsHuman: { gate: 'G:task-end', reason: 'open doubts', seq: 9, doubts: [{ step: 'code-scenarios', ambiguity: 'Whether a line with no quantity counts as one.' }] },
  fixes: { rollbacks: [] },
}

// The publish run that follows it: pb publish opens the pull request and removes this ledger.
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

// A workflow agent spawned under its stage label, as a live run spawns it.
const spawnLabelled = ($: any, label: string, subagentType: string) => $.agent.spawn({ prompt: 'p', description: label, subagentType, workflow: { runId: 'wf_1', agentIndex: 1 } })

async function lensReturn($: any, lens: string, findings: unknown[]) {
  const spawned = await $.agent.spawn({ prompt: 'p', description: `pb1 code-safety-net - lens ${lens} r1`, subagentType: 'pairingbuddy:lens', workflow: { runId: 'wf_1', agentIndex: 1 } })
  await $.tool.call({ tool: 'StructuredOutput', tool_use_id: `tu-${lens}`, pb_key: `code-safety-net.lens.${lens}.r1.a1`, ambiguity: null, findings, agentId: spawned.agentId })
}

test('report-of-an-ended-run-is-written-and-opened', async ($, on) => {
  const rig = setupReplay(on)
  const recorder = recordReportCalls(on)
  serve(rig, { [LEDGER]: doneRun, [UNIT]: unitFile, [CHANGED]: changed })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  // The run's agents in order: the scenarios review round, then the test's tries, then the end round.
  await spawnLabelled($, 'pb1 code-scenarios - lens necessity r1', 'pairingbuddy:lens')
  await spawnLabelled($, 'pb1 code-tdd RED implement-tests order-total-sums-lines r1', 'pairingbuddy:implement-tests')
  await spawnLabelled($, 'pb1 code-tdd RED runner order-total-sums-lines r1', 'pairingbuddy:runner')
  await spawnLabelled($, 'pb1 code-tdd GREEN implement-code order-total-sums-lines r1', 'pairingbuddy:implement-code')
  await spawnLabelled($, 'pb1 code-tdd GREEN runner order-total-sums-lines r2', 'pairingbuddy:runner')
  await lensReturn($, 'code', [{ rule: '', severity: 'low', kind: 'drift', title: 'Name says total, sums subtotals', claim: 'order_total sums subtotals.', where: 'cart.py:3' }])
  await rig.clock.advance(POLL_MS * 2)
  serve(rig, { [LEDGER]: publishRun, [UNIT]: unitFile, [CHANGED]: changed })
  await rig.clock.advance(POLL_MS * 2)
  rig.toolResults.set('Bash', { stdout: '{"ok":true,"result":"published","url":"https://github.com/o/r/pull/7","warnings":[]}\n', stderr: '' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-publish', command: 'node /plugin/cli/pb.mjs publish' })
  serve(rig, { [CHANGED]: changed, '.pairingbuddy/run/corpus.json': '{}', '.pairingbuddy/run/subject.diff': '' })
  await rig.clock.advance(POLL_MS * 2)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  const drawn = (await pane.findAll({ type: 'Text' })).map((node: any) => node.text as string)
  await pane.unmount()

  const fileName = writtenFileName(recorder.writes, `the ended run's report is written; the pane drew ${JSON.stringify(drawn)}`)
  expect(drawn, 'the pane confirms the report was written and opened').toContain(reportConfirmation(fileName))
})

// An agent's turn ends as the engine raises it, with how long the turn took.
const finish = ($: any, agentId: string, seconds: number) => $.turn.complete({ answer: '', durationMs: seconds * 1000, isAborted: false, turnId: `turn-${agentId}`, agentId, reason: 'answer' })

test('report-times-each-try-from-its-agents-turns', async ($, on) => {
  const rig = setupReplay(on)
  const recorder = recordReportCalls(on)
  serve(rig, { [LEDGER]: doneRun, [UNIT]: unitFile, [CHANGED]: changed })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  const writer = await spawnLabelled($, 'pb1 code-tdd RED implement-tests order-total-sums-lines r1', 'pairingbuddy:implement-tests')
  await finish($, writer.agentId, 41)
  const runner = await spawnLabelled($, 'pb1 code-tdd RED runner order-total-sums-lines r1', 'pairingbuddy:runner')
  await finish($, runner.agentId, 7)
  await rig.clock.advance(POLL_MS * 2)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  await pane.unmount()

  const html = recorder.writes[0]?.text ?? ''
  expect(html, 'the RED try is timed from its writer and runner turns, with its result').toContain('<td>RED</td><td>1</td><td>0:48</td><td>0:41</td><td>0:07</td><td>failed, as it should (exit 1)</td>')
})

// What pb kept of the two runs when each ended (keepRun in shared-node/unit-files.mjs): ledger, returns and kept.json.
const KEPT = '.pairingbuddy/reports/runs'
const UNIT_KEY = `${unitFile.branch} ${unitFile.baseSha}`
const SCENARIOS_KEY = 'code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1'
const NET_KEY = 'code-safety-net.lens.code.r1.a1'
const keptCodeRun = { ...doneRun, needsHuman: null, gates: { 'G:task-end': { source: 'human-cli', answer: 'approve', doubts: doneRun.needsHuman.doubts } } }
const keptPublishRun = { ...publishRun, stage: { ...publishRun.stage, status: 'done' }, stages: [{ ...publishRun.stage, status: 'done' }], gates: { 'G:publish': { source: 'human', answer: 'approve' } } }
const keptFiles = {
  [`${KEPT}/code-run/kept.json`]: { unit: UNIT_KEY, endedAt: '2026-11-14T10:04:00.000Z' },
  [`${KEPT}/code-run/ledger.json`]: keptCodeRun,
  [`${KEPT}/code-run/artifacts/${SCENARIOS_KEY}.json`]: { pb_key: SCENARIOS_KEY, ambiguity: null, scenarios: [{ description: 'Two lines sum their totals', test_cases: [{ description: 'order_total of two lines is 30.0' }] }] },
  [`${KEPT}/code-run/artifacts/${NET_KEY}.json`]: { pb_key: NET_KEY, ambiguity: null, findings: [{ rule: '', severity: 'low', kind: 'drift', title: 'Empty order sums to int', claim: 'An empty order returns 0.', where: 'cart.py:3' }] },
  [`${KEPT}/publish-run/kept.json`]: { unit: UNIT_KEY, endedAt: '2026-11-14T10:14:00.000Z', prUrl: 'https://github.com/o/r/pull/7' },
  [`${KEPT}/publish-run/ledger.json`]: keptPublishRun,
}

test('report-of-an-ended-task-describes-both-runs', async ($, on) => {
  const rig = setupReplay(on)
  const recorder = recordReportCalls(on)
  serve(rig, { [LEDGER]: doneRun, [UNIT]: unitFile, [CHANGED]: changed })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await spawnLabelled($, 'pb1 code-tdd RED implement-tests order-total-sums-lines r1', 'pairingbuddy:implement-tests')
  await rig.clock.advance(POLL_MS * 2)
  serve(rig, { [LEDGER]: publishRun, [UNIT]: unitFile, [CHANGED]: changed })
  await rig.clock.advance(POLL_MS * 2)
  // Both runs have ended: their ledgers are gone and only what pb kept of them is left.
  serve(rig, { [CHANGED]: changed, ...keptFiles })
  await rig.clock.advance(POLL_MS * 2)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  await pane.unmount()

  const [written] = recorder.writes
  const html = written?.text ?? ''
  expect(html, 'the task type is the code run\'s').toContain('new feature')
  expect(html, 'the code run\'s steps are there').toContain('build test by test')
  expect(html, 'the publish run\'s step too').toContain('write the pull request')
  expect(html, 'the code run\'s scenarios, from its kept returns').toContain('Two lines sum their totals')
  expect(html, 'the safety-net review, from its kept returns').toContain('Empty order sums to int')
  expect(html, 'the doubt the task was approved past').toContain('Whether a line with no quantity counts as one.')
  expect(html, 'the next action is the pull request').toContain('Review pull request #7: https://github.com/o/r/pull/7')
  expect(html.includes('unknown type'), 'the type is known').toBe(false)
})

test('pb-report after the task ended writes the whole task from the kept runs and names its path', async ($, on) => {
  const rig = setupReplay(on)
  const recorder = recordReportCalls(on)
  serve(rig, { [LEDGER]: doneRun, [UNIT]: unitFile, [CHANGED]: changed })
  await rig.clock.set(Date.parse('2026-11-14T10:02:30.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  serve(rig, { [LEDGER]: publishRun, [UNIT]: unitFile, [CHANGED]: changed })
  await rig.clock.advance(POLL_MS * 2)
  serve(rig, { [CHANGED]: changed, ...keptFiles })
  await rig.clock.advance(POLL_MS * 2)

  const result: any = await $.command.run({ command: 'pb-report', args: '' })

  const [written] = recorder.writes
  expect(written?.text ?? '', 'the report holds both kept runs').toContain('write the pull request')
  expect(written.text, 'including the code run').toContain('build test by test')
  expect(result?.text, 'the answer names the report by its absolute path').toContain(written.path)
})
