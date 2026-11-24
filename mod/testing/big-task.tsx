// A big task the pane must keep short (docs/design/progress-mod/DIRECTION.md, "Long lists"), mid-build and at its end, served
// to the mod as its files and spawns: for long-lists and pane-height. Like ./replay it is not part of the mod itself.
import { POLL_MS } from '../poll'
import { LEDGER, ROOT, SNAPSHOT_RUNNING, start } from './band'
import type { Rig } from './replay'

export const TDD_START = '2026-11-14T10:00:00.000Z'

export async function serve($: any, rig: Rig, files: Record<string, unknown>, at = '2026-11-14T10:00:30.000Z') {
  rig.served.clear()
  for (const [path, value] of Object.entries(files)) rig.served.set(`${ROOT}/${path}`, typeof value === 'string' ? value : JSON.stringify(value))
  await rig.clock.set(Date.parse(at))
  await start($)
  await rig.clock.advance(POLL_MS * 2)
}

// A big task: 15 scenarios holding 40 tests, 20 changed files, 8 review findings, and names and titles over 100 characters.
export const LONG = 'and keeps the order currency, rounding and tax lines exactly as the cart recorded them at checkout time'
export const TEST_COUNTS = [4, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 1, 1, 1, 1]
export const BIG_TESTS = TEST_COUNTS.flatMap((count, s) => Array.from({ length: count }, (_, t) => ({ id: `s${s + 1}-t${t + 1}`, scenario: s })))
export const BIG_SCENARIOS = {
  scenarios: TEST_COUNTS.map((_, s) => ({
    description: `order_total scenario ${s + 1} ${LONG}`,
    test_cases: BIG_TESTS.filter(test => test.scenario === s).map(test => ({ test_case_id: `case-${test.id}`, description: `${test.id} sums one line total ${LONG}` })),
  })),
}
export const BIG_TESTS_FILE = { tests: BIG_TESTS.map(test => ({ test_id: test.id, test_case_id: `case-${test.id}` })) }
export const BIG_FILES = Array.from({ length: 20 }, (_, i) => ({ path: `src/shop/checkout/order_total_part_${i + 1}_with_a_long_module_name.py`, status: 'M' }))
export const BIG_TASK = `Add order_total to cart.py so that it sums price times quantity over every line ${LONG}. Then document it.`
export const UNIT = '.pairingbuddy/run/unit.json'
export const UNIT_FILE = { unit: null, plan: null, tracer: null, branch: 'feat/order-total', base: 'main', baseSha: 'abc', tasks: [], commits: [] }
export const doneStage = (name: string, startedAt: string) => ({ name, status: 'done', attempt: 1, startedAt, spend: { agents: 1, tokens: 0, tokensKnown: false } })

export const cellsOf = (line: string) => [...line].length
export const tooWide = (lines: string[], columns: number) => lines.filter(line => cellsOf(line) > columns)

export async function bigBuild($: any, rig: Rig) {
  // Ten tests done, the eleventh in RED, 29 waiting.
  const perTest = Object.fromEntries(BIG_TESTS.slice(0, 11).map((test, i) => [test.id, i < 10 ? { red: { done: true }, green: { passed: true, done: true } } : {}]))
  const ledger = { ...SNAPSHOT_RUNNING, task: BIG_TASK, taskType: 'new_feature', stage: { name: 'code-tdd', status: 'active', runId: null, attempt: 1, startedAt: TDD_START }, tests: { perTest } }
  await serve($, rig, { [LEDGER]: ledger, '.pairingbuddy/tests.json': BIG_TESTS_FILE, '.pairingbuddy/scenarios.json': BIG_SCENARIOS, '.pairingbuddy/run/changed.json': BIG_FILES })
  await $.agent.spawn({ prompt: 'p', description: `pb1 code-tdd RED implement-tests ${BIG_TESTS[10].id} r1`, subagentType: 'pairingbuddy:implement-tests', workflow: { runId: 'wf_1', agentIndex: 1 } })
}

export async function bigEnd($: any, rig: Rig) {
  const safetyNet = '2026-11-14T10:20:00.000Z'
  const perTest = Object.fromEntries(BIG_TESTS.map(test => [test.id, { red: { done: true }, green: { passed: true, done: true } }]))
  const ledger = {
    ...SNAPSHOT_RUNNING, kind: 'code', task: BIG_TASK, taskType: 'new_feature', runId: 'code-run',
    stage: { name: 'code-safety-net', status: 'done', runId: null, attempt: 1, startedAt: safetyNet },
    stages: [doneStage('intake', TDD_START), doneStage('code-scenarios', TDD_START), doneStage('code-tdd', TDD_START), doneStage('code-safety-net', safetyNet)],
    gates: { 'G:task-end': { source: 'human-cli', answer: 'approve' } }, tests: { perTest }, fixes: { rollbacks: [] },
  }
  await serve($, rig, { [LEDGER]: ledger, [UNIT]: UNIT_FILE, '.pairingbuddy/tests.json': BIG_TESTS_FILE, '.pairingbuddy/scenarios.json': BIG_SCENARIOS, '.pairingbuddy/run/changed.json': BIG_FILES }, '2026-11-14T10:20:30.000Z')
  const findings = Array.from({ length: 8 }, (_, i) => ({ rule: '', severity: 'low', kind: 'drift', title: `Finding ${i + 1} says order_total ${LONG}`, claim: `Claim ${i + 1}. ${LONG}.`, where: `src/shop/checkout/order_total_part_${i + 1}_with_a_long_module_name.py:${i + 10}` }))
  for (const [lens, part] of [['code', findings.slice(0, 5)], ['corpus-misalignment', findings.slice(5)]] as const) {
    const spawned = await $.agent.spawn({ prompt: 'p', description: `pb1 code-safety-net - lens ${lens} r1`, subagentType: 'pairingbuddy:lens', workflow: { runId: 'wf_1', agentIndex: 1 } })
    await $.tool.call({ tool: 'StructuredOutput', tool_use_id: `tu-${lens}`, pb_key: `code-safety-net.lens.${lens}.r1.a1`, ambiguity: null, findings: part, agentId: spawned.agentId })
  }
  await rig.clock.advance(POLL_MS * 2)
}
