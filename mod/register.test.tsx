import { expect, test } from 'claude-code/testing'
import { BAND, engine, start } from './testing/band'
import { PANE_ID } from './pane-open'
import { recordHooks } from './testing/hooks'

test('registers with the kit and loads without error under claude plugin test', async ($) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const drawn = await ui.find({ type: 'Text' })
  expect(drawn, 'the mod draws its band once registered').toBeDefined()
  await ui.unmount()
})

test("running the pb command returns a short non-empty text and opens the pairingbuddy pane", async ($, on) => {
  const { calls } = engine(on)
  await start($)

  const result: any = await $.command.run({ command: 'pb', args: '' })

  expect(typeof result?.text, 'the pb command answers with a text, so the engine reports no unanswered command').toBe('string')
  expect(result.text, 'the mod answers the command itself and does not pass it on to the engine, which would report it unanswered').not.toBe('unanswered by the test')
  expect(result.text.trim().length, 'the answer text is not empty').toBeGreaterThan(0)
  expect(result.text.length, 'the answer text is short').toBeLessThanOrEqual(200)
  expect(calls.opened.map(open => open.id), 'the pb command opens the pairingbuddy pane').toEqual([PANE_ID])
})
test("running a command other than pb opens no pane and is passed on unanswered", async ($, on) => {
  const { calls } = engine(on)
  await start($)

  const result: any = await $.command.run({ command: 'other', args: '' })

  expect(result?.text, 'the mod does not answer commands that belong to other plugins').toBe('unanswered by the test')
  expect(calls.opened, 'a command other than pb opens no pane').toEqual([])
})

test('pb-command-opens-pane-with-focus: running the pb command calls ui.open once with id pairingbuddy, focus true and closeOnEscape true, and without holdToasts', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  await $.command.run({ command: 'pb', args: '' })

  expect(calls.opened.length, 'the pb command calls ui.open once').toBe(1)
  expect(calls.opened[0].id, 'it opens the pairingbuddy pane').toBe(PANE_ID)
  expect(calls.opened[0].focus, 'the pane takes focus so its hotkeys work').toBe(true)
  expect(calls.opened[0].closeOnEscape, 'esc returns to the prompt').toBe(true)
  expect(calls.opened[0].holdToasts, 'the pane holds no toasts').toBeUndefined()
})

test('pb-reopens-pane-with-focus', async ($, on) => {
  const { calls } = engine(on)
  await start($)
  await $.command.run({ command: 'pb', args: '' })

  const result: any = await $.command.run({ command: 'pb', args: '' })

  expect(calls.opened.length, 'the second pb opens the pane again').toBe(2)
  expect(calls.opened[1].id, 'it opens the pairingbuddy pane').toBe(PANE_ID)
  expect(calls.opened[1].focus, 'the pane takes the keys again, the documented recovery').toBe(true)
  expect(result.text.trim().length, 'the answer text is still given').toBeGreaterThan(0)
})

test('tool-call-hook-records-calls-and-passes-through', () => {
  const registered = recordHooks().filter(hook => hook.event === 'tool.call')

  expect(registered.map(hook => hook.matcher), 'the mod registers one tool.call hook, for StructuredOutput calls').toEqual([{ tool: 'StructuredOutput' }])
})
