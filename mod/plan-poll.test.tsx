import { test } from 'claude-code/testing'

test('with a ledger naming a plan path and a plan MD on disk, the poll returns the parsed plan units', async () => {
  throw new Error('not implemented: poll-reads-plan-from-ledger-path')
})

test('after the plan MD changes between polls (a box is ticked), the next poll returns the updated tree', async () => {
  throw new Error('not implemented: poll-picks-up-plan-change')
})

test('a plan path that is missing, empty or unreadable yields no plan and does not throw', async () => {
  throw new Error('not implemented: poll-unreadable-plan-reads-as-none')
})

test('polling and rendering the plan tree writes no file outside reports/', async () => {
  throw new Error('not implemented: view-writes-nothing-outside-reports')
})
