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
    case 'agent.spawn': {
      const spawn = { prompt: 'p', description: 'd', subagentType: 'pairingbuddy:classify-task' }
      return { surveyed: spawn, idle: spawn }
    }
    // A session with no one at the prompt has no band to feed, so the hook only hands it on.
    case 'session.start': {
      const start = { cwd: '/', surface: null, isInteractive: false }
      return { surveyed: start, idle: start }
    }
    // A session that ends without a clear only hands on.
    case 'session.end': {
      const end = { sessionId: 's1', reason: 'other' }
      return { surveyed: end, idle: end }
    }
    // Any command but /pb passes through untouched.
    case 'command.run': {
      const run = { command: 'other', args: '' }
      return { surveyed: run, idle: run }
    }
    // An agent's turn ended: the mod only notes the agent as finished and hands on.
    case 'turn.complete': {
      const turn = { answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' }
      return { surveyed: turn, idle: turn }
    }
    // A workflow agent's StructuredOutput call: the mod records it and hands on.
    case 'tool.call': {
      const call = {
        tool: 'StructuredOutput',
        tool_use_id: 'tu1',
        agentId: 'a1',
        pb_key: 'code-safety-net.lens.code.r1.a1',
        findings: [],
      }
      return { surveyed: call, idle: call }
    }
    default:
      throw new Error(`no representative events for the "${event}" hook: add a case to eventsFor`)
  }
}

// What a hook did with an event: the value it answered, or the error it let escape.
export async function outcome(call: () => unknown): Promise<{ value?: unknown; error?: unknown }> {
  try {
    return { value: await call() }
  } catch (error) {
    return { error }
  }
}

export function isDeny(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'deny' in value
}
