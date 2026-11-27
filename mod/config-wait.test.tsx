// Scenario config-wait: the human changed .pairingbuddy/test-config.json mid-stage, so the CLI ended the attempt and set the
// run waiting on them (needsHuman config-changed, with its fix line). The pane says NEEDS YOU in plain words, never a stop.
import { expect, test } from 'claude-code/testing'
import { SNAPSHOT_RUNNING, engine, start } from './testing/band'
import { paneLines } from './testing/replay'

const FIX = 'answer the question in the session, or type !.pairingbuddy/bin/pb human accept'
const WAITING = {
  ...SNAPSHOT_RUNNING,
  stage: { ...SNAPSHOT_RUNNING.stage, status: 'failed' },
  needsHuman: { gate: 'config-changed', reason: 'the config hash changed', seq: SNAPSHOT_RUNNING.seq + 1, askedAt: SNAPSHOT_RUNNING.stage.startedAt, fix: FIX },
}

const statusOf = (lines: string[]) => {
  const at = lines.findIndex(line => line.startsWith('STATUS'))
  return lines.slice(at, at + 2).map(line => line.replace(/^(STATUS)?\s+/, ''))
}

test('a changed test-config reads as needs you: answer the question, or the accept line', async ($, on) => {
  engine(on, WAITING)
  await start($)

  const status = statusOf(await paneLines($, { bodyColumns: 120 }))

  expect(status[0], 'STATUS says what to do, in plain words').toBe('⏸ WAITING FOR YOU · the test settings changed: check and accept them')
  expect(status[1], 'the fix line follows').toContain(FIX)
})
