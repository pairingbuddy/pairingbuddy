export const meta = { name: 'stage2', description: 'Second stage' }
return await agent('Run the Bash command `touch .probe/stage2.done`, then reply done.', { label: 'stage:two', agentType: 'pbprobe:echoer', model: 'haiku' })
