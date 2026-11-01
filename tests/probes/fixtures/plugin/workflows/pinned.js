export const meta = { name: 'pinned', description: 'Agents pinned to dearer models' }
const opus = await agent('Reply ok', { label: 'pin:opus', agentType: 'pbprobe:pinned-opus' })
const sonnet = await agent('Reply ok', { label: 'pin:sonnet', agentType: 'pbprobe:pinned-sonnet' })
return { opus, sonnet }
