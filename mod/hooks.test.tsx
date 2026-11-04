import { expect, test } from 'claude-code/testing'
import { eventsFor, isDeny, outcome, recordHooks } from './testing/hooks'

// Nothing of the engine is reachable: a hook that passes an event through must not touch `$`.
const UNTOUCHED = new Proxy({}, {
  get: (_, key) => {
    throw new Error(`pass-through touched $.${String(key)}`)
  },
})

test('every registered hook hands the event to next when a survey owns the slot', () => {
  for (const { event, matcher, hook } of recordHooks()) {
    const fed = eventsFor(event, matcher).surveyed
    const handedOn = Symbol('next result')
    const received: unknown[] = []
    const next = (e: unknown) => {
      received.push(e)
      return handedOn
    }

    const result = hook(UNTOUCHED, fed, next)

    expect(received, `${event} hook calls next once with the event it was fed`).toEqual([fed])
    expect(result, `${event} hook returns what next returned`).toBe(handedOn)
  }
})

test('no registered hook answers deny, with a normal next or a rejecting one', async () => {
  for (const { event, matcher, hook } of recordHooks()) {
    const { surveyed } = eventsFor(event, matcher)
    const failure = new Error('next rejected')

    const normal = await outcome(() => hook(UNTOUCHED, surveyed, (e: unknown) => e))
    const rejecting = await outcome(() => hook(UNTOUCHED, surveyed, () => Promise.reject(failure)))

    expect(isDeny(normal.value), `${event} hook does not deny with a normal next`).toBe(false)
    expect(isDeny(rejecting.value), `${event} hook does not deny when next rejects`).toBe(false)
    expect(rejecting.error, `${event} hook lets the rejection of next through`).toBe(failure)
  }
})

test('no ui.render hook answers deny when its own code throws, and it lets the error through', async () => {
  for (const { event, matcher, hook } of recordHooks().filter(recorded => recorded.event === 'ui.render')) {
    const { idle } = eventsFor(event, matcher)
    const injected = new Error('injected by the test: ui.resolve threw')
    // Targets the idle render path, the one that resolves its components through `$.ui.resolve`.
    const throwingResolve = {
      ui: {
        resolve: () => {
          throw injected
        },
      },
    }

    const throwing = await outcome(() => hook(throwingResolve, idle, (e: unknown) => e))

    expect(isDeny(throwing.value), `${event} hook does not deny when its own code throws`).toBe(false)
    expect(throwing.error, `${event} hook lets its own error through`).toBe(injected)
  }
})
