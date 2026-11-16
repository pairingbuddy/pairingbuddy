// Ninth watched run: how many tests the run is working on, once the placeholders return lists them (no tests.json in a new-path run).
import { expect, test } from 'claude-code/testing'
import { paneLines, setupReplay } from './testing/replay'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, bandTexts, start } from './testing/band'
import { POLL_MS } from './poll'

const ARTIFACTS = `${ROOT}/.pairingbuddy/run/task/artifacts`
const PLACEHOLDERS_KEY = 'code-tdd.create-test-placeholders.-.r1.a1'
const FIRST = 'order-total-sums-two-lines'
const SECOND = 'order-total-of-no-lines-is-zero'
const row = (id: string, caseId: string) => ({ test_id: id, test_case_id: caseId, scenario_id: 'order-total', runner_id: 'pytest', test_file: 'tests/test_cart.py', test_function: `test_${id.replaceAll('-', '_')}` })
const placeholders = { pb_key: PLACEHOLDERS_KEY, ambiguity: '', commit_subject: '', files_changed: [], tests: [row(FIRST, 'two-lines'), row(SECOND, 'no-lines')] }
const record = { stage: 'code-tdd', attempt: 1, done: true, passed: true, exitCodes: [1], timedOut: false, excerpt: '' }
const building = {
  ...SNAPSHOT_RUNNING,
  taskType: 'new_feature',
  stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-04T08:19:00.000Z' },
  stages: [{ name: 'code-scenarios', status: 'done', attempt: 1, startedAt: '2026-11-04T08:18:00.000Z' }],
  tests: { perTest: { [FIRST]: { selector: { runner_id: 'pytest', test_file: 'tests/test_cart.py', test_function: FIRST }, red: record } } },
}

async function serve($: any, on: Function, ledger: unknown, files: Record<string, unknown>, spawn: string) {
  const rig = setupReplay(on)
  rig.served.set(`${ROOT}/${LEDGER}`, JSON.stringify(ledger))
  for (const [path, value] of Object.entries(files)) rig.served.set(path, JSON.stringify(value))
  await rig.clock.set(Date.parse('2026-11-04T08:20:00.000Z'))
  await start($)
  await $.agent.spawn({ prompt: 'p', description: 'd', name: spawn, subagentType: 'pairingbuddy:implement-code' })
  await rig.clock.advance(POLL_MS * 3)
  return rig
}

test('status-counts-the-tests-the-placeholders-return-lists', async ($, on) => {
  await serve($, on, building, { [`${ARTIFACTS}/${PLACEHOLDERS_KEY}.json`]: placeholders }, `pb1 code-tdd GREEN implement-code ${FIRST} r1`)

  const lines = await paneLines($)

  const status = lines.slice(lines.findIndex(line => line.startsWith('STATUS')), lines.findIndex(line => line.startsWith('─'))).join(' ')
  expect(status, `STATUS gives the position against the planned total: ${JSON.stringify(lines)}`).toContain('test 1 of 2')
})

// Tenth watched run: a test reads by its short name (its id, spaced out), never its whole scenario sentence, which the report's SCENARIOS keeps.
test('tests-status-and-the-band-name-a-test-by-its-short-name-not-its-scenario-sentence', async ($, on) => {
  const key = 'code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1'
  const sentence = 'order_total([(10, 2), (4, 1)]) returns 30.0, which is line_total(10, 2) = 25.0 plus line_total(4, 1) = 5.0.'
  const scenarios = { pb_key: key, scenarios: [{ scenario_id: 'order-total', description: 'Order total', test_cases: [{ test_case_id: 'two-lines', description: sentence }, { test_case_id: 'no-lines', description: 'No lines total zero' }] }] }
  await serve($, on, building, { [`${ARTIFACTS}/${PLACEHOLDERS_KEY}.json`]: placeholders, [`${ARTIFACTS}/${key}.json`]: scenarios }, `pb1 code-tdd GREEN implement-code ${FIRST} r1`)

  const lines = await paneLines($)
  const band = (await bandTexts($, { bodyColumns: 120 })).join('')

  expect(lines.some(line => line.includes('▸ order total sums two lines')), `TESTS names the current test by its short name: ${JSON.stringify(lines)}`).toBe(true)
  expect(lines.some(line => line.startsWith('STATUS') && line.includes('order total sums two lines')), 'STATUS names it the same way').toBe(true)
  expect(band, 'the band names it the same way').toContain('● GREEN · order total sums two lines · 1/2')
  expect([...lines, band].join(' '), 'the scenario sentence is not in the pane or the band').not.toContain('returns 30.0')
})

test('the-band-gives-the-position-after-the-test-name-while-it-fits', async ($, on) => {
  await serve($, on, building, { [`${ARTIFACTS}/${PLACEHOLDERS_KEY}.json`]: placeholders }, `pb1 code-tdd GREEN implement-code ${FIRST} r1`)

  const row = (await bandTexts($, { bodyColumns: 120 })).join('')

  expect(row, 'the band reads the position against the total after the name').toContain('● GREEN · order total sums two lines · 1/2 │ ')
})

test('the-place-gives-way-before-the-test-name-is-cut', async ($, on) => {
  await serve($, on, building, { [`${ARTIFACTS}/${PLACEHOLDERS_KEY}.json`]: placeholders }, `pb1 code-tdd GREEN implement-code ${FIRST} r1`)

  const row = (await bandTexts($, { bodyColumns: 44 })).join('')

  expect(row, 'short of room, the place goes and the name stays whole').toMatch(/^● GREEN · order total sums two lines$/)
})

const testsRow = (lines: string[]) => lines.slice(lines.findIndex(line => line.startsWith('TESTS')), lines.findIndex(line => line.startsWith('REVIEW')))

test('tests-leads-with-how-many-are-done-of-the-total', async ($, on) => {
  await serve($, on, building, { [`${ARTIFACTS}/${PLACEHOLDERS_KEY}.json`]: placeholders }, `pb1 code-tdd GREEN implement-code ${FIRST} r1`)

  const row = testsRow(await paneLines($))

  expect(row[0], `the count leads TESTS, then the list: ${JSON.stringify(row)}`).toBe('TESTS    0 of 2 done')
  expect(row.slice(1).map(line => line.trim().slice(0, 2)), 'then one line per test').toEqual(['▸ ', '· '])
})

const passedRecord = { ...record, exitCodes: [0] }
const selectorOf = (id: string) => ({ runner_id: 'pytest', test_file: 'tests/test_cart.py', test_function: id })
const built = {
  ...building,
  stage: { name: 'code-safety-net', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-04T08:19:50.000Z' },
  stages: [...building.stages, { name: 'code-tdd', status: 'done', attempt: 1, startedAt: '2026-11-04T08:19:00.000Z' }],
  tests: { perTest: Object.fromEntries([FIRST, SECOND].map(id => [id, { selector: selectorOf(id), red: record, green: passedRecord }])) },
}

test('after-the-build-tests-reads-as-a-settled-summary', async ($, on) => {
  await serve($, on, built, { [`${ARTIFACTS}/${PLACEHOLDERS_KEY}.json`]: placeholders }, 'pb1 code-safety-net - corpus-misalignment - r1')

  const row = testsRow(await paneLines($))

  expect(row, 'the build is over: how many pass of the total, then the list').toEqual(['TESTS    ✓ 2 of 2 passing', '         ✓ order total sums two lines', '         ✓ order total of no lines is zero'])
})
