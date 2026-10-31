export const meta = { name: 'u-env', description: 'Spike U2 and U8 re-run' }
const R = { type: 'object', properties: { root: { type: 'string' }, pwd: { type: 'string' }, wrote: { type: 'string' } }, required: ['root', 'pwd', 'wrote'] }
return await agent('Run `printenv CLAUDE_PLUGIN_ROOT` (root), then `pwd` (pwd), then `date > ledger-probe.txt && cat ledger-probe.txt` (wrote). Report outputs verbatim, or the error text if a command was denied.', { label: 'stage:env', schema: R, agentType: 'pbprobe:echoer', model: 'haiku' })
