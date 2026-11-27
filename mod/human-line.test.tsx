// Scenario human-line: the run waits on a line only the human types (a config proposal's apply or refuse, a refusal whose
// only way through is a pb human verb). The pane and the band say WAITING FOR YOU with the line, never "working".
import { expect, test } from 'claude-code/testing'
import { paneLines, setupReplay } from './testing/replay'
import { LEDGER, SNAPSHOT_RUNNING, bandTexts } from './testing/band'
import { UNIT, UNIT_FILE, serve } from './testing/big-task'
import { firstGlance } from './testing/glance'

const PROPOSALS = '.pairingbuddy/run/config-proposals.json'
const APPLY = '!.pairingbuddy/bin/pb human config apply 1'
const REFUSE = '!.pairingbuddy/bin/pb human config refuse 1'
const proposal = { n: 1, file: 'git-config.json', key: 'pr.title_template', old: '{type}: {summary}', new: 'KEY-1 {summary}', reason: 'the team puts the ticket key first', status: 'pending', at: '2026-11-14T10:00:20.000Z', lines: { apply: APPLY, refuse: REFUSE } }
// Every step done, nothing running: the session waits on the human's line.
const BETWEEN = { ...SNAPSHOT_RUNNING, stage: { ...SNAPSHOT_RUNNING.stage, status: 'done' } }

test('a pending config proposal reads as waiting for you, with the apply and refuse lines', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: BETWEEN, [PROPOSALS]: { proposals: [proposal] } })

  const lines = await paneLines($, { bodyColumns: 120 })
  const glance = firstGlance(lines)

  expect(glance[0], `the bar says what waits: ${JSON.stringify(glance)}`).toBe('⏸ WAITING FOR YOU · apply or refuse the pr.title_template change')
  expect(lines.join('\n'), 'WHY gives the apply line').toContain(APPLY)
  expect(lines.join('\n'), 'and the refuse line').toContain(REFUSE)
})

test('the band leads with the same wait, not "all steps done"', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [LEDGER]: BETWEEN, [PROPOSALS]: { proposals: [proposal] } })

  const band = (await bandTexts($, { bodyColumns: 120 })).join('')

  expect(band, 'the band bar says what waits').toContain('⏸ WAITING FOR YOU · apply or refuse the pr.title_template change')
  expect(band).not.toContain('all steps done')
})

test('with no run open, a pending proposal still reads as waiting for you', async ($, on) => {
  const rig = setupReplay(on)
  await serve($, rig, { [UNIT]: UNIT_FILE, [PROPOSALS]: { proposals: [proposal] } })

  const glance = firstGlance(await paneLines($, { bodyColumns: 120 }))
  const band = (await bandTexts($, { bodyColumns: 120 })).join('')

  expect(glance[0], JSON.stringify(glance)).toBe('⏸ WAITING FOR YOU · apply or refuse the pr.title_template change')
  expect(band).toContain('⏸ WAITING FOR YOU · apply or refuse the pr.title_template change')
})

test('a refusal pb handed the human a line for reads as waiting for you, with that line', async ($, on) => {
  const rig = setupReplay(on)
  const line = '!.pairingbuddy/bin/pb test --full'
  const refusal = { verb: 'task end', message: `the last full suite run failed, so the task cannot end. Nothing was touched: ask the human to type ${line}`, lines: [line], at: '2026-11-14T10:00:20.000Z' }
  await serve($, rig, { [LEDGER]: BETWEEN, '.pairingbuddy/run/human-wait.json': refusal })

  const lines = await paneLines($, { bodyColumns: 120 })

  expect(firstGlance(lines)[0]).toBe('⏸ WAITING FOR YOU · type the line pb task end gave you')
  expect(lines.join('\n')).toContain(line)
})
