export const meta = { name: 'budget', description: 'budget.spent with no target' }
const before = { total: budget.total, spent: budget.spent(), remaining: String(budget.remaining()) }
const text = await agent('Reply with the word ok and nothing else.', { label: 'budget:agent', model: 'haiku' })
return { before, after: { spent: budget.spent() }, text }
