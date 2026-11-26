// Scenario questions-for-you: doubts an auto-mode gate set aside wait on the open unit (run/unit.json questions) until
// G:publish asks them. While they wait, STATUS and the band count them, so the human sees there is something for them
// before the pull request, though nothing stops the run.
import { expect, test } from 'claude-code/testing'
import { paneLines, setupReplay, type Rig } from './testing/replay'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, bandTexts, start } from './testing/band'
import { POLL_MS } from './poll'

const UNIT = '.pairingbuddy/run/unit.json'
const question = (n: number) => ({ gate: 'G:task-end', task: 'Task 1: one', step: 'a reviewer', ambiguity: `Doubt ${n}?` })
const unitWith = (questions: unknown[], more?: number) => ({
  unit: null, plan: null, tracer: null, branch: 'feat/x', base: 'main', baseSha: 'abc', tasks: [], commits: [],
  questions, ...(more === undefined ? {} : { questionsMore: more }),
})
const running = { ...SNAPSHOT_RUNNING, kind: 'code', taskType: 'new_feature', stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-14T10:00:00.000Z' } }

function serve(rig: Rig, files: Record<string, unknown>) {
  rig.served.clear()
  for (const [path, value] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, JSON.stringify(value))
}

async function shown($: any, on: Function, unit: unknown) {
  const rig = setupReplay(on)
  serve(rig, { [LEDGER]: running, [UNIT]: unit })
  await rig.clock.set(Date.parse('2026-11-14T10:01:00.000Z'))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
  return { lines: await paneLines($), band: (await bandTexts($)).join('') }
}

test('questions-the-unit-holds-are-counted-in-status-and-the-band', async ($, on) => {
  const { lines, band } = await shown($, on, unitWith([question(1), question(2)], 1))

  const status = lines.find(line => line.startsWith('STATUS'))
  expect(status, `STATUS adds the count after what the run is doing: ${JSON.stringify(lines)}`).toMatch(/· 3 questions for you$/)
  expect(band, 'the band counts them too').toContain('3 questions for you')
})
