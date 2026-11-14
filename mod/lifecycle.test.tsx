import { expect, mock, test } from 'claude-code/testing'
import { BAND, LEDGER_PATH, ROOT, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, start, texts } from './testing/band'
import { POLL_MS } from './poll'
import { PANE } from './testing/replay'
import { plainName } from '../shared-node/plain-names.mjs'

const TESTS_PATH = `${ROOT}/.pairingbuddy/tests.json`
const label = (item: string) => `pb1 code-tdd RED implement-tests ${item} r1`

// Files the engine serves and how often the ledger was read. While `hold` is set, a ledger read waits for it.
function engine(on: Function, files: Record<string, string>) {
  const run = { files, ledgerReads: 0, hold: undefined as Promise<void> | undefined }
  on('session.root', () => ({ value: ROOT }))
  on('session.start', () => ({ cwd: ROOT }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('fs.read', async (_: unknown, e: { path: string }) => {
    if (e.path === LEDGER_PATH) {
      run.ledgerReads++
      await run.hold
    }
    return e.path in run.files ? { value: run.files[e.path] } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path in run.files }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_: unknown, e: { path: string }) =>
    e.path in run.files
      ? { value: { kind: 'file', size: run.files[e.path].length, mtimeMs: 0, isLink: false } }
      : { deny: `ENOENT ${e.path}` })
  return run
}

const spawn = ($: any, name: string) => $.agent.spawn({ prompt: 'p', description: 'd', name, subagentType: 'pairingbuddy:implement-tests' })
const agentsIn = (shown: string[]) => shown.find(text => /\d+ agents?/.test(text))?.match(/\d+ agents?/)?.[0]

test('a session.end with reason clear empties the spawn history, so the next draw\'s agent count restarts, while the poller keeps running', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = engine(on, { [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING) })
  await start($)
  await spawn($, label('one'))
  await spawn($, label('two'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(agentsIn(await texts(band)), 'two agents are counted before the clear').toBe('2 agents')

  await $.session.end({ sessionId: 's1', reason: 'clear' })
  await spawn($, label('three'))
  const readsAfterClear = run.ledgerReads
  run.files[LEDGER_PATH] = JSON.stringify(SNAPSHOT_NO_STAGE)
  await clock.advance(POLL_MS)

  expect(run.ledgerReads, 'the poller read the ledger again after the clear').toBeGreaterThan(readsAfterClear)
  expect(await texts(band), 'the poller still redraws the band: the ledger is now between steps').toEqual([expect.stringMatching(/^Pairing Buddy · between steps · next: .+ · \/pb( for details)?$/)])
  run.files[LEDGER_PATH] = JSON.stringify(SNAPSHOT_RUNNING)
  await clock.advance(POLL_MS)
  expect(agentsIn(await texts(band)), 'only the agent spawned after the clear is counted').toBe('1 agent')
  await band.unmount()
})

test('a second session.start does not start a second poller', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = engine(on, { [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING) })
  await start($)
  await start($)

  const before = run.ledgerReads
  await clock.advance(POLL_MS)

  expect(run.ledgerReads - before, 'one poll per interval, from one poller').toBe(1)
})

test('ticks do not overlap while a poll is still running', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = engine(on, { [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING) })
  await start($)
  let release!: () => void
  run.hold = new Promise(resolve => { release = resolve })

  const before = run.ledgerReads
  await clock.advance(POLL_MS * 5)
  const started = run.ledgerReads - before
  release()

  expect(started, 'five ticks while the first poll is still reading start one poll').toBe(1)
})

test('a tests.json entry without a test_id is not counted', async ($, on) => {
  engine(on, {
    [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING),
    [TESTS_PATH]: JSON.stringify({ tests: [{ test_id: 'first' }, {}, { test_id: '' }, { test_id: 'last' }] }),
  })
  await start($)
  await spawn($, label('first'))

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const shown = await texts(band)
  await band.unmount()

  expect(shown, 'the band reads "test 1 of 2": the entries without an id are left out').toContain('RED · test 1 of 2')
})

test("when a new run ledger appears the pane shows the new run and its ended snapshot replaces the old one", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = engine(on, { [LEDGER_PATH]: JSON.stringify(SNAPSHOT_RUNNING) })
  await start($)
  const steps = async () => {
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const shown = await texts(pane)
    await pane.unmount()
    return shown.filter(text => /^[▸✓○] /.test(text))
  }
  const first = plainName('code-scenarios')
  const second = plainName('code-config')

  delete run.files[LEDGER_PATH]
  await clock.advance(POLL_MS)
  const afterFirstEnd = await steps()
  run.files[LEDGER_PATH] = JSON.stringify({ ...SNAPSHOT_RUNNING, taskType: 'config_change', stage: { ...SNAPSHOT_RUNNING.stage, name: 'code-config' } })
  await clock.advance(POLL_MS)
  const whileSecondRuns = await steps()
  delete run.files[LEDGER_PATH]
  await clock.advance(POLL_MS)
  const afterSecondEnd = await steps()

  expect(afterFirstEnd.some(line => line.includes(first)), `the first ended run is shown: ${JSON.stringify(afterFirstEnd)}`).toBe(true)
  expect(whileSecondRuns.some(line => line.includes(second)), `the new run is shown: ${JSON.stringify(whileSecondRuns)}`).toBe(true)
  expect(afterSecondEnd.some(line => line.includes(second)), `the snapshot is the new run's: ${JSON.stringify(afterSecondEnd)}`).toBe(true)
  expect(afterSecondEnd.some(line => line.includes(first)), `the old run's steps are gone: ${JSON.stringify(afterSecondEnd)}`).toBe(false)
})

// Seq 10 of tests/smoke/recordings/t59-healthy/ledger.jsonl, copied whole (the mod cannot import node:fs): the first ledger with tests.perTest.
const SEQ_10 = JSON.parse(String.raw`{"v": 1, "seq": 10, "sha": "0f70898fb178bbe4824746de4eaf987367828d5b86174f7a83c49f83727c4e11", "kind": "code", "taskType": "bug_fix", "runId": "599dd6da-b4a0-4cc9-ac06-ca4c07f567c2", "owner": {"sessionId": "3855343a-c693-4213-9f52-91a2ff2021ef", "lastSeen": "2026-11-04T08:13:24.369Z"}, "task": "Fix this bug in discount.py: apply_discount(100, 10) returns 10 and it should return 90. One regression test for exactly that case is the whole scope", "plan": {"path": "", "title": ""}, "configHash": "7f0e44e3b566f99a7f833786814dd84e0df93b5f018ef8b1b74f0681cec6d54d", "policy": {"mode": "auto", "source": "permission_mode"}, "stage": {"name": "code-tdd", "status": "active", "runId": "wf_a0587b6b-b6b", "attempt": 1, "startedAt": "2026-11-04T08:13:42.543Z"}, "stages": [{"name": "code-scenarios", "status": "done", "attempt": 1, "startedAt": "2026-11-04T08:13:26.472Z", "spend": {"agents": 1, "tokens": 0, "tokensKnown": false}}], "gates": {"G:scenarios": {"source": "auto"}}, "tests": {"perTest": {"apply-discount-100-by-10-returns-90": {"selector": {"runner_id": "pytest", "test_file": "tests/test_discount.py", "test_function": "test_apply_discount_100_by_10_returns_90"}, "red": {"stage": "code-tdd", "attempt": 1, "done": false, "sha": null, "passed": true, "exitCodes": [1], "timedOut": false, "excerpt": "F                                                                        [100%]\n=================================== FAILURES ===================================\n___________________ test_apply_discount_100_by_10_returns_90 ___________________\n\n    def test_apply_discount_100_by_10_returns_90():\n        sut = apply_discount\n    \n        result = sut(100, 10)\n    \n>       assert result == 90, f\"apply_discount(100, 10) should return 90, got {result}\"\nE       AssertionError: apply_discount(100, 10) should return 90, got 10.0\nE       assert 10.0 == 90\n\ntests/test_discount.py:13: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_discount.py::test_apply_discount_100_by_10_returns_90 - Ass...\n1 failed in 0.01s\n", "head": "e1fc011d2e796e9967569a647f37c4bbfd255900"}}}}, "commits": ["e1fc011d2e796e9967569a647f37c4bbfd255900"], "retries": {}, "spend": {"agents": 1, "tokens": 0, "tokensKnown": false}, "stop": null, "needsHuman": null, "checkpoints": [{"step": "placeholders", "key": "code-tdd.create-test-placeholders.-.r1.a1", "committed": true, "sha": "e1fc011d2e796e9967569a647f37c4bbfd255900", "base": "78e0229728ea4434289aab03ffd42072085b4fc5", "stage": "code-tdd", "attempt": 1}]}`)
const PER_TEST = 'apply-discount-100-by-10-returns-90'

test('tests-read-from-ledger-per-test: with the real seq 10 ledger and no tests.json on disk, the band and the pane NOW row show "test 1" with no "of", and no LEFT row is drawn', async ($, on) => {
  engine(on, { [LEDGER_PATH]: JSON.stringify(SEQ_10) })
  await start($)
  await spawn($, label(PER_TEST))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const shownBand = (await texts(band)).join(' | ')
  const shownPane = await texts(pane)
  const now = shownPane.find(text => text.startsWith('NOW')) ?? ''
  const left = shownPane.find(text => text.startsWith('LEFT'))

  expect(shownBand, 'the band names the test position').toMatch(/test 1\b/)
  expect(shownBand, 'the band does not claim a total').not.toMatch(/test 1 of/)
  expect(now, 'the pane NOW row names the test position').toMatch(/test 1\b/)
  expect(now, 'the pane NOW row does not claim a total').not.toMatch(/\bof\b/)
  expect(left, 'LEFT is not drawn: perTest does not give the total, so nothing is known to be left').toBeUndefined()
  await band.unmount()
  await pane.unmount()
})
