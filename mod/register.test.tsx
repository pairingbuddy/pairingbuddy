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

test('a second /pb closes the open pane, and a third opens it again', async ($, on) => {
  const { calls } = engine(on)
  await start($)
  await $.command.run({ command: 'pb', args: '' })

  const closed: any = await $.command.run({ command: 'pb', args: '' })
  const reopened: any = await $.command.run({ command: 'pb', args: '' })

  expect(calls.closed.map(close => close.id), 'the second /pb closes the pane it opened').toEqual([PANE_ID])
  expect(closed.text, 'and says so').toBe('Pairing Buddy pane closed')
  expect(calls.opened.length, 'the third /pb opens it again').toBe(2)
  expect(reopened.text, 'and says so').toBe('Pairing Buddy pane opened')
})

test('a /pb right after the one that closed the pane opens it, though the engine still lists the pane as shown', async ($, on) => {
  const { calls, shown } = engine(on)
  await start($)
  await $.command.run({ command: 'pb', args: '' })
  const closed: any = await $.command.run({ command: 'pb', args: '' })
  // The engine's list lags the close: the pane is still listed shown and placed after it.
  shown.add(PANE_ID)

  const opened: any = await $.command.run({ command: 'pb', args: '' })
  const closedAgain: any = await $.command.run({ command: 'pb', args: '' })

  expect([closed.text, opened.text, closedAgain.text], 'consecutive /pb answers alternate').toEqual(['Pairing Buddy pane closed', 'Pairing Buddy pane opened', 'Pairing Buddy pane closed'])
  expect(calls.opened.length, 'the /pb after a close opens the pane again').toBe(2)
  expect(calls.closed.length, 'and the one after that closes it').toBe(2)
})

test('tool-call-hook-records-calls-and-passes-through', () => {
  const registered = recordHooks().filter(hook => hook.event === 'tool.call')

  expect(registered.map(hook => hook.matcher), 'the mod registers two tool.call hooks: StructuredOutput calls, and Bash calls for what pb publish opened').toEqual([{ tool: 'StructuredOutput' }, { tool: 'Bash' }])
})

test('pb is registered as a command that runs while Claude is working', async ($, on) => {
  const { calls } = engine(on)

  await start($)

  const spec = calls.registered.find(command => command.name === 'pb')
  expect(spec?.immediate, 'the pb command runs at once, also mid-turn').toBe(true)
})
