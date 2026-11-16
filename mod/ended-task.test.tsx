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
