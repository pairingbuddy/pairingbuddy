// What the mod keeps of an agent.spawn event. A workflow script's agent() label reaches the spawn as its description
// (the agent's transcript meta records it there), with `workflow` set and no `name`.
import { expect, test } from 'claude-code/testing'
import { spawnOf } from './inputs'

test('a workflow agent spawn with no name keeps its description as the label', () => {
  const label = 'pb1 code-safety-net - lens code r1'
  const spawn = spawnOf({ description: label, subagentType: 'pairingbuddy:lens', workflow: { runId: 'wf_1', agentIndex: 3 } })
  expect(spawn).toEqual({ kind: 'workflow_agent', name: label, subagentType: 'pairingbuddy:lens' })
})
