export const meta = { name: 'stage1', description: 'First stage' }
return await agent('Run the Bash command `touch .probe/stage1.done`, then reply done.', { label: 'stage:one', agentType: 'pbprobe:echoer', model: 'haiku' })
