export const meta = { name: 'runner-allow', description: 'Runner command under a hook auto-allow, with a control' }
const allowed = await agent('Run the Bash command `touch .probe/pb-runner-cmd`, then reply with its output.', { label: 'runner:allowed', agentType: 'pbprobe:echoer', model: 'haiku' })
const control = await agent('Run the Bash command `touch .probe/pb-control-cmd`, then reply with its output.', { label: 'runner:control', agentType: 'pbprobe:echoer', model: 'haiku' })
return { allowed, control }
