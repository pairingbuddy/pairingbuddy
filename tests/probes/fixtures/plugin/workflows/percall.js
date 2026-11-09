export const meta = { name: 'percall', description: 'Per-call model against an agent pin' }
const up = await agent('Reply with the word ok', { label: 'percall:haiku-pin+sonnet', agentType: 'pbprobe:pinned-haiku', model: 'claude-sonnet-5-5' })
const down = await agent('Reply with the word ok', { label: 'percall:sonnet-pin+haiku', agentType: 'pbprobe:pinned-sonnet', model: 'claude-haiku-5-5' })
const plain = await agent('Reply with the word ok', { label: 'percall:plain+sonnet', model: 'claude-sonnet-5-5' })
return { up, down, plain }
