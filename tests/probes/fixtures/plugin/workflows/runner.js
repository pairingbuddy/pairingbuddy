export const meta = { name: 'runner', description: 'Tool calls inside workflow agents' }
const R = { type: 'object', properties: { bash: { type: 'string' }, denied: { type: 'string' }, read: { type: 'string' } }, required: ['bash', 'denied', 'read'] }
const P = 'Do these three steps. Bash `echo pb-allow`, put its output in bash. Bash `echo pb-deny-me`, put its output or error in denied. Read the file blocked.txt, put its content or error in read.'
const typed = await agent(P, { label: 'probe:typed', schema: R, agentType: 'pbprobe:echoer', model: 'haiku' })
const plain = await agent(P, { label: 'probe:plain', schema: R, model: 'haiku' })
return { typed, plain }
