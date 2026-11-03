import { expect, test } from 'claude-code/testing'
import { eventsFor, recordHooks } from './testing/hooks'

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

// What a hook did with an event: the value it answered, or the error it let escape.
async function outcome(call: () => unknown): Promise<{ value?: unknown; error?: unknown }> {
  try {
    return { value: await call() }
  } catch (error) {
    return { error }
  }
}

function isDeny(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'deny' in value
}

test('no registered hook answers deny, including when a hook body throws', async () => {
  for (const { event, matcher, hook } of recordHooks()) {
    const { surveyed, idle } = eventsFor(event, matcher)
    const failure = new Error('next rejected')
    const injected = new Error('injected by the test: ui.resolve threw')
    // Targets the idle render path, the one that resolves its components through `$.ui.resolve`.
    const throwingResolve = {
      ui: {
        resolve: () => {
          throw injected
        },
      },
    }

    const normal = await outcome(() => hook(UNTOUCHED, surveyed, (e: unknown) => e))
    const rejecting = await outcome(() => hook(UNTOUCHED, surveyed, () => Promise.reject(failure)))
    const throwing = await outcome(() => hook(throwingResolve, idle, (e: unknown) => e))

    expect(isDeny(normal.value), `${event} hook does not deny with a normal next`).toBe(false)
    expect(isDeny(rejecting.value), `${event} hook does not deny when next rejects`).toBe(false)
    expect(rejecting.error, `${event} hook lets the rejection of next through`).toBe(failure)
    expect(isDeny(throwing.value), `${event} hook does not deny when its own code throws`).toBe(false)
    expect(throwing.error, `${event} hook lets its own error through`).toBe(injected)
  }
})
