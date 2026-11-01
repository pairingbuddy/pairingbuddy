export const meta = { name: 'unknown-caught', description: 'Unknown agentType inside try/catch' }
try {
  const value = await agent('Reply with the word ran.', { label: 'probe:unknown', agentType: 'pbprobe:does-not-exist', model: 'haiku' })
  return { threw: false, value: value === undefined ? 'undefined' : value }
} catch (err) {
  return { threw: true, error: String(err) }
}
