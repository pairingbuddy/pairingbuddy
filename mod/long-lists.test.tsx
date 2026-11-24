// Scenario long-lists: a big task keeps the pane readable (docs/design/progress-mod/DIRECTION.md, "Long lists").
import { expect, test } from 'claude-code/testing'
import { paneLines, setupReplay } from './testing/replay'
import { recordReportCalls, runPbReport } from './testing/report'
import { LEDGER, SNAPSHOT_RUNNING } from './testing/band'
import { BIG_FILES, TDD_START, bigBuild, bigEnd, serve, tooWide } from './testing/big-task'

const LABEL_WIDTH = 9
const WIDTHS = [60, 100]

// A row's lines: from its label to the next label, or to the first line that is not the pane's row (the gap before the footer).
function rowLinesOf(lines: string[], name: string): string[] {
  const from = lines.findIndex(line => line.startsWith(name.padEnd(LABEL_WIDTH)))
  const to = lines.findIndex((line, at) => at > from && (line.slice(0, LABEL_WIDTH).trim() !== '' || !line.startsWith(' '.repeat(LABEL_WIDTH))))
  return from < 0 ? [] : lines.slice(from, to < 0 ? undefined : to)
}
const testsRow = (lines: string[]) => rowLinesOf(lines, 'TESTS')

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
  await runPbReport($)
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


for (const columns of WIDTHS) {
  test(`a-big-task-mid-build-fits-${columns}-columns-and-keeps-tests-to-five-lines`, async ($, on) => {
    const rig = setupReplay(on)
    await bigBuild($, rig)

    const lines = await paneLines($, { bodyColumns: columns })
    const tests = testsRow(lines)

    expect(tooWide(lines, columns), `every line fits ${columns} columns`).toEqual([])
    expect(tests.length, `TESTS is at most 5 lines: ${JSON.stringify(tests)}`).toBeLessThanOrEqual(5)
    expect(tests[0], 'the done tests fold into the count of the total').toBe('TESTS    10 of 40 done')
    expect(tests.at(-1), 'the waiting tests past the shown ones are counted').toBe(`${' '.repeat(LABEL_WIDTH)}+27 more`)
    // A test line stays one line: a long name is cut at a word and marked by …; the report's SCENARIOS holds it whole.
    // Only a finding's title, too long for the room, is cut, at a word and marked by …; what happens to it stays whole.
    expect(lines.filter(line => line.includes('…')).every(line => /^ +left as is · \S.*\S…$/.test(line)), `only finding titles are cut with an ellipsis: ${JSON.stringify(lines)}`).toBe(true)
  })

  test(`a-big-task-at-its-end-fits-${columns}-columns-with-built-wrapped-whole-and-review-in-five`, async ($, on) => {
    const rig = setupReplay(on)
    await bigEnd($, rig)

    const lines = await paneLines($, { bodyColumns: columns })
    const review = rowLinesOf(lines, 'REVIEW')

    expect(tooWide(lines, columns), `every line fits ${columns} columns`).toEqual([])
    // BUILT wraps instead of being cut: every word it holds is drawn, and it ends with the tests.
    const squash = (text: string) => text.replace(/[\s·]/g, '')
    const built = rowLinesOf(lines, 'BUILT').map(line => line.slice(LABEL_WIDTH)).join('')
    const whole = `${BIG_FILES.slice(0, 3).map(file => file.path).join(', ')} + 17 more files · 40 tests passing`
    expect(squash(built), `BUILT is drawn whole, wrapped: ${JSON.stringify(lines)}`).toBe(squash(whole))
    // Only a finding's title, too long for the room, is cut, at a word and marked by …; what happens to it stays whole.
    expect(lines.filter(line => line.includes('…')).every(line => /^ +left as is · \S.*\S…$/.test(line)), `only finding titles are cut with an ellipsis: ${JSON.stringify(lines)}`).toBe(true)
    // The end review: one summary line, the first three findings, then "+ n more".
    expect(review.length, `REVIEW is at most 5 lines: ${JSON.stringify(review)}`).toBeLessThanOrEqual(5)
    expect(review.at(-1), 'the other five findings are counted').toBe(`${' '.repeat(LABEL_WIDTH)}  + 5 more`)
    // TESTS is settled: how many pass of the total, then the list, folded to five lines.
    const tests = testsRow(lines)
    expect(tests[0], `TESTS leads with the settled count: ${JSON.stringify(tests)}`).toBe('TESTS    ✓ 40 of 40 passing')
    expect(tests.slice(1, -1).map(line => line.trim().slice(0, 2)), 'then the first three tests').toEqual(['✓ ', '✓ ', '✓ '])
    expect(tests.at(-1), 'then how many more').toBe(`${' '.repeat(LABEL_WIDTH)}+37 more`)
    // BUILT, GOAL and PR cut at a word, never mid-word with an ellipsis.
    for (const name of ['BUILT', 'GOAL', 'PR']) {
      for (const line of rowLinesOf(lines, name)) expect(line.includes('…'), `${name} is cut at a word: ${line}`).toBe(false)
    }
  })
}
