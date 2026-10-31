// Fixture mod. The harness replaces the two placeholders when it copies the plugin.
import type { Register } from 'claude-code'
const LOG = '__PROBE_DIR__/mod.jsonl'
const REWRITE_MODEL = '__REWRITE_MODEL__'
const lines: string[] = []
const put = async ($: any, tag: string, data: unknown) => {
  lines.push(JSON.stringify({ tag, data }))
  await $.fs.write(LOG, lines.join('\n') + '\n')
}
export const register: Register = on => {
  on('agent.spawn', async ($, e, next) => {
    await put($, 'spawn', { type: e.subagentType, desc: e.description, wf: e.workflow, model: (e as any).model, promptHead: e.prompt.slice(0, 60) })
    if (e.prompt.startsWith('Reply ok.')) return { deny: 'pbprobe: out of order' }
    const r = await next(REWRITE_MODEL ? { ...e, model: REWRITE_MODEL } : e)
    await put($, 'spawned', r)
    return r
  })
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Workflow' && String((e as any).name).endsWith('modgated')) return { deny: 'pbprobe: stage order: gate not approved' }
    const r = await next(e)
    await put($, 'tool', { tool: e.tool, keys: Object.keys(e), agentId: (e as any).agentId, isError: (r as any).isError })
    return r
  })
  on('turn.complete', async ($, e, next) => {
    await put($, 'turn.complete', { keys: Object.keys(e), agentId: (e as any).agentId, usage: (e as any).usage, reason: e.reason })
    return next(e)
  })
}
