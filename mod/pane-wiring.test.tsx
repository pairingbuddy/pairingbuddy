// Scenario pane-wiring: the mod pane and poller wiring for the now-building block (mod tests via claude plugin test ., runner mod).
import { expect, mock, test } from 'claude-code/testing'
import { PANE, paneLines, replay, setupReplay } from './testing/replay'
import { PHASE_COLOURS } from './pane'
import calm from './fixtures/replay/g-open-1'
import looping from './fixtures/replay/probe-2'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, engine, start } from './testing/band'
import { POLL_MS } from './poll'
import { fromPolled } from './inputs'

test('pane-draws-the-tests-and-test-rows', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-04T08:20:00.000Z') })
  const record = (passed: boolean) => ({ stage: 'code-tdd', attempt: 1, done: passed, passed, exitCodes: [passed ? 0 : 1], timedOut: false, excerpt: '' })
  const selector = (id: string) => ({ runner_id: 'pytest', test_file: 'tests/test_discount.py', test_function: id })
  engine(on, {
    ...SNAPSHOT_RUNNING,
    stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-04T08:19:00.000Z' },
    tests: { perTest: {
      'ten-percent-off': { selector: selector('ten-percent-off'), red: record(true), green: record(true) },
      'zero-percent-keeps-price': { selector: selector('zero-percent-keeps-price'), red: record(true) },
    } },
  })
  await start($)
  const label = (item: string) => `pb1 code-tdd GREEN implement-code ${item} r1`
  for (const name of [label('ten-percent-off'), label('zero-percent-keeps-price'), 'not a pb1 label at all']) {
    await $.agent.spawn({ prompt: 'p', description: 'd', name, subagentType: 'pairingbuddy:implement-code' })
  }
  await clock.advance(90_000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const nodes: { text: string; props: Record<string, unknown> }[] = await pane.findAll({ type: 'Text' })
  await pane.unmount()
  const lines = await paneLines($)

  const shown = JSON.stringify(lines)
  expect(lines, `the TESTS row marks the finished test done and the current one: ${shown}`).toContain('TESTS    ✓ ten percent off   ▸ zero percent keeps price')
  expect(lines, `the TEST row names the current test, its cycle and the step age: ${shown}`).toContain('TEST     zero percent keeps price  ✓RED ●GREEN  1:30')
  expect(lines.findIndex(line => line.startsWith('TESTS')), 'TESTS comes before TEST').toBeLessThan(lines.findIndex(line => line.startsWith('TEST ')))
  const marker = nodes.find(node => node.text === '●GREEN')
  expect(marker!.props.color, 'the lit GREEN step uses its fixed phase colour').toBe(PHASE_COLOURS.GREEN)
  const texts = nodes.map(node => node.text)
  for (const removed of [/now building/, /\bactive\b/, /\d+ unknown$/, /made to pass|already passed|▸ now|to do/]) {
    expect(texts.some(text => removed.test(text)), `nothing matching ${removed} is drawn: ${JSON.stringify(texts)}`).toBe(false)
  }
})

test('marker-lights-the-live-phase-in-its-colour', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-11-04T08:20:00.000Z') })
  const ID = 'ten-percent-off'
  engine(on, {
    ...SNAPSHOT_RUNNING,
    taskType: 'new_feature',
    stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-04T08:19:00.000Z' },
    tests: { perTest: { [ID]: { selector: { runner_id: 'pytest', test_file: 'tests/test_discount.py', test_function: ID } } } },
  })
  await start($)
  // Fixed colours, never theme keys: a theme that maps success to blue cannot turn GREEN blue.
  const steps = [['RED', 'implement-tests', '#e5534b'], ['GREEN', 'implement-code', '#3fb950'], ['REFACTOR', 'refactor-code', '#4c8dff']]
  for (const [phase, role, colour] of steps) {
    await $.agent.spawn({ prompt: 'p', description: `pb1 code-tdd ${phase} ${role} ${ID} r1`, subagentType: `pairingbuddy:${role}`, workflow: { runId: 'wf_1', agentIndex: 1 } })
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const nodes: { text: string; props: Record<string, unknown> }[] = await pane.findAll({ type: 'Text' })
    await pane.unmount()
    const lit = nodes.find(node => node.text === `●${phase}`)
    expect(lit, `${phase}: the live phase is drawn with a bullet: ${JSON.stringify(nodes.map(node => node.text))}`).toBeDefined()
    expect(lit!.props.color, `${phase}: the live phase is drawn in its colour`).toBe(colour)
    expect(lit!.props.bold, `${phase}: the live phase is bold`).toBe(true)
    const others = nodes.filter(node => /^[✓›](RED|GREEN|REFACTOR)$/.test(node.text))
    expect(others.length, `${phase}: the other two phases are drawn`).toBe(2)
    expect(others.every(node => node.props.dimColor === true && node.props.color === undefined), `${phase}: the other phases are dim`).toBe(true)
  }
})

test('marker-is-hidden-when-no-phase-is-known', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-11-04T08:20:00.000Z') })
  const ID = 'ten-percent-off'
  engine(on, {
    ...SNAPSHOT_RUNNING,
    taskType: 'new_feature',
    stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-04T08:19:00.000Z' },
    tests: { perTest: { [ID]: { selector: { runner_id: 'pytest', test_file: 'tests/test_discount.py', test_function: ID } } } },
  })
  await start($)

  const lines = await paneLines($)
  expect(lines, `the seen test is listed: ${JSON.stringify(lines)}`).toContain('TESTS    · ten percent off')
  expect(lines, 'with no step on a test the TEST row reads a dash').toContain('TEST     —')
  expect(lines.some(text => /RED|GREEN|REFACTOR/.test(text)), `no phase marker is drawn with no live phase: ${JSON.stringify(lines)}`).toBe(false)
})

test('poller-reads-tests-and-scenarios', async ($, on) => {
  const rig = setupReplay(on)
  const ID = 'ten-percent-off-100-returns-90'
  const DESCRIPTION = 'Ten percent off 100 gives 90'
  const FALLBACK = 'ten percent off 100 returns 90'
  const TESTS_PATH = `${ROOT}/.pairingbuddy/tests.json`
  const SCENARIOS_PATH = `${ROOT}/.pairingbuddy/scenarios.json`
  const tests = JSON.stringify({ tests: [{ test_id: ID, test_case_id: 'ten-percent', scenario_id: 'discount' }] })
  const scenarios = JSON.stringify({ scenarios: [{ scenario_id: 'discount', description: 'Discounts', test_cases: [{ test_case_id: 'ten-percent', description: DESCRIPTION }] }] })
  const variants: { name: string; files: Record<string, string>; unreadable?: string[]; described: boolean }[] = [
    { name: 'both files served', files: { '.pairingbuddy/tests.json': tests, '.pairingbuddy/scenarios.json': scenarios }, described: true },
    { name: 'scenarios.json missing', files: { '.pairingbuddy/tests.json': tests }, described: false },
    { name: 'tests.json missing', files: { '.pairingbuddy/scenarios.json': scenarios }, described: false },
    { name: 'scenarios.json unreadable', files: { '.pairingbuddy/tests.json': tests, '.pairingbuddy/scenarios.json': scenarios }, unreadable: [SCENARIOS_PATH], described: false },
    { name: 'tests.json unreadable', files: { '.pairingbuddy/tests.json': tests, '.pairingbuddy/scenarios.json': scenarios }, unreadable: [TESTS_PATH], described: false },
    { name: 'scenarios.json truncated', files: { '.pairingbuddy/tests.json': tests, '.pairingbuddy/scenarios.json': scenarios.slice(0, 60) }, described: false },
    { name: 'tests.json truncated', files: { '.pairingbuddy/tests.json': tests.slice(0, 30), '.pairingbuddy/scenarios.json': scenarios }, described: false },
  ]

  // The target test is the CURRENT test: its RED is done, a labelled spawn is on it, and the ledger is in code-tdd and not yet green.
  const record = { stage: 'code-tdd', attempt: 1, done: true, passed: true, exitCodes: [0], timedOut: false, excerpt: '' }
  const ledger = {
    ...SNAPSHOT_RUNNING,
    stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-04T08:19:00.000Z' },
    tests: { perTest: { [ID]: { selector: { runner_id: 'pytest', test_file: 'tests/test_discount.py', test_function: ID }, red: record } } },
  }
  const LEDGER_FILE = `${ROOT}/${LEDGER}`

  // The clock never runs backwards, so it is set once and each variant only advances it.
  await rig.clock.set(Date.parse('2026-11-04T08:20:00.000Z'))
  for (const variant of variants) {
    const everyText: string[] = []
    let threw: unknown
    try {
      rig.served.clear()
      rig.unreadable.clear()
      for (const [path, text] of Object.entries(variant.files)) rig.served.set(`${ROOT}/${path}`, text)
      rig.served.set(LEDGER_FILE, JSON.stringify(ledger))
      for (const path of variant.unreadable ?? []) rig.unreadable.add(path)
      await start($)
      await $.agent.spawn({ prompt: 'p', description: 'd', name: `pb1 code-tdd GREEN implement-code ${ID} r1`, subagentType: 'pairingbuddy:implement-code' })
      await rig.clock.advance(POLL_MS * 3)
      const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
      everyText.push(...(await pane.findAll({ type: 'Text' })).map((node: any) => node.text))
      await pane.unmount()
    } catch (error) {
      threw = error
    }
    expect(threw, `${variant.name}: drawing the pane does not throw`).toBeUndefined()
    const shown = JSON.stringify(everyText)
    expect(everyText.some(text => text === 'TEST     '), `${variant.name}: the TEST row is drawn: ${shown}`).toBe(true)
    if (variant.described) {
      expect(everyText.some(text => text.includes(DESCRIPTION)), `${variant.name}: the pane shows the scenario description: ${shown}`).toBe(true)
    } else {
      expect(everyText.some(text => text.includes(DESCRIPTION)), `${variant.name}: the description cannot be known, so it is not shown: ${shown}`).toBe(false)
      expect(everyText.some(text => text.includes(FALLBACK)), `${variant.name}: the pane falls back to the id with spaces: ${shown}`).toBe(true)
    }
  }
})

test('replay-matches-recorded-run', async ($, on) => {
  const rig = setupReplay(on)
  const run = async (recording: Parameters<typeof replay>[2]) => {
    const steps: { t: number; kind: string; name: unknown; shown: string[] }[] = []
    for await (const step of replay($, rig, recording, { mount: { ...PANE, props: { ...PANE.props, bodyColumns: 140 }, surface: 'terminal' } })) {
      steps.push({ t: step.t, kind: step.kind, name: step.recorded.name, shown: step.texts.map(text => text.text) })
    }
    return steps
  }
  // The recording is bug_fix, so no step of the cycle is REFACTOR. Every spawn finishes at its t + seconds: the
  // workflow agents by their recorded duration, the Agents (classify-task, curate-guidance) at their task_notification row.
  const calmSteps = await run(calm)
  const loopingSteps = await run(looping)
  const shownOf = (step: (typeof calmSteps)[number] | undefined, what: string) => {
    expect(step, `${what} was replayed`).toBeDefined()
    return step!.shown
  }
  const at = (steps: typeof calmSteps, kind: string, name: string) =>
    shownOf(steps.find(step => step.kind === kind && step.name === name), `a ${kind} step for ${name}`)
  const last = (steps: typeof calmSteps) => steps[steps.length - 1].shown
  const ledgerAt = (steps: typeof calmSteps, t: number) =>
    shownOf(steps.find(step => step.kind === 'ledger' && step.t === t), `a ledger step at t=${t}`)

  // Calm run, g-open-1: after the last RED/GREEN cycle the ledger has one test with a passing GREEN and three covered (RED passed straight away).
  const calmCycleDone = shownOf(calmSteps.find(step => step.shown.some(text => text.startsWith('✓ 1 done'))), 'a step showing \'✓ 1 done\'')
  expect(calmCycleDone, 'the progress row folds the one finished test and the three covered tests into separate counts').toContain('✓ 1 done   ◌ 3 covered')
  expect(calmSteps.flatMap(step => step.shown).some(text => text.includes('REFACTOR')), 'a bug_fix run has no REFACTOR step').toBe(false)
  // In the safety-net review no test is current: TEST reads a dash and no phase is lit.
  const review = at(calmSteps, 'spawn', 'pb1 code-safety-net - update-documentation - r1')
  expect(review, 'the safety-net review lights no phase').not.toContain('●GREEN')
  expect(review[review.indexOf('TEST     ') + 1], 'TEST reads a dash outside build test by test').toBe('—')

  // Looping run, probe-2: GREEN is lit on the first test's GREEN spawn, RED is lit on the third try at zero-percent-keeps-full-price.
  const green = at(loopingSteps, 'spawn', 'pb1 code-tdd GREEN implement-code ten-percent-off-hundred r1')
  expect(green, 'the GREEN step is the lit one').toContain('●GREEN')
  expect(green, 'RED is no longer lit, and shows as passed').toContain('✓RED')
  const thirdTry = at(loopingSteps, 'spawn', 'pb1 code-tdd RED implement-tests zero-percent-keeps-full-price r3')
  expect(thirdTry, 'the RED step is the lit one').toContain('●RED')
  expect(thirdTry, 'the looping row names the step and its try').toContain('writing a failing test · try 3 of 3')
  expect(thirdTry, 'the tries line lists the three tries at RED').toContain('try 1 at RED: unknown · try 2 at RED: unknown · try 3 at RED: unknown')
  // The ledger records the latest RED try only: at the 139.689 snapshot the third try's runner has run and the record
  // (passed false, exit 0) reads "passed straight away, refused"; the earlier tries keep no record of their own.
  expect(ledgerAt(loopingSteps, 139.689), 'the tries line shows the third try\'s real result and the earlier two stay unknown').toContain('try 1 at RED: unknown · try 2 at RED: unknown · try 3 at RED: passed straight away, refused (exit 0)')
  expect(loopingSteps.flatMap(step => step.shown).some(text => text.includes('REFACTOR')), 'a bug_fix run has no REFACTOR step').toBe(false)
})

test('replay-keeps-one-layout-and-fits-at-widths', async ($, on) => {
  const rig = setupReplay(on)
  const WIDTHS = [50, 80, 140]
  const BODY_ROWS = 30
  const cells = (text: string) => [...text].length
  const textOf = (node: any): string => (node.children ?? []).map((child: any) => (typeof child === 'string' ? child : textOf(child))).join('')
  const isRow = (node: any) => node?.type === 'Box' && (node.children ?? []).length > 0 && node.children.every((child: any) => child?.type === 'Text')
  const LABELS = ['NOW', 'SPENT', 'LOOPING', 'STEPS', 'TESTS', 'TEST', 'REVIEW']

  for (const [name, recording] of [['g-open-1', calm], ['probe-2', looping]] as const) {
    for (const columns of WIDTHS) {
      const mount = { ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: BODY_ROWS } }, surface: 'terminal' }
      let steps = 0
      for await (const step of replay($, rig, recording, { mount, find: { type: 'Box' } })) {
        if (!step.ledger) continue
        steps++
        const where = `${name} at ${columns} columns, step t=${step.t} (${step.kind})`
        const rows: any[] = ((step.nodes as any)?.children ?? []).filter(isRow)
        const labels = rows.map(row => textOf(row.children[0]).trim()).filter(label => label !== '')
        // One layout: every row, in the same order, at every step.
        expect(labels, `${where}: the rows`).toEqual(LABELS)
        // The rows the pane folds itself fit the width: TESTS, TEST and REVIEW; the one-sentence rows and the steps are cut by their Text.
        const folded = rows.slice(rows.findIndex(row => textOf(row.children[0]).trim() === 'TESTS'))
        for (const row of folded) expect(cells(textOf(row)), `${where}: the row "${textOf(row)}" fits the body width ${columns}`).toBeLessThanOrEqual(columns)
        expect(rows.length, `${where}: the pane's ${rows.length} rows fit the ${BODY_ROWS} body rows`).toBeLessThanOrEqual(BODY_ROWS)
      }
      expect(steps, `${name} at ${columns} columns: some step had a ledger`).toBeGreaterThan(0)
    }
  }
})

test('from-polled-without-tests-complete-is-incomplete', async () => {
  const polled = { ledger: null, tests: ['ten-percent-off'], now: null }

  const inputs = fromPolled(polled, [])

  expect(inputs.testsComplete).toBe(false)
})
