export const meta = { name: 'fanout', description: 'Same-type fan-out with a pinned pb_key' }
const schema = key => ({ type: 'object', properties: { pb_key: { type: 'string', enum: [key] }, token: { type: 'string' }, ambiguity: { type: ['string', 'null'] } }, required: ['pb_key', 'token', 'ambiguity'] })
const items = ['alpha', 'bravo', 'charlie']
const small = items.map(item => () => agent(`Return token "${item}-${item.length}" with pb_key as the schema requires and ambiguity null. Use no other tools.`, {
  label: `fan:${item}`, schema: schema(`fan.worker.${item}.r1.a1`), agentType: 'pbprobe:echoer', model: 'haiku',
}))
const large = () => agent('Read the file large.txt. Return its complete text, verbatim, as token, with pb_key as the schema requires and ambiguity null. Do not abbreviate.', {
  label: 'fan:large', schema: schema('fan.worker.large.r1.a1'), agentType: 'pbprobe:echoer', model: 'haiku',
})
const returned = await parallel([...small, large])
const after = await agent('Run the Bash command `ls .probe/artifacts`, then reply with its output verbatim.', { label: 'fan:after', agentType: 'pbprobe:echoer', model: 'haiku' })
return { returned: returned.map(r => r && { pb_key: r.pb_key, tokenLength: r.token.length, head: r.token.slice(0, 20) }), after }
