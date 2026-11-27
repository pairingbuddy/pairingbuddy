// Scenario band-goal (seventh watched run): the band leads with the goal's gist, bold as the pane's GOAL, on its own row above
// the step, so the band is two rows at most. The gist is cut at a clause, else a word, never with "…".
import { expect, mock, test } from 'claude-code/testing'
import { BAND, SNAPSHOT_NO_STAGE, SNAPSHOT_RUNNING, engine, isSeparatorRule, start } from './testing/band'
import { needingHuman } from './testing/alert'
import { POLL_MS } from './poll'
import { goalGist, goalOf } from '../shared-node/end-state.mjs'

// The band's row gets this many fewer cells than bodyColumns: the pane's [-] control sits beside it.
const CONTROL_WIDTH = 4
const GOAL = goalOf(SNAPSHOT_RUNNING.task)

async function bandNodes($: any, bodyColumns: number) {
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'terminal' })
  const found = (await band.findAll({ type: 'Text' })).filter((node: any) => !isSeparatorRule(node))
  await band.unmount()
  return found as { text: string; props: Record<string, unknown> }[]
}

test('the-band-leads-with-the-goal-gist-in-bold-at-50-80-and-139-columns', async ($, on) => {
  engine(on, SNAPSHOT_RUNNING)
  await start($)

  for (const columns of [50, 80, 139]) {
    const [first, ...rest] = await bandNodes($, columns)
    const room = columns - CONTROL_WIDTH
    expect(first.text, `at ${columns} columns the band leads with the goal's gist`).toBe(goalGist(GOAL, room))
    expect(first.props.bold, 'bold, as the pane draws GOAL').toBe(true)
    expect(first.props.color, 'not coloured: colour means where the run is now, needs-you or a stop').toBeUndefined()
    expect([...first.text].length, `at ${columns} columns the goal fits its row`).toBeLessThanOrEqual(room)
    expect(first.text.endsWith('…'), 'never cut with an ellipsis').toBe(false)
    expect(rest.slice(0, 2).map(node => node.text).join(''), `at ${columns} columns the step follows the goal, behind the working mark`).toBe('● write test scenarios')
  }
})

// The band's rows as drawn: the outer column Box's children, the dim rule aside.
async function bandRows($: any, bodyColumns = 80) {
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'terminal' })
  const [outer] = await band.findAll({ type: 'Box' })
  await band.unmount()
  // A child is drawn as its description: a Text's words are its string children.
  const read = (child: any) => ({ ...child, text: (child?.children ?? []).filter((part: unknown) => typeof part === 'string').join('') })
  return (outer.children as any[]).map(read).filter(child => !(child.type === 'Text' && isSeparatorRule(child)))
}

test('the-goal-has-a-row-of-its-own-between-steps-and-after-the-run-the-bar-takes-it-at-a-question-and-none-while-idle', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const run = engine(on, null)
  await start($)
  const idle = await bandRows($)
  const shown: Record<string, any[]> = {}
  const states: [string, unknown][] = [
    ['a question', needingHuman()],
    ['between steps', SNAPSHOT_NO_STAGE],
    ['after the run', null],
  ]
  for (const [name, ledger] of states) {
    run.serve(ledger)
    await clock.advance(POLL_MS)
    shown[name] = await bandRows($)
  }

  expect(idle.length, 'idle, with no run, the band is one row').toBe(1)
  for (const [name] of states) {
    expect(shown[name].length, `${name}: the goal row (or the bar), then the step row: two rows at most`).toBe(2)
    // A loud state's bar takes the goal's row; the pane keeps the goal.
    if (name === 'a question') expect(shown[name][0].type, `${name}: the first row is the bar`).toBe('Box')
    else expect(shown[name][0].text, `${name}: the first row is the goal`).toBe(goalGist(GOAL, 80 - CONTROL_WIDTH))
  }
})
