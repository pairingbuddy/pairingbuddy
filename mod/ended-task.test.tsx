// Scenario ended-task-reads-its-kept-runs: once a task has ended, the pane takes SPENT and REVIEW from the runs pb kept of
// it, not from the session's memory of agents and returns, which a reload empties. Replays a watched run: its build, then
// its publish run, then the mod reloaded with no agent seen. Runs under `claude plugin test .`.
import { expect, test } from 'claude-code/testing'
import { PANE, paneLines, setupReplay, type Rig } from './testing/replay'
import { LEDGER, ROOT, start } from './testing/band'
import { POLL_MS } from './poll'
import { CHANGED, CODE_RUN, KEPT_FILES, PUBLISH_RUN, UNIT_FILE } from './fixtures/ended-task'

const UNIT = '.pairingbuddy/run/unit.json'
const CHANGED_PATH = '.pairingbuddy/run/changed.json'

function serve(rig: Rig, files: Record<string, unknown>) {
  rig.served.clear()
  for (const [path, value] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, typeof value === 'string' ? value : JSON.stringify(value))
}

// The build ends, the publish run follows, and pb publish ends it: only what pb kept is left. No agent is seen this session.
async function endTheTask($: any, rig: Rig) {
  serve(rig, { [LEDGER]: CODE_RUN, [UNIT]: UNIT_FILE, [CHANGED_PATH]: CHANGED })
  // The clock is set near the publish run's end: the four hours between are not ticked through.
  await rig.clock.set(Date.parse('2026-11-16T19:43:50.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  serve(rig, { [LEDGER]: PUBLISH_RUN, [UNIT]: UNIT_FILE, [CHANGED_PATH]: CHANGED, ...KEPT_FILES })
  await rig.clock.advance(POLL_MS * 2)
  serve(rig, { [CHANGED_PATH]: CHANGED, ...KEPT_FILES })
  await rig.clock.advance(POLL_MS * 2)
}

const row = (lines: string[], label: string) => lines.find(line => line.startsWith(label))

test('ended-task-spent-counts-the-agents-its-runs-recorded', async ($, on) => {
  const rig = setupReplay(on)
  await endTheTask($, rig)

  const spent = row(await paneLines($), 'SPENT')

  expect(spent, 'the build\'s 32 agents and the publish run\'s 9, and both runs\' tokens').toMatch(/^SPENT\s+41 agents · \S+ · 39856 output tokens$/)
})

test('ended-task-review-is-the-safety-net-round-its-runs-kept', async ($, on) => {
  const rig = setupReplay(on)
  await endTheTask($, rig)

  const lines = await paneLines($)
  const review = lines.slice(lines.findIndex(line => line.startsWith('REVIEW')))

  expect(review[0], 'the safety-net review found one issue, left as is').toBe('REVIEW   review: 1 issue, all left as is')
  expect(review[1], 'named by its gist').toContain('left as is · Float sum of cent-rounded totals may drift')
})

test('ended-task-status-reads-the-goal-verdict-its-runs-kept', async ($, on) => {
  const rig = setupReplay(on)
  await endTheTask($, rig)

  const status = row(await paneLines($), 'STATUS')

  expect(status, 'the goal lens (docs and plan) returned with nothing open').toBe('STATUS   ✓ DONE · goal met · PR #7 opened · ready for your next task')
})

// The poll runs every second; a run pb kept never changes once its kept.json is written, so it is read once.
test('ended-task-kept-runs-are-read-once', async ($, on) => {
  const rig = setupReplay(on)
  await endTheTask($, rig)
  const ledgerPath = [...rig.served.keys()].find(path => path.endsWith(`${CODE_RUN.runId}/ledger.json`))!
  const before = rig.reads.get(ledgerPath)

  await rig.clock.advance(POLL_MS * 5)

  expect(before, 'the kept code run was read').toBeGreaterThan(0)
  expect(rig.reads.get(ledgerPath), 'and not again on later polls').toBe(before)
})

// The publish question waited four hours on the human; that wait is no working time, so SPENT leaves it out.
test('ended-task-spent-leaves-out-the-time-its-questions-waited', async ($, on) => {
  const rig = setupReplay(on)
  const publishLedger = `.pairingbuddy/reports/runs/${PUBLISH_RUN.runId}/ledger.json`
  const waited = { ...PUBLISH_RUN, gates: { 'G:publish': { ...PUBLISH_RUN.gates['G:publish'], askedAt: '2026-11-16T15:42:30.000Z', answeredAt: '2026-11-16T19:43:50.000Z' } } }
  serve(rig, { [LEDGER]: CODE_RUN, [UNIT]: UNIT_FILE, [CHANGED_PATH]: CHANGED })
  await rig.clock.set(Date.parse('2026-11-16T19:43:50.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  serve(rig, { [CHANGED_PATH]: CHANGED, ...KEPT_FILES, [publishLedger]: waited })
  await rig.clock.advance(POLL_MS * 2)

  const spent = row(await paneLines($), 'SPENT')

  expect(spent, 'the task\'s 4:26:07 less the 4:01:20 the publish question waited').toMatch(/^SPENT\s+41 agents · 24:47 · 39856 output tokens$/)
})

// A reload while the publish run is live empties the session's agents; the code run pb kept still counts toward SPENT.
test('live-publish-run-spent-counts-the-kept-code-run-after-a-reload', async ($, on) => {
  const rig = setupReplay(on)
  const live = { ...PUBLISH_RUN, stage: { ...PUBLISH_RUN.stage, status: 'active' }, stages: [], spend: { agents: 0, tokens: 0, tokensKnown: true } }
  const codeRunKept = Object.fromEntries(Object.entries(KEPT_FILES).filter(([path]) => path.includes(CODE_RUN.runId)))
  serve(rig, { [LEDGER]: live, [UNIT]: UNIT_FILE, [CHANGED_PATH]: CHANGED, ...codeRunKept })
  await rig.clock.set(Date.parse('2026-11-16T15:43:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  const spent = row(await paneLines($), 'SPENT')

  expect(spent, 'the code run\'s 32 agents, with none seen this session').toMatch(/^SPENT\s+32 agents · /)
})

// Scenario S6 unit A: the code run ended in an earlier session, and this session starts at the publish run, whose ledger
// names no task. The code run pb kept stands in for the one the session never saw, so the goal and the end state read as
// they do for a unit whose code run the session watched.
test('a session that starts at the publish run reads the code run pb kept: its goal, then done with its PR', async ($, on) => {
  const rig = setupReplay(on)
  const live = { ...PUBLISH_RUN, task: '', stage: { ...PUBLISH_RUN.stage, status: 'active' }, stages: [], spend: { agents: 0, tokens: 0, tokensKnown: true } }
  const codeRunKept = Object.fromEntries(Object.entries(KEPT_FILES).filter(([path]) => path.includes(CODE_RUN.runId)))
  serve(rig, { [LEDGER]: live, [UNIT]: UNIT_FILE, [CHANGED_PATH]: CHANGED, ...codeRunKept })
  await rig.clock.set(Date.parse('2026-11-16T15:43:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  const goal = row(await paneLines($), 'GOAL')
  // pb publish opens the PR and keeps the publish run; the unit closes.
  serve(rig, { [CHANGED_PATH]: CHANGED, ...KEPT_FILES })
  await rig.clock.advance(POLL_MS * 2)
  const lines = await paneLines($)

  expect(goal, 'the kept code run\'s task, while the publish run drafts').toMatch(/^GOAL\s+Add order_total\(lines\) to cart\.py/)
  expect(row(lines, 'STATUS'), 'signed off and published').toMatch(/^STATUS\s+✓ DONE · .*PR #7 opened/)
  expect(row(lines, 'PR'), 'the PR the publish opened').toMatch(/^PR\s+opened · #7/)
})

// Scenario S6 with the mod's state kept across sessions: a publish whose code run the pane never knew opened PR #1, and the
// next unit's code run is signed off. The PR row is the next unit's, not unit A's number under unit B's title.
test('a PR opened for a code run the pane did not know is not the next unit\'s PR', async ($, on) => {
  const rig = setupReplay(on)
  const unitA = { ...UNIT_FILE, branch: 'fix/a', baseSha: 'aaaaaaa' }
  const publishingA = { ...PUBLISH_RUN, runId: 'publish-a', task: '', stage: { ...PUBLISH_RUN.stage, status: 'active' }, stages: [] }
  serve(rig, { [LEDGER]: publishingA, [UNIT]: unitA })
  await rig.clock.set(Date.parse('2026-11-16T15:43:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  rig.toolResults.set('Bash', { stdout: '{"result":"opened","url":"https://github.com/example/repo/pull/1"}', stderr: '', exitCode: 0 })
  await $.tool.call({ tool: 'Bash', command: '.pairingbuddy/bin/pb publish' })
  await rig.clock.advance(POLL_MS * 2)
  // Unit B opens, and its code run is signed off.
  serve(rig, { [LEDGER]: CODE_RUN, [UNIT]: UNIT_FILE, [CHANGED_PATH]: CHANGED })
  await rig.clock.advance(POLL_MS * 2)

  expect(row(await paneLines($), 'PR'), 'unit B has opened no PR yet').toBe('PR       —')
})

// Scenario S6 unit A, SPENT while the publish run drafts: the agents already count the kept code run, so the time and the
// tokens count it too. One scope, the whole task: from the code run's start, with both runs' tokens.
test('live-publish-run-spent-counts-the-kept-code-run-time-and-tokens-too', async ($, on) => {
  const rig = setupReplay(on)
  const live = { ...PUBLISH_RUN, stage: { ...PUBLISH_RUN.stage, status: 'active' }, stages: [], spend: { agents: 0, tokens: 0, tokensKnown: true } }
  const codeRunKept = Object.fromEntries(Object.entries(KEPT_FILES).filter(([path]) => path.includes(CODE_RUN.runId)))
  serve(rig, { [LEDGER]: live, [UNIT]: UNIT_FILE, [CHANGED_PATH]: CHANGED, ...codeRunKept })
  await rig.clock.set(Date.parse('2026-11-16T15:43:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  const spent = row(await paneLines($), 'SPENT')

  expect(spent, 'the code run\'s 32 agents, its start at 15:17:53 and its 27779 tokens, with the publish run\'s none yet').toBe('SPENT    32 agents · 25:08 · 27779 output tokens')
})

// Scenario S6: REVIEW read the PR draft's review while unit A's PR was drafted, and the code review once unit B's draft was
// done. One rule: once the code is signed off, REVIEW is the code review, in the publish run too, read from the kept code run
// after a reload.
test('live-publish-run-review-is-the-code-review-its-code-run-kept', async ($, on) => {
  const rig = setupReplay(on)
  const live = { ...PUBLISH_RUN, stage: { ...PUBLISH_RUN.stage, status: 'active' }, stages: [], spend: { agents: 0, tokens: 0, tokensKnown: true } }
  const codeRunKept = Object.fromEntries(Object.entries(KEPT_FILES).filter(([path]) => path.includes(CODE_RUN.runId)))
  serve(rig, { [LEDGER]: live, [UNIT]: UNIT_FILE, [CHANGED_PATH]: CHANGED, ...codeRunKept })
  await rig.clock.set(Date.parse('2026-11-16T15:43:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  const lines = await paneLines($)
  const review = lines.slice(lines.findIndex(line => line.startsWith('REVIEW')))

  expect(review[0], 'the safety-net review, not the PR draft\'s').toBe('REVIEW   review: 1 issue, all left as is')
})

// Scenario S6 unit A, frame 03: the publish run had closed no attempt yet, so its spend carried no tokensKnown, and SPENT
// dropped the code run's known tokens. No attempt counted is still known (addSpend in stage-run.mjs).
test('live-publish-run-with-no-attempt-closed-still-shows-the-kept-code-run-tokens', async ($, on) => {
  const rig = setupReplay(on)
  const live = { ...PUBLISH_RUN, stage: { ...PUBLISH_RUN.stage, status: 'active' }, stages: [], spend: { agents: 0, tokens: 0 } }
  const codeRunKept = Object.fromEntries(Object.entries(KEPT_FILES).filter(([path]) => path.includes(CODE_RUN.runId)))
  serve(rig, { [LEDGER]: live, [UNIT]: UNIT_FILE, [CHANGED_PATH]: CHANGED, ...codeRunKept })
  await rig.clock.set(Date.parse('2026-11-16T15:43:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)

  const spent = row(await paneLines($), 'SPENT')

  expect(spent, 'the code run\'s 27779 tokens, the publish run having counted none yet').toMatch(/ · 27779 output tokens$/)
})
