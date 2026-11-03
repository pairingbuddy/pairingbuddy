import { register } from '../register'

// Shared by the mod's tests. It lives outside the `*.test.tsx` pattern, so `claude plugin test` does
// not run it, and outside register.tsx's imports, so it is not part of the mod itself.

export type Recorded = { event: string; matcher: Record<string, unknown>; hook: Function }

// Records every hook the mod registers, whatever it is, instead of listing them. Fails when the mod
// registers nothing, so a loop over the hooks can never pass by running zero times.
export function recordHooks(): Recorded[] {
  const recorded: Recorded[] = []
  const on = (event: string, ...rest: unknown[]) => {
    const hook = rest[rest.length - 1] as Function
    const matcher = (rest.length > 1 ? rest[0] : {}) as Record<string, unknown>
    recorded.push({ event, matcher, hook })
    return {}
  }
  register(on as never, {} as never)
  if (recorded.length === 0) {
    throw new Error('the mod registers no hook')
  }
  return recorded
}

// Representative events per registered event name. A hook whose event has no entry fails loudly,
// so whoever registers a new hook has to say what a realistic event for it looks like.
export type Events = { surveyed: unknown; idle: unknown }

export function eventsFor(event: string, matcher: Record<string, unknown>): Events {
  switch (event) {
    case 'ui.render':
      return {
        surveyed: { ...matcher, surface: 'terminal', props: { hasSurvey: true } },
        idle: { ...matcher, surface: 'terminal', props: { hasSurvey: false } },
      }
    default:
      throw new Error(`no representative events for the "${event}" hook: add a case to eventsFor`)
  }
}
