// Scenario suggestion-delivery-status: the pane shows the note waiting, then names the agent that read it. Runs under `claude plugin test .`.
import { expect, test } from 'claude-code/testing'
import { paneTexts } from './testing/report'
import { buildLabel } from '../shared-node/labels.mjs'
import { NOTE_HEAD, WAITING_LINE, spawnStageAgent, startRunningPane, SUGGESTION_TEXT, runPbNote, leaveNote } from './testing/suggest'

test('pane-shows-the-note-waiting-for-the-next-agent', async ($, on) => {
  await leaveNote($, on, { text: SUGGESTION_TEXT })

  expect(await paneTexts($), 'the note, quoted, waits for the next agent').toContain(WAITING_LINE)
})

test('pane-says-delivered-after-next-spawn', async ($, on) => {
  await leaveNote($, on, { text: SUGGESTION_TEXT })
  await spawnStageAgent($, { stage: 'code-scenarios', role: 'enumerate-scenarios-and-test-cases' })

  const drawn = await paneTexts($)
  expect(drawn, 'the pane names the agent that read the note').toContain(`${NOTE_HEAD} · read by: listing scenarios`)
  expect(drawn, 'the waiting line is gone once the agent spawned').not.toContain(WAITING_LINE)
})

test('pane-says-delivered-to-workflow-agent-labelled-by-description', async ($, on) => {
  await leaveNote($, on, { text: SUGGESTION_TEXT })
  // A workflow script's agent() label arrives as the description, with no name.
  await $.agent.spawn({ prompt: 'p', description: 'pb1 code-scenarios - enumerate-scenarios-and-test-cases - r1', subagentType: 'pairingbuddy:enumerate-scenarios-and-test-cases', workflow: { runId: 'wf_1', agentIndex: 1 } })

  expect(await paneTexts($), 'the pane says the note reached the workflow agent').toContain(`${NOTE_HEAD} · read by: listing scenarios`)
})

test('spawn-before-suggestion-is-not-delivery', async ($, on) => {
  await startRunningPane($, on, {})
  await spawnStageAgent($, { stage: 'code-scenarios', role: 'enumerate-scenarios-and-test-cases' })
  await runPbNote($, SUGGESTION_TEXT)

  expect(await paneTexts($), 'a spawn before the note was written is not a delivery').toContain(WAITING_LINE)
})

// The lab run: the note was saved mid-TDD and the next spawn was a runner, which does nothing with a note.
test('a-runner-spawn-is-not-delivery', async ($, on) => {
  await leaveNote($, on, { text: SUGGESTION_TEXT })
  await spawnStageAgent($, { stage: 'code-tdd', role: 'runner' })

  expect(await paneTexts($), 'a runner never reads the note').toContain(WAITING_LINE)
})

test('a-cycle-agent-is-named-with-its-test', async ($, on) => {
  await leaveNote($, on, { text: SUGGESTION_TEXT })
  const name = buildLabel({ stage: 'code-tdd', phase: 'GREEN', role: 'implement-code', item: 'order-total-sums-line-totals', round: 1 })
  await $.agent.spawn({ prompt: 'p', description: name, subagentType: 'pairingbuddy:implement-code', workflow: { runId: 'wf_1', agentIndex: 1 } })

  expect(await paneTexts($)).toContain(`${NOTE_HEAD} · read by: making the test pass for order total sums line totals`)
})
