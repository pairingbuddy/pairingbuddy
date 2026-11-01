export const meta = { name: 'unknown-raw', description: 'Unknown agentType with no catch' }
const value = await agent('Reply with the word ran.', { label: 'probe:unknown-raw', agentType: 'pbprobe:does-not-exist', model: 'haiku' })
return { value }
