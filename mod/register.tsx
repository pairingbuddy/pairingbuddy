import type { EngineInterface, Register } from 'claude-code'

const LEDGER = '.pairingbuddy/run/task/ledger.json'

// Never throws: an absent, empty, truncated or partial ledger, or an unreadable session root, reads as undefined.
async function readLedger($: EngineInterface): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(`${await $.session.root()}/${LEDGER}`))
  } catch {
    return undefined
  }
}

function hasCurrentStage(ledger: unknown): boolean {
  const stage = (ledger as { stage?: { name?: unknown; status?: unknown } } | null | undefined)?.stage
  return typeof stage?.name === 'string' && stage.name !== '' && stage.status === 'active'
}

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return readLedger($).then(ledger => (
      <Box>
        <Text dimColor>{hasCurrentStage(ledger) ? 'Workflow running' : 'Workflow idle'}</Text>
      </Box>
    ))
  })
}
