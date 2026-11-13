// Scenario pane-wiring: the mod pane and poller wiring for the now-building block (mod tests via claude plugin test ., runner mod).
import { expect, mock, test } from 'claude-code/testing'
import { PANE, replay, setupReplay } from './testing/replay'
import calm from './fixtures/replay/g-open-1'
import looping from './fixtures/replay/probe-2'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, engine, start } from './testing/band'
import { POLL_MS } from './poll'

test('pane-renders-now-building-block', async ($, on) => {
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
  const boxes: any[] = await pane.findAll({ type: 'Box' })
  await pane.unmount()
  const rowTexts = (box: any): string[] => (box.children ?? []).filter((child: any) => child.type === 'Text').map((child: any) => (child.children ?? []).join(''))
  const markerRow = boxes.map(rowTexts).find(texts => texts.includes('●GREEN') && texts.some(text => text.includes('1:30')))

  const shown = nodes.map(node => node.text)
  const at = (part: string) => shown.findIndex(text => text.includes(part))
  expect(at('now building'), `the block is drawn before the unknown-label footer: ${JSON.stringify(shown)}`).toBeGreaterThanOrEqual(0)
  expect(at('now building'), 'the block comes before the unknown-label footer').toBeLessThan(at('only watches'))
  const progress = shown.find(text => text.includes('ten percent off') && text.includes('zero percent keeps price'))
  expect(progress, `the progress row names both tests: ${JSON.stringify(shown)}`).toBeDefined()
  expect(progress, 'the finished test is marked done').toContain('✓ ten percent off')
  expect(progress, 'the current test is marked now').toContain('▸ zero percent keeps price')
  const marker = nodes.find(node => node.text === '●GREEN')
  expect(marker, `the lit GREEN step is drawn: ${JSON.stringify(shown)}`).toBeDefined()
  expect(marker!.props.color, 'the lit GREEN step uses its phase colour key').toBe('success')
  expect(markerRow, `the step age 1:30 sits on the same row as the marker: ${JSON.stringify(shown)}`).toBeDefined()
  expect(shown.some(text => text.includes('3 active')), `the active count is drawn: ${JSON.stringify(shown)}`).toBe(true)
  expect(shown.some(text => /\b1\b.*unknown/.test(text)), `the unknown count is drawn: ${JSON.stringify(shown)}`).toBe(true)
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
    expect(everyText.some(text => text.includes('now building')), `${variant.name}: the now-building block is drawn: ${shown}`).toBe(true)
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
  // classify-task finished at 26.834 and every earlier workflow agent before update-documentation spawned at 148.104, so only it runs.
  expect(at(calmSteps, 'spawn', 'pb1 code-safety-net - update-documentation - r1'), 'only the update-documentation agent is running').toContain('1 active')
  expect(at(calmSteps, 'finish', 'pb1 code-safety-net - runner - r1'), 'the last recorded finish (159.04) leaves no agent active').toContain('0 active')
  expect(last(calmSteps), 'every recorded finish has come, so no agent is active').toContain('0 active')

  // Looping run, probe-2: GREEN is lit on the first test's GREEN spawn, RED is lit on the third try at zero-percent-keeps-full-price.
  const green = at(loopingSteps, 'spawn', 'pb1 code-tdd GREEN implement-code ten-percent-off-hundred r1')
  expect(green, 'the GREEN step is the lit one').toContain('●GREEN')
  expect(green, 'RED is no longer lit').toContain('›RED')
  expect(green, 'both Agents finished (14.505, 26.198) and the earlier runners too, so only this spawn runs').toContain('1 active')
  const thirdTry = at(loopingSteps, 'spawn', 'pb1 code-tdd RED implement-tests zero-percent-keeps-full-price r3')
  expect(thirdTry, 'the RED step is the lit one').toContain('●RED')
  expect(thirdTry, 'the looping row names three tries').toContain('LOOPING  yes: 3 tries at the same step')
  expect(thirdTry, 'the tries line lists the three tries at RED').toContain('  try 1 at RED: unknown · try 2 at RED: unknown · try 3 at RED: unknown')
  expect(thirdTry, 'the earlier RED runner finished at 124.5, so only this spawn runs').toContain('1 active')
  // The ledger records the latest RED try only: at the 139.689 snapshot the third try's runner has run and the record
  // (passed false, exit 0) reads "passed straight away, refused"; the earlier tries keep no record of their own.
  expect(ledgerAt(loopingSteps, 139.689), 'the tries line shows the third try\'s real result and the earlier two stay unknown').toContain('  try 1 at RED: unknown · try 2 at RED: unknown · try 3 at RED: passed straight away, refused (exit 0)')
  expect(at(loopingSteps, 'finish', 'pb1 code-tdd - runner - r3'), 'the last recorded finish (141.14) leaves no agent active').toContain('0 active')
  expect(loopingSteps.flatMap(step => step.shown).some(text => text.includes('REFACTOR')), 'a bug_fix run has no REFACTOR step').toBe(false)
  expect(last(loopingSteps), 'every recorded finish has come, so no agent is active').toContain('0 active')
})

test('replay-no-flicker-or-scroll-at-widths', async ($, on) => {
  const rig = setupReplay(on)
  const WIDTHS = [50, 80, 140]
  const BODY_ROWS = 30
  const cells = (text: string) => [...text].length
  const textOf = (node: any): string => (node.children ?? []).map((child: any) => (typeof child === 'string' ? child : textOf(child))).join('')
  // The kit never paints, so a row's width is the sum of its Text widths: a Text child counts its text, a Box child is one row of its own Texts.
  const rowWidth = (node: any): number => (node.type === 'Text' ? cells(textOf(node)) : (node.children ?? []).reduce((sum: number, child: any) => sum + rowWidth(child), 0))

  // Rows a node draws: a Text is one row, a column Box stacks its children's rows, any other Box lays its children on one row.
  const drawnRows = (node: any): number => (node.type === 'Box' && node.props?.flexDirection === 'column' ? (node.children ?? []).reduce((sum: number, child: any) => sum + drawnRows(child), 0) : 1)

  for (const [name, recording] of [['g-open-1', calm], ['probe-2', looping]] as const) {
    for (const columns of WIDTHS) {
      let triesLines = 0
      const mount = { ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: BODY_ROWS } }, surface: 'terminal' }
      let previous: { t: number; rows: number } | undefined
      let shownSteps = 0
      for await (const step of replay($, rig, recording, { mount, find: { type: 'Box' } })) {
        const where = `${name} at ${columns} columns, step t=${step.t} (${step.kind})`
        const root: any = step.nodes
        const children: any[] = root?.children ?? []
        const block = children.find((child: any) => child.type === 'Box' && textOf((child.children ?? [])[0] ?? { children: [] }) === 'now building')
        if (!block) {
          previous = undefined
          continue
        }
        shownSteps++
        const rows: any[] = block.children ?? []
        // Every row of the block, and the looping tries line the pane draws beside it, fits the body width.
        for (const row of rows) {
          expect(rowWidth(row), `${where}: the now-building row "${textOf(row)}" (${rowWidth(row)} cells) fits the body width ${columns}`).toBeLessThanOrEqual(columns)
        }
        // The looping tries line is the child directly under the LOOPING row; when the run is not looping, OFF TRACK follows instead.
        const loopingAt = children.findIndex((node: any) => node.type === 'Text' && textOf(node).startsWith('LOOPING'))
        const under = loopingAt >= 0 ? children[loopingAt + 1] : undefined
        if (under && !textOf(under).startsWith('OFF TRACK')) {
          triesLines++
          expect(rowWidth(under), `${where}: the looping tries line "${textOf(under)}" fits the body width ${columns}`).toBeLessThanOrEqual(columns)
        }
        // No flicker: the block keeps its row count from one step to the next while it is shown.
        if (previous) expect(rows.length, `${where}: the block keeps ${previous.rows} rows from step t=${previous.t}`).toBe(previous.rows)
        previous = { t: step.t, rows: rows.length }
        // Nothing needs to scroll: the rows the pane draws (a column Box such as the block contributes all its rows) fit the body rows.
        const drawn = children.reduce((sum: number, child: any) => sum + drawnRows(child), 0)
        expect(drawn, `${where}: the pane draws ${drawn} rows, within the ${BODY_ROWS} body rows`).toBeLessThanOrEqual(BODY_ROWS)
      }
      expect(shownSteps, `${name} at ${columns} columns: the block was shown on some step`).toBeGreaterThan(0)
      if (name === 'probe-2') expect(triesLines, `${name} at ${columns} columns: the looping tries line was shown on some step`).toBeGreaterThan(0)
    }
  }
})

test('now-building-draws-legend-line', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-11-04T08:20:00.000Z') })
  const record = { stage: 'code-tdd', attempt: 1, done: true, passed: true, exitCodes: [0], timedOut: false, excerpt: '' }
  const ID = 'ten-percent-off'
  engine(on, {
    ...SNAPSHOT_RUNNING,
    stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: '2026-11-04T08:19:00.000Z' },
    tests: { perTest: { [ID]: { selector: { runner_id: 'pytest', test_file: 'tests/test_discount.py', test_function: ID }, red: record } } },
  })
  await start($)
  await $.agent.spawn({ prompt: 'p', description: 'd', name: `pb1 code-tdd GREEN implement-code ${ID} r1`, subagentType: 'pairingbuddy:implement-code' })

  const textOf = (node: any): string => (node.children ?? []).map((child: any) => (typeof child === 'string' ? child : textOf(child))).join('')
  const legendAt = async (columns: number) => {
    const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface: 'terminal' })
    const boxes: any[] = await pane.findAll({ type: 'Box' })
    await pane.unmount()
    const block = boxes.find(box => textOf((box.children ?? [])[0] ?? { children: [] }) === 'now building')
    expect(block, `the now-building block is drawn at ${columns} columns`).toBeDefined()
    const texts: any[] = (block.children ?? []).filter((child: any) => child.type === 'Text')
    return texts.find(text => textOf(text).startsWith('✓ made to pass'))
  }

  const wide = await legendAt(140)
  expect(wide, 'the legend Text is in the now-building block at 140 columns').toBeDefined()
  expect(textOf(wide), 'the wide legend lists all four entries').toBe('✓ made to pass   ◌ already passed, nothing to fix   ▸ now   · to do')
  expect(wide.props.dimColor, 'the legend is drawn faint').toBe(true)

  const narrow = await legendAt(55)
  expect(narrow, 'the legend Text is in the now-building block at 55 columns').toBeDefined()
  expect(textOf(narrow), 'at 55 columns the last two entries are dropped whole, nothing is cut mid-word').toBe('✓ made to pass   ◌ already passed, nothing to fix')
  expect(narrow.props.dimColor, 'the narrow legend is drawn faint').toBe(true)
})
