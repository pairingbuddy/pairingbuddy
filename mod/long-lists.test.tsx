// Scenario long-lists: a big task keeps the pane readable (docs/design/progress-mod/DIRECTION.md, "Long lists").
import { expect, test } from 'claude-code/testing'
import { PANE, paneLines, setupReplay, type Rig } from './testing/replay'
import { recordReportCalls, REPORT_KEY } from './testing/report'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { POLL_MS } from './poll'

const LABEL_WIDTH = 9
const TDD_START = '2026-11-14T10:00:00.000Z'

async function serve($: any, rig: Rig, files: Record<string, unknown>, at = '2026-11-14T10:00:30.000Z') {
  rig.served.clear()
  for (const [path, value] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, typeof value === 'string' ? value : JSON.stringify(value))
  await rig.clock.set(Date.parse(at))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
}

// The TESTS row's lines: from its label to the next label.
function testsRow(lines: string[]): string[] {
  const from = lines.findIndex(line => line.startsWith('TESTS'))
  const to = lines.findIndex((line, at) => at > from && line.slice(0, LABEL_WIDTH).trim() !== '')
  return lines.slice(from, to < 0 ? undefined : to)
}

test('tests-the-row-hides-are-counted-so-far-while-the-total-is-unknown', async ($, on) => {
  const rig = setupReplay(on)
  // No tests.json: the ledger's seen tests are the list, so the total is not known.
  const perTest = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`t${i + 1}`, i < 3 ? { green: { passed: true } } : {}]))
  const ledger = { ...SNAPSHOT_RUNNING, stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: TDD_START }, tests: { perTest } }
  await serve($, rig, { [LEDGER]: ledger })
  await $.agent.spawn({ prompt: 'p', description: 'pb1 code-tdd RED implement-tests t4 r1', subagentType: 'pairingbuddy:implement-tests', workflow: { runId: 'wf_1', agentIndex: 1 } })

  const row = testsRow(await paneLines($))

  expect(row.at(-1), `the two hidden tests are counted, and "so far" says more may come: ${JSON.stringify(row)}`).toBe(`${' '.repeat(LABEL_WIDTH)}+2 more so far`)
})

const ARTIFACTS = '.pairingbuddy/run/task/artifacts'
const SCENARIOS_KEY = 'code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1'
const scenarioReturn = (scenarios: { description: string; tests: string[] }[], pbKey = SCENARIOS_KEY) => ({
  pb_key: pbKey,
  scenarios: scenarios.map(({ description, tests }) => ({ description, test_cases: tests.map(test => ({ description: test })) })),
})

async function pressReport($: any) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: REPORT_KEY })
  await pane.unmount()
}

const sectionOf = (html: string, name: string) => html.match(new RegExp(`<h2>${name}</h2>[\\s\\S]*?</section>`))?.[0] ?? ''

test('the-report-lists-the-standing-scenarios-and-every-changed-file', async ($, on) => {
  const rig = setupReplay(on)
  const recorder = recordReportCalls(on)
  const ledger = { ...SNAPSHOT_RUNNING, stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: TDD_START }, stages: [{ name: 'code-scenarios', status: 'done', attempt: 1, startedAt: TDD_START }] }
  const scenarios = [{ description: 'order total sums the lines', tests: ['two lines add up', 'no lines give zero'] }, { description: 'a bad line is refused', tests: ['a negative quantity raises'] }]
  const changed = Array.from({ length: 7 }, (_, i) => `src/file_${i + 1}.py`)
  await serve($, rig, { [LEDGER]: ledger, [`${ARTIFACTS}/${SCENARIOS_KEY}.json`]: scenarioReturn(scenarios), '.pairingbuddy/run/changed.json': changed.map(path => ({ path, status: 'M' })) })

  await pressReport($)

  const html = recorder.writes[0]?.text ?? ''
  for (const text of ['order total sums the lines', 'two lines add up', 'no lines give zero', 'a bad line is refused', 'a negative quantity raises']) {
    expect(sectionOf(html, 'SCENARIOS'), `the report's scenarios hold ${text}`).toContain(text)
  }
  for (const path of changed) expect(sectionOf(html, 'BUILT'), `the report's built list holds ${path}`).toContain(path)
})
