// Scenario suggestion-delivery-status: the pane names the next agent that will read a suggestion and switches
// when that agent spawns. Runs under `claude plugin test .`.
import { expect, test } from 'claude-code/testing'
import { SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING } from './testing/band'
import { paneTexts } from './testing/report'
import { PENDING_PHRASE, spawnStageAgent, startRunningPane, SUGGESTION_TEXT, typeIntoPane, typeSuggestion } from './testing/suggest'

test('pane-names-next-agent-after-suggest', async ($, on) => {
  await typeSuggestion($, on, { text: SUGGESTION_TEXT })

  const drawn = await paneTexts($)
  expect(drawn, 'the pane names the next agent in plain words (code-scenarios runs enumerate-scenarios-and-test-cases first)').toContain(`${PENDING_PHRASE}: listing scenarios`)
})

test('pane-says-delivered-after-next-spawn', async ($, on) => {
  await typeSuggestion($, on, { text: SUGGESTION_TEXT })
  await spawnStageAgent($, { stage: 'code-scenarios', role: 'enumerate-scenarios-and-test-cases' })

  const drawn = await paneTexts($)
  expect(drawn, 'the pane says the suggestion reached the agent that spawned').toContain('delivered to listing scenarios')
  expect(drawn.some((text) => text.includes(PENDING_PHRASE)), 'the pending line is gone once the agent spawned').toBe(false)
})

test('spawn-before-suggestion-is-not-delivery', async ($, on) => {
  await startRunningPane($, on, {})
  await spawnStageAgent($, { stage: 'code-scenarios', role: 'enumerate-scenarios-and-test-cases' })
  await typeIntoPane($, SUGGESTION_TEXT)

  const drawn = await paneTexts($)
  expect(drawn.some((text) => text.includes('delivered to')), 'a spawn before the suggestion was written is not a delivery').toBe(false)
  expect(drawn.some((text) => text.startsWith(PENDING_PHRASE)), 'the pane still shows the suggestion as pending').toBe(true)
})

// The pane line when the ledger cannot name the next agent: the pending phrase, then the plain fallback.
const FALLBACK_LINE = `${PENDING_PHRASE}: the next agent`

// Asserts the pending line is the plain fallback, not a guessed agent name.
async function expectFallbackLine($: any) {
  const line = (await paneTexts($)).find((text) => text.startsWith(PENDING_PHRASE))
  expect(line, 'the pane says "the next agent", not a guessed name').toBe(FALLBACK_LINE)
}

test('next-agent-unknown-falls-back-plain: after a spawn the successor is not derivable', async ($, on) => {
  await startRunningPane($, on, {})
  await spawnStageAgent($, { stage: 'code-scenarios', role: 'enumerate-scenarios-and-test-cases' })
  await typeIntoPane($, SUGGESTION_TEXT)

  await expectFallbackLine($)
})

// Each ledger that cannot name the next agent. No agent spawns, so the pane reaches the stage and task-type checks itself.
const UNDERIVABLE = [
  { name: 'no active stage', ledger: SNAPSHOT_NO_STAGE },
  { name: 'unknown task type', ledger: { ...SNAPSHOT_RUNNING, taskType: 'no_such_task_type' } },
]

for (const { name, ledger } of UNDERIVABLE) {
  test(`next-agent-unknown-falls-back-plain: ${name}`, async ($, on) => {
    await startRunningPane($, on, { ledger })
    await typeIntoPane($, SUGGESTION_TEXT)

    await expectFallbackLine($)
  })
}

test('next-agent-judges-only-active-stage-spawns', async ($, on) => {
  const ledger = { ...SNAPSHOT_RUNNING, stage: { ...SNAPSHOT_RUNNING.stage, name: 'code-tdd' } }
  await startRunningPane($, on, { ledger })
  await spawnStageAgent($, { stage: 'code-scenarios', role: 'enumerate-scenarios-and-test-cases' })
  await typeIntoPane($, SUGGESTION_TEXT)

  const drawn = await paneTexts($)
  expect(drawn, 'a spawn from an earlier stage does not count: the pane names the active stage\'s first agent (code-tdd runs create-test-placeholders first)').toContain(`${PENDING_PHRASE}: sketching the tests`)
})
