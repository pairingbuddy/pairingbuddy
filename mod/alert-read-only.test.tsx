// Scenario: mod-stays-read-only. Alerting does not break the mod's invariants.
import { expect, mock, test } from 'claude-code/testing'
import { POLL_MS } from './poll'
import { BAND, LEDGER_PATH, ROOT, SNAPSHOT_RUNNING, start } from './testing/band'
import { isDeny, outcome, recordHooks } from './testing/hooks'
import { PANE } from './testing/replay'
import { openedKey, seenKey } from './alert'
import { refuseWorldChanges } from './testing/refuse'
import { alertEngine, needingHuman, stopped } from './testing/alert'

const STANDING = {
  stop: () => stopped({ code: 'step-failed' }),
  needsHuman: () => needingHuman(),
}

for (const [standing, ledger] of Object.entries(STANDING)) {
  test(`alert-hooks-never-deny: ${standing}`, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const run = alertEngine(on, { ledger: ledger(), play: 'reject', store: 'reject', open: 'reject' })

    const started = await outcome(() => start($))
    const polled = await outcome(() => clock.advance(POLL_MS))
    const spawned = await outcome(() => $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'pairingbuddy:implement-tests' }))
    const cleared = await outcome(() => $.session.end({ sessionId: 's1', reason: 'clear' }))
    const ended = await outcome(() => $.session.end({ sessionId: 's1', reason: 'other' }))
    const commanded = await outcome(() => $.command.run({ command: 'other', args: '' }))
    const turned = await outcome(() => $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' }))
    const band = await outcome(() => $.ui.mount({ ...BAND, surface: 'terminal' }))
    const pane = await outcome(() => $.ui.mount({ ...PANE, surface: 'terminal' }))

    expect(run.calls.played.length, `the alert tried the sound while the ${standing} stood, so the failing effects were exercised`).toBeGreaterThan(0)
    const hooks = { 'session.start': started, poll: polled, 'agent.spawn': spawned, 'session.end clear': cleared, 'session.end other': ended, 'command.run': commanded, 'turn.complete': turned, 'ui.render band': band, 'ui.render pane': pane }
    for (const [name, result] of Object.entries(hooks)) {
      expect(result.error, `${name} does not throw while the ${standing} stands and the alert's effects fail`).toBeUndefined()
      expect(isDeny(result.value), `${name} does not deny while the ${standing} stands and the alert's effects fail`).toBe(false)
    }
    const driven = new Set(['session.start', 'session.end', 'agent.spawn', 'command.run', 'turn.complete', 'ui.render'])
    for (const { event } of recordHooks()) {
      expect(driven.has(event), `the mod registers a "${event}" hook this test does not drive: add it here`).toBe(true)
    }
  })
}

for (const [standing, ledger] of Object.entries(STANDING)) {
  test(`alert-writes-no-run-state: ${standing}`, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const run = alertEngine(on, { ledger: ledger() })
    const touched: string[] = []
    const stateSet: string[] = []
    // Anything that changes the world beneath the mod is recorded and refused.
    refuseWorldChanges(on, touched)
    on('state.set', (_: unknown, e: { key: string }) => {
      stateSet.push(e.key)
      return { value: { isSet: true, version: 1 } }
    })

    await start($)
    await clock.advance(POLL_MS)
    // The second poll covers the already-seen path: re-polling a standing event writes nothing either.
    await clock.advance(POLL_MS)

    expect(run.calls.played.length, `the alert fired while the ${standing} stood, so the write paths were exercised`).toBeGreaterThan(0)
    expect(touched, `alerting on a ${standing} makes no $.fs write and no $.process call`).toEqual([])
    expect([...run.store.keys()], `the ${standing} was recorded as seen in the mod's own store`).toEqual([seenKey(ROOT)])
    expect(stateSet, `the alert's own writes went to $.state`).toContain(openedKey())
  })
}

// A stop with a seq but no code is not here: an older ledger's code-less stop still reads as stopped (stop-without-code-falls-back), so it still alerts.
const QUIET: Record<string, (run: ReturnType<typeof alertEngine>) => void> = {
  'no ledger': (run) => run.serve(null),
  'an unreadable ledger': (run) => run.serveRaw('not json at all'),
  'a truncated ledger': (run) => run.serveRaw(JSON.stringify(stopped()).slice(0, -1)),
  'a ledger of the wrong shape': (run) => run.serve([stopped()]),
  'a stop missing its seq': (run) => run.serve({ ...SNAPSHOT_RUNNING, seq: 3, stop: { reason: 'the stage failed', code: 'step-failed' } }),
  'a stop that is not an object': (run) => run.serve({ ...SNAPSHOT_RUNNING, seq: 3, stop: 'step-failed' }),
}

for (const [shown, serve] of Object.entries(QUIET)) {
  test(`alert-without-ledger-is-quiet: ${shown}`, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    // The baseline is a stop that would alert, so a case that fails to apply its override cannot pass quietly.
    const run = alertEngine(on, { ledger: stopped() })
    serve(run)

    await start($)
    await clock.advance(POLL_MS)

    expect(run.served.asked, `the ledger was polled, so ${shown} was actually met`).toContain(LEDGER_PATH)
    expect(run.calls.played, `no sound for ${shown}`).toEqual([])
    expect(run.calls.status, `no status for ${shown}`).toEqual([])
    expect(run.calls.opened, `no pane opened for ${shown}`).toEqual([])
  })
}
