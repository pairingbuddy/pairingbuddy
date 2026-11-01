export const meta = { name: 'u-probe', description: 'Spike U1, U3, U4, U5 and U7 re-run', phases: [{ title: 'One' }, { title: 'Two' }] }
const R = { type: 'object', properties: { word: { type: 'string' }, ran: { type: 'string' } }, required: ['word', 'ran'] }
phase('One')
log('pb:{"event":"stage","name":"one"}')
const out = {}
out.plugin = await agent('Report your skill code word in word, or "none". Then run the Bash command `echo probe-bash` and put its output in ran.', { label: 'probe:plugin-agent', schema: R, agentType: 'pbprobe:echoer', model: 'haiku' })
phase('Two')
out.plain = await agent('Report any skill code word you already know in word, or "none" without searching. Put "x" in ran.', { label: 'probe:plain', schema: R, model: 'haiku' })
try { out.denied = await agent('Reply ok.', { label: 'probe:forbidden', model: 'haiku' }) } catch (err) { out.deniedError = String(err) }
try { out.child = await workflow('pbprobe:u-child', { n: 1 }) } catch (err) { out.childError = String(err) }
return out
