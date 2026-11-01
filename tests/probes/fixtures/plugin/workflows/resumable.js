export const meta = { name: 'resumable', description: 'Resume probe' }
const R = { type: 'object', properties: { done: { type: 'string' } }, required: ['done'] }
const first = await agent('Run the Bash command `echo x >> .probe/first.count`, then put the word ok in done.', { label: 'res:first', schema: R, agentType: 'pbprobe:echoer', model: 'haiku' })
if (args && args.stopAfterFirst) throw new Error('PROBE_STOP_AFTER_FIRST')
const second = await agent('Run the Bash command `echo x >> .probe/second.count`, then put the word ok in done.', { label: 'res:second', schema: R, agentType: 'pbprobe:echoer', model: 'haiku' })
return { first, second }
